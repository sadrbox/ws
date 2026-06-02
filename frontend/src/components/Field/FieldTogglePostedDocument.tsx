import { FC, useId } from "react";
import { translate, getTranslation } from "src/i18";
import styles from "./FieldTogglePostedDocument.module.scss";

export interface FieldTogglePostedDocumentProps {
  /** Текущее состояние (проведён/не проведён). */
  value: boolean;
  /** Обработчик изменения. */
  onChange?: (checked: boolean) => void;
  /** Заблокирован. */
  disabled?: boolean;
  /** Имя поля (для form-data при необходимости). */
  name?: string;
  /** Подпись (по умолчанию «Проведён»). */
  label?: string;
  /** Подсказка title. */
  title?: string;
}

/**
 * Статусный переключатель «Проведён» — пилюля с круглым зелёным бейджем и
 * галочкой. Выделенный компонент специально для флага проведения документа
 * (визуально заметнее обычного FieldToggle). Кликабелен целиком, доступен
 * с клавиатуры.
 *
 * ```tsx
 * <FieldTogglePostedDocument
 *   value={form.fields.posted}
 *   onChange={(v) => form.setField("posted", v)}
 *   disabled={!canWrite}
 * />
 * ```
 */
const FieldTogglePostedDocument: FC<FieldTogglePostedDocumentProps> = ({
  value,
  onChange,
  disabled,
  name,
  label,
  title,
}) => {
  const id = useId();
  const text = label ? getTranslation(label) : translate("posted");

  return (
    <label
      htmlFor={id}
      className={[
        styles.Toggle,
        value && styles.checked,
        disabled && styles.disabled,
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
        onChange={() => { if (!disabled) onChange?.(!value); }}
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
      <span className={styles.label}>{text}</span>
    </label>
  );
};

export default FieldTogglePostedDocument;
