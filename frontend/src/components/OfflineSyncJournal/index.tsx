/**
 * OfflineSyncJournal — журнал отложенных операций.
 */

import { FC, useCallback, useState } from "react";
import { translate } from "src/i18";
import { useOfflineSync } from "src/hooks/useOfflineSync";
import { updateEntry, type QueueEntry } from "src/services/offlineQueue";
import { processQueue } from "src/services/networkStatus";
import { Button } from "src/components/Button";
import ConflictResolver from "./ConflictResolver";
import styles from "./OfflineSyncJournal.module.scss";

const STATUS_CONFIG: Record<string, { icon: string; label: string; css: string }> = {
  pending: { icon: "⏳", label: translate("statusPending"), css: styles.StatusPending },
  syncing: { icon: "🔄", label: translate("statusSyncing"), css: styles.StatusSyncing },
  synced: { icon: "✅", label: translate("statusSynced"), css: styles.StatusSynced },
  failed: { icon: "❌", label: translate("statusFailed"), css: styles.StatusFailed },
  conflict: { icon: "⚠️", label: translate("statusConflict"), css: styles.StatusConflict },
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
          {translate("syncJournalTitle")}
        </div>
        <div className={styles.SyncJournalSummary}>
          {summary.pending > 0 && <span>⏳ {summary.pending}</span>}
          {summary.conflict > 0 && <span>⚠️ {summary.conflict}</span>}
          {summary.failed > 0 && <span>❌ {summary.failed}</span>}
          {summary.synced > 0 && <span>✅ {summary.synced}</span>}
          <span>{translate("total")}: {summary.total}</span>
        </div>
        <div className={styles.SyncJournalActions}>
          {summary.synced > 0 && (
            <Button onClick={clearSynced} disabled={isSyncing}>
              <span>{translate("clear")} ✅</span>
            </Button>
          )}
          <Button
            variant="primary"
            onClick={syncNow}
            disabled={isSyncing || !isOnline || summary.pending === 0}
          >
            <span>{isSyncing ? translate("statusSyncing") + "…" : translate("syncNow")}</span>
          </Button>
        </div>
      </div>

      <div className={styles.SyncJournalBody}>
        {entries.length === 0 ? (
          <div className={styles.SyncJournalEmpty}>
            {translate("syncQueueEmpty")}
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
                    {entry.attempts > 0 && ` · ${translate("attempts")}: ${entry.attempts}`}
                  </div>
                  {entry.lastError && (
                    <div className={styles.SyncEntryError}>{entry.lastError}</div>
                  )}
                </div>
                <div className={styles.SyncEntryActions}>
                  {entry.status === "conflict" && (
                    <Button onClick={() => setConflictEntry(entry)}>
                      <span>{translate("resolve")}</span>
                    </Button>
                  )}
                  {entry.status === "failed" && (
                    <Button onClick={() => handleRetry(entry)}>
                      <span>{translate("retry")}</span>
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
