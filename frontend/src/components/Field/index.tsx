import React, { CSSProperties, FC, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'

import styles from "./Field.module.scss"
import { useTableContext } from '../Table'
// import { TypeDateRange } from '../Table/types'
import { Group } from 'src/components/UI'
import useUID from 'src/hooks/useUID'
import { useDebounceValue } from 'src/hooks/useDebounceValue'

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


type TypeFieldFilterProps = {
  actions: TypeFieldActions;
  name: string;
  label: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

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

// Пропсы для Field
interface TypeFieldStringProps {
  label: string;
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
}

// Пропсы для FieldGroup
interface TypeFieldGroupProps {
  name: string;
  label: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  actions?: TypeFieldActions;
  style?: CSSProperties;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
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
  actions
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Обработчик очистки поля
  const handleClear = () => {
    if (inputRef.current) {
      inputRef.current.value = "";
      // Триггерим событие onChange с пустым значением
      if (onChange) {
        const event = new Event('input', { bubbles: true });
        Object.defineProperty(event, 'target', {
          writable: false,
          value: inputRef.current
        });
        onChange(event as any);
      }
    }
  };

  const handleList = () => {
    console.log("List action for field:", name);
  };

  const handleOpen = () => {
    console.log("Open action for field:", name);
  };

  // Дефолтные действия (можно переопределить через props)
  const defaultActions: TypeFieldActions = actions || [
    { type: "clear", onClick: handleClear },
    // { type: "list", onClick: handleList },
    // { type: "open", onClick: handleOpen },
  ];

  // Показываем кнопку очистки только если поле не disabled и есть значение
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
        width: width ?? 'auto',
        maxWidth: maxWidth ?? 'none',
        minWidth: minWidth ?? 'none'
      }}
      actions={visibleActions.length > 0 ? visibleActions : undefined}
      disabled={disabled}
      placeholder={placeholder}
      required={required}
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
  required = false
}) => {
  return (
    <div
      className={styles.FieldWrapper}
      style={style ? { ...style, width: style?.width } : style}
    >
      <label
        htmlFor={name}
        className={styles.FieldLabel}
      >
        {label}
        {required && <span style={{ color: 'red', marginLeft: '4px' }}>*</span>}
      </label>

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
              paddingRight: `${actions.length * 32 + 8}px`
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



export const FieldFilter: FC<TypeFieldFilterProps> = ({ label, name, actions }) => {
  const inputRef = useRef<HTMLInputElement | null>(null)

  return (
    <FieldGroup
      name={name}
      label={label}
      inputRef={inputRef}
      actions={actions}
    />
  );
};

export const FieldString: FC<TypeFieldStringProps> = ({ label, name }) => {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleClear = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleList = () => {
    console.log("List action");
  };


  const actions: TypeFieldActions = [
    { type: "clear", onClick: handleClear },
    { type: "list", onClick: handleList },
    { type: "open", onClick: () => { console.log("Open action"); } },
  ];
  return (
    <FieldGroup
      name={name}
      label={label}
      inputRef={inputRef}
      actions={actions}
    />
  );
};

type TypeFieldSelectProps = {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  style?: CSSProperties;
};

export const FieldSelect: FC<TypeFieldSelectProps> = ({ label, name, options, style }) => {
  return (
    <Group align="row" className={styles.FieldWrapper} style={style}>
      <label htmlFor={name} className={styles.FieldLabel}>{label}</label>
      <Group align="col" className={styles.FieldSelectWrapper}>
        <select name={name} id={name} className={styles.FieldSelect} >
          {
            options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))
          }
        </select >
      </Group >
    </Group >
  );
};

type TypeFieldAutocompleteProps = {
  label: string;
  name: string;
  style?: CSSProperties;
  // attributes?: HTMLAttributes<HTMLInputElement>;
}

export const FieldAutocomplete: FC<TypeFieldAutocompleteProps> = ({ label, name, style }) => {
  return (
    <Group align="row" className={styles.FieldWrapper} style={style}>
      <label htmlFor={name} className={styles.FieldLabel}>{label}</label>
      <Group align="col" className={styles.FieldInputWrapper}>
        <input
          type="text"
          id={name}
          name={name}
          autoComplete='off'
          placeholder=""
          className={styles.FieldString}
        />
      </Group>
    </Group>
  );
};

