/**
 * offlineDataService.ts — прокси-слой между UI и данными.
 *
 * Стратегия «offline-first»:
 *  ● READ (список/форма):
 *    - online  → запрос к API, результат кэшируется в Dexie
 *    - offline → чтение из Dexie
 *
 *  ● WRITE (create/update/delete):
 *    - Всегда записываем в Dexie сразу (мгновенная реакция UI)
 *    - online  → отправляем на сервер, при успехе — обновляем Dexie серверной версией
 *    - offline → добавляем в _pendingChanges, будет push при следующем sync
 *
 * Этот модуль НЕ заменяет apiClient — он используется как надстройка
 * в useInfiniteModelList и useFormStore.
 */

import apiClient from "src/services/api/client";
import { isNetworkError as isNetworkLike } from "./networkUtils";
import { getIsOnline } from "./networkStatus";
import { crypto } from "src/utils/main.module";
import {
  offlineDb,
  SYNCABLE_TABLES,
  type SyncRecord,
  upsertRecords,
  getRecordByUuid,
  getActiveRecords,
  countActiveRecords,
  searchRecords,
  addPendingChange,
} from "./offlineDb";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Проверяет, является ли endpoint синхронизируемой таблицей */
export function isSyncableEndpoint(endpoint: string): boolean {
  return (SYNCABLE_TABLES as readonly string[]).includes(endpoint);
}

/** Нормализует endpoint: убирает начальный слеш */
function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/^\/+/, "");
}

// ═══════════════════════════════════════════════════════════════════════════
// READ — получение списка
// ═══════════════════════════════════════════════════════════════════════════

export interface OfflineListParams {
  limit?: number;
  cursor?: number | null;
  sort?: Record<string, "asc" | "desc"> | null;
  search?: string;
  searchColumns?: string[];
  filter?: Record<string, unknown>;
}

export interface OfflineListResult<T = SyncRecord> {
  items: T[];
  nextCursor: number | null;
  hasMore: boolean;
  total: number;
  /** true если данные получены из локального кэша */
  fromCache: boolean;
}

/**
 * Получить список записей. При online — с сервера (+ кэш в Dexie).
 * При offline — из Dexie.
 */
export async function fetchList<T = SyncRecord>(
  endpoint: string,
  params?: OfflineListParams,
  apiParams?: Record<string, any>,
): Promise<OfflineListResult<T>> {
  const ep = normalizeEndpoint(endpoint);
  const syncable = isSyncableEndpoint(ep);

  // ── Online: пробуем сервер ──
  if (getIsOnline()) {
    try {
      const response = await apiClient.get(`/${ep}`, { params: apiParams });
      const data = response.data;

      // Кэшируем в Dexie (в фоне, не блокируя UI)
      if (syncable && Array.isArray(data.items) && data.items.length > 0) {
        upsertRecords(ep, data.items).catch((err) =>
          console.warn(`[OfflineData] Ошибка кэширования ${ep}:`, err),
        );
      }

      return {
        items: data.items ?? [],
        nextCursor: data.nextCursor ?? null,
        hasMore: data.hasMore ?? false,
        total: data.total ?? data.items?.length ?? 0,
        fromCache: false,
      };
    } catch (err: any) {
      // Если сеть упала во время запроса — fallback на Dexie
      if (isNetworkLike(err) && syncable) {
        console.warn(`[OfflineData] Fallback на кэш для ${ep}`);
        return fetchFromDexie<T>(ep, params);
      }
      throw err;
    }
  }

  // ── Offline: читаем из Dexie ──
  if (syncable) {
    return fetchFromDexie<T>(ep, params);
  }

  // Несинхронизируемая таблица и нет сети — пустой результат
  return {
    items: [],
    nextCursor: null,
    hasMore: false,
    total: 0,
    fromCache: true,
  };
}

