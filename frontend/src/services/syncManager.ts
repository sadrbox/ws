/**
 * syncManager.ts — двусторонняя синхронизация между клиентом и сервером.
 *
 * ┌─────────┐   pull (server→client)    ┌──────────┐
 * │  Server │ ─────────────────────────→ │ IndexedDB│
 * │  (API)  │ ←───────────────────────── │ (Dexie)  │
 * └─────────┘   push (client→server)    └──────────┘
 *
 * Pull: GET /sync/pull с lastSyncAt → сервер возвращает изменённые записи → upsert в Dexie
 * Push: собираем _pendingChanges → POST /sync/push → обработка конфликтов
 *
 * Стратегия:
 *  1. Сначала push (отправить локальные изменения)
 *  2. Потом pull (скачать серверные изменения)
 *  Это гарантирует, что при pull мы получим актуальные данные, включая свои изменения.
 */

import apiClient from "src/services/api/client";
import { logger } from "src/utils/logger";
import { isNetworkError } from "./networkUtils";
import {
  ensureOfflineDb,
  SYNCABLE_TABLES,
  type SyncableTable,
  getLastSyncAt,
  setLastSyncAt,
  getAllPendingChanges,
  removePendingChange,
  upsertRecords,
} from "./offlineDb";
import { getIsOnline } from "./networkStatus";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface SyncResult {
  success: boolean;
  /** Количество записей, полученных с сервера (pull) */
  pulled: number;
  /** Количество изменений, отправленных на сервер (push) */
  pushed: number;
  /** Конфликты, обнаруженные при push */
  conflicts: SyncConflict[];
  /** Ошибки при push */
  errors: SyncError[];
  /** Время начала синхронизации */
  startedAt: string;
  /** Время окончания */
  finishedAt: string;
  /** Общее время (мс) */
  durationMs: number;
}

export interface SyncConflict {
  uuid: string;
  table: string;
  clientData: Record<string, unknown>;
  serverData: Record<string, unknown>;
  serverUpdatedAt: string;
}

export interface SyncError {
  uuid: string;
  table: string;
  error: string;
}

export type SyncStatus =
  | "idle"
  | "pulling"
  | "pushing"
  | "resolving"
  | "done"
  | "error";

