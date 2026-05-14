import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import {
  useNotificationJournal,
  clearNotificationJournal,
  type NotificationJournalEntry,
} from "src/hooks/useFormStore";
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
    (_entry: NotificationJournalEntry) => {
      // Универсального открытия по endpoint нет — направляем в центр уведомлений.
      openCenter();
    },
    [openCenter],
  );

  if (!userUuid) return null;

  return (
    <div className={styles.NotificationToast}>
      <button
        className={styles.BellButton}
        onClick={() => setIsOpen((prev) => !prev)}
        title={t("notifications") || "Уведомления"}
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
                {t("markAllRead") || "Прочитать всё"}
              </button>
            )}
          </div>

          <div className={styles.PanelBody}>
            {recent.length === 0 ? (
              <div className={styles.Empty}>
                {t("noNotifications") || "Нет уведомлений"}
              </div>
            ) : (
              recent.map((n) => (
                <div
                  key={n.id}
                  className={`${styles.Item} ${n.timestamp > lastSeenAt ? styles.ItemSlideIn : ""
                    }`}
                >
                  <div
                    className={styles.ItemContent}
                    onClick={() => openEntry(n)}
                  >
                    <div className={styles.ItemTitle}>
                      {n.paneLabel || n.type}
                    </div>
                    <div className={styles.ItemMessage}>{n.text}</div>
                    <div className={styles.ItemTime}>
                      {new Date(n.timestamp).toLocaleString("ru-RU")}
                    </div>
                  </div>
                </div>
              ))
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
