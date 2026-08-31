// FieldDateTime / FieldDate — поля выбора даты(-времени). Вынесено из Field/index.tsx (Q9).
import { FC, useId, type ChangeEvent } from "react";
import styles from "./Field.module.scss";
import { useFieldBase, FieldLabelNode, FieldHintNode, type FieldVariant } from "./fieldBase";

interface TypeFieldDateTimeProps {
  label?: string;
  name: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  width?: string;
  minWidth?: string;
  maxWidth?: string;
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  variant?: FieldVariant;
  /** Видимая подсказка-help ПОД полем. */
  hint?: React.ReactNode;
}

export const FieldDateTime: FC<TypeFieldDateTimeProps> = ({
  label,
  name,
  value = '',
  onChange,
  width,
  minWidth,
  maxWidth,
  disabled = false,
  required = false,
  error = false,
  variant = 'default',
}) => {
  // Гарантируем, что value для input[type=datetime-local] имеет формат YYYY-MM-DDTHH:mm
  const safeValue = (() => {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00`;
    return '';
  })();

  const uid = useId();
  const { isTable, wrapperClass, effectiveRequired } = useFieldBase({ name, variant, required, error, value });

  return (
    <div className={wrapperClass} style={{ width: width ?? 'auto', ...(width ? { flex: '0 0 auto' } : {}), minWidth: minWidth ?? 'none', maxWidth: maxWidth ?? 'none' }}>
      <FieldLabelNode htmlFor={uid} label={label} required={effectiveRequired} isTable={isTable} />
      <div className={styles.FieldInputWrapper}>
        <input
          type="datetime-local"
          id={uid}
          name={name}
          value={safeValue}
          onChange={onChange}
          className={`${styles.FieldString} ${disabled ? styles.FieldDisabled : ''}`}
          disabled={disabled}
        />
      </div>
    </div>
  );
};

// Компонент FieldDate — поле выбора даты (без времени)
export const FieldDate: FC<TypeFieldDateTimeProps> = ({
  label,
  name,
  value = '',
  onChange,
  width,
  minWidth,
  maxWidth,
  disabled = false,
  required = false,
  error = false,
  variant = 'default',
  hint,
}) => {
  // Гарантируем, что value для input[type=date] имеет формат YYYY-MM-DD
  const safeValue = (() => {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
    return '';
  })();

  const uid = useId();
  const hintId = hint ? `${uid}-hint` : undefined;
  const { isTable, wrapperClass, effectiveRequired } = useFieldBase({ name, variant, required, error, value });

  return (
    <div className={wrapperClass} style={{ width: width ?? 'auto', ...(width ? { flex: '0 0 auto' } : {}), minWidth: minWidth ?? 'none', maxWidth: maxWidth ?? 'none' }}>
      <FieldLabelNode htmlFor={uid} label={label} required={effectiveRequired} isTable={isTable} />
      <div className={styles.FieldInputWrapper}>
        <input
          type="date"
          id={uid}
          name={name}
          value={safeValue}
          onChange={onChange}
          className={`${styles.FieldDate} ${disabled ? styles.FieldDisabled : ''}`}
          disabled={disabled}
          aria-describedby={hintId}
        />
      </div>
      <FieldHintNode id={hintId} hint={hint} isTable={isTable} />
    </div>
  );
};

export { FieldFile } from "./FieldFile";

