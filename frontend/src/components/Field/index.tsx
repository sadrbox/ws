import React, { CSSProperties, FC, useId, useRef, type ChangeEvent } from 'react'

import styles from "./Field.module.scss"
import FieldActionButton from "./FieldActionButton"

import { useFieldBase, FieldLabelNode, FieldHintNode, FIELD_ACTION_META } from "./fieldBase";
import type { TypeFieldActions } from "./fieldBase";
export type { TypeFieldActions } from "./fieldBase";
import type { FieldVariant } from "./fieldBase";
export type { FieldVariant } from "./fieldBase";





// Пропсы для Field
interface TypeFieldStringProps {
  label?: string;
  name: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  width?: string;
  maxWidth?: string;
  minWidth?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Подсказка при наведении (title инпута). Не оборачивать поле в <span> ради
   *  title — обёртка ломает растягивание поля по ширине родителя. */
  title?: string;
  required?: boolean;
  error?: boolean;
  /** Явный список действий-кнопок (полностью переопределяет встроенные). */
  actions?: TypeFieldActions;
  /** Показывать встроенную кнопку «Очистить», если `actions` не задан. По умолчанию
   *  false — без явных `actions`/`clearable` поле не показывает FieldActions при фокусе. */
  clearable?: boolean;
  variant?: FieldVariant;
  /** Тип ввода. password — для секретов (пароль пользователя ИБ и т.п.): без него
   *  единственной альтернативой был бы собственный <input> в обход общего поля. */
  type?: "text" | "password";
  autoFocus?: boolean;
  /** Максимальная длина ввода (символов). Напр. 9 для номера документа. */
  maxLength?: number;
  /** Поле имеет несохранённые изменения (при открытии через "Несохранённые записи") */
  isDirty?: boolean;
  /** Видимая подсказка-help ПОД полем (не путать с `title`). Связывается через aria-describedby. */
  hint?: React.ReactNode;
}

// Пропсы для FieldGroup
interface TypeFieldGroupProps {
  name: string;
  label?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  actions?: TypeFieldActions;
  style?: CSSProperties;
  disabled?: boolean;
  placeholder?: string;
  /** Подсказка при наведении (title инпута). */
  title?: string;
  required?: boolean;
  error?: boolean;
  variant?: FieldVariant;
  autoFocus?: boolean;
  /** Видимая подсказка-help ПОД полем. */
  hint?: React.ReactNode;
}

// // Иконки для действий (можно заменить на ваши SVG)
// const imgActions: Record<FieldActionType, { img: React.ReactNode; alt: string }> = {
//   clear: {
//     img: (
//       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
//       </svg>
//     ),
//     alt: 'Очистить'
//   },
//   list: {
//     img: (
//       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
//       </svg>
//     ),
//     alt: 'Список'
//   },
//   open: {
//     img: (
//       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <path d="M6 2L12 8L6 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
//       </svg>
//     ),
//     alt: 'Открыть'
//   }
// };

