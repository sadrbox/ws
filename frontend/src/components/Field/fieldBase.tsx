// Общая база Field*-компонентов: useFieldBase + подписи/подсказки + FieldVariant.
// Вынесено из Field/index.tsx (Q9), чтобы компоненты можно было дробить без цикла.
import React, { FC } from "react";
import styles from "./Field.module.scss";
import { getTranslation } from "src/i18";
import { useCellFieldState } from "src/hooks/useDirtyHighlight";
import { useFormRequiredScope, useFormDirtyScope } from "src/hooks/useFormRequired";
import type { IconName } from "src/components/IconButton/icons";

// Карта тип-действия → иконка + подпись (общая для Field*-компонентов).
export const FIELD_ACTION_META: Record<'clear' | 'list' | 'open' | 'assignNumber', { icon: IconName; label: string }> = {
  clear: { icon: "clear", label: "Очистить" },
  list: { icon: "list", label: "Выбрать из списка" },
  open: { icon: "open", label: "Открыть" },
  assignNumber: { icon: "recalc", label: "Присвоить номер" },
};
export type FieldActionType = 'clear' | 'list' | 'open' | 'assignNumber';
export interface FieldAction { type: FieldActionType; onClick: () => void; /** Скрыть кнопку (display:none): набор в DOM постоянен, места не занимает. Стабильность ширины поля обеспечивает width-семантика (заданная ширина = flex 0 0 auto). */ hidden?: boolean; }
export type TypeFieldActions = FieldAction[];

// ── Общий hook для всех Field* компонентов ──────────────────────────────────
// Источники required: явный проп → CellFieldStateScope → FormRequiredScope
// Источники dirty:    явный проп isDirty → FormDirtyScope
export function useFieldBase(params: {
  name: string;
  variant: FieldVariant;
  required: boolean;
  error: boolean;
  value?: string | number;
  isDirty?: boolean;
}) {
  const { name, variant, required, error, value, isDirty: isDirtyProp } = params;
  const cellState = useCellFieldState();
  const formRequired = useFormRequiredScope();
  const formDirty = useFormDirtyScope();
  const isTable = variant === 'table';
  // Header fields: matches validateDocumentFields (null/undefined/"" only).
  // Table cells: matches isItemFieldEmpty (null/undefined/""/0).
  const isEmpty = value === '' || value === undefined || value === null || (isTable && value === 0);

  // tail: часть имени после последнего `_` (напр. "formUid_date" → "date")
  const tail = name.includes('_') ? name.slice(name.lastIndexOf('_') + 1) : name;

  const effectiveRequired = required || !!cellState.required || (!isTable && formRequired.requiredKeys.has(tail));
  const effectiveError = error || !!cellState.error;
  const effectiveDirty = !isTable && (isDirtyProp || formDirty.has(tail));

  const wrapperClass = [
    isTable ? `${styles.FieldWrapper} ${styles.tableVariant}` : styles.FieldWrapper,
    !effectiveError && effectiveRequired && isEmpty ? styles.FieldRequired : '',
    effectiveError ? styles.FieldError : '',
    effectiveDirty ? styles.FieldDirty : '',
  ].filter(Boolean).join(' ');

  return { isTable, wrapperClass, effectiveRequired, effectiveError };
}

// ── Подпись поля (label + asterisk для required) ────────────────────────────
export const FieldLabelNode: FC<{
  /** id формируемого labelable-элемента (input/select/textarea). */
  htmlFor?: string;
  /** id самого <label> — для связи с нестандартными контролами через aria-labelledby. */
  id?: string;
  label?: React.ReactNode;
  required: boolean;
  isTable: boolean;
}> = ({ htmlFor, id, label, required, isTable }) => {
  if (isTable || !label) return null;
  return (
    <label htmlFor={htmlFor} id={id} className={styles.FieldLabel}>
      {typeof label === 'string' ? getTranslation(label) : label}
      {required && <span style={{ color: 'red', marginLeft: '4px' }}>*</span>}
    </label>
  );
};

// Подсказка-help уровня ПОЛЯ (под контролом). Рендерится ВНУТРИ обёртки Field*, id
// связывается с контролом через aria-describedby. Не для табличного варианта и не для
// заметок уровня секции/формы (для тех — свои элементы вне поля).
export const FieldHintNode: FC<{ id?: string; hint?: React.ReactNode; isTable: boolean }> = ({ id, hint, isTable }) => {
  if (isTable || hint == null || hint === '') return null;
  return <div id={id} className={styles.FieldHint}>{hint}</div>;
};

// Варианты отображения Field*
export type FieldVariant = 'default' | 'table';
