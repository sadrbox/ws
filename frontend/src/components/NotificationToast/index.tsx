import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useAppContext } from "src/app/context";
import { translate } from "src/i18";
import {
  useNotificationJournal,
  clearNotificationJournal,
  type NotificationJournalEntry,
} from "src/hooks/useFormStore";
import { openFormByRef, canOpenByRef } from "src/utils/openFormByRef";
import styles from "./NotificationToast.module.scss";

/**
 * Колокольчик уведомлений в шапке.
 *
 * Уведомления хранятся ИСКЛЮЧИТЕЛЬНО на клиенте (localStorage), сервер
 * никаких уведомлений не пишет и не возвращает. «Непрочитанные» считаются
 * как записи журнала с timestamp > lastSeenAt (ключ — на пользователя).
 */
const NotificationToast: FC<{ userUuid?: string }> = ({ userUuid }) => {
  const journal = useNotificationJournal();
  const [isOpen, setIsOpen] = useState(false);
  const { addPane } = useAppContext().windows;
  const t = (key: string) => translate(key) || key;

  const seenKey = useMemo(
    () => `notification-journal:lastSeen:${userUuid || "anonymous"}`,
    [userUuid],
  );

  const [lastSeenAt, setLastSeenAt] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(seenKey)) || 0;
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    try {
      setLastSeenAt(Number(localStorage.getItem(seenKey)) || 0);
    } catch {
      setLastSeenAt(0);
    }
  }, [seenKey]);

  const unread = useMemo(
    () => journal.filter((e) => e.timestamp > lastSeenAt),
    [journal, lastSeenAt],
  );

  const recent = useMemo(
    () => [...journal].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10),
    [journal],
  );

  const markAllRead = useCallback(() => {
    const now = Date.now();
    try {
      localStorage.setItem(seenKey, String(now));
    } catch {
      /* ignore */
    }
    setLastSeenAt(now);
  }, [seenKey]);

  const openCenter = useCallback(() => {
    void import("src/models/Notifications").then(({ NotificationsList }) => {
      addPane({
        component: NotificationsList,
        label: "Центр уведомлений",
      });
    });
    setIsOpen(false);
    markAllRead();
  }, [addPane, markAllRead]);

  const openEntry = useCallback(
    (entry: NotificationJournalEntry) => {
      if (entry.ref && canOpenByRef(entry.ref.endpoint)) {
        void openFormByRef(entry.ref, addPane, entry.paneLabel);
        setIsOpen(false);
        markAllRead();
      } else {
        openCenter();
      }
    },
    [openCenter, addPane, markAllRead],
  );

  if (!userUuid) return null;

  return (
    <div className={styles.NotificationToast}>
      <button
        className={styles.BellButton}
        onClick={() => setIsOpen((prev) => !prev)}
        title={t("notifications") || translate("notifications")}
        type="button"
      >
        🔔
        {unread.length > 0 && (
          <span className={styles.Badge}>
            {unread.length > 99 ? "99+" : unread.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className={styles.Panel}>
          <div className={styles.PanelHeader}>
            <span>{t("notifications") || "Уведомления"}</span>
            {journal.length > 0 && (
              <button
                className={styles.MarkAllBtn}
                onClick={markAllRead}
                type="button"
              >
                {t("markAllRead") || translate("markAllRead")}
              </button>
            )}
          </div>

          <div className={styles.PanelBody}>
            {recent.length === 0 ? (
              <div className={styles.Empty}>
                {t("noNotifications") || translate("noNotifications")}
              </div>
            ) : (
              recent.map((n) => {
                const hasLink = !!n.ref && canOpenByRef(n.ref.endpoint);
                return (
                  <div
                    key={n.id}
                    className={`${styles.Item} ${n.timestamp > lastSeenAt ? styles.ItemSlideIn : ""}`}
                  >
                    <div className={styles.ItemContent}>
                      <div className={styles.ItemHeader}>
                        <span className={`${styles.TypeBadge} ${styles[`type_${n.type}`]}`}>{n.type}</span>
                        {n.paneLabel && <span className={styles.PaneLabel}>{n.paneLabel}</span>}
                      </div>
                      <div className={styles.ItemMessage}>
                        {n.text.split("\n").map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                      </div>
                      <div className={styles.ItemFooter}>
                        <span className={styles.ItemTime}>
                          {new Date(n.timestamp).toLocaleString("ru-RU")}
                        </span>
                        {hasLink && (
                          <button
                            className={styles.ItemOpenBtn}
                            type="button"
                            onClick={() => openEntry(n)}
                          >
                            Открыть ➜
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className={styles.PanelFooter}>
            <button
              className={styles.ShowAllBtn}
              onClick={openCenter}
              type="button"
            >
              {t("showAll") || "Открыть центр уведомлений"}
            </button>
            {journal.length > 0 && (
              <button
                className={styles.ShowAllBtn}
                onClick={() => {
                  clearNotificationJournal();
                  markAllRead();
                }}
                type="button"
              >
                Очистить
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

NotificationToast.displayName = "NotificationToast";
export default NotificationToast;
