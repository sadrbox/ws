/**
 * useOfflineSync — React-хук для интеграции offline-синхронизации.
 *
 * Единая очередь: _pendingChanges в Dexie (offlineDb).
 * Синхронизация: через syncManager (push/pull).
 *
 * Предоставляет:
 *  - isOnline        — текущий статус сети
 *  - isSyncing       — идёт ли синхронизация
 *  - pendingChanges  — массив PendingChange из Dexie
 *  - pendingCount    — количество ожидающих изменений
 *  - syncState       — состояние syncManager (status, progress, message, lastSyncAt)
 *  - syncNow()       — ручной запуск полной синхронизации
 *  - abortSync()     — отмена текущей синхронизации
 *  - removePending(id) — удалить pending change
 *  - clearAllPending() — очистить все pending changes
 *  - conflicts       — конфликты из последней синхронизации
 *  - offlineStats    — статистика оффлайн-хранилища
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  subscribeNetwork,
  getIsOnline,
  getIsSyncing,
  subscribeSyncStatus,
} from "src/services/networkStatus";
import {
  fullSync,
  abortSyncManager,
  getSyncState,
  subscribeSyncManager,
  type SyncState,
  type SyncConflict,
} from "src/services/syncManager";
import {
  getAllPendingChanges,
  getPendingChangesCount,
  removePendingChange,
  clearAllPendingChanges,
  getOfflineDbStats,
  type PendingChange,
} from "src/services/offlineDb";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface OfflineStats {
  tables: Record<string, number>;
  totalRecords: number;
  pendingChanges: number;
}

export interface UseOfflineSyncResult {
  /** true если есть подключение к серверу */
  isOnline: boolean;
  /** true если сейчас идёт синхронизация */
  isSyncing: boolean;
  /** Все pending changes из Dexie */
  pendingChanges: PendingChange[];
  /** Количество pending changes */
  pendingCount: number;
  /** Состояние syncManager (data sync) */
  syncState: SyncState;
  /** Конфликты из последней синхронизации */
  conflicts: SyncConflict[];
  /** Ручной запуск полной синхронизации */
  syncNow: () => Promise<void>;
  /** Отмена текущей синхронизации */
  abortSync: () => void;
  /** Удалить pending change */
  removePending: (id: number) => Promise<void>;
  /** Очистить все pending changes */
  clearAllPending: () => Promise<void>;
  /** Есть ли записи, требующие внимания */
  hasActionRequired: boolean;
  /** Общее число pending (для бейджа) */
  badgeCount: number;
  /** Статистика оффлайн-хранилища */
  offlineStats: OfflineStats | null;
  /** Обновить статистику */
  refreshStats: () => Promise<void>;

  // ── Обратная совместимость ──
  /** @deprecated Используйте pendingCount */
  pendingChangesCount: number;
  /** @deprecated Используйте pendingChanges */
  entries: PendingChange[];
  /** @deprecated Используйте removePending */
  removeEntry: (id: number) => Promise<void>;
  /** @deprecated Не нужна — pending changes удаляются при успешном push */
  clearSynced: () => Promise<void>;
  /** @deprecated Используйте pendingCount и conflicts */
  summary: { pending: number; syncing: number; synced: number; failed: number; conflict: number; total: number };
}

// ═══════════════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════════════

