/**
 * OfflineSyncJournal — журнал отложенных оффлайн-изменений.
 *
 * Использует актуальную модель синхронизации (useOfflineSync): список
 * PendingChange (table/uuid/action) + конфликты SyncConflict из последней
 * синхронизации. Ранее компонент был написан под устаревший QueueEntry —
 * переведён на живую модель.
 */
import { FC, useCallback, useState } from "react";
import { getFormatDate } from "src/utils/datetime";
import { translate } from "src/i18";
import { useOfflineSync } from "src/hooks/useOfflineSync";
import type { PendingChange } from "src/services/offlineDb";
import type { SyncConflict } from "src/services/syncManager";
import { Button } from "src/components/Button";
import ConflictResolver from "./ConflictResolver";
import styles from "./OfflineSyncJournal.module.scss";

const ACTION_CONFIG: Record<string, { icon: string; css?: string }> = {
  create: { icon: "➕", css: styles.StatusSynced },
  update: { icon: "✏️", css: styles.StatusSyncing },
  delete: { icon: "🗑️", css: styles.StatusFailed },
};

function formatDate(iso: string): string {
  return getFormatDate(iso) || iso;
}

const OfflineSyncJournal: FC = () => {
  const {
    isOnline, isSyncing, pendingChanges, pendingCount, conflicts,
    syncNow, removePending, clearAllPending,
  } = useOfflineSync();

  const [conflict, setConflict] = useState<SyncConflict | null>(null);

  const handleDelete = useCallback(async (entry: PendingChange) => {
    if (entry.id == null) return;
    await removePending(entry.id);
  }, [removePending]);

  if (conflict) {
    return <ConflictResolver conflict={conflict} onClose={() => setConflict(null)} />;
  }

  return (
    <div className={styles.SyncJournal}>
      <div className={styles.SyncJournalHeader}>
        <div className={styles.SyncJournalTitle}>
          {translate("syncJournalTitle")}
        </div>
        <div className={styles.SyncJournalSummary}>
          {pendingCount > 0 && <span>⏳ {pendingCount}</span>}
          {conflicts.length > 0 && <span>⚠️ {conflicts.length}</span>}
          <span>{translate("total")}: {pendingCount}</span>
        </div>
        <div className={styles.SyncJournalActions}>
          {pendingCount > 0 && (
            <Button onClick={clearAllPending} disabled={isSyncing}>
              <span>{translate("clear")}</span>
            </Button>
          )}
          <Button
            variant="primary"
            onClick={syncNow}
            disabled={isSyncing || !isOnline || pendingCount === 0}
          >
            <span>{isSyncing ? translate("statusSyncing") + "…" : translate("syncNow")}</span>
          </Button>
        </div>
      </div>

      <div className={styles.SyncJournalBody}>
        {/* Конфликты последней синхронизации */}
        {conflicts.map((c) => (
          <div key={`conflict-${c.table}-${c.uuid}`} className={styles.SyncEntry}>
            <div className={[styles.SyncEntryIcon, styles.StatusConflict].filter(Boolean).join(" ")}>⚠️</div>
            <div className={styles.SyncEntryBody}>
              <div className={styles.SyncEntryLabel}>{translate("statusConflict")}: {c.table}</div>
              <div className={styles.SyncEntryMeta}>{c.uuid}</div>
            </div>
            <div className={styles.SyncEntryActions}>
              <Button onClick={() => setConflict(c)}>
                <span>{translate("resolve")}</span>
              </Button>
            </div>
          </div>
        ))}

        {/* Отложенные изменения */}
        {pendingChanges.length === 0 && conflicts.length === 0 ? (
          <div className={styles.SyncJournalEmpty}>
            {translate("syncQueueEmpty")}
          </div>
        ) : (
          pendingChanges.map((entry) => {
            const cfg = ACTION_CONFIG[entry.action] ?? ACTION_CONFIG.update;
            return (
              <div key={entry.id} className={styles.SyncEntry}>
                <div className={[styles.SyncEntryIcon, cfg.css].filter(Boolean).join(" ")}>
                  {cfg.icon}
                </div>
                <div className={styles.SyncEntryBody}>
                  <div className={styles.SyncEntryLabel}>{entry.table}</div>
                  <div className={styles.SyncEntryMeta}>
                    {entry.action} - {entry.uuid} - {formatDate(entry.createdAt)}
                  </div>
                </div>
                <div className={styles.SyncEntryActions}>
                  <Button onClick={() => handleDelete(entry)} disabled={isSyncing}>
                    <span>✕</span>
                  </Button>
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