/** Чтение из Dexie с пагинацией и поиском */
async function fetchFromDexie<T>(
  endpoint: string,
  params?: OfflineListParams,
): Promise<OfflineListResult<T>> {
  const limit = params?.limit ?? 200;
  const offset = params?.cursor ?? 0;

  // Определяем поле и направление сортировки
  let sortField = "id";
  let sortDir: "asc" | "desc" = "desc";
  if (params?.sort) {
    const entries = Object.entries(params.sort);
    if (entries.length > 0) {
      [sortField, sortDir] = entries[0];
    }
  }

  let items: SyncRecord[];
  let total: number;

  if (params?.search) {
    // Поиск
    items = await searchRecords(endpoint, params.search, params.searchColumns);
    total = items.length;
    // Сортировка
    items.sort((a, b) => {
      const va = (a as any)[sortField];
      const vb = (b as any)[sortField];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return sortDir === "desc"
        ? (vb > va ? 1 : vb < va ? -1 : 0)
        : (va > vb ? 1 : va < vb ? -1 : 0);
    });
    // Пагинация
    items = items.slice(offset, offset + limit);
  } else {
    total = await countActiveRecords(endpoint);
    items = await getActiveRecords(endpoint, {
      limit,
      offset,
      sortField,
      sortDir,
    });
  }

  const hasMore = offset + items.length < total;
  const nextCursor = hasMore ? offset + items.length : null;

  return {
    items: items as unknown as T[],
    nextCursor,
    hasMore,
    total,
    fromCache: true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// READ — получение одной записи
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Получить одну запись по uuid. При online — с сервера + кэш.
 * При offline — из Dexie.
 */
export async function fetchOne<T = SyncRecord>(
  endpoint: string,
  uuid: string,
): Promise<{ item: T; fromCache: boolean } | null> {
  const ep = normalizeEndpoint(endpoint);
  const syncable = isSyncableEndpoint(ep);

  // ── Online ──
  if (getIsOnline()) {
    try {
      const response = await apiClient.get(`/${ep}/${uuid}`);
      const item = response.data?.item ?? response.data;

      // Кэш в Dexie
      if (syncable && item) {
        upsertRecords(ep, [item]).catch((err) =>
          console.warn(`[OfflineData] Ошибка кэширования ${ep}/${uuid}:`, err),
        );
      }

      return { item: item as T, fromCache: false };
    } catch (err: any) {
      if (isNetworkLike(err) && syncable) {
        console.warn(`[OfflineData] Fallback на кэш для ${ep}/${uuid}`);
        const cached = await getRecordByUuid(ep, uuid);
        if (cached) return { item: cached as unknown as T, fromCache: true };
      }
      throw err;
    }
  }

  // ── Offline ──
  if (syncable) {
    const cached = await getRecordByUuid(ep, uuid);
    if (cached) return { item: cached as unknown as T, fromCache: true };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// WRITE — создание
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Создать запись. При online — на сервере + в Dexie.
 * При offline — в Dexie + pendingChanges.
 */
export async function createRecord<T = SyncRecord>(
  endpoint: string,
  data: Record<string, unknown>,
): Promise<{ item: T; offline: boolean }> {
  const ep = normalizeEndpoint(endpoint);
  const syncable = isSyncableEndpoint(ep);
  const now = new Date().toISOString();

  // Генерируем временный uuid если не передан
  const uuid = (data.uuid as string) || crypto.randomUUID();

  // ── Online ──
  if (getIsOnline()) {
    try {
      const response = await apiClient.post(`/${ep}`, { ...data, uuid });
      const item = response.data?.item ?? response.data;

      // Offline-interceptor вернул заглушку
      if (response.data?._offline) {
        return handleOfflineCreate(ep, syncable, uuid, data, now);
      }

      // Кэш
      if (syncable && item) {
        upsertRecords(ep, [item]).catch(console.warn);
      }

      return { item: item as T, offline: false };
    } catch (err: any) {
      if (isNetworkLike(err) && syncable) {
        return handleOfflineCreate(ep, syncable, uuid, data, now);
      }
      throw err;
    }
  }

  // ── Offline ──
  return handleOfflineCreate<T>(ep, syncable, uuid, data, now);
}

async function handleOfflineCreate<T>(
  endpoint: string,
  syncable: boolean,
  uuid: string,
  data: Record<string, unknown>,
  now: string,
): Promise<{ item: T; offline: boolean }> {
  const record = {
    ...data,
    uuid,
    createdAt: now,
    updatedAt: now,
  };

  if (syncable) {
    await upsertRecords(endpoint, [record as SyncRecord]);
    await addPendingChange({
      table: endpoint,
      uuid,
      action: "create",
      data: record,
      clientUpdatedAt: now,
    });
  }

  return { item: record as unknown as T, offline: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// WRITE — обновление
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Обновить запись. При online — на сервере + в Dexie.
 * При offline — в Dexie + pendingChanges.
 */
export async function updateRecord<T = SyncRecord>(
  endpoint: string,
  uuid: string,
  data: Record<string, unknown>,
): Promise<{ item: T; offline: boolean }> {
  const ep = normalizeEndpoint(endpoint);
  const syncable = isSyncableEndpoint(ep);
  const now = new Date().toISOString();

  // ── Online ──
  if (getIsOnline()) {
    try {
      const response = await apiClient.put(`/${ep}/${uuid}`, data);

      if (response.data?._offline) {
        return handleOfflineUpdate(ep, syncable, uuid, data, now);
      }

      const item = response.data?.item ?? response.data;

      if (syncable && item) {
        upsertRecords(ep, [item]).catch(console.warn);
      }

      return { item: item as T, offline: false };
    } catch (err: any) {
      if (isNetworkLike(err) && syncable) {
        return handleOfflineUpdate(ep, syncable, uuid, data, now);
      }
      throw err;
    }
  }

  // ── Offline ──
  return handleOfflineUpdate<T>(ep, syncable, uuid, data, now);
}

async function handleOfflineUpdate<T>(
  endpoint: string,
  syncable: boolean,
  uuid: string,
  data: Record<string, unknown>,
  now: string,
): Promise<{ item: T; offline: boolean }> {
  if (syncable) {
    // Мержим с существующей записью
    const existing = await getRecordByUuid(endpoint, uuid);
    const merged = { ...existing, ...data, uuid, updatedAt: now };
    await upsertRecords(endpoint, [merged as SyncRecord]);

    // Проверяем, нет ли уже pending create для этого uuid
    const pendingCreates = await offlineDb._pendingChanges
      .where("[table+uuid]")
      .equals([endpoint, uuid])
      .filter((p) => p.action === "create")
      .count()
      .catch(() => 0);

    if (pendingCreates > 0) {
      // Обновляем данные в существующем pending create
      const creates = await offlineDb._pendingChanges
        .where("table").equals(endpoint)
        .filter((p) => p.uuid === uuid && p.action === "create")
        .toArray();
      for (const c of creates) {
        if (c.id != null) {
          await offlineDb._pendingChanges.update(c.id, {
            data: merged,
            clientUpdatedAt: now,
          });
        }
      }
    } else {
      await addPendingChange({
        table: endpoint,
        uuid,
        action: "update",
        data,
        clientUpdatedAt: now,
      });
    }
  }

  const result = { ...data, uuid, updatedAt: now };
  return { item: result as unknown as T, offline: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// WRITE — удаление (soft delete)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Soft delete записи.
 */
export async function deleteRecord(
  endpoint: string,
  uuid: string,
): Promise<{ offline: boolean }> {
  const ep = normalizeEndpoint(endpoint);
  const syncable = isSyncableEndpoint(ep);
  const now = new Date().toISOString();

  // ── Online ──
  if (getIsOnline()) {
    try {
      const response = await apiClient.delete(`/${ep}/${uuid}`);

      if (response.data?._offline) {
        return handleOfflineDelete(ep, syncable, uuid, now);
      }

      // Мягкое удаление в Dexie
      if (syncable) {
        const existing = await getRecordByUuid(ep, uuid);
        if (existing) {
          await upsertRecords(ep, [{ ...existing, deletedAt: now }]);
        }
      }

      return { offline: false };
    } catch (err: any) {
      if (isNetworkLike(err) && syncable) {
        return handleOfflineDelete(ep, syncable, uuid, now);
      }
      throw err;
    }
  }

  // ── Offline ──
  return handleOfflineDelete(ep, syncable, uuid, now);
}

async function handleOfflineDelete(
  endpoint: string,
  syncable: boolean,
  uuid: string,
  now: string,
): Promise<{ offline: boolean }> {
  if (syncable) {
    const existing = await getRecordByUuid(endpoint, uuid);
    if (existing) {
      await upsertRecords(endpoint, [{ ...existing, deletedAt: now }]);
    }
    await addPendingChange({
      table: endpoint,
      uuid,
      action: "delete",
      clientUpdatedAt: now,
    });
  }
  return { offline: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

export default {
  fetchList,
  fetchOne,
  createRecord,
  updateRecord,
  deleteRecord,
  isSyncableEndpoint,
};
