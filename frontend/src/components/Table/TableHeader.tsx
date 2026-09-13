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
import { spreadResize, type ResizeColumn } from './columnResize';
import styles from './Table.module.scss';

export const TableHeader = memo(() => {
  const {
    variant, selectable,
    columns, rows, componentName,
    sorting: { sort, onSortChange },
    states: { setSelectedRows, setIsAllSelectedMode, setExcludedRows },
    isLoading, canSelect, groupSelection, selectionLocked,
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

  // В групповой таблице «отметить всё» — это «выдать/снять всё во всех вложенных
  // строках»: своих отметок у неё нет (см. groupSelection).
  //
  // ИЗ ПРОМЕЖУТОЧНОГО СОСТОЯНИЯ ДОБИРАЕМ, а не снимаем: ровно так ведёт себя чекбокс
  // самой строки-группы (см. TableBodyRow), и шапка — это та же отметка, только сразу по
  // всем группам. Разное поведение у двух одинаковых на вид чекбоксов пришлось бы
  // запоминать. Заблокированным чекбокс больше не остаётся: неотмечаемые вложенные строки
  // в счёт не идут (см. groupSelection).
  const groupToggleAll = useCallback(() => {
    groupSelection?.toggleAll(!groupSelection.all);
  }, [groupSelection]);

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
      checkboxRef.current.indeterminate = groupSelection ? groupSelection.some : isIndeterminate;
    }
  }, [isIndeterminate, groupSelection]);

  // ── Column Resize ──────────────────────────────────────────────────────
  //
  // ВПРАВО РАСТЁТ ТОЛЬКО СХВАЧЕННАЯ КОЛОНКА — та, что слева от границы. Соседей это не
  // касается: человек просит места ей, а не перекладывает его по таблице.
  //
  // СУЖЕНИЕ ИДЁТ ЦЕПОЧКОЙ ВЛЕВО. Колонка ужимается до своего минимума, а дальше границу
  // тянет за собой ПРЕДЫДУЩАЯ колонка, потом та, что перед ней, и так до первой. Прежде
  // движение упиралось в минимум: таблица из десяти колонок не помещалась в узкий пейн, а
  // подвинуть границу было некуда — оставалось прятать колонки настройкой.
  //
  // Колонка отметок в этом не участвует: её ширина постоянна, и отдавать её под данные
  // значило бы сделать чекбоксы недоступными ради лишних десяти пикселей. В расчёт
  // попадают только колонки данных (visibleColumns), а смещение колонки отметок в
  // <colgroup> учитывается отдельно (colOffset).
  const { actions } = useTableContext();
  const resizingRef = useRef<{
    colIndex: number;
    startX: number;
    /** Ширины и минимумы ВСЕХ видимых колонок на момент захвата границы. */
    start: ResizeColumn[];
    isLastCol: boolean;
    /** Элементы шапки и <colgroup> по индексам видимых колонок — кэш на время перетаскивания. */
    ths: HTMLElement[];
    colEls: HTMLElement[];
  } | null>(null);

  const handleResizeMouseDown = useCallback((e: ReactMouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    const th = (e.target as HTMLElement).closest('th') as HTMLElement | null;
    const table = th?.closest('table');
    if (!th || !table) return;

    // Кэшируем все нужные ссылки один раз — onMouseMove не делает никаких DOM-запросов.
    const colOffset = showCheckbox ? 1 : 0;
    const headCells = Array.from(table.querySelectorAll<HTMLElement>('thead th'));
    const colGroup = Array.from(table.querySelector('colgroup')?.children ?? []) as HTMLElement[];
    const ths = headCells.slice(colOffset);
    const colEls = colGroup.slice(colOffset);
    // Ширины берём ИЗМЕРЕННЫЕ, а не из настроек: последняя колонка живёт с width: auto, и
    // её настроечная ширина ничего не говорит о том, сколько места она занимает сейчас.
    const start: ResizeColumn[] = visibleColumns.map((c, i) => ({
      width: ths[i]?.getBoundingClientRect().width ?? 0,
      min: parseInt(c.minWidth ?? '50', 10),
    }));

    resizingRef.current = {
      colIndex, startX: e.clientX, start,
      isLastCol: colIndex === visibleColumns.length - 1,
      ths, colEls,
    };
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const apply = (clientX: number): number[] => {
      const r = resizingRef.current!;
      const next = spreadResize(r.start, r.colIndex, clientX - r.startX);
      for (let i = 0; i < next.length; i += 1) {
        if (next[i] === r.start[i].width) continue;
        const px = `${next[i]}px`;
        if (r.ths[i]) r.ths[i].style.width = px;
        if (r.colEls[i]) r.colEls[i].style.width = px;
      }
      return next;
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (resizingRef.current) apply(ev.clientX);
    };

    const onMouseUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const r = resizingRef.current;
      if (!r) return;
      const next = apply(ev.clientX);
      // Сохраняем ВСЕ колонки, которых коснулась цепочка сужения, а не одну перетаскиваемую:
      // иначе после перерисовки левые соседи прыгнут обратно к прежней ширине.
      const byId = new Map<string, string>();
      visibleColumns.forEach((c, i) => {
        if (next[i] !== r.start[i].width) byId.set(c.identifier, `${next[i]}px`);
      });
      const mapped = columns.map(c => (byId.has(c.identifier) ? { ...c, width: byId.get(c.identifier)! } : c));
      // Последняя колонка: сохраняем явную ширину, не сбрасываем в auto
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
                checked={groupSelection ? groupSelection.all : isAllSelected}
                onChange={selectionLocked ? undefined : groupSelection ? groupToggleAll : toggleAll}
                readOnly={!!selectionLocked}
                disabled={isLoading || rows.length === 0 || !canSelect || !!selectionLocked}
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
              // Курсор — оформление, а не данные: его место в CSS. Атрибут говорит,
              // можно ли сортировать по колонке ЗДЕСЬ И СЕЙЧАС (во время загрузки нельзя).
              data-sortable={(!isLoading && isSortable) || undefined}
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
