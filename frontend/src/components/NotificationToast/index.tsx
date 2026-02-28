import { FC, useState, useEffect, useCallback, useRef } from "react";
import { api } from "src/services/api/client";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import styles from "./NotificationToast.module.scss";

interface TNotification {
  uuid: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  todo?: { uuid: string; shortName: string; id: number };
}

const POLL_INTERVAL = 30_000; // 30 секунд

const NotificationToast: FC<{ userUuid?: string }> = ({ userUuid }) => {
  const [notifications, setNotifications] = useState<TNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const { addPane } = useAppContext().windows;
  const t = (key: string) => translate(key) || key;
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Получить количество непрочитанных
  const fetchUnreadCount = useCallback(async () => {
    if (!userUuid) return;
    try {
      const res: any = await api.get(`/notifications/unread-count?userUuid=${userUuid}`);
      setUnreadCount(res.count ?? 0);
    } catch { /* ignore */ }
  }, [userUuid]);

  // Получить последние непрочитанные
  const fetchNotifications = useCallback(async () => {
    if (!userUuid) return;
    try {
      const res: any = await api.get(`/notifications?filter=${encodeURIComponent(JSON.stringify({ isRead: { value: false, operator: "equals" } }))}&sort=${encodeURIComponent(JSON.stringify({ createdAt: "desc" }))}&limit=10`);
      setNotifications(res.data ?? []);
      setUnreadCount(res.total ?? 0);
    } catch { /* ignore */ }
  }, [userUuid]);

  // Пометить одно как прочитанное
  const markRead = useCallback(async (uuid: string) => {
    setRemoving(prev => new Set(prev).add(uuid));
    try {
      await api.put(`/notifications/${uuid}/read`);
    } catch { /* ignore */ }
    // Убираем с анимацией
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.uuid !== uuid));
      setUnreadCount(prev => Math.max(0, prev - 1));
      setRemoving(prev => { const s = new Set(prev); s.delete(uuid); return s; });
    }, 300);
  }, []);

  // Пометить все как прочитанные
  const markAllRead = useCallback(async () => {
    if (!userUuid) return;
    try {
      await api.put("/notifications/read-all", { userUuid });
    } catch { /* ignore */ }
    setNotifications([]);
    setUnreadCount(0);
  }, [userUuid]);

  // Открыть панель уведомлений
  const openNotificationsList = useCallback(() => {
    import("src/models/Notifications").then(({ NotificationsList }) => {
      addPane({
        component: NotificationsList,
        label: t("NotificationsList"),
      });
    });
    setIsOpen(false);
  }, [addPane, t]);

  // Открыть задачу из уведомления
  const openTodo = useCallback((n: TNotification) => {
    if (!n.todo?.uuid) return;
    import("src/models/Todos").then(({ TodosForm }) => {
      addPane({
        label: `${t("TodosList")}: ${n.todo!.shortName || "?"} • ${n.todo!.id}`,
        component: TodosForm,
        data: { uuid: n.todo!.uuid } as any,
      });
    });
    setIsOpen(false);
  }, [addPane, t]);

  // Polling
  useEffect(() => {
    fetchUnreadCount();
    timerRef.current = setInterval(fetchUnreadCount, POLL_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [fetchUnreadCount]);

  // Загрузить уведомления при открытии
  useEffect(() => {
    if (isOpen) fetchNotifications();
  }, [isOpen, fetchNotifications]);

  if (!userUuid) return null;

  return (
    <div className={styles.NotificationToast}>
      {/* Колокольчик */}
      <button
        className={styles.BellButton}
        onClick={() => setIsOpen(prev => !prev)}
        title={t("notifications")}
      >
        🔔
        {unreadCount > 0 && (
          <span className={styles.Badge}>{unreadCount > 99 ? "99+" : unreadCount}</span>
        )}
      </button>

      {/* Выпадающая панель */}
      {isOpen && (
        <div className={styles.Panel}>
          <div className={styles.PanelHeader}>
            <span>{t("notifications")}</span>
            {notifications.length > 0 && (
              <button className={styles.MarkAllBtn} onClick={markAllRead}>
                {t("markAllRead")}
              </button>
            )}
          </div>

          <div className={styles.PanelBody}>
            {notifications.length === 0 ? (
              <div className={styles.Empty}>{t("noNotifications")}</div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.uuid}
                  className={`${styles.Item} ${removing.has(n.uuid) ? styles.ItemSlideOut : styles.ItemSlideIn}`}
                >
                  <div className={styles.ItemContent} onClick={() => openTodo(n)}>
                    <div className={styles.ItemTitle}>{n.title}</div>
                    <div className={styles.ItemMessage}>{n.message}</div>
                    <div className={styles.ItemTime}>
                      {new Date(n.createdAt).toLocaleString("ru-RU")}
                    </div>
                  </div>
                  <button
                    className={styles.MarkReadBtn}
                    onClick={(e) => { e.stopPropagation(); markRead(n.uuid); }}
                    title={t("markRead")}
                  >✓</button>
                </div>
              ))
            )}
          </div>

          <div className={styles.PanelFooter}>
            <button className={styles.ShowAllBtn} onClick={openNotificationsList}>
              {t("showAll")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

NotificationToast.displayName = "NotificationToast";
export default NotificationToast;
