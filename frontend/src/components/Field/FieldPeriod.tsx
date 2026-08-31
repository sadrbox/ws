// FieldPeriod — поле выбора периода «Месяц Год» (YYYY-MM). Вынесено из Field/index.tsx (Q9).
import { FC, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import styles from "./Field.module.scss";
import { useFieldBase, FieldLabelNode, type FieldVariant } from "./fieldBase";

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

  const { isTable, wrapperClass, effectiveRequired } = useFieldBase({
    name, variant, required, error, value,
  });

  const labelId = useId();
  const hasLabel = !isTable && !!label;

  return (
    <div ref={rootRef} className={wrapperClass} style={{ width: width ?? 'auto', ...(width ? { flex: '0 0 auto' } : {}), position: 'relative' }}>
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
