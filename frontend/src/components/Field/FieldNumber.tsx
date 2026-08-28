// FieldNumber — числовое поле с форматированием/шагами. Вынесено из Field/index.tsx (Q9).
import { FC, useCallback,useEffect,useId,useMemo,useRef,useState, type ChangeEvent } from "react";
import styles from "./Field.module.scss";
import FieldActionButton from "./FieldActionButton";
import { getFormatNumerical, parseNumericInput } from 'src/components/Table/services.ts';
import { useFieldBase, FieldLabelNode, FieldHintNode, FIELD_ACTION_META, type TypeFieldActions, type FieldVariant } from "./fieldBase";

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
  /** Явный список действий-кнопок (полностью переопределяет встроенные). */
  actions?: TypeFieldActions;
  /** Показывать встроенную кнопку «Очистить», если `actions` не задан. По умолчанию false. */
  clearable?: boolean;
  variant?: FieldVariant;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Если true — значение 0 отображается как пустое поле (пока не в фокусе) */
  zeroAsEmpty?: boolean;
  /**
   * Максимум знаков после запятой — должен совпадать с точностью поля в БД
   * (напр. price=2, quantity=4). Ограничивает ввод дробной части, округляет
   * при потере фокуса и форматирует отображение. По умолчанию — без ограничения.
   */
  decimals?: number;
  /** Видимая подсказка-help ПОД полем. */
  hint?: React.ReactNode;
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
  clearable = false,
  variant = 'default',
  onKeyDown,
  zeroAsEmpty = false,
  decimals,
  hint,
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
    return n != null ? getFormatNumerical(n, decimals) : rawValue;
  }, [isFocused, editText, rawValue, zeroAsEmpty, decimals]);

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
    // Округляем до точности поля (как хранится в БД) — чтобы значение не
    // «менялось само» после сохранения: что видно в поле, то и сохранится.
    if (decimals !== undefined && decimals >= 0) clamped = Number(clamped.toFixed(decimals));
    prevRawRef.current = String(clamped);
    // Вызываем onChange только если значение реально изменилось
    if (String(clamped) === valueAtFocusRef.current) return;
    const fakeEvent = {
      target: { value: String(clamped), name },
      currentTarget: e.currentTarget,
    } as React.ChangeEvent<HTMLInputElement>;
    onChange(fakeEvent);
  }, [onChange, min, max, name, decimals]);

  const handleClear = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.value = "";
      if (onChange) {
        const event = new Event('input', { bubbles: true });
        Object.defineProperty(event, 'target', { writable: false, value: inputRef.current });
        onChange(event as unknown as ChangeEvent<HTMLInputElement>);
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
    let displayNorm = commaParts.length > 2
      ? commaParts[0] + ',' + commaParts.slice(1).join('')
      : withComma;
    // Ограничиваем дробную часть точностью поля (как в БД): лишние знаки просто
    // не вводятся. Целая часть и знак минус не трогаются.
    if (decimals !== undefined && decimals >= 0) {
      const ci = displayNorm.indexOf(',');
      if (ci >= 0) {
        const frac = displayNorm.slice(ci + 1);
        if (frac.length > decimals) {
          displayNorm = decimals === 0
            ? displayNorm.slice(0, ci)
            : displayNorm.slice(0, ci + 1 + decimals);
        }
      }
    }
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
  }, [onChange, name, decimals]);

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

  // FieldActions опциональны: явный `actions` переопределяет; иначе встроенная
  // «Очистить» только при clearable (по умолчанию для FieldNumber — нет).
  const defaultActions: TypeFieldActions = actions ?? (clearable ? [{ type: "clear", onClick: handleClear }] : []);

  const visibleActions = disabled
    ? []
    : defaultActions.filter(action => {
      if (action.type === 'clear' && !value) return false;
      return true;
    });
  const uid = useId();
  const hintId = hint ? `${uid}-hint` : undefined;
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
          className={styles.FieldNumber}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          style={{ textAlign }}
          aria-describedby={hintId}
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
      <FieldHintNode id={hintId} hint={hint} isTable={isTable} />
    </div>
  );
};
