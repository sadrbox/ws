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

  const dismiss = useCallback((id: number) => {
    // Помечаем как closing для анимации
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, closing: true } : t)),
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, 280); // длительность CSS-анимации
  }, []);

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
      const timer = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

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
        >
          <span className={styles.Icon}>{ICONS[toast.type!]}</span>
          <div className={styles.Body}>
            {toast.title && <div className={styles.Title}>{toast.title}</div>}
            <MessageLines text={toast.message} />
          </div>
          <button
            className={styles.Close}
            onClick={() => dismiss(toast.id)}
            aria-label="Закрыть"
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
