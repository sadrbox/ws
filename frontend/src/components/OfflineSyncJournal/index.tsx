/**
 * OfflineSyncJournal — журнал отложенных операций.
 */

import { FC, useCallback, useState } from "react";
import { useOfflineSync } from "src/hooks/useOfflineSync";
import { updateEntry, type QueueEntry } from "src/services/offlineQueue";
import { processQueue } from "src/services/networkStatus";
import { Button } from "src/components/Button";
import ConflictResolver from "./ConflictResolver";
import styles from "src/styles/main.module.scss";

const STATUS_CONFIG: Record<string, { icon: string; label: string; css: string }> = {
  pending:  { icon: "⏳", label: "Ожидает",          css: styles.StatusPending },
  syncing:  { icon: "���", label: "Синхронизация…",   css: styles.StatusSyncing },
  synced:   { icon: "✅", label: "Синхронизировано",  css: styles.StatusSynced },
  failed:   { icon: "❌", label: "Ошибка",            css: styles.StatusFailed },
  conflict: { icon: "⚠️", label: "Конфликт",         css: styles.StatusConflict },
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return iso; }
}

const OfflineSyncJournal: FC = () => {
  const {
    isOnline, isSyncing, summary, entries,
    syncNow, removeEntry, clearSynced,
  } = useOfflineSync();

  const [conflictEntry, setConflictEntry] = useState<QueueEntry | null>(null);

  const handleRetry = useCallback(async (entry: QueueEntry) => {
    if (entry.id == null) return;
    await updateEntry(entry.id, { status: "pending", lastError: undefined });
    await processQueue();
  }, []);

  const handleDelete = useCallback(async (entry: QueueEntry) => {
    if (entry.id == null) return;
    await removeEntry(entry.id);
  }, [removeEntry]);

  if (conflictEntry) {
    return (
      <ConflictResolver
        entry={conflictEntry}
        onClose={() => setConflictEntry(null)}
      />
    );
  }

  return (
    <div className={styles.SyncJournal}>
      <div className={styles.SyncJournalHeader}>
        <div className={styles.SyncJournalTitle}>
          Журнал синхронизации
        </div>
        <div className={styles.SyncJournalSummary}>
          {summary.pending > 0 && <span>⏳ {summary.pending}</span>}
          {summary.conflict > 0 && <span>⚠️ {summary.conflict}</span>}
          {summary.failed > 0 && <span>❌ {summary.failed}</span>}
          {summary.synced > 0 && <span>✅ {summary.synced}</span>}
          <span>Всего: {summary.total}</span>
        </div>
        <div className={styles.SyncJournalActions}>
          {summary.synced > 0 && (
            <Button onClick={clearSynced} disabled={isSyncing}>
              <span>Очистить ✅</span>
            </Button>
          )}
          <Button
            variant="primary"
            onClick={syncNow}
            disabled={isSyncing || !isOnline || summary.pending === 0}
          >
            <span>{isSyncing ? "Синхронизация…" : "Синхронизировать"}</span>
          </Button>
        </div>
      </div>

      <div className={styles.SyncJournalBody}>
        {entries.length === 0 ? (
          <div className={styles.SyncJournalEmpty}>
            Очередь пуста — все данные синхронизированы
          </div>
        ) : (
          entries.map((entry) => {
            const cfg = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG.pending;
            return (
              <div key={entry.id} className={styles.SyncEntry}>
                <div className={[styles.SyncEntryIcon, cfg.css].filter(Boolean).join(" ")}>
                  {cfg.icon}
                </div>
                <div className={styles.SyncEntryBody}>
                  <div className={styles.SyncEntryLabel}>{entry.label}</div>
                  <div className={styles.SyncEntryMeta}>
                    {entry.method} {entry.url} · {formatDate(entry.createdAt)}
                    {entry.attempts > 0 && ` · Попыток: ${entry.attempts}`}
                  </div>
                  {entry.lastError && (
                    <div className={styles.SyncEntryError}>{entry.lastError}</div>
                  )}
                </div>
                <div className={styles.SyncEntryActions}>
                  {entry.status === "conflict" && (
                    <Button onClick={() => setConflictEntry(entry)}>
                      <span>Разрешить</span>
                    </Button>
                  )}
                  {entry.status === "failed" && (
                    <Button onClick={() => handleRetry(entry)}>
                      <span>Повторить</span>
                    </Button>
                  )}
                  {entry.status !== "syncing" && (
                    <Button onClick={() => handleDelete(entry)}>
                      <span>✕</span>
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

OfflineSyncJournal.displayName = "OfflineSyncJournal";
export default OfflineSyncJournal;
