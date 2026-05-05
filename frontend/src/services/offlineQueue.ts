/**
 * @deprecated OfflineQueueService — УСТАРЕВШАЯ очередь отложенных операций.
 *
 * ⚠️ Этот модуль заменён на единую систему через:
 *   - offlineDb.ts (_pendingChanges в Dexie) — для хранения очереди
 *   - offlineDataService.ts — для CRUD операций с офлайн-поддержкой
 *   - syncManager.ts — для push/pull синхронизации
 *   - networkStatus.ts — для отслеживания сети и авто-синхронизации
 *
 * Модуль оставлен для обратной совместимости.
 * Функции isNetworkError и типы QueueEntry/QueueSummary используются
 * в нескольких местах приложения.
 *
 * Архитектура (legacy):
 *  1. Каждая сетевая мутация (POST/PUT/DELETE), которая упала с ошибкой сети,
 *     сохраняется как QueueEntry в IndexedDB.
 *  2. При восстановлении связи записи воспроизводятся в порядке создания.
 *  3. Если сервер возвращает 409 (Conflict) — запись помечается «conflict»
 *     и пользователь разрешает конфликт вручную через ConflictResolver.
 *
 * IndexedDB Schema:  DB "offline_queue", store "operations"
 *   key: id (autoIncrement)
 *   indexes: status, createdAt
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type QueueEntryStatus =
  | "pending"    // ожидает отправки
  | "syncing"    // в процессе отправки
  | "synced"     // успешно синхронизировано
  | "failed"     // ошибка сервера (4xx кроме 409)
  | "conflict";  // 409 — конфликт, требуется ручное разрешение

export interface QueueEntry {
  id?: number;             // autoIncrement (присваивается IndexedDB)
  /** HTTP-метод */
  method: "POST" | "PUT" | "DELETE";
  /** URL-путь (относительный, например "/organizations/abc-123") */
  url: string;
  /** Тело запроса (JSON-сериализуемый объект) */
  payload: Record<string, unknown> | null;
  /** Заголовки (только нужные; auth-token будет добавлен автоматически при sync) */
  headers?: Record<string, string>;
  /** Человекочитаемое описание операции */
  label: string;
  /** Endpoint модели (organizations, contacts …) */
  endpoint: string;
  /** uuid записи (для PUT/DELETE) */
  entityUuid?: string;

  status: QueueEntryStatus;
  /** Количество попыток синхронизации */
  attempts: number;
  /** Последняя ошибка */
  lastError?: string;
  /** Серверная версия данных при конфликте (для diff-view) */
  serverData?: Record<string, unknown>;
  /** ISO timestamp создания */
  createdAt: string;
  /** ISO timestamp последней попытки */
  updatedAt?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// IndexedDB HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const DB_NAME = "offline_queue";
const DB_VERSION = 1;
const STORE_NAME = "operations";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("IDB error"));
    };
  });
  return dbPromise;
}

function tx(
  mode: IDBTransactionMode,
): Promise<{ store: IDBObjectStore; done: Promise<void> }> {
  return openDB().then((db) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("IDB error"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IDB error"));
    });
    return { store, done };
  });
}

/** Обёртка для IDBRequest → Promise */
function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IDB error"));
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SUBSCRIBE PATTERN  (для React useSyncExternalStore)
// ═══════════════════════════════════════════════════════════════════════════

type Listener = () => void;
const listeners = new Set<Listener>();

/** revision — монотонно растущий счётчик, используемый как snapshot для useSyncExternalStore */
let revision = 0;

function notify(): void {
  revision++;
  for (const l of listeners) l();
}

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getQueueRevision(): number {
  return revision;
}

// ═══════════════════════════════════════════════════════════════════════════
// CRUD
// ═══════════════════════════════════════════════════════════════════════════

