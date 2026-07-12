import { FC, useEffect, useCallback } from "react";
import { translate } from "src/i18";
import styles from "./FormError.module.scss";

interface FormErrorProps {
  /** Текст ошибки. Если null/undefined/"" — компонент не рендерится */
  message: string | null | undefined;
  /** Колбэк для очистки ошибки (кнопка ×). Если не задан — кнопка не показывается */
  onDismiss?: () => void;
  /** Авто-скрытие через N мс (по умолчанию — 8000, 0 = отключено) */
  autoDismissMs?: number;
  /**
   * Ревизия ошибки — при изменении гарантирует перемонтирование
   * (перезапуск анимации + таймера auto-dismiss), даже если текст тот же.
   * Используйте с хуком useFormError().
   */
  revision?: number;
}

/**
 * Универсальный баннер ошибки для форм элементов.
 *
 * Лучшие практики:
 * - Красная левая полоса-акцент + иконка ⚠ для быстрого визуального распознавания
 * - Кнопка × для ручного закрытия
 * - Авто-скрытие через 8 сек (настраивается)
 * - Появление с мягкой анимацией (slideIn)
 * - При повторной одинаковой ошибке — анимация и таймер перезапускаются (через revision)
 *
 * Использование:
 * ```tsx
 * const [error, setError, errorRevision] = useFormError();
 * <FormError message={error} revision={errorRevision} onDismiss={() => setError(null)} />
 * ```
 */
const FormError: FC<FormErrorProps> = ({ message, onDismiss, autoDismissMs = 8000, revision }) => {
  const handleDismiss = useCallback(() => {
    onDismiss?.();
  }, [onDismiss]);

  useEffect(() => {
    if (!message || !onDismiss || !autoDismissMs) return;
    const timer = setTimeout(handleDismiss, autoDismissMs);
    return () => clearTimeout(timer);
    // revision в зависимостях гарантирует перезапуск таймера при повторной ошибке
  }, [message, revision, handleDismiss, autoDismissMs]);

  if (!message) return null;

  return (
    <div key={revision} className={styles.formError} role="alert">
      <svg className={styles.icon} viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM7.25 5a.75.75 0 0 1 1.5 0v3a.75.75 0 0 1-1.5 0V5Zm.75 6.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
      </svg>
      <span className={styles.message}>{message}</span>
      {onDismiss && (
        <button className={styles.close} onClick={handleDismiss} title={translate("close")} type="button">
          ×
        </button>
      )}
    </div>
  );
};

FormError.displayName = "FormError";
export default FormError;
