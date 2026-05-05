import React, { CSSProperties, FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import styles from "./Field.module.scss"
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

export const imgActions = {
  clear: {
    img: (<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M3,3 L13,13 M13,3 L3,13" stroke="currentColor" strokeWidth="0.5" fill="none" strokeLinecap="round" />
    </svg>),
    alt: "clear-sign--v1",
  },
  list: {
    img: (<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="3" width="14" height="1" fill="currentColor" rx="0.5" />
      <rect x="1" y="6" width="14" height="1" fill="currentColor" rx="0.5" />
      <rect x="1" y="9" width="14" height="1" fill="currentColor" rx="0.5" />
      <rect x="1" y="12" width="14" height="1" fill="currentColor" rx="0.5" />
    </svg>),
    alt: "list-sign--v1",
  },
  open: {
    img: (<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1" rx="0.5" />
      <rect x="3" y="3" width="10" height="1" fill="currentColor" rx="0.5" />
      <rect x="3" y="5" width="8" height="1" fill="currentColor" rx="0.5" />
      <rect x="3" y="7" width="6" height="1" fill="currentColor" rx="0.5" />
      <rect x="3" y="9" width="4" height="1" fill="currentColor" rx="0.5" />
      <rect x="3" y="11" width="6" height="1" fill="currentColor" rx="0.5" />
    </svg>),
    alt: "open-sign--v1",
  }
}

// Типы для действий
type FieldActionType = 'clear' | 'list' | 'open';

interface FieldAction {
  type: FieldActionType;
  onClick: () => void;
}

type TypeFieldActions = FieldAction[];

// Варианты отображения Field*
export type FieldVariant = 'default' | 'table';

// Пропсы для Field
interface TypeFieldStringProps {
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
  actions?: TypeFieldActions;
  variant?: FieldVariant;
}

// Пропсы для FieldGroup
interface TypeFieldGroupProps {
  name: string;
  label?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  actions?: TypeFieldActions;
  style?: CSSProperties;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
  variant?: FieldVariant;
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
  width,
  maxWidth,
  minWidth,
  disabled = false,
  placeholder,
  required = false,
  actions,
  variant = 'default',
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
      variant={variant}
    />
  );
};

