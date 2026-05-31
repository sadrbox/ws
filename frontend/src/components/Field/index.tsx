import React, { CSSProperties, FC, useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { getTranslation } from "src/i18"

import styles from "./Field.module.scss"
import FieldActionButton from "./FieldActionButton"
import type { IconName } from "src/components/IconButton/icons"
import { useCellFieldState } from "src/hooks/useDirtyHighlight"
import { useFormRequiredScope, useFormDirtyScope } from "src/hooks/useFormRequired"
// import { TypeDateRange } from '../Table/types'

import { getFormatNumerical, parseNumericInput } from 'src/components/Table/services.ts'
// type TypeFieldStringProps = {
//   label: string
//   name: string
//   value?: string
//   onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
//   width?: string | number
//   maxWidth?: string | number
// }
// export type TypeFieldActions = {
//   img?: string;
//   alt?: string;
//   type: 'clear' | 'list' | 'open';
//   onClick: () => void;
// }[];


// type TypeFieldGroupProps = {
//   name: string;
//   label: string;
//   value?: string;
//   onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
//   inputRef?: React.RefObject<HTMLInputElement | null>;
//   actions?: TypeFieldActions;
//   style?: CSSProperties;
// }

// Карта тип-действия → иконка из общего реестра + подпись.
// fieldActions описывают только тип, обработчик и (опц.) состояние —
// визуал инкапсулирован в FieldActionButton/IconButton.
const FIELD_ACTION_META: Record<'clear' | 'list' | 'open', { icon: IconName; label: string }> = {
  clear: { icon: "clear", label: "Очистить" },
  list: { icon: "list", label: "Выбрать из списка" },
  open: { icon: "open", label: "Открыть" },
};

// Типы для действий
type FieldActionType = 'clear' | 'list' | 'open';

interface FieldAction {
  type: FieldActionType;
  onClick: () => void;
}

type TypeFieldActions = FieldAction[];

// ── Общий hook для всех Field* компонентов ──────────────────────────────────
// Источники required: явный проп → CellFieldStateScope → FormRequiredScope
// Источники dirty:    явный проп isDirty → FormDirtyScope
function useFieldBase(params: {
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
const FieldLabelNode: FC<{
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

// Варианты отображения Field*
export type FieldVariant = 'default' | 'table';

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
  required?: boolean;
  error?: boolean;
  actions?: TypeFieldActions;
  variant?: FieldVariant;
  autoFocus?: boolean;
  /** Поле имеет несохранённые изменения (при открытии через "Несохранённые записи") */
  isDirty?: boolean;
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
  required?: boolean;
  error?: boolean;
  variant?: FieldVariant;
  autoFocus?: boolean;
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
  required = false,
  error = false,
  actions,
  variant = 'default',
  autoFocus,
  isDirty,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleClear = () => {
    if (inputRef.current) {
      inputRef.current.value = "";
      if (onChange) {
        const event = new Event('input', { bubbles: true });
        Object.defineProperty(event, 'target', { writable: false, value: inputRef.current });
        onChange(event as any);
      }
    }
  };

  const defaultActions: TypeFieldActions = actions || [
    { type: "clear", onClick: handleClear },
  ];

  const visibleActions = disabled
    ? []
    : defaultActions.filter(action => {
      if (action.type === 'clear' && !value) return false;
      return true;
    });

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
        minWidth: minWidth ?? 'none'
      }}
      actions={visibleActions.length > 0 ? visibleActions : undefined}
      disabled={disabled}
      placeholder={placeholder}
      required={required}
      error={error}
      variant={variant}
      autoFocus={autoFocus}
      isDirty={isDirty}
    />
  );
};

