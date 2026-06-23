/**
 * queryPersist — сохранение / восстановление кэша React Query в IndexedDB.
 *
 * При каждом обновлении кэша (через subscribe) запускается debounced-запись.
 * При старте приложения — восстанавливается последний снимок.
 *
 * Это позволяет приложению при перезагрузке без сети мгновенно показать
 * ранее загруженные данные.
 */

import type { QueryClient } from "@tanstack/react-query";
import { logger } from "src/utils/logger";

// ═══════════════════════════════════════════════════════════════════════════
// IndexedDB
// ═══════════════════════════════════════════════════════════════════════════

const DB_NAME = "react_query_cache";
const DB_VERSION = 1;
const STORE_NAME = "cache";
const CACHE_KEY = "queryClientState";

/** Максимальный возраст записи кэша (24 часа) */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
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

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error("IDB error"));
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB error"));
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB error"));
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Serialization helpers
// ═══════════════════════════════════════════════════════════════════════════

interface PersistedCache {
  timestamp: number;
  clientState: {
    queries: Array<{
      queryKey: unknown;
      queryHash: string;
      state: {
        data: unknown;
        dataUpdatedAt: number;
        status: string;
      };
    }>;
  };
}

/**
 * Достать из queryClient только «успешные» queries с данными
 * (нет смысла персистить ошибки или loading-состояния).
 */
function dehydrateClient(client: QueryClient): PersistedCache {
  const queryCache = client.getQueryCache();
  const queries = queryCache.getAll()
    .filter((q) => q.state.status === "success" && q.state.data !== undefined)
    .map((q) => ({
      queryKey: q.queryKey,
      queryHash: q.queryHash,
      state: {
        data: q.state.data,
        dataUpdatedAt: q.state.dataUpdatedAt,
        status: q.state.status,
      },
    }));

  return { timestamp: Date.now(), clientState: { queries } };
}

/**
 * Восстановить кэш: записываем данные обратно в queryClient.
 * setQueryData ставит статус success и обновляет dataUpdatedAt.
 */
function hydrateClient(client: QueryClient, persisted: PersistedCache): void {
  const now = Date.now();
  for (const entry of persisted.clientState.queries) {
    // Пропускаем устаревшие записи
    if (now - entry.state.dataUpdatedAt > MAX_AGE_MS) continue;
    try {
      client.setQueryData(entry.queryKey as any, entry.state.data, {
        updatedAt: entry.state.dataUpdatedAt,
      });
    } catch {
      // Игнорируем ошибки десериализации отдельных записей
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Восстановить кэш из IndexedDB.
 * Вызывается ДО рендера приложения (или параллельно).
 */
export async function restoreQueryCache(client: QueryClient): Promise<void> {
  try {
    const persisted = await idbGet<PersistedCache>(CACHE_KEY);
    if (!persisted) return;
    // Проверяем возраст всего снимка
    if (Date.now() - persisted.timestamp > MAX_AGE_MS) return;
    hydrateClient(client, persisted);
    logger.info(`[QueryPersist] Restored ${persisted.clientState.queries.length} queries from cache`);
  } catch (err) {
    console.warn("[QueryPersist] Failed to restore cache:", err);
  }
}

/**
 * Подписаться на изменения кэша и периодически сохранять в IndexedDB.
 * Возвращает функцию отписки.
 */
export function persistQueryCache(client: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const DEBOUNCE_MS = 2000; // Сохраняем не чаще чем раз в 2 секунды

  function scheduleSave(): void {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const snapshot = dehydrateClient(client);
      idbSet(CACHE_KEY, snapshot).catch((err) =>
        console.warn("[QueryPersist] Failed to save cache:", err),
      );
    }, DEBOUNCE_MS);
  }

  // Подписка на любые изменения в query cache
  const unsubscribe = client.getQueryCache().subscribe(() => {
    scheduleSave();
  });

  // Также сохраняем при закрытии вкладки
  const handleBeforeUnload = () => {
    const snapshot = dehydrateClient(client);
    // Используем синхронный вариант через localStorage как fallback
    try {
      // Пробуем IndexedDB (может не успеть)
      idbSet(CACHE_KEY, snapshot).catch(() => {});
    } catch {
      // Игнорируем
    }
  };
  window.addEventListener("beforeunload", handleBeforeUnload);

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
    window.removeEventListener("beforeunload", handleBeforeUnload);
  };
}

/**
 * Очистить сохранённый кэш из IndexedDB.
 * Вызывается при logout для удаления данных предыдущего пользователя.
 */
export async function clearPersistedCache(): Promise<void> {
  try {
    await idbDelete(CACHE_KEY);
    logger.info("[QueryPersist] Persisted cache cleared");
  } catch (err) {
    console.warn("[QueryPersist] Failed to clear persisted cache:", err);
  }
}
