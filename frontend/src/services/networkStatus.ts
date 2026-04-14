/**
 * networkStatus — сервис отслеживания состояния сети + движок синхронизации.
 *
 * Подписки:
 *  - subscribeNetwork(listener) — уведомление при смене online/offline
 *  - subscribeQueue (из offlineQueue) — уведомление при изменении очереди
 *
 * Синхронизация:
 *  - При переходе в online → автозапуск processQueue()
 *  - processQueue() обходит pending-записи и воспроизводит их через apiClient
 *  - При 409 (Conflict) — загружает серверную версию и помечает entry «conflict»
 */

import apiClient from "src/services/api/client";
import {
  getEntriesByStatus,
  updateEntry,
  removeEntry,
  clearSynced,
  type QueueEntry,
  subscribeQueue,
  getQueueRevision,
  getQueueSummary,
  type QueueSummary,
} from "./offlineQueue";

// ═══════════════════════════════════════════════════════════════════════════
// ONLINE / OFFLINE STATE
// ═══════════════════════════════════════════════════════════════════════════

type Listener = () => void;
const networkListeners = new Set<Listener>();

let _isOnline: boolean = navigator.onLine;

function notifyNetwork(): void {
  for (const l of networkListeners) l();
}

export function subscribeNetwork(listener: Listener): () => void {
  networkListeners.add(listener);
  return () => { networkListeners.delete(listener); };
}

export function getIsOnline(): boolean {
  return _isOnline;
}

// Инициализация при импорте
function handleOnline(): void {
  if (_isOnline) return;
  _isOnline = true;
  notifyNetwork();
  // Автоматический запуск синхронизации
  processQueue().catch(console.error);
}
function handleOffline(): void {
  if (!_isOnline) return;
  _isOnline = false;
  notifyNetwork();
}

window.addEventListener("online", handleOnline);
window.addEventListener("offline", handleOffline);

// Периодический health-check (navigator.onLine ненадёжен)
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

export function startHealthCheck(intervalMs = 30_000): void {
  stopHealthCheck();
  healthCheckTimer = setInterval(async () => {
    try {
      // Лёгкий ping к API (HEAD на /health — относительно базового URL без /v1)
      const base = apiClient.defaults.baseURL || "/api/v1";
      const healthUrl = base.replace(/\/v1\/?$/, "/health");
      await apiClient.head(healthUrl, { baseURL: "" , timeout: 5000 });
      if (!_isOnline) handleOnline();
    } catch {
      if (_isOnline && !navigator.onLine) handleOffline();
    }
  }, intervalMs);
}