// Компонент Field
export const Field: FC<TypeFieldStringProps> = ({
  label,
  name,
  value = '',
  onChange,
  onBlur,
  width,
  maxWidth,
  minWidth,
  disabled = false,
  placeholder,
  title,
  required = false,
  error = false,
  type = "text",
  actions,
  clearable = false,
  variant = 'default',
  autoFocus,
  maxLength,
  isDirty,
  hint,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleClear = () => {
    if (inputRef.current) {
      inputRef.current.value = "";
      if (onChange) {
        const event = new Event('input', { bubbles: true });
        Object.defineProperty(event, 'target', { writable: false, value: inputRef.current });
        onChange(event as unknown as ChangeEvent<HTMLInputElement>);
      }
    }
  };

  // FieldActions опциональны: явный `actions` переопределяет; встроенная «Очистить»
  // показывается ТОЛЬКО при clearable (по умолчанию false — без actions/clearable
  // поле не показывает FieldActions при фокусе).
  const defaultActions: TypeFieldActions = actions ?? (clearable ? [{ type: "clear", onClick: handleClear }] : []);

  // НЕ убираем действия из DOM (иначе поле «прыгает»): при disabled — делаем
  // недоступными, а «Очистить» при пустом значении — НЕВИДИМОЙ (hidden), но место
  // сохраняем. Так очистка/заполнение не меняют ширину блока действий.
  const visibleActions = defaultActions.map(action =>
    action.type === 'clear' && !value ? { ...action, hidden: true } : action,
  );

  return (
    <FieldGroup
      name={name}
      label={label}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      inputRef={inputRef}
      style={{
        width: width ?? '100%',
        maxWidth: maxWidth ?? 'none',
        minWidth: minWidth ?? 'none',
        // Заданная ширина фиксирует поле: не растягивать/не сжимать в flex-ряду.
        ...(width ? { flex: '0 0 auto' } : {}),
      }}
      actions={visibleActions.length > 0 ? visibleActions : undefined}
      disabled={disabled}
      placeholder={placeholder}
      title={title}
      required={required}
      error={error}
      variant={variant}
      type={type}
      autoFocus={autoFocus}
      maxLength={maxLength}
      isDirty={isDirty}
      hint={hint}
    />
  );
};

// Компонент FieldGroup
export const FieldGroup: FC<TypeFieldGroupProps & { isDirty?: boolean; maxLength?: number; type?: "text" | "password" }> = ({
  name,
  label,
  value = '',
  onChange,
  onBlur,
  inputRef,
  actions,
  style,
  disabled = false,
  placeholder,
  title,
  required = false,
  error = false,
  variant = 'default',
  autoFocus,
  maxLength,
  isDirty,
  hint,
  type = "text",
}) => {
  const uid = useId();
  const hintId = hint ? `${uid}-hint` : undefined;
  const { isTable, wrapperClass, effectiveRequired } = useFieldBase({ name, variant, required, error, value, isDirty });

  return (
    <div className={wrapperClass} style={style}>
      <FieldLabelNode htmlFor={uid} label={label} required={effectiveRequired} isTable={isTable} />
      <div className={styles.FieldInputWrapper}>
        <input
          ref={inputRef}
          type={type}
          id={uid}
          name={name}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          className={`${styles.FieldString} ${disabled ? styles.FieldDisabled : ''}`}
          autoComplete='off'
          disabled={disabled}
          placeholder={placeholder}
          title={title}
          maxLength={maxLength}
          autoFocus={autoFocus}
          aria-describedby={hintId}
        />
        {actions && actions.length > 0 && (
          <div className={styles.FieldActions}>
            {actions.map((action, index) => {
              const meta = FIELD_ACTION_META[action.type];
              // hidden-класс на самой кнопке (не span-обёртке): спаны в ячейках таблицы
              // получают паддинг от Table.module «span,code» — кнопки расползались.
              return (
                <FieldActionButton key={index} icon={meta.icon} label={meta.label} onClick={action.onClick}
                  disabled={disabled || action.hidden}
                  className={action.hidden ? styles.FieldActionHidden : undefined}
                  aria-hidden={action.hidden || undefined} />
              );
            })}
          </div>
        )}
      </div>
      <FieldHintNode id={hintId} hint={hint} isTable={isTable} />
    </div>
  );
};

export { FieldDateTime, FieldDate } from "./FieldDate";
export { FieldFile } from "./FieldFile";
type TypeFieldSelectProps = {
  label?: string;
  name: string;
  options: { value: string; label: string }[];
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  style?: CSSProperties;
  variant?: FieldVariant;
  /** Компактный размер — высота подогнана под шапку панели (PaneItemHeaderToolbar). */
  size?: 'sm';
  /** Видимая подсказка-help ПОД полем. */
  hint?: React.ReactNode;
};

export const FieldSelect: FC<TypeFieldSelectProps> = ({ label, name, options, value = '', onChange, disabled = false, required = false, error = false, style, variant = 'default', size, hint }) => {
  const uid = useId();
  const hintId = hint ? `${uid}-hint` : undefined;
  const { isTable, wrapperClass, effectiveRequired } = useFieldBase({ name, variant, required, error, value });
  const className = size === 'sm' ? `${wrapperClass} ${styles.FieldSizeSm}` : wrapperClass;

  return (
    <div className={className} style={style}>
      <FieldLabelNode htmlFor={uid} label={label} required={effectiveRequired} isTable={isTable} />
      <div className={styles.FieldSelectWrapper}>
        <select name={name} id={uid} className={styles.FieldSelect} value={value} onChange={onChange} disabled={disabled} aria-describedby={hintId}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <FieldHintNode id={hintId} hint={hint} isTable={isTable} />
    </div>
  );
};

// ────────────────────────────────────────────────
// FieldNumber — числовое поле (input type="number")
// ────────────────────────────────────────────────


export { FieldNumber } from "./FieldNumber";
export const Divider = () => {
  return (
    <div style={{ borderLeft: "1px dotted #888", display: "flex", height: "auto" }}></div>
  )
};

// ═══════════════════════════════════════════════════════════════════════════
export { FieldTextarea } from "./FieldTextarea";
export { FieldPeriod } from "./FieldPeriod";
