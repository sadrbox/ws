/**
 * useOfflineSync — React-хук для интеграции offline-очереди в компоненты.
 *
 * Предоставляет:
 *  - isOnline        — текущий статус сети
 *  - isSyncing       — идёт ли синхронизация
 *  - summary         — { pending, syncing, synced, failed, conflict, total }
 *  - entries         — полный список QueueEntry[]
 *  - syncNow()       — ручной запуск синхронизации
 *  - abortSync()     — отмена текущей синхронизации
 *  - removeEntry(id) — удалить запись вручную
 *  - clearSynced()   — очистить все synced
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  subscribeNetwork,
  getIsOnline,
  processQueue,
  abortSync,
  getIsSyncing,
  subscribeSyncStatus,
  subscribeQueue,
  getQueueRevision,
  getQueueSummary,
  type QueueSummary,
  type QueueEntry,
} from "src/services/networkStatus";
import {
  getAllEntries,
  removeEntry as removeQueueEntry,
  clearSynced as clearQueueSynced,
} from "src/services/offlineQueue";

// ═══════════════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════════════

export interface UseOfflineSyncResult {
  /** true если есть подключение к серверу */
  isOnline: boolean;
  /** true если сейчас идёт синхронизация очереди */
  isSyncing: boolean;
  /** Сводка по статусам очереди */
  summary: QueueSummary;
  /** Все записи очереди */
  entries: QueueEntry[];
  /** Ручной запуск синхронизации */
  syncNow: () => Promise<void>;
  /** Отмена текущей синхронизации */
  abortSync: () => void;
  /** Удалить запись из очереди */
  removeEntry: (id: number) => Promise<void>;
  /** Очистить все synced записи */
  clearSynced: () => Promise<void>;
  /** Есть ли записи, требующие внимания (pending + failed + conflict) */
  hasActionRequired: boolean;
  /** Общее число pending + conflict */
  badgeCount: number;
}

const EMPTY_SUMMARY: QueueSummary = {
  pending: 0, syncing: 0, synced: 0, failed: 0, conflict: 0, total: 0,
};

export function useOfflineSync(): UseOfflineSyncResult {
  // ── Статус сети ──
  const isOnline = useSyncExternalStore(subscribeNetwork, getIsOnline);

  // ── Статус синхронизации ──
  const isSyncing = useSyncExternalStore(subscribeSyncStatus, getIsSyncing);

  // ── revision из очереди (триггер перечитки) ──
  const queueRevision = useSyncExternalStore(subscribeQueue, getQueueRevision);

  // ── Данные очереди (загружаем при изменении revision) ──
  const [summary, setSummary] = useState<QueueSummary>(EMPTY_SUMMARY);
  const [entries, setEntries] = useState<QueueEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, e] = await Promise.all([getQueueSummary(), getAllEntries()]);
      if (!cancelled) {
        setSummary(s);
        setEntries(e);
      }
    })();
    return () => { cancelled = true; };
  }, [queueRevision]);

  // ── Actions ──
  const syncNow = useCallback(async () => {
    await processQueue();
  }, []);

  const removeEntry = useCallback(async (id: number) => {
    await removeQueueEntry(id);
  }, []);

  const clearSynced = useCallback(async () => {
    await clearQueueSynced();
  }, []);

  const hasActionRequired = summary.pending > 0 || summary.failed > 0 || summary.conflict > 0;
  const badgeCount = summary.pending + summary.conflict;

  return useMemo(() => ({
    isOnline,
    isSyncing,
    summary,
    entries,
    syncNow,
    abortSync,
    removeEntry,
    clearSynced,
    hasActionRequired,
    badgeCount,
  }), [isOnline, isSyncing, summary, entries, syncNow, removeEntry, clearSynced, hasActionRequired, badgeCount]);
}

/**
 * Лёгкий хук — только isOnline + badgeCount (для индикатора в навбаре).
 * Не загружает полный список entries.
 */
export function useNetworkStatus(): { isOnline: boolean; badgeCount: number; isSyncing: boolean } {
  const isOnline = useSyncExternalStore(subscribeNetwork, getIsOnline);
  const isSyncing = useSyncExternalStore(subscribeSyncStatus, getIsSyncing);
  const queueRevision = useSyncExternalStore(subscribeQueue, getQueueRevision);

  const [badgeCount, setBadgeCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getQueueSummary().then(s => {
      if (!cancelled) setBadgeCount(s.pending + s.conflict);
    });
    return () => { cancelled = true; };
  }, [queueRevision]);

  return useMemo(() => ({ isOnline, badgeCount, isSyncing }), [isOnline, badgeCount, isSyncing]);
}
