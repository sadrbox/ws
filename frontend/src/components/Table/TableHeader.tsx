/**
 * TableHeader — шапка таблицы (<thead>): чекбокс «выбрать все», заголовки колонок
 * с сортировкой и ресайзом (drag правой границы).
 *
 * Вынесено из Table/index.tsx (T4). Потребитель контекста (useTableContext +
 * useTableVolatile для чекбокса «все»); вынос безопасен после context.tsx.
 */
import { memo, useCallback, useMemo, useRef, useEffect, type MouseEvent as ReactMouseEvent } from 'react';
import { getTranslateColumn } from 'src/i18';
import { useTableContext, useTableVolatile } from './context';
import { normalizeLastColumnWidth } from './services';
import styles from './Table.module.scss';

export const TableHeader = memo(() => {
  const {
    variant, selectable,
    columns, rows, componentName,
    sorting: { sort, onSortChange },
    states: { setSelectedRows, setIsAllSelectedMode, setExcludedRows },
    isLoading, canDelete,
  } = useTableContext();
  // Значения выделения — из волатильного контекста (чекбокс «выбрать все»).
  const { selectedRows, isAllSelectedMode, excludedRows } = useTableVolatile();

  const isSelect = variant === 'select';
  const showCheckbox = !isSelect && selectable;

  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);

  // isAllSelected = true если режим "все" без исключений
  const isAllSelected = useMemo(() => {
    if (isAllSelectedMode) return excludedRows.size === 0;
    return rows.length > 0 && rows.every(r => selectedRows.has(r.id));
  }, [isAllSelectedMode, excludedRows, rows, selectedRows]);

  // indeterminate = частичный выбор
  const isIndeterminate = useMemo(() => {
    if (isAllSelectedMode) return excludedRows.size > 0;
    return selectedRows.size > 0 && !isAllSelected;
  }, [isAllSelectedMode, excludedRows, isAllSelected, selectedRows]);

  const toggleAll = useCallback(() => {
    if (isAllSelected || isIndeterminate) {
      // Есть хоть что-то выбранное (или всё) — сбрасываем всё
      setIsAllSelectedMode(false);
      setExcludedRows(new Set());
      setSelectedRows(new Set());
    } else {
      // Ничего не выбрано → включаем режим "все"
      setIsAllSelectedMode(true);
      setExcludedRows(new Set());
      setSelectedRows(new Set());
    }
  }, [isAllSelected, isIndeterminate, setIsAllSelectedMode, setExcludedRows, setSelectedRows]);

  const isResizingRef = useRef(false);

  const handleSort = useCallback((field: string) => {
    if (isResizingRef.current) return; // Не сортировать во время ресайза
    const newDir = sort[field] === 'asc' ? 'desc' : 'asc';
    onSortChange({ [field]: newDir });
  }, [sort, onSortChange]);

  // Устанавливаем indeterminate напрямую через DOM (React не поддерживает этот атрибут)
  const checkboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  // ── Column Resize ──────────────────────────────────────────────────────
  const { actions } = useTableContext();
  const resizingRef = useRef<{
    colIndex: number;
    startX: number;
    startWidth: number;
    minW: number;
    isLastCol: boolean;
    colId: string;
    th: HTMLElement;
    colEl: HTMLElement | null;
  } | null>(null);

  const handleResizeMouseDown = useCallback((e: ReactMouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    const th = (e.target as HTMLElement).closest('th') as HTMLElement | null;
    if (!th) return;

    // Кэшируем все нужные ссылки один раз — onMouseMove не делает никаких DOM-запросов
    const colOffset = showCheckbox ? 1 : 0;
    const colEl = (th.closest('table')?.querySelector('colgroup')?.children[colIndex + colOffset] as HTMLElement) ?? null;
    const col = visibleColumns[colIndex];
    const minW = parseInt(col.minWidth ?? '50', 10);
    const isLastCol = colIndex === visibleColumns.length - 1;

    resizingRef.current = {
      colIndex, startX: e.clientX, startWidth: th.getBoundingClientRect().width,
      minW, isLastCol, colId: col.identifier, th, colEl,
    };
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      const newWidth = Math.max(r.minW, r.startWidth + (ev.clientX - r.startX));
      r.th.style.width = newWidth + 'px';
      if (r.colEl) r.colEl.style.width = newWidth + 'px';
    };

    const onMouseUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const r = resizingRef.current;
      if (!r) return;
      const newWidth = Math.max(r.minW, r.startWidth + (ev.clientX - r.startX));
      // Последняя колонка: сохраняем явную ширину, не сбрасываем в auto
      const mapped = columns.map(c => c.identifier === r.colId ? { ...c, width: newWidth + 'px' } : c);
      const updatedColumns = r.isLastCol ? mapped : normalizeLastColumnWidth(mapped);
      actions.setColumns(updatedColumns);
      // Служебные колонки (__*) не сохраняем в localStorage (иначе сигнатура колонок
      // не совпадёт с defaults и настройки будут сбрасываться).
      localStorage.setItem(`table_columns_${componentName}`, JSON.stringify(updatedColumns.filter(c => !c.identifier.startsWith("__"))));
      resizingRef.current = null;
      setTimeout(() => { isResizingRef.current = false; }, 0);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [visibleColumns, columns, actions, componentName, showCheckbox]);

  return (
    <thead>
      <tr>
        {showCheckbox && (
          <th className={styles.HeaderCheckboxCell}>
            <div className={styles.CenterContent}>
              <input
                ref={checkboxRef}
                type="checkbox"
                checked={isAllSelected}
                onChange={toggleAll}
                disabled={isLoading || rows.length === 0 || !canDelete}
              />
            </div>
          </th>
        )}
        {visibleColumns.map((col, idx) => {
          const isSorting = !!(sort && sort[col.identifier]);
          const dir = isSorting ? sort[col.identifier] : null;
          const isLast = idx === visibleColumns.length - 1;
          const isSortable = col.sortable !== false;
          return (
            <th
              key={col.identifier}
              title={col.hint || undefined}
              style={{
                cursor: `${(isLoading || !isSortable) ? 'default' : 'pointer'}`,
              }}
              onClick={(!isLoading && isSortable) ? () => handleSort(col.identifier) : undefined}
            >
              <div className={styles.TableHeaderCell}>
                <span>{getTranslateColumn(col)}</span>
                {isSorting && (
                  <svg className={`${styles.SortArrow} ${dir === 'desc' ? styles.desc : ''}`}
                    width="24px" height="24px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <g><path fill="none" d="M0 0h24v24H0z" /><path d="M12 14l-4-4h8z" /></g>
                  </svg>
                )}
              </div>
              {!isLast && (
                <div
                  className={styles.ResizeHandle}
                  onMouseDown={(e) => handleResizeMouseDown(e, idx)}
                />
              )}
            </th>
          );
        })}
      </tr>
    </thead>
  );
});
TableHeader.displayName = 'TableHeader';
