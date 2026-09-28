/**
 * UIToast — глобальный компонент для показа коротких системных уведомлений
 * (ошибки прав доступа, сетевые ошибки и пр.)
 *
 * Работает через CustomEvent "ui_toast", но слать его руками не нужно:
 *   notify({ severity, text, source })   — событие: тост + след в журнале (TechMessages/store)
 *   showToast(message, type)             — только тост; отправляет событие сам
 *
 * Плюс постоянное уведомление «Доступна новая версия» с кнопкой (КР-10 аудита 27.09): состояние —
 * в services/appUpdate, сюда оно приходит подпиской.
 */
import { FC, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { translate } from "src/i18";
import {
  applyAppUpdate, dismissAppUpdate, getAppUpdateState, hasUnsavedWork, subscribeAppUpdate, type AppUpdateState,
} from "src/services/appUpdate";
import { ErrorIcon, InfoIcon, SuccessIcon, WarningIcon } from "./icons";
import styles from "./UIToast.module.scss";

const MessageLines: FC<{ text: string }> = ({ text }) => {
  const lines = text.split("\n").filter((l) => l.length > 0);
  if (lines.length <= 1) return <span className={styles.Message}>{text}</span>;
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
  duration: number;
  closing: boolean;
  paused: boolean;
}

const ICONS: Record<UIToastType, FC> = {
  error: ErrorIcon,
  warning: WarningIcon,
  info: InfoIcon,
  success: SuccessIcon,
};

const MAX_VISIBLE = 5;

/**
 * «Доступна новая версия» — не исчезает сама: обновиться человек решает кнопкой. Есть
 * несохранённое — первое нажатие только предупреждает, что пропадёт, второе обновляет.
 */
const AppUpdateNotice: FC<{ state: Exclude<AppUpdateState, "none"> }> = ({ state }) => {
  const [confirming, setConfirming] = useState(false);
  const onApply = () => {
    if (!confirming && hasUnsavedWork()) {
      setConfirming(true);
      return;
    }
    applyAppUpdate();
  };
  return (
    <div className={`${styles.Toast} ${styles.info}`} role="status" aria-live="polite" data-app-update="true">
      <span className={styles.Icon}>
        <InfoIcon />
      </span>
      <div className={styles.Body}>
        <MessageLines text={translate(state === "ready" ? "appUpdateReady" : "appUpdateActivated")} />
        {confirming && <MessageLines text={translate("appUpdateUnsaved")} />}
        <button type="button" className={styles.ToastAction} onClick={onApply}>
          {translate(confirming ? "appUpdateReloadAnyway" : "appUpdateReload")}
        </button>
      </div>
      <button className={styles.Close} onClick={dismissAppUpdate} aria-label={translate("close")} type="button">
        ×
      </button>
    </div>
  );
};

const UIToast: FC = () => {
  const appUpdate = useSyncExternalStore(subscribeAppUpdate, getAppUpdateState, getAppUpdateState);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
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
    }, 240); // длительность CSS-анимации закрытия
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
      const id = nextId.current++;
      const duration = detail.duration ?? 4000;
      const item: ToastItem = {
        ...detail,
        type: detail.type ?? "error",
        id,
        duration,
        closing: false,
        paused: false,
      };
      setToasts((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), item]);
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
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, paused: true } : t)));
  }, []);

  const handleMouseLeave = useCallback((id: number) => {
    const left = remaining.current.get(id);
    if (left == null) return;
    scheduleTimer(id, left);
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, paused: false } : t)));
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

  if (toasts.length === 0 && appUpdate === "none") return null;

  // Тосты в state хранятся в порядке появления (новый — последний).
  // В DOM рендерим в обратном порядке: верх — старые, низ — новый,
  // т.к. .Container имеет flex-direction: column-reverse и стекает снизу.
  // Уведомление о новой версии — первым узлом: оно внизу и не участвует в «стопке».
  return (
    <div className={styles.Container} aria-live="polite" aria-atomic="false">
      {appUpdate !== "none" && <AppUpdateNotice state={appUpdate} />}
      {toasts.map((toast, idx) => {
        const Icon = ICONS[toast.type!];
        // offset: 0 у нового (последнего в state), 1 у предыдущего и т.д.
        const offset = toasts.length - 1 - idx;
        const isAssertive = toast.type === "error" || toast.type === "warning";
        return (
          <div
            key={toast.id}
            data-offset={offset}
            className={`${styles.Toast} ${styles[toast.type!]} ${toast.closing ? styles.closing : ""}`}
            role={isAssertive ? "alert" : "status"}
            aria-live={isAssertive ? "assertive" : "polite"}
            onMouseEnter={() => handleMouseEnter(toast.id)}
            onMouseLeave={() => handleMouseLeave(toast.id)}
          >
            <span className={styles.Icon}>
              <Icon />
            </span>
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
            <span
              className={styles.Progress}
              style={{
                animationDuration: `${toast.duration}ms`,
                animationPlayState: toast.paused ? "paused" : "running",
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

UIToast.displayName = "UIToast";
export default UIToast;

/**
 * Утилита — удобный вызов из любого места. Единственное место, откуда уходит событие
 * "ui_toast". Прикладному коду предпочтительнее `notify` (TechMessages/store): он решает,
 * оставить ли событию след в журнале.
 */
export function showToast(message: string, type: UIToastType = "error", duration?: number, title?: string) {
  window.dispatchEvent(
    new CustomEvent("ui_toast", { detail: { message, type, duration, title } }),
  );
}