export interface SyncState {
  status: SyncStatus;
  progress: number;        // 0..100
  message: string;
  lastResult: SyncResult | null;
  lastSyncAt: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// State & Subscriptions
// ═══════════════════════════════════════════════════════════════════════════

type Listener = () => void;
const listeners = new Set<Listener>();

let syncState: SyncState = {
  status: "idle",
  progress: 0,
  message: "",
  lastResult: null,
  lastSyncAt: null,
};

function notify(): void {
  for (const l of listeners) l();
}

function setState(patch: Partial<SyncState>): void {
  syncState = { ...syncState, ...patch };
  notify();
}

export function getSyncState(): SyncState {
  return syncState;
}

export function subscribeSyncManager(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// ═══════════════════════════════════════════════════════════════════════════
// Abort control
// ═══════════════════════════════════════════════════════════════════════════

let abortController: AbortController | null = null;

export function abortSyncManager(): void {
  abortController?.abort();
  abortController = null;
  setState({ status: "idle", progress: 0, message: "Синхронизация отменена" });
}

// ═══════════════════════════════════════════════════════════════════════════
// Главная функция: fullSync
// ═══════════════════════════════════════════════════════════════════════════

/** Лок, чтобы не запускать две синхронизации параллельно */
let isSyncing = false;

/**
 * Полная двусторонняя синхронизация.
 * @param tables — список таблиц для синхронизации (по умолчанию — все)
 */
export async function fullSync(
  tables?: SyncableTable[],
): Promise<SyncResult> {
  if (isSyncing) {
    return emptyResult();
  }
  if (!getIsOnline()) {
    // Тихо возвращаем пустой результат — не логируем как ошибку
    return emptyResult();
  }

  isSyncing = true;
  abortController = new AbortController();
  const startedAt = new Date().toISOString();
  const start = Date.now();

  const tablesToSync = tables ?? [...SYNCABLE_TABLES];

  const result: SyncResult = {
    success: true,
    pulled: 0,
    pushed: 0,
    conflicts: [],
    errors: [],
    startedAt,
    finishedAt: "",
    durationMs: 0,
  };

  try {
    // ── Шаг 1: PUSH (клиент → сервер) ──
    setState({ status: "pushing", progress: 10, message: "Отправка локальных изменений..." });
    const pushResult = await pushChanges();
    if (abortController?.signal.aborted) throw new DOMException("Aborted", "AbortError");

    result.pushed = pushResult.applied;
    result.conflicts = pushResult.conflicts;
    result.errors = pushResult.errors;

    // ── Шаг 2: PULL (сервер → клиент) ──
    setState({ status: "pulling", progress: 40, message: "Загрузка обновлений с сервера..." });
    const pullResult = await pullChanges(tablesToSync);
    if (abortController?.signal.aborted) throw new DOMException("Aborted", "AbortError");

    result.pulled = pullResult.totalRecords;

    // ── Готово ──
    result.finishedAt = new Date().toISOString();
    result.durationMs = Date.now() - start;
    result.success = result.errors.length === 0;

    const lastSync = new Date().toISOString();
    setState({
      status: "done",
      progress: 100,
      message: `Синхронизировано: ↓${result.pulled} ↑${result.pushed}` +
        (result.conflicts.length > 0 ? ` ⚠${result.conflicts.length} конфликтов` : ""),
      lastResult: result,
      lastSyncAt: lastSync,
    });

    logger.info(
      `[SyncManager] Завершено за ${result.durationMs}ms: pulled=${result.pulled}, pushed=${result.pushed}, conflicts=${result.conflicts.length}`,
    );

    return result;

  } catch (err: unknown) {
    if ((err as Error)?.name === "AbortError") {
      return emptyResult();
    }
    // При сетевых ошибках — тихо переключаемся в idle, не пугаем пользователя
    if (isNetworkError(err)) {
      setState({
        status: "idle",
        progress: 0,
        message: "Нет связи с сервером",
      });
    } else {
      console.error("[SyncManager] Ошибка:", err);
      setState({
        status: "error",
        progress: 0,
        message: (err as Error)?.message || "Ошибка синхронизации",
        lastResult: result,
      });
    }
    result.success = false;
    result.finishedAt = new Date().toISOString();
    result.durationMs = Date.now() - start;
    return result;
  } finally {
    isSyncing = false;
    abortController = null;
    // Через 3 секунды сбрасываем статус обратно в idle
    setTimeout(() => {
      if (syncState.status === "done" || syncState.status === "error") {
        setState({ status: "idle", progress: 0 });
      }
    }, 3000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUSH — отправка локальных изменений на сервер
// ═══════════════════════════════════════════════════════════════════════════

/** Ссылка на строку в ответе синхронизации (конфликт/ошибка): таблица + uuid. */
interface SyncRowRef {
  table: string;
  uuid: string;
}

interface PushResult {
  applied: number;
  conflicts: SyncConflict[];
  errors: SyncError[];
}

async function pushChanges(): Promise<PushResult> {
  const pending = await getAllPendingChanges();
  if (pending.length === 0) {
    return { applied: 0, conflicts: [], errors: [] };
  }

  // Формируем массив changes для API
  const changes = pending.map((p) => ({
    table: p.table,
    action: p.action,
    uuid: p.uuid,
    data: p.data ?? {},
    clientUpdatedAt: p.clientUpdatedAt,
  }));

  try {
    const response = await apiClient.post("/sync/push", { changes }, {
      signal: abortController?.signal,
    });
    const body = response.data;

    if (!body.success) {
      throw new Error(body.message || "Ошибка push");
    }

    // Удаляем успешно синхронизированные записи из pending
    // Если сервер не вернул детализацию applied, удаляем все кроме conflicts/errors
    if (body.applied > 0) {
      // Удаляем все pending, кроме тех, что попали в conflicts/errors
      const conflictUuids = new Set(
        (body.conflicts ?? []).map((c: SyncRowRef) => `${c.table}:${c.uuid}`),
      );
      const errorUuids = new Set(
        (body.errors ?? []).map((e: SyncRowRef) => `${e.table}:${e.uuid}`),
      );

      for (const p of pending) {
        const key = `${p.table}:${p.uuid}`;
        if (!conflictUuids.has(key) && !errorUuids.has(key) && p.id != null) {
          await removePendingChange(p.id);
        }
      }
    }

    return {
      applied: body.applied ?? 0,
      conflicts: body.conflicts ?? [],
      errors: body.errors ?? [],
    };
  } catch (err: unknown) {
    if ((err as Error)?.name === "AbortError") throw err;
    // Если сеть пропала во время push — оставляем pending как есть (тихо)
    const isNetwork = isNetworkError(err);
    if (!isNetwork) {
      console.error("[SyncManager] Push failed:", err);
    }
    return {
      applied: 0,
      conflicts: [],
      errors: isNetwork
        ? [] // Сетевые ошибки — не ошибки приложения, просто нет связи
        : [{ uuid: "", table: "*", error: (err as Error)?.message || "Push failed" }],
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PULL — загрузка изменений с сервера
// ═══════════════════════════════════════════════════════════════════════════

interface PullResult {
  totalRecords: number;
  tablesUpdated: string[];
}

async function pullChanges(tables: SyncableTable[]): Promise<PullResult> {
  // Собираем lastSyncAt для каждой таблицы, берём минимальный
  // (для простоты используем один pull-запрос на все таблицы)
  let oldestSync: string | null = null;
  for (const t of tables) {
    const last = await getLastSyncAt(t);
    if (!last) {
      // Если хотя бы одна таблица никогда не синхронизировалась — тянем всё
      oldestSync = null;
      break;
    }
    if (!oldestSync || new Date(last) < new Date(oldestSync)) {
      oldestSync = last;
    }
  }

  try {
    const response = await apiClient.post("/sync/pull", {
      lastSyncAt: oldestSync,
      tables,
    }, {
      signal: abortController?.signal,
      timeout: 60_000, // 60 секунд на pull (может быть много данных)
    });
    const body = response.data;

    if (!body.success) {
      throw new Error(body.message || "Ошибка pull");
    }

    const serverTime = body.serverTime as string;
    const data = body.data as Record<string, any[]>;

    let totalRecords = 0;
    const tablesUpdated: string[] = [];

    // Записываем в Dexie пачками
    for (const [tableName, records] of Object.entries(data)) {
      if (!Array.isArray(records) || records.length === 0) continue;

      if (abortController?.signal.aborted) throw new DOMException("Aborted", "AbortError");

      setState({
        message: `Сохранение: ${tableName} (${records.length} записей)...`,
        progress: 40 + Math.round((tablesUpdated.length / tables.length) * 50),
      });

      await upsertRecords(tableName, records);
      totalRecords += records.length;
      tablesUpdated.push(tableName);

      // Обновляем lastSyncAt для этой таблицы
      await setLastSyncAt(tableName, serverTime);
    }

    // Для таблиц, в которых не было изменений — тоже обновляем lastSyncAt
    for (const t of tables) {
      if (!tablesUpdated.includes(t)) {
        await setLastSyncAt(t, serverTime);
      }
    }

    return { totalRecords, tablesUpdated };

  } catch (err: unknown) {
    if ((err as Error)?.name === "AbortError") throw err;
    // Сетевые ошибки при pull — тихо, это нормальная ситуация при оффлайне
    if (!isNetworkError(err)) {
      console.error("[SyncManager] Pull failed:", err);
    }
    return { totalRecords: 0, tablesUpdated: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Инкрементальная синхронизация конкретной таблицы
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Быстрый pull одной таблицы (вызывается при возврате online или по таймеру).
 */
export async function pullSingleTable(table: SyncableTable): Promise<number> {
  if (!getIsOnline()) return 0;

  const lastSync = await getLastSyncAt(table);

  try {
    const response = await apiClient.post("/sync/pull", {
      lastSyncAt: lastSync,
      tables: [table],
    }, { timeout: 30_000 });
    const body = response.data;
    if (!body.success) return 0;

    const records = body.data?.[table];
    if (!Array.isArray(records) || records.length === 0) {
      // Обновляем timestamp даже если нет изменений
      await setLastSyncAt(table, body.serverTime);
      return 0;
    }

    await upsertRecords(table, records);
    await setLastSyncAt(table, body.serverTime);
    return records.length;
  } catch {
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Начальная синхронизация (при первом входе)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Проверяет, была ли уже начальная синхронизация.
 * Если нет — запускает полный sync всех таблиц.
 * Если да — делает инкрементальный sync (с lastSyncAt).
 */
export async function initialSync(): Promise<SyncResult> {
  // Гарантируем, что IndexedDB открыта (с обработкой UpgradeError)
  const db = await ensureOfflineDb();
  // Проверяем, есть ли хотя бы одна запись в _syncMeta
  const metas = await db._syncMeta.count();
  if (metas > 0) {
    // Уже синхронизировались — инкрементальный sync (lastSyncAt подхватится автоматически)
    logger.info("[SyncManager] Инкрементальная синхронизация...");
    return fullSync();
  }
  // Первый раз — полная загрузка
  logger.info("[SyncManager] Начальная синхронизация (первый запуск)...");
  return fullSync();
}

// ═══════════════════════════════════════════════════════════════════════════
// Периодическая синхронизация
// ═══════════════════════════════════════════════════════════════════════════

let periodicTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Запустить периодическую синхронизацию.
 * @param intervalMs — интервал (по умолчанию 5 минут)
 */
export function startPeriodicSync(intervalMs = 5 * 60 * 1000): void {
  stopPeriodicSync();
  periodicTimer = setInterval(() => {
    // Двойная проверка: syncManager.getIsOnline() + navigator.onLine
    if (getIsOnline() && navigator.onLine && !isSyncing) {
      fullSync().catch(() => {});
    }
  }, intervalMs);
  logger.info(`[SyncManager] Периодическая синхронизация: каждые ${intervalMs / 1000}с`);
}

export function stopPeriodicSync(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Разрешение конфликтов
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Принять локальную версию — перезаписать серверную.
 */
export async function resolveConflictKeepLocal(
  conflict: SyncConflict,
): Promise<boolean> {
  try {
    await apiClient.put(`/${conflict.table}/${conflict.uuid}`, conflict.clientData, {
      headers: { "X-Force-Overwrite": "true" },
    });
    return true;
  } catch (err) {
    console.error("[SyncManager] resolveConflictKeepLocal failed:", err);
    return false;
  }
}

/**
 * Принять серверную версию — обновить локальную.
 */
export async function resolveConflictKeepServer(
  conflict: SyncConflict,
): Promise<boolean> {
  try {
    await upsertRecords(conflict.table, [conflict.serverData as any]);
    return true;
  } catch (err) {
    console.error("[SyncManager] resolveConflictKeepServer failed:", err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function emptyResult(): SyncResult {
  return {
    success: true,
    pulled: 0,
    pushed: 0,
    conflicts: [],
    errors: [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
  };
}

export default {
  fullSync,
  initialSync,
  pullSingleTable,
  startPeriodicSync,
  stopPeriodicSync,
  abortSyncManager,
  getSyncState,
  subscribeSyncManager,
  resolveConflictKeepLocal,
  resolveConflictKeepServer,
};