/** Добавить операцию в очередь */
export async function enqueue(
  entry: Omit<QueueEntry, "id" | "status" | "attempts" | "createdAt">,
): Promise<number> {
  const { store, done } = await tx("readwrite");
  const full: QueueEntry = {
    ...entry,
    status: "pending",
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
  const id = await req(store.add(full));
  await done;
  notify();
  return id as number;
}

/** Получить одну запись */
export async function getEntry(id: number): Promise<QueueEntry | undefined> {
  const { store, done } = await tx("readonly");
  const result = await req(store.get(id));
  await done;
  return result as QueueEntry | undefined;
}

/** Получить все записи (отсортированы по createdAt) */
export async function getAllEntries(): Promise<QueueEntry[]> {
  const { store, done } = await tx("readonly");
  const all = await req(store.getAll());
  await done;
  return (all as QueueEntry[]).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

/** Получить записи с определённым статусом */
export async function getEntriesByStatus(
  status: QueueEntryStatus,
): Promise<QueueEntry[]> {
  const { store, done } = await tx("readonly");
  const index = store.index("status");
  const result = await req(index.getAll(status));
  await done;
  return result as QueueEntry[];
}

/** Обновить запись */
export async function updateEntry(
  id: number,
  patch: Partial<QueueEntry>,
): Promise<void> {
  const { store, done } = await tx("readwrite");
  const existing = await req(store.get(id));
  if (!existing) { await done; return; }
  const updated = {
    ...(existing as QueueEntry),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await req(store.put(updated));
  await done;
  notify();
}

/** Удалить запись */
export async function removeEntry(id: number): Promise<void> {
  const { store, done } = await tx("readwrite");
  await req(store.delete(id));
  await done;
  notify();
}

/** Очистить все synced-записи */
export async function clearSynced(): Promise<void> {
  const synced = await getEntriesByStatus("synced");
  if (synced.length === 0) return;
  const { store, done } = await tx("readwrite");
  for (const entry of synced) {
    if (entry.id != null) store.delete(entry.id);
  }
  await done;
  notify();
}

/** Очистить ВСЕ записи очереди. Вызывается при logout. */
export async function clearAllEntries(): Promise<void> {
  const { store, done } = await tx("readwrite");
  store.clear();
  await done;
  notify();
}

/** Количество pending-записей */
export async function getPendingCount(): Promise<number> {
  const pending = await getEntriesByStatus("pending");
  return pending.length;
}

/** Количество conflict-записей */
export async function getConflictCount(): Promise<number> {
  const conflicts = await getEntriesByStatus("conflict");
  return conflicts.length;
}

/** Сводка по статусам */
export interface QueueSummary {
  pending: number;
  syncing: number;
  synced: number;
  failed: number;
  conflict: number;
  total: number;
}

export async function getQueueSummary(): Promise<QueueSummary> {
  const all = await getAllEntries();
  const summary: QueueSummary = {
    pending: 0, syncing: 0, synced: 0, failed: 0, conflict: 0, total: all.length,
  };
  for (const e of all) {
    if (e.status in summary) {
      (summary as any)[e.status]++;
    }
  }
  return summary;
}

// ═══════════════════════════════════════════════════════════════════════════
// DETECT NETWORK ERROR
// ═══════════════════════════════════════════════════════════════════════════

/** @deprecated Используйте import { isNetworkError } from "src/services/networkUtils" */
export { isNetworkError } from "./networkUtils";

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: превратить axios config в QueueEntry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Создать QueueEntry из неудавшегося axios-запроса.
 * Вызывается из interceptor при обнаружении ошибки сети.
 */
export function buildEntryFromAxiosConfig(config: any): Omit<QueueEntry, "id" | "status" | "attempts" | "createdAt"> | null {
  const method = (config.method || "").toUpperCase() as QueueEntry["method"];
  // Только мутирующие запросы (POST, PUT, DELETE)
  if (!["POST", "PUT", "DELETE"].includes(method)) return null;

  const url: string = config.url || "";
  // Разбираем endpoint и entityUuid из url
  // Пример: "/organizations/abc-123" → endpoint="organizations", entityUuid="abc-123"
  const segments = url.replace(/^\//, "").split("/");
  const endpoint = segments[0] || "unknown";
  const entityUuid = segments[1] || undefined;

  // Парсим payload
  let payload: Record<string, unknown> | null = null;
  if (config.data) {
    try {
      payload = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
    } catch {
      payload = null;
    }
  }

  // Не сохраняем FormData (файлы)  — невозможно надёжно сериализовать
  if (config.data instanceof FormData) return null;

  // Человекочитаемое описание
  const actionLabel = method === "POST" ? "Создание" : method === "PUT" ? "Изменение" : "Удаление";
  const label = `${actionLabel}: ${endpoint}${entityUuid ? ` (${entityUuid.slice(0, 8)}…)` : ""}`;

  return { method, url, payload, label, endpoint, entityUuid };
}