// Компонент FieldGroup
export const FieldGroup: FC<TypeFieldGroupProps & { isDirty?: boolean }> = ({
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
  required = false,
  error = false,
  variant = 'default',
  autoFocus,
  isDirty,
}) => {
  const uid = useId();
  const { isTable, wrapperClass, effectiveRequired } = useFieldBase({ name, variant, required, error, value, isDirty });

  return (
    <div className={wrapperClass} style={style}>
      <FieldLabelNode htmlFor={uid} label={label} required={effectiveRequired} isTable={isTable} />
      <div className={styles.FieldInputWrapper}>
        <input
          ref={inputRef}
          type="text"
          id={uid}
          name={name}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          className={`${styles.FieldString} ${disabled ? styles.FieldDisabled : ''}`}
          autoComplete='off'
          disabled={disabled}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
        {actions && actions.length > 0 && (
          <div className={styles.FieldActions}>
            {actions.map((action, index) => {
              const meta = FIELD_ACTION_META[action.type];
              return (
                <FieldActionButton key={index} icon={meta.icon} label={meta.label} onClick={action.onClick} />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// Компонент FieldDateTime — поле выбора даты/времени (datetime-local)
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
    <div className={wrapperClass} style={{ width: width ?? 'auto', minWidth: minWidth ?? 'none', maxWidth: maxWidth ?? 'none' }}>
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
}) => {
  // Гарантируем, что value для input[type=date] имеет формат YYYY-MM-DD
  const safeValue = (() => {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
    return '';
  })();

  const uid = useId();
  const { isTable, wrapperClass, effectiveRequired } = useFieldBase({ name, variant, required, error, value });

  return (
    <div className={wrapperClass} style={{ width: width ?? 'auto', minWidth: minWidth ?? 'none', maxWidth: maxWidth ?? 'none' }}>
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
        />
      </div>
    </div>
  );
};

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
};

export const FieldSelect: FC<TypeFieldSelectProps> = ({ label, name, options, value = '', onChange, disabled = false, required = false, error = false, style, variant = 'default', size }) => {
  const uid = useId();
  const { isTable, wrapperClass, effectiveRequired } = useFieldBase({ name, variant, required, error, value });
  const className = size === 'sm' ? `${wrapperClass} ${styles.FieldSizeSm}` : wrapperClass;

  return (
    <div className={className} style={style}>
      <FieldLabelNode htmlFor={uid} label={label} required={effectiveRequired} isTable={isTable} />
      <div className={styles.FieldSelectWrapper}>
        <select name={name} id={uid} className={styles.FieldSelect} value={value} onChange={onChange} disabled={disabled}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────
// FieldNumber — числовое поле (input type="number")
// ────────────────────────────────────────────────

interface TypeFieldNumberProps {
  label?: string;
  name: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  width?: string;
  maxWidth?: string;
  minWidth?: string;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
  error?: boolean;
  step?: string;
  min?: string;
  max?: string;
  textAlign?: 'left' | 'right' | 'center';
  actions?: TypeFieldActions;
  variant?: FieldVariant;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Если true — значение 0 отображается как пустое поле (пока не в фокусе) */
  zeroAsEmpty?: boolean;
}

export const FieldNumber: FC<TypeFieldNumberProps> = ({
  label,
  name,
  value,
  onChange,
  width,
  maxWidth,
  minWidth,
  disabled = false,
  placeholder,
  required = false,
  error = false,
  step: _step,
  min,
  max,
  textAlign = 'right',
  actions,
  variant = 'default',
  onKeyDown,
  zeroAsEmpty = false,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ── Состояние фокуса: когда поле активно — показываем «сырое» число с точкой,
  // при потере фокуса — форматируем с разделителями групп разрядов и запятой.
  const [isFocused, setIsFocused] = useState(false);
  // Буфер ввода — то что пользователь набирает сейчас (хранится отдельно чтобы не скакал курсор)
  const [editText, setEditText] = useState('');

  // «Сырое» значение снаружи (без пробелов, с точкой)
  const rawValue = useMemo(() => {
    if (value === '' || value === undefined || value === null) return '';
    return String(value).replace(/[\s\u00A0\u202F]/g, '').replace(',', '.');
  }, [value]);

  // Значение поля в момент получения фокуса — для сравнения в handleBlur
  const valueAtFocusRef = useRef('');

  // Синхронизируем editText когда внешнее значение меняется извне (не через ввод пользователя)
  const prevRawRef = useRef(rawValue);
  useEffect(() => {
    if (!isFocused && prevRawRef.current !== rawValue) {
      prevRawRef.current = rawValue;
      setEditText(rawValue);
    }
  }, [isFocused, rawValue]);

  // Отображаемый текст:
  // - в фокусе: editText (то что набрал пользователь, с запятой)
  // - без фокуса: форматированное с разделителями и запятой (ru-RU)
  const displayText = useMemo(() => {
    if (isFocused) return editText;
    if (rawValue === '') return '';
    const n = parseNumericInput(rawValue);
    if (zeroAsEmpty && n === 0) return '';
    return n != null ? getFormatNumerical(n) : rawValue;
  }, [isFocused, editText, rawValue, zeroAsEmpty]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    // Сохраняем исходное значение для сравнения в handleBlur (определение изменения)
    valueAtFocusRef.current = prevRawRef.current;
    // При входе в поле показываем значение с запятой (пользовательский формат)
    setEditText(prevRawRef.current.replace('.', ','));
  }, []);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    if (!onChange) return;
    // Нормализуем введённое: убираем пробелы, меняем запятую на точку
    const n = parseNumericInput(e.target.value);
    if (n === null) {
      // Если пустое — ничего не делаем
      if (e.target.value.trim() === '') return;
      // Некорректный ввод — сбрасываем в пустое, но только если исходное не было пустым
      if (valueAtFocusRef.current === '') return;
      const fakeEvent = { target: { value: '', name }, currentTarget: e.currentTarget } as React.ChangeEvent<HTMLInputElement>;
      onChange(fakeEvent);
      return;
    }
    // Применяем зажим min/max
    const mn = min !== undefined ? parseNumericInput(String(min)) : null;
    const mx = max !== undefined ? parseNumericInput(String(max)) : null;
    let clamped = n;
    if (mn !== null && n < mn) clamped = mn;
    if (mx !== null && n > mx) clamped = mx;
    prevRawRef.current = String(clamped);
    // Вызываем onChange только если значение реально изменилось
    if (String(clamped) === valueAtFocusRef.current) return;
    const fakeEvent = {
      target: { value: String(clamped), name },
      currentTarget: e.currentTarget,
    } as React.ChangeEvent<HTMLInputElement>;
    onChange(fakeEvent);
  }, [onChange, min, max, name]);

  const handleClear = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.value = "";
      if (onChange) {
        const event = new Event('input', { bubbles: true });
        Object.defineProperty(event, 'target', { writable: false, value: inputRef.current });
        onChange(event as any);
      }
    }
  }, [onChange]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Разрешаем только: цифры, точку, запятую (десятичный разделитель), минус в начале
    const raw = e.target.value;
    // Убираем все недопустимые символы: всё кроме 0-9, . , -
    const filtered = raw.replace(/[^0-9.,-]/g, '');
    // Разрешаем минус только в начале и только один раз
    const withMinus = filtered.replace(/(?!^)-/g, '');
    // Нормализуем: и точку и запятую принимаем как десятичный разделитель,
    // но в editText храним запятую (пользовательский формат)
    const withComma = withMinus.replace('.', ',');
    // Не допускаем две запятых
    const commaParts = withComma.split(',');
    const displayNorm = commaParts.length > 2
      ? commaParts[0] + ',' + commaParts.slice(1).join('')
      : withComma;
    // Внутреннее значение (для onChange и prevRawRef) — с точкой
    const dotNorm = displayNorm.replace(',', '.');
    // Обновляем буфер редактирования (с запятой — для отображения)
    setEditText(displayNorm);
    prevRawRef.current = dotNorm;
    // Пробрасываем дальше только если значение завершённое (не заканчивается запятой/точкой)
    if (onChange && dotNorm !== '' && !dotNorm.endsWith('.')) {
      const fakeEvent = { ...e, target: { ...e.target, value: dotNorm, name } } as React.ChangeEvent<HTMLInputElement>;
      onChange(fakeEvent);
    } else if (onChange && dotNorm === '') {
      onChange({ ...e, target: { ...e.target, value: '', name } } as React.ChangeEvent<HTMLInputElement>);
    }
  }, [onChange, name]);

  const handleNumberKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Блокируем ввод букв и спецсимволов (кроме навигационных и управляющих клавиш)
    if (e.ctrlKey || e.metaKey) {
      // разрешаем Ctrl+C/V/A/X и т.д.
      onKeyDown?.(e);
      return;
    }
    if (e.key.length === 1 && !/[0-9.,-]/.test(e.key)) {
      e.preventDefault();
      return;
    }
    onKeyDown?.(e);
  }, [onKeyDown]);

  const defaultActions: TypeFieldActions = actions || [
    { type: "clear", onClick: handleClear },
  ];

  const visibleActions = disabled
    ? []
    : defaultActions.filter(action => {
      if (action.type === 'clear' && !value) return false;
      return true;
    });
  const uid = useId();
  const { isTable, wrapperClass, effectiveRequired } = useFieldBase({ name, variant, required, error, value });

  return (
    <div className={wrapperClass} style={{ width: width ?? 'auto', maxWidth: maxWidth ?? 'none', minWidth: minWidth ?? 'none' }}>
      <FieldLabelNode htmlFor={uid} label={label} required={effectiveRequired} isTable={isTable} />

      <div className={styles.FieldInputWrapper}>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          id={uid}
          name={name}
          value={displayText}
          onChange={handleChange}
          onKeyDown={handleNumberKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={styles.FieldString}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          style={{ textAlign }}
        />

        {visibleActions.length > 0 && (
          <div className={styles.FieldActions}>
            {visibleActions.map((action, index) => {
              const meta = FIELD_ACTION_META[action.type];
              return (
                <FieldActionButton
                  key={index}
                  icon={meta.icon}
                  label={meta.label}
                  onClick={action.onClick}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export const Divider = () => {
  return (
    <div style={{ borderLeft: "1px dotted #888", display: "flex", height: "auto" }}></div>
  )
};

// ═══════════════════════════════════════════════════════════════════════════
// FieldTextarea — многострочное текстовое поле, стилизованное как Field
// ═══════════════════════════════════════════════════════════════════════════

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
        />
      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// FieldPeriod — поле выбора периода «Месяц Год» (значение YYYY-MM)
// Используется в зарплатных и других документах, где период = конкретный месяц.
// ═══════════════════════════════════════════════════════════════════════════

const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель",
  "Май", "Июнь", "Июль", "Август",
  "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const MONTHS_SHORT = [
  "Янв", "Фев", "Мар", "Апр",
  "Май", "Июн", "Июл", "Авг",
  "Сен", "Окт", "Ноя", "Дек",
];

interface FieldPeriodProps {
  label?: string;
  name: string;
  /** Период в формате "YYYY-MM". Пустая строка — текущий месяц как дефолт отображения. */
  value?: string;
  onChange?: (e: { target: { value: string; name: string } }) => void;
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  variant?: FieldVariant;
  width?: string;
}

function parsePeriod(value: string): [number, number] {
  const now = new Date();
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    if (mo >= 1 && mo <= 12) return [y, mo];
  }
  return [now.getFullYear(), now.getMonth() + 1];
}

export const FieldPeriod: FC<FieldPeriodProps> = ({
  label,
  name,
  value = '',
  onChange,
  disabled = false,
  required = false,
  error = false,
  variant = 'default',
  width,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});

  const [selYear, selMonth] = useMemo(() => parsePeriod(value), [value]);
  // dropYear: год, отображаемый в picker-е (независим от выбранного)
  const [dropYear, setDropYear] = useState<number>(selYear);

  // Синхронизируем dropYear с selYear при изменении value извне
  useEffect(() => { setDropYear(selYear); }, [selYear]);

  const emit = useCallback((y: number, m: number) => {
    onChange?.({ target: { value: `${y}-${String(m).padStart(2, '0')}`, name } });
  }, [onChange, name]);

  // При монтировании: если value пусто — эмитим текущий период
  useEffect(() => {
    if (!value) {
      const now = new Date();
      emit(now.getFullYear(), now.getMonth() + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const computePeriodDropStyle = useCallback((): React.CSSProperties => {
    const DROP_H = 210;
    const DROP_W = 168;
    const rect = triggerRef.current!.getBoundingClientRect();
    const style: React.CSSProperties = { position: 'fixed', zIndex: 9999, minWidth: Math.max(rect.width, DROP_W) };
    if (window.innerHeight - rect.bottom >= DROP_H || rect.top < DROP_H) {
      style.top = rect.bottom + 1;
    } else {
      style.bottom = window.innerHeight - rect.top + 1;
    }
    if (rect.left + DROP_W <= window.innerWidth) {
      style.left = rect.left;
    } else {
      style.left = Math.max(4, window.innerWidth - DROP_W - 4);
    }
    return style;
  }, []);

  // Пересчёт при скролле / ресайзе пока дропдаун открыт
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => setDropStyle(computePeriodDropStyle());
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, computePeriodDropStyle]);

  // Закрытие по клику вне компонента
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Изменение периода на ±delta месяцев
  const shiftPeriod = useCallback((delta: number) => {
    let m = selMonth - 1 + delta; // 0-based
    let y = selYear;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    emit(y, m + 1);
  }, [selYear, selMonth, emit]);

  // Прокрутка колесом на триггере
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (disabled) return;
    e.preventDefault();
    shiftPeriod(e.deltaY > 0 ? 1 : -1);
  }, [disabled, shiftPeriod]);

  // Стрелки на триггере
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); shiftPeriod(-1); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); shiftPeriod(1); }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(o => {
        if (!o && triggerRef.current) setDropStyle(computePeriodDropStyle());
        return !o;
      });
    }
    if (e.key === 'Escape') setOpen(false);
  }, [disabled, shiftPeriod, computePeriodDropStyle]);

  const selectMonth = useCallback((m: number) => {
    emit(dropYear, m);
    setOpen(false);
  }, [dropYear, emit]);

  const displayText = value
    ? `${MONTHS_RU[selMonth - 1]} ${selYear}`
    : '—';

  const { isTable, wrapperClass, effectiveRequired } = useFieldBase({
    name, variant, required, error, value,
  });

  const labelId = useId();
  const hasLabel = !isTable && !!label;

  return (
    <div ref={rootRef} className={wrapperClass} style={{ width: width ?? 'auto', position: 'relative' }}>
      <FieldLabelNode id={labelId} label={label} required={effectiveRequired} isTable={isTable} />

      {/* Trigger */}
      <div
        role="combobox"
        aria-labelledby={hasLabel ? labelId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        tabIndex={disabled ? -1 : 0}
        ref={triggerRef}
        className={styles.FieldPeriodWrapper}
        style={{ width: '100px' }}
        data-disabled={disabled ? "true" : undefined}
        onClick={() => {
          if (disabled) return;
          setOpen(o => {
            if (!o && triggerRef.current) setDropStyle(computePeriodDropStyle());
            return !o;
          });
        }}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.FieldPeriod} >
          <span>{MONTHS_RU[selMonth - 1]}</span>
          <span>{selYear}</span>
          {/* <span className={styles.FieldPeriodCaret}>▾</span> */}
        </div>
      </div>

      {/* Dropdown picker */}
      {open && (
        <div className={styles.FieldPeriodDropdown} style={dropStyle}>
          {/* Year nav */}
          <div className={styles.FieldPeriodYearNav}>
            <button type="button" className={styles.FieldPeriodYearBtn} onClick={() => setDropYear(y => y - 1)}>◄</button>
            <span className={styles.FieldPeriodYearLabel}>{dropYear}</span>
            <button type="button" className={styles.FieldPeriodYearBtn} onClick={() => setDropYear(y => y + 1)}>►</button>
          </div>

          {/* Month grid 3×4 */}
          <div className={styles.FieldPeriodMonthGrid}>
            {MONTHS_SHORT.map((mon, i) => {
              const mNum = i + 1;
              const isSelected = dropYear === selYear && mNum === selMonth;
              return (
                <button
                  key={mNum}
                  type="button"
                  className={`${styles.FieldPeriodMonthBtn}${isSelected ? ` ${styles.FieldPeriodMonthBtnSelected}` : ''}`}
                  onClick={() => selectMonth(mNum)}
                >
                  {mon}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
