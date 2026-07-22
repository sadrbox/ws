/**
 * Тулбарные под-компоненты таблицы: строка активного периода (DateRangeBar),
 * модалка выбора периода (FieldDateRangeModal) и быстрый поиск (FieldFastSearchInternal).
 *
 * Вынесено из Table/index.tsx (T4 — разгрузка ядра). Все три ЧИСТО props-driven
 * (не читают useTableContext), поэтому вынос безопасен и без циклических импортов.
 */
import { memo, useState, useEffect, useCallback, useRef, type ChangeEvent } from 'react';
import { translate } from 'src/i18';
import Modal from '../Modal';
import Toolbar from 'src/components/Toolbar';
import { Field, FieldDateTime } from 'src/components/Field';
import { Group } from 'src/components/UI';
import type { TypeFormMethod } from './types';
import styles from './Table.module.scss';

/** «YYYY-MM-DD[THH:MM]» → «DD.MM.YYYY[ HH:MM]». */
function formatDateTimeRu(dateStr: string): string {
  if (!dateStr) return '';
  const [datePart, timePart] = dateStr.split('T');
  const [y, m, d] = datePart.split('-');
  const date = `${d}.${m}.${y}`;
  return timePart ? `${date} ${timePart}` : date;
}

// Строка активного периода — ссылка между панелью и таблицей.
export const DateRangeBar = memo(({ startDate, endDate, onClick, onClear }: {
  startDate?: string;
  endDate?: string;
  onClick: () => void;
  onClear: () => void;
}) => {
  if (!startDate && !endDate) return null;

  const label = startDate && endDate
    ? `${formatDateTimeRu(startDate)} — ${formatDateTimeRu(endDate)}`
    : startDate
      ? `с ${formatDateTimeRu(startDate)}`
      : `по ${formatDateTimeRu(endDate!)}`;

  return (
    <div className={styles.DateRangeBar}>
      <span className={styles.DateRangeBarLabel}>{translate("period")}:</span>
      <a className={styles.DateRangeLink} onClick={onClick} title={translate("changePeriod")}>{label}</a>
      <Toolbar.ClearButton size='sm' onClick={onClear} title={translate("resetPeriod")} />
    </div>
  );
});
DateRangeBar.displayName = 'DateRangeBar';

// Модальная форма выбора периода.
export const FieldDateRangeModal = memo(({ method, startDate, endDate, onApply }: {
  method: TypeFormMethod;
  startDate: string;
  endDate: string;
  onApply: (start: string, end: string) => void;
}) => {
  const withDefaultTime = (val: string, defaultTime: string) => {
    if (!val) return '';
    return val.includes('T') ? val : `${val}T${defaultTime}`;
  };
  const getDatePart = (val: string) => val ? val.split('T')[0] : '';

  const [localStart, setLocalStart] = useState(() => withDefaultTime(startDate, '00:00'));
  const [localEnd, setLocalEnd] = useState(() => withDefaultTime(endDate, '23:59'));

  useEffect(() => {
    setLocalStart(withDefaultTime(startDate, '00:00'));
    setLocalEnd(withDefaultTime(endDate, '23:59'));
  }, [startDate, endDate]);

  const handleStartChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) { setLocalStart(''); return; }
    setLocalStart(prev => {
      if (!prev) return `${getDatePart(val)}T00:00`;
      const prevDate = getDatePart(prev);
      const newDate = getDatePart(val);
      if (prevDate !== newDate) return `${newDate}T00:00`;
      return val;
    });
  }, []);

  const handleEndChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) { setLocalEnd(''); return; }
    setLocalEnd(prev => {
      if (!prev) return `${getDatePart(val)}T23:59`;
      const prevDate = getDatePart(prev);
      const newDate = getDatePart(val);
      if (prevDate !== newDate) return `${newDate}T23:59`;
      return val;
    });
  }, []);

  const handleApply = useCallback(() => {
    onApply(localStart, localEnd);
  }, [onApply, localStart, localEnd]);

  return (
    <Modal method={method} onApply={handleApply} title={translate("period")} className={styles.DateRangeModal}>
      <Group>
        <FieldDateTime label="С" name="dateRangeStart" value={localStart} onChange={handleStartChange} />
        <FieldDateTime label="По" name="dateRangeEnd" value={localEnd} onChange={handleEndChange} />
      </Group>
    </Modal>
  );
});
FieldDateRangeModal.displayName = 'FieldDateRangeModal';

// Встроенный быстрый поиск (debounce 300ms для виртуального скролла).
export const FieldFastSearchInternal = memo(({ value, onChange }: {
  value: string;
  onChange: (value: string) => void;
}) => {
  const [inputValue, setInputValue] = useState(value);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => { setInputValue(value); }, [value]);

  const handleChange = useCallback((newValue: string) => {
    setInputValue(newValue);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      onChange(newValue);
      debounceTimerRef.current = null;
    }, 300);
  }, [onChange]);

  const handleClear = useCallback(() => {
    setInputValue('');
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    onChange('');
  }, [onChange]);

  useEffect(() => () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  }, []);

  return (
    // ВАЖНО: не оборачивать поле в <span> ради title — обёртка ломает растягивание
    // поля до края родителя. Подсказка про шаблоны идёт прямо на инпут через title.
    <Field
      name="fastSearch"
      value={inputValue}
      onChange={(e) => handleChange(e.target.value)}
      placeholder={translate("fastSearch")}
      title={translate("fastSearchTemplateHint")}
      autoFocus
      actions={[{ type: 'clear', onClick: handleClear }]}
    />
  );
}, (prevProps, nextProps) =>
  prevProps.value === nextProps.value && prevProps.onChange === nextProps.onChange,
);
FieldFastSearchInternal.displayName = 'FieldFastSearch';
