import type { TDataItem } from "src/components/Table/types";
import { FC, useCallback } from "react";
import { useAppContext } from "src/app/context";
import {
  useNotificationJournal,
  clearNotificationJournal,
} from "src/hooks/useFormStore";
import type { NotificationJournalEntry } from "src/hooks/useFormStore";
import { translate } from "src/i18";
import styles from "./Notifications.module.scss";

// ═══════════════════════════════════════════════════════════════════════════
// Локальный журнал уведомлений (localStorage, без сервера)
// ═══════════════════════════════════════════════════════════════════════════

interface NotificationsListProps {
  variant?: string;
  onSelectItem?: (item: TDataItem) => void;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const NotificationsList: FC<NotificationsListProps> = () => {
  const journal = useNotificationJournal();
  const { addPane } = useAppContext().windows;

  const openRef = useCallback(
    (entry: NotificationJournalEntry) => {
      if (!entry.ref) return;
      const { endpoint, uuid } = entry.ref;
      void import("../../registry/formRegistry").then(({ openFormByEndpoint }) => {
        void openFormByEndpoint(endpoint, uuid, addPane);
      }).catch(() => { /* intentional */ });
    },
    [addPane],
  );

  const reversed = [...journal].reverse();

  return (
    <div className={styles.JournalWrap}>
      <div className={styles.JournalHeader}>
        <h3 className={styles.JournalTitle}>{translate("notificationsCenter")}</h3>
        {journal.length > 0 && (
          <button className={styles.JournalClear} onClick={clearNotificationJournal} type="button">
            Очистить журнал
          </button>
        )}
      </div>
      {reversed.length === 0 ? (
        <div className={styles.JournalEmpty}>{translate("noNotifications")}</div>
      ) : (
        <div className={styles.JournalList}>
          {reversed.map((entry) => (
            <div
              key={entry.id}
              className={[styles.JournalItem, entry.type === "warning" ? styles.JournalWarning : styles.JournalInfo].join(" ")}
            >
              <span className={styles.JournalIcon}>
                {entry.type === "warning" ? "⚠️" : "ℹ️"}
              </span>
              <div className={styles.JournalBody}>
                {entry.paneLabel && (
                  <div className={styles.JournalLabel}>
                    {entry.ref ? (
                      <button
                        className={styles.JournalLink}
                        onClick={() => openRef(entry)}
                        type="button"
                        title="Открыть объект"
                      >
                        {entry.paneLabel}
                      </button>
                    ) : (
                      <span>{entry.paneLabel}</span>
                    )}
                  </div>
                )}
                <div className={styles.JournalText}>{entry.text}</div>
                <div className={styles.JournalDate}>{formatDate(entry.timestamp)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

NotificationsList.displayName = "NotificationsList";
export { NotificationsList };