export function useOfflineSync(): UseOfflineSyncResult {
  // ── Статус сети ──
  const isOnline = useSyncExternalStore(subscribeNetwork, getIsOnline);

  // ── Статус синхронизации ──
  const isSyncingNetwork = useSyncExternalStore(subscribeSyncStatus, getIsSyncing);

  // ── Состояние syncManager ──
  const syncState = useSyncExternalStore(subscribeSyncManager, getSyncState);

  // ── Pending changes ──
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [offlineStats, setOfflineStats] = useState<OfflineStats | null>(null);

  // Конфликты из последнего результата
  const conflicts = syncState.lastResult?.conflicts ?? [];

  // Перечитка pending changes при изменении syncState
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [changes, count] = await Promise.all([
        getAllPendingChanges(),
        getPendingChangesCount(),
      ]);
      if (!cancelled) {
        setPendingChanges(changes);
        setPendingCount(count);
      }
    })();
    return () => { cancelled = true; };
  }, [syncState.status, syncState.lastResult]);

  // ── Refresh stats ──
  const refreshStats = useCallback(async () => {
    try {
      const stats = await getOfflineDbStats();
      const pc = await getPendingChangesCount();
      const { _pendingChanges: _, ...tables } = stats;
      const totalRecords = Object.values(tables).reduce((sum, n) => sum + n, 0);
      setOfflineStats({
        tables,
        totalRecords,
        pendingChanges: pc,
      });
    } catch (err) {
      console.warn("[useOfflineSync] Failed to get stats:", err);
    }
  }, []);

  // Загрузка статистики при первом рендере
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // ── Actions ──
  const syncNow = useCallback(async () => {
    await fullSync();
  }, []);

  const abortSync = useCallback(() => {
    abortSyncManager();
  }, []);

  const removePending = useCallback(async (id: number) => {
    await removePendingChange(id);
    setPendingChanges(prev => prev.filter(p => p.id !== id));
    setPendingCount(prev => Math.max(0, prev - 1));
  }, []);

  const clearAllPending = useCallback(async () => {
    await clearAllPendingChanges();
    setPendingChanges([]);
    setPendingCount(0);
  }, []);

  const isSyncing = isSyncingNetwork || syncState.status === "pulling" || syncState.status === "pushing";
  const hasActionRequired = pendingCount > 0 || conflicts.length > 0;
  const badgeCount = pendingCount + conflicts.length;

  // ── Обратная совместимость ──
  const compatSummary = useMemo(() => ({
    pending: pendingCount,
    syncing: isSyncing ? 1 : 0,
    synced: 0,
    failed: 0,
    conflict: conflicts.length,
    total: pendingCount + conflicts.length,
  }), [pendingCount, isSyncing, conflicts.length]);

  return useMemo(() => ({
    isOnline,
    isSyncing,
    pendingChanges,
    pendingCount,
    syncState,
    conflicts,
    syncNow,
    abortSync,
    removePending,
    clearAllPending,
    hasActionRequired,
    badgeCount,
    offlineStats,
    refreshStats,

    // Обратная совместимость
    pendingChangesCount: pendingCount,
    entries: pendingChanges as any,
    removeEntry: removePending,
    clearSynced: clearAllPending,
    summary: compatSummary,
  }), [
    isOnline, isSyncing, pendingChanges, pendingCount, syncState, conflicts,
    syncNow, abortSync, removePending, clearAllPending,
    hasActionRequired, badgeCount, offlineStats, refreshStats, compatSummary,
  ]);
}

/**
 * Лёгкий хук — только isOnline + badgeCount (для индикатора в навбаре).
 * Не загружает полный список entries.
 */
export function useNetworkStatus(): { isOnline: boolean; badgeCount: number; isSyncing: boolean } {
  const isOnline = useSyncExternalStore(subscribeNetwork, getIsOnline);
  const isSyncing = useSyncExternalStore(subscribeSyncStatus, getIsSyncing);
  const syncState = useSyncExternalStore(subscribeSyncManager, getSyncState);

  const [badgeCount, setBadgeCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getPendingChangesCount().then(count => {
      if (!cancelled) {
        const conflicts = syncState.lastResult?.conflicts?.length ?? 0;
        setBadgeCount(count + conflicts);
      }
    });
    return () => { cancelled = true; };
  }, [syncState.status, syncState.lastResult]);

  return useMemo(() => ({ isOnline, badgeCount, isSyncing }), [isOnline, badgeCount, isSyncing]);
}