export function stopHealthCheck(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SYNC ENGINE
// ═══════════════════════════════════════════════════════════════════════════

let isSyncing = false;
let syncAborted = false;

const syncListeners = new Set<Listener>();

export function subscribeSyncStatus(listener: Listener): () => void {
  syncListeners.add(listener);
  return () => { syncListeners.delete(listener); };
}

function notifySyncStatus(): void {
  for (const l of syncListeners) l();
}

export function getIsSyncing(): boolean {
  return isSyncing;
}

/**
 * Воспроизвести очередь отложенных операций.
 * Вызывается автоматически при переходе в online, или вручную из UI.
 * Возвращает сводку результатов.
 */
export async function processQueue(): Promise<QueueSummary> {
  if (isSyncing) return getQueueSummary();
  isSyncing = true;
  syncAborted = false;
  notifySyncStatus();

  try {
    const pending = await getEntriesByStatus("pending");
    // Также ретрай failed-записей (до 5 попыток)
    const failed = (await getEntriesByStatus("failed")).filter(e => e.attempts < 5);
    const toProcess = [...pending, ...failed];

    for (const entry of toProcess) {
      if (syncAborted || !_isOnline) break;
      await processSingleEntry(entry);
    }

    // Автоочистка: удаляем synced старше 24ч
    await clearSynced();
  } finally {
    isSyncing = false;
    notifySyncStatus();
  }

  return getQueueSummary();
}

/** Отменить текущую синхронизацию */
export function abortSync(): void {
  syncAborted = true;
}

/** Обработать одну запись очереди */
async function processSingleEntry(entry: QueueEntry): Promise<void> {
  if (!entry.id) return;

  await updateEntry(entry.id, { status: "syncing", attempts: entry.attempts + 1 });

  try {
    switch (entry.method) {
      case "POST":
        await apiClient.post(entry.url, entry.payload, { _fromSyncEngine: true } as any);
        break;
      case "PUT":
        await apiClient.put(entry.url, entry.payload, { _fromSyncEngine: true } as any);
        break;
      case "DELETE":
        await apiClient.delete(entry.url, { _fromSyncEngine: true } as any);
        break;
    }

    // Успех — помечаем synced
    await updateEntry(entry.id, {
      status: "synced",
      lastError: undefined,
    });
  } catch (err: any) {
    // Нет сети — ставим обратно pending (не считаем это попыткой)
    if (isNetworkLike(err)) {
      await updateEntry(entry.id, {
        status: "pending",
        attempts: entry.attempts, // не увеличиваем
      });
      handleOffline();
      return;
    }

    // 409 Conflict — загружаем серверную версию
    if (err.response?.status === 409) {
      let serverData: Record<string, unknown> | undefined;
      try {
        if (entry.entityUuid) {
          const res = await apiClient.get(`/${entry.endpoint}/${entry.entityUuid}`);
          serverData = res.data?.item ?? res.data;
        }
      } catch {
        // Не удалось загрузить серверную версию — не страшно
      }
      await updateEntry(entry.id, {
        status: "conflict",
        lastError: err.response?.data?.message || "Конфликт: данные были изменены на сервере",
        serverData,
      });
      return;
    }

    // Другая ошибка сервера
    const msg = err.response?.data?.message || err.message || "Неизвестная ошибка";
    await updateEntry(entry.id, {
      status: "failed",
      lastError: msg,
    });
  }
}

function isNetworkLike(err: any): boolean {
  if (!err) return false;
  if (err.code === "ERR_NETWORK" || err.code === "ECONNABORTED") return true;
  if (err.message === "Network Error") return true;
  if (err.isAxiosError && !err.response) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFLICT RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Принять локальную версию — повторить запрос с force-флагом.
 * Если сервер поддерживает X-Force-Overwrite, используем его;
 * иначе просто повторяем PUT.
 */
export async function resolveConflictLocal(entryId: number): Promise<boolean> {
  const { getEntry } = await import("./offlineQueue");
  const entry = await getEntry(entryId);
  if (!entry || entry.status !== "conflict") return false;

  try {
    switch (entry.method) {
      case "PUT":
        await apiClient.put(entry.url, entry.payload, {
          headers: { "X-Force-Overwrite": "true" },
        });
        break;
      case "POST":
        await apiClient.post(entry.url, entry.payload);
        break;
      case "DELETE":
        await apiClient.delete(entry.url);
        break;
    }
    await updateEntry(entryId, { status: "synced", lastError: undefined, serverData: undefined });
    return true;
  } catch (err: any) {
    await updateEntry(entryId, {
      status: "failed",
      lastError: err.response?.data?.message || err.message,
    });
    return false;
  }
}

/**
 * Принять серверную версию — отбросить локальные изменения, удалить запись из очереди.
 */
export async function resolveConflictServer(entryId: number): Promise<void> {
  await removeEntry(entryId);
}

/**
 * Принять пользовательский мёрж — отправить смёрженные данные.
 */
export async function resolveConflictMerge(
  entryId: number,
  mergedPayload: Record<string, unknown>,
): Promise<boolean> {
  const { getEntry } = await import("./offlineQueue");
  const entry = await getEntry(entryId);
  if (!entry || entry.status !== "conflict") return false;

  try {
    if (entry.method === "PUT") {
      await apiClient.put(entry.url, mergedPayload, {
        headers: { "X-Force-Overwrite": "true" },
      });
    } else if (entry.method === "POST") {
      await apiClient.post(entry.url, mergedPayload);
    }
    await updateEntry(entryId, { status: "synced", lastError: undefined, serverData: undefined });
    return true;
  } catch (err: any) {
    await updateEntry(entryId, {
      status: "failed",
      lastError: err.response?.data?.message || err.message,
    });
    return false;
  }
}

// Реэкспортируем нужные функции из offlineQueue для удобства
export { subscribeQueue, getQueueRevision, getQueueSummary };
export type { QueueSummary, QueueEntry };
