import { FC, useId } from "react";
import { translate, getTranslation } from "src/i18";
import { Icon } from "src/components/IconButton/icons";
import styles from "./HeaderTogglePosted.module.scss";

export interface HeaderTogglePostedProps {
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
 * Переключатель «Проведён» для ШАПКИ панели (PaneItemHeaderToolbar). Это НЕ
 * Field-элемент, а тулбар-тоггл в стиле IconButton: иконка статуса (posted/
 * notPosted) + подпись, с подсветкой активного состояния (мягкий зелёный), без
 * «пилюли». Кликабелен целиком, доступен с клавиатуры. Контракт props совпадает
 * с прежним FieldTogglePostedDocument — замена в вызовах механическая.
 *
 * ```tsx
 * <HeaderTogglePosted
 *   value={form.fields.posted}
 *   onChange={(v) => form.setField("posted", v)}
 *   disabled={!canWrite}
 * />
 * ```
 */
const HeaderTogglePosted: FC<HeaderTogglePostedProps> = ({
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
      <span className={styles.icon} aria-hidden>
        <Icon name={value ? "posted" : "notPosted"} width={16} height={16} />
      </span>
      <span className={styles.label}>{text}</span>
    </label>
  );
};

export default HeaderTogglePosted;
