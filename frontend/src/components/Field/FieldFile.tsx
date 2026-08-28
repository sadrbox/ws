// FieldFile — выбор файла в стиле Field + Button. Вынесено из Field/index.tsx (Q9).
import { FC, useId, useRef, useState, type ChangeEvent } from "react";
import styles from "./Field.module.scss";
import FieldActionButton from "./FieldActionButton";
import { useFieldBase, FieldLabelNode, type FieldVariant } from "./fieldBase";

interface TypeFieldFileProps {
  label?: string;
  name: string;
  /** Атрибут accept (напр. ".xls,.xlsx"). */
  accept?: string;
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  variant?: FieldVariant;
  width?: string;
  minWidth?: string;
  maxWidth?: string;
  /** Подпись кнопки выбора (по умолчанию «Выбрать файл»). */
  buttonLabel?: string;
  /** Плейсхолдер, когда файл не выбран. */
  placeholder?: string;
  /** Имя выбранного файла (controlled). Если не задано — компонент хранит сам. */
  fileName?: string;
  /** Показать индикатор загрузки — напр. пока файл обрабатывается. Без `progress`
   *  рисуется «бегущая» (indeterminate) полоса, с `progress` — определённая. */
  loading?: boolean;
  /** Процент загрузки 0–100 (определённый прогресс-бар вместо «бегущего»). */
  progress?: number;
  /** Колбэк выбора файла (основной). */
  onSelect?: (file: File | null) => void;
  /** Сырой onChange (если нужен доступ к FileList/event). */
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
}

export const FieldFile: FC<TypeFieldFileProps> = ({
  label, name, accept, disabled = false, required = false, error = false,
  variant = 'default',
  buttonLabel = 'Выбрать файл',
  placeholder = 'Файл не выбран', fileName, loading = false, progress, onSelect, onChange,
}) => {
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [internalName, setInternalName] = useState('');
  const displayName = fileName !== undefined ? fileName : internalName;
  const { isTable, effectiveRequired } = useFieldBase({ name, variant, required, error, value: displayName });

  const openPicker = () => { if (!disabled) inputRef.current?.click(); };
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (fileName === undefined) setInternalName(f?.name ?? '');
    onSelect?.(f);
    onChange?.(e);
  };
  const handleClear = () => {
    if (inputRef.current) inputRef.current.value = '';
    if (fileName === undefined) setInternalName('');
    onSelect?.(null);
  };

  const hasProgress = typeof progress === 'number' && Number.isFinite(progress);
  const showBar = loading || hasProgress;
  const pct = hasProgress ? Math.max(0, Math.min(100, progress)) : 0;
  const canClear = !!displayName && !disabled && !loading;

  return (
    <>
      <FieldLabelNode htmlFor={uid} label={label} required={effectiveRequired} isTable={isTable} />
      {/* Контрол фиксированной высоты: кнопка + имя (ellipsis) + слот «очистить» +
          абсолютный прогресс-бар снизу — разметка не «прыгает» при выборе/загрузке. */}
      <div className={styles.FieldFileControl} data-loading={loading || undefined}>
        <button type="button" className={styles.FieldFileButton} onClick={openPicker} disabled={disabled} title={label || buttonLabel}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 10.5V2.5" /><path d="M5.5 5L8 2.5 10.5 5" /><path d="M3 10.5V13h10v-2.5" />
          </svg>
          {buttonLabel}
        </button>
        <span className={[styles.FieldFileName, displayName ? '' : styles.FieldFilePlaceholder].filter(Boolean).join(' ')} title={displayName || placeholder}>
          {displayName || placeholder}
        </span>
        {hasProgress && loading && <span className={styles.FieldFilePct}>{Math.round(pct)}%</span>}
        {/* Слот фиксированной ширины — место под «очистить» зарезервировано всегда. */}
        <span className={styles.FieldFileClear}>
          {canClear && <FieldActionButton icon="clear" label="Очистить" onClick={handleClear} />}
        </span>
        <input
          ref={inputRef}
          id={uid}
          name={name}
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={handleChange}
          className={styles.FieldFileHiddenInput}
        />
        {showBar && (
          <div className={styles.FieldFileProgress} role="progressbar" aria-valuenow={hasProgress ? Math.round(pct) : undefined}>
            <div
              className={[styles.FieldFileProgressBar, hasProgress ? '' : styles.indeterminate].filter(Boolean).join(' ')}
              style={hasProgress ? { width: `${pct}%` } : undefined}
            />
          </div>
        )}
      </div>
    </>
  );
};
FieldFile.displayName = 'FieldFile';