// Компонент FieldGroup
export const FieldGroup: FC<TypeFieldGroupProps> = ({
  name,
  label,
  value = '',
  onChange,
  inputRef,
  actions,
  style,
  disabled = false,
  placeholder,
  required = false,
  variant = 'default',
}) => {
  const isTable = variant === 'table';
  const wrapperClass = isTable
    ? `${styles.FieldWrapper} ${styles.tableVariant}`
    : styles.FieldWrapper;

  return (
    <div className={wrapperClass} style={style}>
      {!isTable && label && (
        <label htmlFor={name} className={styles.FieldLabel}>
          {label}
          {required && <span style={{ color: 'red', marginLeft: '4px' }}>*</span>}
        </label>
      )}

      <div className={styles.FieldInputWrapper}>
        <input
          ref={inputRef}
          type="text"
          id={name}
          name={name}
          value={value}
          onChange={onChange}
          className={`${styles.FieldString} ${disabled ? styles.FieldDisabled : ''}`}
          autoComplete='off'
          disabled={disabled}
          placeholder={placeholder}
          style={{
            ...(actions && actions.length > 0 && {
              // paddingRight: `${actions.length * 32 - 6}px`
            })
          }}
        />

        {actions && actions.length > 0 && (
          <div className={styles.FieldActions}>
            {actions.map((action, index) => (
              <button
                key={index}
                onClick={action.onClick}
                type='button'
                className={styles.FieldActionButton}
                title={imgActions[action.type].alt}
                tabIndex={-1}
              >
                {imgActions[action.type].img}
              </button>
            ))}
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
  variant = 'default',
}) => {
  const isTable = variant === 'table';
  const wrapperClass = isTable
    ? `${styles.FieldWrapper} ${styles.tableVariant}`
    : styles.FieldWrapper;

  // Гарантируем, что value для input[type=datetime-local] имеет формат YYYY-MM-DDTHH:mm
  const safeValue = (() => {
    if (!value) return '';
    // Если в формате YYYY-MM-DDTHH:mm или YYYY-MM-DDTHH:mm:ss — ОК
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value;
    // Если только дата YYYY-MM-DD — добавляем 00:00
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00`;
    // Любое другое значение — пустая строка
    return '';
  })();

  return (
    <div
      className={wrapperClass}
      style={{ width: width ?? 'auto', minWidth: minWidth ?? 'none', maxWidth: maxWidth ?? 'none' }}
    >
      {!isTable && label && (
        <label htmlFor={name} className={styles.FieldLabel}>
          {label}
          {required && <span style={{ color: 'red', marginLeft: '4px' }}>*</span>}
        </label>
      )}
      <div className={styles.FieldInputWrapper}>
        <input
          type="datetime-local"
          id={name}
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
  variant = 'default',
}) => {
  const isTable = variant === 'table';
  const wrapperClass = isTable
    ? `${styles.FieldWrapper} ${styles.tableVariant}`
    : styles.FieldWrapper;

  // Гарантируем, что value для input[type=date] имеет формат YYYY-MM-DD
  const safeValue = (() => {
    if (!value) return '';
    // Если уже в формате YYYY-MM-DD — ОК
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    // Если ISO datetime — берём первые 10 символов
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
    // Любое другое значение (включая русский текст) — пустая строка
    return '';
  })();

  return (
    <div
      className={wrapperClass}
      style={{ width: width ?? 'auto', minWidth: minWidth ?? 'none', maxWidth: maxWidth ?? 'none' }}
    >
      {!isTable && label && (
        <label htmlFor={name} className={styles.FieldLabel}>
          {label}
          {required && <span style={{ color: 'red', marginLeft: '4px' }}>*</span>}
        </label>
      )}
      <div className={styles.FieldInputWrapper}>
        <input
          type="date"
          id={name}
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

type TypeFieldSelectProps = {
  label?: string;
  name: string;
  options: { value: string; label: string }[];
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  style?: CSSProperties;
  variant?: FieldVariant;
};

export const FieldSelect: FC<TypeFieldSelectProps> = ({ label, name, options, value, onChange, disabled = false, style, variant = 'default' }) => {
  const isTable = variant === 'table';
  const wrapperClass = isTable
    ? `${styles.FieldWrapper} ${styles.tableVariant}`
    : styles.FieldWrapper;

  return (
    <div className={wrapperClass} style={style}>
      {!isTable && label && <label htmlFor={name} className={styles.FieldLabel}>{label}</label>}
      <div className={styles.FieldSelectWrapper}>
        <select name={name} id={name} className={styles.FieldSelect} value={value} onChange={onChange} disabled={disabled}>
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
  step?: string;
  min?: string;
  max?: string;
  textAlign?: 'left' | 'right' | 'center';
  actions?: TypeFieldActions;
  variant?: FieldVariant;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
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
  step: _step,
  min,
  max,
  textAlign = 'right',
  actions,
  variant = 'default',
  onKeyDown,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isTable = variant === 'table';
  const wrapperClass = isTable
    ? `${styles.FieldWrapper} ${styles.tableVariant}`
    : styles.FieldWrapper;

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
    return n != null ? getFormatNumerical(n) : rawValue;
  }, [isFocused, editText, rawValue]);

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

  return (
    <div
      className={wrapperClass}
      style={{
        width: width ?? 'auto',
        maxWidth: maxWidth ?? 'none',
        minWidth: minWidth ?? 'none',
      }}
    >
      {!isTable && label && (
        <label htmlFor={name} className={styles.FieldLabel}>
          {label}
          {required && <span style={{ color: 'red', marginLeft: '4px' }}>*</span>}
        </label>
      )}

      <div className={styles.FieldInputWrapper}>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          id={name}
          name={name}
          value={displayText}
          onChange={handleChange}
          onKeyDown={handleNumberKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={`${styles.FieldString} ${disabled ? styles.FieldDisabled : ''}`}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          style={{ textAlign }}
        />

        {visibleActions.length > 0 && (
          <div className={styles.FieldActions}>
            {visibleActions.map((action, index) => (
              <button
                key={index}
                onClick={action.onClick}
                type="button"
                className={styles.FieldActionButton}
                title={imgActions[action.type].alt}
                tabIndex={-1}
              >
                {imgActions[action.type].img}
              </button>
            ))}
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
}) => {
  return (
    <div className={styles.FieldTextareaWrapper} style={{
      width: width ?? 'auto',
      maxWidth: maxWidth ?? 'none',
      minWidth: minWidth ?? 'none',
    }}>
      {label && (
        <label htmlFor={name} className={styles.FieldLabel}>
          {label}
          {required && <span style={{ color: 'red', marginLeft: '4px' }}>*</span>}
        </label>
      )}
      <div className={styles.FieldTextareaInputWrapper}>
        <textarea
          id={name}
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

