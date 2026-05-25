/**
 * UIToast — глобальный компонент для показа коротких системных уведомлений
 * (ошибки прав доступа, сетевые ошибки и пр.)
 *
 * Работает через CustomEvent "ui_toast":
 *   window.dispatchEvent(new CustomEvent("ui_toast", {
 *     detail: { message: "Недостаточно прав", type: "error" }
 *   }))
 */
import { FC, useCallback, useEffect, useRef, useState } from "react";
import { translate } from "src/i18";
import styles from "./UIToast.module.scss";

const MessageLines: FC<{ text: string }> = ({ text }) => {
  const lines = text.split("\n");
  if (lines.length === 1) return <span className={styles.Message}>{text}</span>;
  return (
    <ul className={styles.Lines}>
      {lines.map((line, i) => (
        <li key={i} className={styles.Line}>{line}</li>
      ))}
    </ul>
  );
};

export type UIToastType = "error" | "warning" | "info" | "success";

export interface UIToastDetail {
  message: string;
  type?: UIToastType;
  duration?: number; // мс, по умолчанию 4000
  title?: string;   // контекст: имя документа / панели
}

interface ToastItem extends UIToastDetail {
  id: number;
  closing: boolean;
}

let _nextId = 1;

const ICONS: Record<UIToastType, string> = {
  error: "🚫",
  warning: "⚠️",
  info: "ℹ️",
  success: "✅",
};

const UIToast: FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // remaining ms per toast when paused (id → ms left)
  const remaining = useRef<Map<number, number>>(new Map());
  // start time of current timer (id → Date.now())
  const startedAt = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, closing: true } : t)),
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(id);
      remaining.current.delete(id);
      startedAt.current.delete(id);
    }, 280); // длительность CSS-анимации
  }, []);

  const scheduleTimer = useCallback((id: number, ms: number) => {
    clearTimeout(timers.current.get(id));
    remaining.current.set(id, ms);
    startedAt.current.set(id, Date.now());
    const timer = setTimeout(() => dismiss(id), ms);
    timers.current.set(id, timer);
  }, [dismiss]);

  const addToast = useCallback(
    (detail: UIToastDetail) => {
      const id = _nextId++;
      const duration = detail.duration ?? 4000;
      const item: ToastItem = {
        ...detail,
        type: detail.type ?? "error",
        id,
        closing: false,
      };
      setToasts((prev) => [...prev.slice(-4), item]); // не более 5 одновременно
      scheduleTimer(id, duration);
    },
    [scheduleTimer],
  );

  const handleMouseEnter = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer == null) return;
    clearTimeout(timer);
    timers.current.delete(id);
    const elapsed = Date.now() - (startedAt.current.get(id) ?? Date.now());
    const left = Math.max((remaining.current.get(id) ?? 0) - elapsed, 0);
    remaining.current.set(id, left);
  }, []);

  const handleMouseLeave = useCallback((id: number) => {
    const left = remaining.current.get(id);
    if (left == null) return;
    scheduleTimer(id, left);
  }, [scheduleTimer]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<UIToastDetail>).detail;
      if (detail?.message) addToast(detail);
    };
    window.addEventListener("ui_toast", handler);
    return () => window.removeEventListener("ui_toast", handler);
  }, [addToast]);

  // Очищаем таймеры при размонтировании
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((timer) => clearTimeout(timer));
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className={styles.Container} aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.Toast} ${styles[toast.type!]} ${toast.closing ? styles.closing : ""}`}
          role="alert"
          onMouseEnter={() => handleMouseEnter(toast.id)}
          onMouseLeave={() => handleMouseLeave(toast.id)}
        >
          <span className={styles.Icon}>{ICONS[toast.type!]}</span>
          <div className={styles.Body}>
            {toast.title && <div className={styles.Title}>{toast.title}</div>}
            <MessageLines text={toast.message} />
          </div>
          <button
            className={styles.Close}
            onClick={() => dismiss(toast.id)}
            aria-label={translate("close")}
            type="button"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

UIToast.displayName = "UIToast";
export default UIToast;

/** Утилита — удобный вызов из любого места */
export function showToast(message: string, type: UIToastType = "error", duration?: number) {
  window.dispatchEvent(
    new CustomEvent("ui_toast", { detail: { message, type, duration } }),
  );
}
