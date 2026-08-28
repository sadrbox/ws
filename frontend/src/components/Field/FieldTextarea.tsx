// FieldTextarea — многострочное текстовое поле в стиле Field. Вынесено из Field/index.tsx (Q9).
import { FC, useId, type ChangeEvent } from "react";
import styles from "./Field.module.scss";
import { FieldHintNode } from "./fieldBase";
import { getTranslation } from "src/i18";
import { useCellFieldState } from "src/hooks/useDirtyHighlight";
import { useFormRequiredScope } from "src/hooks/useFormRequired";

interface TypeFieldTextareaProps {
  label?: string;
  name: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  width?: string;
  maxWidth?: string;
  minWidth?: string;
  minHeight?: string;
  rows?: number;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
  error?: boolean;
  /** Видимая подсказка-help ПОД полем. */
  hint?: React.ReactNode;
}

export const FieldTextarea: FC<TypeFieldTextareaProps> = ({
  label,
  name,
  value = '',
  onChange,
  width,
  maxWidth,
  minWidth,
  minHeight,
  rows = 4,
  disabled = false,
  placeholder,
  required = false,
  error = false,
  hint,
}) => {
  const cellState = useCellFieldState();
  const formRequired = useFormRequiredScope();
  const isEmpty = value === '' || value === undefined || value === null;
  const tail = name.includes('_') ? name.slice(name.lastIndexOf('_') + 1) : name;
  const effectiveRequired = required || !!cellState.required || formRequired.requiredKeys.has(tail);
  const effectiveError = error || !!cellState.error;

  const wrapperClass = [
    styles.FieldTextareaWrapper,
    !effectiveError && effectiveRequired && isEmpty ? styles.FieldRequired : '',
    effectiveError ? styles.FieldError : '',
  ].filter(Boolean).join(' ');

  const uid = useId();
  const hintId = hint ? `${uid}-hint` : undefined;
  return (
    <div className={wrapperClass} style={{ width: width ?? 'auto', maxWidth: maxWidth ?? 'none', minWidth: minWidth ?? 'none' }}>
      {label && (
        <label htmlFor={uid} className={styles.FieldLabel}>
          {typeof label === 'string' ? getTranslation(label) : label}
          {effectiveRequired && <span style={{ color: 'red', marginLeft: '4px' }}>*</span>}
        </label>
      )}
      <div className={styles.FieldTextareaInputWrapper}>
        <textarea
          id={uid}
          name={name}
          value={value}
          onChange={onChange}
          className={styles.FieldTextarea}
          disabled={disabled}
          placeholder={placeholder}
          rows={rows}
          style={{ minHeight: minHeight ?? undefined }}
          aria-describedby={hintId}
        />
      </div>
      <FieldHintNode id={hintId} hint={hint} isTable={false} />
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