export const FieldFastSearch: FC = () => {
  const { search, filtering, columns } = useTableContext();

  // Глобальное значение поиска из контекста
  const { value: globalSearchValue, onChange: setGlobalSearch } = search;

  // Локальное значение инпута (управляемое состояние)
  const [localValue, setLocalValue] = useState<string>(globalSearchValue);

  // Дебаунс — отправляем в глобальный фильтр не чаще чем раз в 400 мс
  const debouncedValue = useDebounceValue(localValue, 400);

  const inputRef = useRef<HTMLInputElement>(null);

  // Видимые колонки для поиска (только те, где visible === true)
  const visibleColumns = useMemo(
    () =>
      columns
        .filter(col => col.visible === true)
        .map(col => ({ identifier: col.identifier, type: col.type })),
    [columns]
  );

  // Синхронизация локального значения с глобальным (если изменилось извне)
  useEffect(() => {
    setLocalValue(globalSearchValue);
  }, [globalSearchValue]);

  // Отправка debounced значения в глобальный фильтр
  useEffect(() => {
    const trimmed: string = typeof debouncedValue === 'string' ? debouncedValue.trim() : '';

    if (!trimmed) {
      // Если пусто — убираем searchBy полностью
      filtering.onFilterChange('searchBy', undefined);
      return;
    }

    // Формируем объект searchBy
    const searchByValue = {
      value: trimmed,
      columns: visibleColumns,
    };

    filtering.onFilterChange('searchBy', searchByValue);
  }, [debouncedValue, visibleColumns, filtering.onFilterChange]);

  // Очистка поля и фильтра
  const handleClear = useCallback(() => {
    setLocalValue('');
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.focus?.();
    }
    // Немедленно очищаем searchBy
    filtering.onFilterChange('searchBy', undefined);
  }, [filtering.onFilterChange]);

  // Обработчик ввода
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  }, []);

  return (
    <div className={styles.FieldInputWrapper}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Поиск..."
        className={styles.FieldString}
        autoComplete="off"
        style={{ paddingRight: '40px' }}
        value={localValue}
        onChange={handleChange}
      />

      {localValue && (
        <div className={styles.FieldActions}>
          <button
            type="button"
            onClick={handleClear}
            title="Очистить поиск"
            aria-label="Очистить поиск"
          >
            {/* Замените на вашу иконку (например, SVG или Heroicons) */}
            <span style={{ fontSize: '20px', lineHeight: 1 }}>×</span>
            {/* или: <XMarkIcon width={18} height={18} /> */}
          </button>
        </div>
      )}
    </div>
  );
};

// type TypeFieldPeriodProps = {setSearchPeriod: ({startDate, endDate}: TypeDateRange) => void };
// type TypeFieldDateRangeProps = { props: { dateRange: TypeDateRange, setDateRange: Dispatch<SetStateAction<TypeDateRange>> }; style?: CSSProperties };

export interface TypeDateRange {
  startDate: string | null; // ISO-строка или пустая строка / null
  endDate: string | null;
}

export const FieldDateRange: FC = () => {
  const { filtering } = useTableContext();
  const { filters, onFilterChange } = filtering;

  // Текущее значение диапазона дат из глобальных фильтров
  const currentDateRange = filters?.dateRange as TypeDateRange | undefined;

  // Локальное состояние для управления вводом
  const [localRange, setLocalRange] = useState<TypeDateRange>(
    currentDateRange ?? { startDate: null, endDate: null }
  );

  // Синхронизация: если глобальный фильтр изменился извне — обновляем локальное состояние
  useEffect(() => {
    if (currentDateRange) {
      setLocalRange(currentDateRange);
    } else {
      setLocalRange({ startDate: null, endDate: null });
    }
  }, [currentDateRange]);

  // Отправка изменений в глобальные фильтры
  // Можно добавить debounce, если сервер не любит частые запросы
  const updateGlobalFilter = useCallback(() => {
    // Если оба поля пустые → очищаем фильтр
    if (!localRange.startDate && !localRange.endDate) {
      onFilterChange('dateRange', undefined);
      return;
    }

    // Иначе передаём объект
    onFilterChange('dateRange', localRange);
  }, [localRange, onFilterChange]);

  // Обновляем глобальный фильтр при изменении локального состояния
  useEffect(() => {
    updateGlobalFilter();
  }, [localRange, updateGlobalFilter]);

  // Обработчики для инпутов
  const handleStartChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value || null;
    setLocalRange(prev => ({ ...prev, startDate: value }));
  }, []);

  const handleEndChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value || null;
    setLocalRange(prev => ({ ...prev, endDate: value }));
  }, []);

  // Очистка диапазона
  const handleClear = useCallback(() => {
    setLocalRange({ startDate: null, endDate: null });
    onFilterChange('dateRange', undefined);
  }, [onFilterChange]);

  return (
    <div className={styles.FieldDateWrapper}>
      <input
        type="datetime-local"
        className={styles.FieldDate}
        value={localRange.startDate ?? ''}
        onChange={handleStartChange}
        placeholder="Начало"
      />
      <span className={styles.DateSeparator}>—</span>
      <input
        type="datetime-local"
        className={styles.FieldDate}
        value={localRange.endDate ?? ''}
        onChange={handleEndChange}
        placeholder="Конец"
      />

      {(localRange.startDate || localRange.endDate) && (
        <button
          type="button"
          className={styles.ClearButton}
          onClick={handleClear}
          title="Сбросить диапазон"
          aria-label="Сбросить диапазон дат"
        >
          ×
        </button>
      )}
    </div>
  );
};

export const Divider = () => {
  return (
    <div style={{ borderLeft: "1px dotted #888", display: "flex", height: "auto" }}></div>
  )
};

function useDebounce(localValue: string, arg1: number) {
  throw new Error('Function not implemented.')
}
