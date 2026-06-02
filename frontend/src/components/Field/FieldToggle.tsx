import { FC, useId } from "react";
import { getTranslation } from "src/i18";
import styles from "./FieldToggle.module.scss";

export interface FieldToggleProps {
  /** Имя поля (для form-data при необходимости). */
  name?: string;
  /** Текст подписи слева от тумблера. */
  label?: string;
  /** Текст рядом с тумблером (опционально, заменяет label справа). */
  caption?: string;
  /** Текущее состояние. */
  value: boolean;
  /** Обработчик изменения. */
  onChange?: (checked: boolean) => void;
  /** Заблокирован. */
  disabled?: boolean;
  /** Цветовая схема (success — зелёный, по умолчанию). */
  variant?: "success" | "primary";
  /** Размер. */
  size?: "sm" | "md";
  /** Доп. класс контейнера. */
  className?: string;
  /** Подсказка title. */
  title?: string;
}

/**
 * Современный стилизованный toggle-switch для булевых полей формы.
 * Используется для отображения «Проведено», «Активен», «Удалён» и т. п.
 *
 * Пример:
 * ```tsx
 * <FieldToggle
 *   label="Проведено"
 *   value={form.fields.posted}
 *   onChange={(v) => form.setField("posted", v)}
 *   variant="success"
 * />
 * ```
 */
const FieldToggle: FC<FieldToggleProps> = ({
  name,
  label,
  caption,
  value,
  onChange,
  disabled,
  variant = "success",
  size = "md",
  className,
  title,
}) => {
  const id = useId();
  const handleChange = () => {
    if (disabled) return;
    onChange?.(!value);
  };

  return (
    <label
      htmlFor={id}
      className={[
        styles.FieldToggle,
        styles[`size_${size}`],
        styles[`variant_${variant}`],
        value && styles.checked,
        disabled && styles.disabled,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      title={title}
    >
      <input
        id={id}
        name={name}
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={handleChange}
        className={styles.input}
      />
      <span className={styles.badge} aria-hidden>
        <svg
          className={styles.checkIcon}
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 8.5l3 3 7-7" />
        </svg>
      </span>
      {label && <span className={styles.label}>{getTranslation(label)}</span>}
      {caption && <span className={styles.caption}>{caption}</span>}
    </label>
  );
};

export default FieldToggle;
