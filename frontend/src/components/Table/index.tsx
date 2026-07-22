import styles from './Table.module.scss';
import { TableConfigModalForm } from './TableConfigModalForm';
import { DateRangeBar, FieldDateRangeModal, FieldFastSearchInternal } from './TableToolbarControls';
import { TableArea } from './TableArea';
import { ROW_HEIGHT, OVERSCAN } from './constants';

import {
  TColumn,
  TDataItem,
  TypeFormAction,
  TypeFormMethod,
} from './types';

import { getTranslateColumn, translate } from 'src/i18';
import {
  CHECKBOX_COL_ID,
  computeNextActiveColId,
  computeNextActiveRowId,
  getCellNavDirection,
  getTableNavDirection,
} from './tableKeyboardNav';

import Modal from '../Modal';
import { Button } from '../Button';
import { LoadingSpinner } from '../UI';
import Toolbar from 'src/components/Toolbar';
import { Group } from 'src/components/UI';

// dnd-kit / PiDots переехали в ./TableConfigColumns вместе с компонентами настройки.


import {
  FC,
  KeyboardEvent as ReactKeyboardEvent,
  memo,
  Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  TableContextProvider,
  useTableContext, useTableVolatile,
  type TableContextProps, type TableVolatileState,
  type TTableVariant, type TOpenModelFormProps,
} from './context';

// Ре-экспорт публичной поверхности контекста (внешние импортируют из этого модуля,
// напр. PrimaryToolbarButton / TradeDocumentItemsTable — пути не меняются).
export { useTableContext, useTableVolatile };
export type { TableContextProps, TableVolatileState, TTableVariant, TOpenModelFormProps };
export type TypeModelProps = TableContextProps;


// ────────────────────────────────────────────────
// TableProps
// ────────────────────────────────────────────────

export interface TableProps {
  variant?: TTableVariant;
  /** false — скрыть колонку чекбоксов выбора строк. По умолчанию true. */
  selectable?: boolean;
  onSelectItem?: (item: TDataItem) => void;
  enableDateRange?: boolean;
  componentName: string;
  rows: TDataItem[];
  columns: TColumn[];
  total: number;
  totalPages: number;
  isLoading: boolean;
  error: Error | null;
  pagination: TableContextProps['pagination'];
  sorting: TableContextProps['sorting'];
  filtering: TableContextProps['filtering'];
  search: TableContextProps['search'];
  actions: TableContextProps['actions'];
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  extraButtons?: React.ReactNode;
  /** Удаление выбранных строк. Может вернуть набор РЕАЛЬНО удалённых id —
   *  таблица сдвигает activeRow и снимает выделение только с них (неудалённые,
   *  напр. документ-основание с 409, остаются активными/выделенными). */
  onDelete?: (selectedRows: Set<number>, rows: TDataItem[]) => void | Promise<{ deletedIds?: Set<number> } | void>;
  // ── Inline-редактирование ──────────────────────────────────────────────
  inlineEditing?: boolean;
  renderCell?: (row: TDataItem, col: TColumn) => React.ReactNode | undefined;
  onInlineAdd?: () => void;
  /**
   * Метаданные ячейки (ошибка / обязательное пустое) — передаются в
   * CellFieldStateScope, откуда Field-компоненты читают через useCellFieldState.
   * errorTooltip — визуальный узел ошибки, рендерящийся рядом с контентом.
   */
  getCellMeta?: (row: TDataItem, col: TColumn) => { required?: boolean; error?: boolean; errorMessage?: string; errorTooltip?: React.ReactNode } | null;
  /** Если true — скрыть кнопки «Добавить»/«Удалить» (режим только чтение по правам доступа) */
  readonly?: boolean;
  /** Если true — кнопка «Добавить» отображается как disabled */
  disableAdd?: boolean;
  /** Если true — скрыть кнопки «Добавить»/«Удалить», НЕ отключая inline-редактирование. */
  hideAddDelete?: boolean;
  /** Если true — скрыть ТОЛЬКО «Добавить» (удаление остаётся). Для журналов: записи
   *  порождаются системой, а не пользователем, но админ может их чистить. */
  hideAdd?: boolean;
  /** Если true — скрыть кнопку «Обновить» в тулбаре (когда перезагрузка с сервера не нужна). */
  hideReload?: boolean;
  /** Раскрытые строки (expand) */
  expandedRowIds?: Set<string>;
  /** Рендер содержимого раскрытой строки */
  renderExpandedRow?: (row: TDataItem) => React.ReactNode;
  /** Императивный ref для внешнего управления таблицей (activeRow, focus). */
  apiRef?: Ref<TableApi>;
  /** uuid строки для подсветки + центрирования («Показать в журнале»). */
  highlightUuid?: string;
  /** Нонс запроса подсветки: меняется при КАЖДОМ запросе, даже если uuid тот же
   *  (чтобы повторное «Показать в списке» снова центрировало строку). */
  highlightToken?: number;
}

/**
 * Императивный API таблицы — позволяет внешним обёрткам (напр. SubTable)
 * управлять activeRow без перевода фокуса на ячейки/поля.
 */
export interface TableApi {
  getActiveRow: () => number | null;
  setActiveRow: (id: number | null) => void;
  /** Идентификатор активной колонки (cell-level выделение) или null. */
  getActiveCell: () => string | null;
  setActiveCell: (identifier: string | null) => void;
  /** Передать фокус на скролл-контейнер таблицы (чтобы клавиатура работала без выбора ячейки). */
  focusContainer: () => void;
  /** Получить скролл-контейнер (для поиска DOM-элементов строк). */
  getScrollContainer: () => HTMLDivElement | null;
}

// ────────────────────────────────────────────────
// TableControlPanel - мемоизированная панель управления
// ────────────────────────────────────────────────

interface TableControlPanelProps {
  variant: TTableVariant;
  showDateRangeButton: boolean;
  isLoading: boolean;
  visibleDateRange: boolean;
  visibleFastSearch: boolean;
  onConfigOpen: () => void;
  onDateRangeToggle: () => void;
  onSearchToggle: () => void;
  onRefresh: () => void;
  onAddClick: () => void;
  onDeleteClick: () => void;
  /** Есть ли выбранные/выделенные строки — от этого зависит доступность кнопки «Удалить». */
  hasSelection: boolean;
  search: { value: string; onChange: (value: string) => void };
  extraButtons?: React.ReactNode;
  /** Если true — скрыть кнопки «Добавить»/«Удалить» (режим только чтение) */
  readonly?: boolean;
  /** Если true — кнопка «Добавить» отображается как disabled */
  disableAdd?: boolean;
  /** Если true — скрыть кнопки «Добавить»/«Удалить» (inline-редактирование сохраняется). */
  hideAddDelete?: boolean;
  /** Если true — скрыть ТОЛЬКО «Добавить» (удаление остаётся). */
  hideAdd?: boolean;
  /** Если true — скрыть кнопку «Обновить». */
  hideReload?: boolean;
  /** Если true — скрыть кнопку «Удалить» (удаление недоступно) */
  canDelete?: boolean;
  componentName?: string;
}

const TableControlPanel = memo(({
  variant,
  showDateRangeButton,
  isLoading,
  visibleDateRange,
  visibleFastSearch,
  onConfigOpen,
  onDateRangeToggle,
  onSearchToggle,
  onRefresh,
  onAddClick,
  onDeleteClick,
  hasSelection,
  search,
  extraButtons,
  readonly: isReadonly = false,
  disableAdd = false,
  hideAddDelete = false,
  hideAdd = false,
  hideReload = false,
  canDelete = true,
  componentName,
}: TableControlPanelProps) => {
  const isSelect = variant === 'select';
  const hideWrite = isSelect || isReadonly || hideAddDelete;
  return (
    <Toolbar
      right={visibleFastSearch ? <FieldFastSearchInternal value={search.value} onChange={search.onChange} /> : undefined}
    >
      {!hideWrite && !hideAdd && <Button onClick={onAddClick} disabled={isLoading || disableAdd} title={disableAdd ? translate("allModelsAssigned") : undefined}><span>{translate("add")}</span></Button>}
      {!hideWrite && <Button onClick={canDelete ? onDeleteClick : undefined} disabled={isLoading || !hasSelection || !canDelete} title={!hasSelection ? translate("selectRowsFirst") : undefined}><span>{translate("delete")}</span></Button>}
      {extraButtons && (
        <>
          {/* <Toolbar.Divider /> */}
          {extraButtons}
        </>
      )}
      {showDateRangeButton && (
        <>
          <Toolbar.Divider />
          <Toolbar.PeriodButton onClick={onDateRangeToggle} active={visibleDateRange} />
          {/* Переключатель вида списка (список / split-предпросмотр), персист per-list.
              Раскладку рендерит ModelList — она слушает CustomEvent "listLayoutToggle". */}
          {componentName && (
            <Toolbar.ToggleSplit
              pressed={(localStorage.getItem(`listPaneLayout:${componentName}`) || 'list') === 'split'}
              onClick={() => {
                const key = `listPaneLayout:${componentName}`;
                const next = (localStorage.getItem(key) || 'list') === 'split' ? 'list' : 'split';
                localStorage.setItem(key, next);
                window.dispatchEvent(new CustomEvent('listLayoutToggle', { detail: componentName }));
              }}
            />
          )}
        </>
      )}
      {!isSelect && <Toolbar.Divider />}
      {!hideReload && <Toolbar.ReloadButton onClick={onRefresh} disabled={isLoading} />}
      <Toolbar.SettingsButton onClick={onConfigOpen} />
      <Toolbar.SearchButton onClick={onSearchToggle} active={visibleFastSearch} />
      {/* <Toolbar.Divider /> */}
    </Toolbar>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.variant === nextProps.variant &&
    prevProps.showDateRangeButton === nextProps.showDateRangeButton &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.visibleDateRange === nextProps.visibleDateRange &&
    prevProps.visibleFastSearch === nextProps.visibleFastSearch &&
    prevProps.search === nextProps.search &&
    prevProps.extraButtons === nextProps.extraButtons &&
    prevProps.onDeleteClick === nextProps.onDeleteClick &&
    prevProps.onAddClick === nextProps.onAddClick &&
    prevProps.hasSelection === nextProps.hasSelection &&
    prevProps.readonly === nextProps.readonly &&
    prevProps.disableAdd === nextProps.disableAdd &&
    prevProps.hideAddDelete === nextProps.hideAddDelete &&
    prevProps.hideAdd === nextProps.hideAdd &&
    prevProps.hideReload === nextProps.hideReload &&
    prevProps.canDelete === nextProps.canDelete
  );
});

TableControlPanel.displayName = 'TableControlPanel';

// ────────────────────────────────────────────────
// Table
// ────────────────────────────────────────────────

const Table: FC<TableProps> = memo((props) => {
  const {
    variant = 'default',
    selectable = true,
    onSelectItem,
    enableDateRange = true,
    componentName, rows, columns, total, totalPages,
    isLoading, error,
    pagination, sorting, filtering, search, actions,
    hasNextPage, isFetchingNextPage,
    extraButtons,
    onDelete,
    inlineEditing,
    renderCell,
    onInlineAdd,
    getCellMeta,
    readonly: isReadonly = false,
    disableAdd = false,
    hideAddDelete = false,
    hideAdd = false,
    hideReload = false,
    expandedRowIds,
    renderExpandedRow,
    apiRef,
    highlightUuid,
    highlightToken,
  } = props;


  const { openModelForm, refetch } = actions;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ── Refs для inline-editing: не участвуют в contextValue, не триггерят ререндер ──
  const renderCellRef = useRef(renderCell);
  renderCellRef.current = renderCell;
  const inlineEditingRef = useRef(inlineEditing);
  inlineEditingRef.current = inlineEditing;
  const getCellMetaRef = useRef(getCellMeta);
  getCellMetaRef.current = getCellMeta;

  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [activeCell, setActiveCell] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [isAllSelectedMode, setIsAllSelectedMode] = useState<boolean>(false);
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set());
  const [configModalAction, setConfigModalAction] = useState<TypeFormAction>('');
  const [dateRangeModalAction, setDateRangeModalAction] = useState<TypeFormAction>('');
  const [visibleFastSearch, setVisibleFastSearch] = useState(false);

  // ── Авто-активация первой строки и клавиатурная навигация (режим выбора) ──
  // Stable refs для использования в эффектах без лишних пересозданий
  const activeRowRef = useRef(activeRow);
  activeRowRef.current = activeRow;
  // Текущие строки в ref — чтобы центрирование по индексу не зависело от
  // виртуализации (искомая строка может быть НЕ отрисована в DOM).
  const rowsForCenterRef = useRef(rows);
  rowsForCenterRef.current = rows;
  const activeCellRef = useRef(activeCell);
  activeCellRef.current = activeCell;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const onSelectItemRef = useRef(onSelectItem);
  onSelectItemRef.current = onSelectItem;

  // Автоматически активировать первую строку когда есть onSelectItem и загрузились данные
  useEffect(() => {
    if (!onSelectItem || rows.length === 0) return;
    setActiveRow((prev: number | null): number | null => {
      // Остаёмся на текущей строке если она ещё видна; иначе переходим на первую
      const stillVisible = prev !== null && rows.some(r => r.id === prev);
      return stillVisible ? prev : (rows[0].id);
    });
  }, [onSelectItem, rows]);

  // Центрирование активной строки по вертикали скролла таблицы. Таблица
  // ВИРТУАЛИЗИРОВАНА — строка вне видимой области не отрисована в DOM, поэтому
  // считаем позицию по ИНДЕКСУ строки (index × ROW_HEIGHT), а не по DOM-элементу.
  // Ждём, пока контейнер видим (clientHeight>0): при открытии из скрытой панели
  // высота появляется не сразу — делаем несколько кадров попыток.
  const centerActiveRow = useCallback(() => {
    const id = activeRowRef.current;
    if (id === null) return;
    const idx = rowsForCenterRef.current.findIndex((r) => r.id === id);
    if (idx < 0) return;
    let tries = 0;
    const tick = () => {
      const c = scrollRef.current;
      if (c && c.clientHeight > 0) {
        const target = idx * ROW_HEIGHT - (c.clientHeight - ROW_HEIGHT) / 2;
        c.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
        return;
      }
      if (tries++ < 30) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  // Прокрутка к активной строке при изменении activeRow.
  //  • обычная навигация (стрелки) — минимальный сдвиг (block: nearest);
  //  • подсветка (highlight) — ЦЕНТРИРОВАНИЕ (флаг centerNextScrollRef).
  const centerNextScrollRef = useRef(false);
  useEffect(() => {
    const c = scrollRef.current;
    if (activeRow === null || !c) return;
    if (centerNextScrollRef.current) {
      centerNextScrollRef.current = false;
      centerActiveRow();
      return;
    }
    const el = c.querySelector<HTMLElement>('[data-active="true"]');
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeRow, centerActiveRow]);

  // Подсветка строки документа по uuid («Показать в списке» / после «Сохранить
  // и закрыть»): ВСЕГДА выставляем activeRow на найденную строку и центрируем.
  // Если строки ещё нет (пагинация) — догружаем страницы, пока не найдём.
  const highlightDoneRef = useRef(false);
  const highlightTriesRef = useRef(0);
  useEffect(() => { highlightDoneRef.current = false; highlightTriesRef.current = 0; }, [highlightUuid, highlightToken]);
  useEffect(() => {
    if (!highlightUuid || highlightDoneRef.current) return;
    const row = rows.find(r => r.uuid === highlightUuid);
    if (row) {
      highlightDoneRef.current = true;
      if (activeRowRef.current === row.id) {
        // Строка уже активна (setActiveRow не вызовет ре-рендер) — центрируем явно.
        centerActiveRow();
      } else {
        centerNextScrollRef.current = true; // отцентрировать после установки activeRow
        setActiveRow(row.id);
      }
    } else if (hasNextPage && !isFetchingNextPage && highlightTriesRef.current < 50) {
      highlightTriesRef.current += 1;
      actions.fetchNextPage?.();
    }
  }, [highlightUuid, highlightToken, rows, hasNextPage, isFetchingNextPage, actions, centerActiveRow]);

  // Сбрасываем activeCell, когда снимается activeRow (нет смысла подсвечивать
  // ячейку без активной строки).
  useEffect(() => {
    if (activeRow === null && activeCell !== null) setActiveCell(null);
  }, [activeRow, activeCell]);

  // Императивный API для внешних оберток (SubTable и т.п.)
  useImperativeHandle(
    apiRef,
    () => ({
      getActiveRow: () => activeRowRef.current,
      setActiveRow: (id) => setActiveRow(id),
      getActiveCell: () => activeCellRef.current,
      setActiveCell: (identifier) => setActiveCell(identifier),
      focusContainer: () => scrollRef.current?.focus(),
      getScrollContainer: () => scrollRef.current,
    }),
    [],
  );

  // Клавиатурная навигация: ↑ / ↓ / Enter — только когда открыт список для выбора
  useEffect(() => {
    if (!onSelectItem) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const currentRows = rowsRef.current;
      if (currentRows.length === 0) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        const currentActive = activeRowRef.current;
        const row = currentRows.find(r => r.id === currentActive);
        if (row) onSelectItemRef.current?.(row);
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveRow((prev: number | null): number | null => {
          const idx = prev !== null ? currentRows.findIndex(r => r.id === prev) : -1;
          if (e.key === 'ArrowDown') {
            return currentRows[Math.min(Math.max(idx + 1, 0), currentRows.length - 1)].id;
          } else {
            return currentRows[Math.max(idx <= 0 ? 0 : idx - 1, 0)].id;
          }
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelectItem]);

  // Текущие значения dateRange из фильтров
  const dateRangeFilter = filtering.filters?.dateRange as { startDate?: string; endDate?: string } | undefined;
  const currentStartDate = dateRangeFilter?.startDate || '';
  const currentEndDate = dateRangeFilter?.endDate || '';
  const hasDateRange = !!(currentStartDate || currentEndDate);
  const showDateRangeButton = useMemo(
    () => enableDateRange && columns.some((column) => column.visible && (column.type === 'date' || column.type === 'datetime')),
    [enableDateRange, columns],
  );

  // extendedActions уже включают setAdaptiveLimit от родителя
  const extendedActions = useMemo(
    () => ({
      ...actions,
    }),
    [actions]
  );

  const contextValue = useMemo<TableContextProps>(
    () => ({
      variant, selectable, onSelectItem,
      componentName, rows, deferredRowsForRender: rows, columns, total, totalPages,
      isLoading, error,
      pagination, sorting, filtering, search,
      actions: extendedActions,
      hasNextPage, isFetchingNextPage,
      inlineEditing, renderCell, onInlineAdd,
      canDelete: !!onDelete,
      renderCellRef, inlineEditingRef, getCellMetaRef,
      scrollRef,
      expandedRowIds,
      renderExpandedRow,
      // Только сеттеры — стабильны, поэтому contextValue НЕ меняется при навигации.
      states: {
        setSelectedRows,
        setIsAllSelectedMode,
        setExcludedRows,
        setActiveRow,
        setActiveCell,
      },
    }),
    [
      variant, selectable, onSelectItem,
      componentName, rows, columns, total, totalPages,
      isLoading, error,
      pagination, sorting, filtering, search, extendedActions,
      hasNextPage, isFetchingNextPage,
      onInlineAdd, onDelete,
      // сеттеры стабильны (useState) — в deps не нужны; волатильные ЗНАЧЕНИЯ ушли
      // в отдельный контекст (см. volatileValue ниже).
      setSelectedRows, setIsAllSelectedMode, setExcludedRows, setActiveRow, setActiveCell,
    ]
  );

  // Высокочастотное состояние — отдельный контекст. Меняется на каждую навигацию/
  // выделение, но на него подписаны единицы (TableHeader), а не N строк.
  const volatileValue = useMemo<TableVolatileState>(
    () => ({ selectedRows, isAllSelectedMode, excludedRows, activeRow, activeCell }),
    [selectedRows, isAllSelectedMode, excludedRows, activeRow, activeCell],
  );

  const handleCreate = useCallback(() => {
    if (inlineEditing && onInlineAdd) {
      onInlineAdd();
    } else if (openModelForm) {
      openModelForm({ onSave: refetch, onClose: () => { } });
    }
  }, [inlineEditing, onInlineAdd, openModelForm, refetch]);  // onRefresh — обновляет данные.
  // isAllSelectedMode, selectedRows и excludedRows НЕ сбрасываем:
  // строки с теми же ID после перезагрузки сохранят своё состояние выделения.
  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleDeleteClick = useCallback(async () => {
    // Собираем реальный набор id выбранных строк
    let effectiveIds: Set<number>;
    if (isAllSelectedMode) {
      // Все строки выбраны, кроме excludedRows
      effectiveIds = new Set<number>(
        rows.map(r => r.id).filter(id => !excludedRows.has(id)),
      );
    } else if (selectedRows.size > 0) {
      effectiveIds = selectedRows;
    } else if (activeRow !== null) {
      // Ничего не выбрано чекбоксом — берём активную строку
      effectiveIds = new Set([activeRow]);
    } else {
      effectiveIds = new Set();
    }

    if (effectiveIds.size === 0) return;
    if (!onDelete) { alert('Удалить выбранные'); return; }

    // Узнаём, какие строки РЕАЛЬНО удалены. Если onDelete вернул deletedIds —
    // используем их (неудалённые, напр. документ-основание → 409, останутся
    // активными/выделенными); иначе (старый контракт) считаем удалёнными все.
    const result = (await onDelete(effectiveIds, rows)) as { deletedIds?: Set<number> } | undefined;
    const deletedIds = result?.deletedIds instanceof Set ? result.deletedIds : effectiveIds;
    // Ничего не удалено (отмена/полный отказ) — состояние таблицы НЕ трогаем.
    if (deletedIds.size === 0) return;

    // activeRow сдвигаем ТОЛЬКО если активная строка действительно удалена:
    // на ближайшую НЕудалённую ниже, иначе выше, иначе null.
    let nextActiveRow: number | null = activeRow;
    if (activeRow !== null && deletedIds.has(activeRow)) {
      nextActiveRow = null;
      const idx = rows.findIndex(r => r.id === activeRow);
      if (idx !== -1) {
        for (let i = idx + 1; i < rows.length; i++) {
          if (!deletedIds.has(rows[i].id)) { nextActiveRow = rows[i].id; break; }
        }
        if (nextActiveRow === null) {
          for (let i = idx - 1; i >= 0; i--) {
            if (!deletedIds.has(rows[i].id)) { nextActiveRow = rows[i].id; break; }
          }
        }
      }
    }

    // Снимаем выделение только с УДАЛЁННЫХ строк (неудалённые остаются выбранными).
    setSelectedRows(prev => { const n = new Set(prev); for (const id of deletedIds) n.delete(id); return n; });
    setIsAllSelectedMode(false);
    setExcludedRows(new Set());
    setActiveRow(nextActiveRow);
  }, [onDelete, selectedRows, rows, isAllSelectedMode, excludedRows, activeRow, setSelectedRows, setIsAllSelectedMode, setExcludedRows, setActiveRow]);

  // ── Клавиатурная навигация по таблице (Insert / Delete / Home / End /
  // PgUp / PgDn / ArrowUp / ArrowDown) ───────────────────────────────────
  // Обрабатывает события на контейнере скролла (tabIndex={0}). Срабатывает
  // только когда фокус на самом контейнере или на не-input элементе внутри
  // (чтобы не мешать вводу). Для select-режима (onSelectItem) стрелки/Enter
  // продолжают работать через отдельный window-listener выше.
  const handleScrollKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    // Не вмешиваемся, если фокус внутри редактируемого поля
    const isEditable = target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || (target?.isContentEditable === true);
    // Insert: создание новой строки/записи. Работает даже из input,
    // т.к. Insert обычно не используется внутри полей ввода.
    if (e.key === 'Insert') {
      e.preventDefault();
      e.stopPropagation();
      handleCreate();
      return;
    }
    if (isEditable) return;
    // Delete: удалить выбранные/активную
    if (e.key === 'Delete') {
      e.preventDefault();
      e.stopPropagation();
      handleDeleteClick();
      return;
    }
    // ── Пробел: переключить выделение активной строки ───────────────────────
    if (e.key === ' ' && variant !== 'select' && activeCell === CHECKBOX_COL_ID && activeRow !== null) {
      e.preventDefault();
      e.stopPropagation();
      const id = activeRow;
      if (isAllSelectedMode) {
        setExcludedRows(prev => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          if (next.size >= rows.length) {
            setIsAllSelectedMode(false);
            setExcludedRows(new Set());
            setSelectedRows(new Set());
            return new Set();
          }
          return next;
        });
      } else {
        setSelectedRows(prev => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          const allLoadedIds = rows.map(r => r.id);
          if (allLoadedIds.every(rid => next.has(rid))) {
            setIsAllSelectedMode(true);
            setExcludedRows(new Set());
            setSelectedRows(new Set());
            return new Set();
          }
          return next;
        });
      }
      return;
    }
    // ── Enter: открыть форму активной строки ─────────────────────────────
    // Работает только в обычных списках (*List, variant === 'default').
    //  - SubTable (variant === 'embedded') обрабатывает Enter сам в capture-фазе
    //    (вход в редактирование ячейки/строки).
    //  - select-режим (onSelectItem) обрабатывает Enter через свой window-listener.
    if (
      e.key === 'Enter' &&
      variant === 'default' &&
      !onSelectItem &&
      openModelForm
    ) {
      if (activeRow === null) return;
      const row = rows.find(r => r.id === activeRow);
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      openModelForm({ data: row, onSave: refetch, onClose: () => { } });
      return;
    }
    // ── Колоночная (cell-level) навигация: ArrowLeft/ArrowRight ───────────
    // Работает во всех вариантах кроме 'select' (там горизонтальная навигация
    // не нужна — пользователь выбирает строку, не ячейку).
    const cellDir = variant !== 'select' ? getCellNavDirection(e.key) : null;
    if (cellDir) {
      // Если строк нет — просто блокируем (чтобы не ездила каретка в input,
      // но мы уже отсекли isEditable выше).
      if (rows.length === 0) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Если activeRow нет — берём первую видимую строку (как точку старта).
      const startRowId = activeRow ?? rows[0].id;
      // Вычисляем следующую колонку с учётом виртуальной колонки чекбокса.
      const visibleCols = columns.filter(c => c.visible !== false);
      let nextColId: string | null;
      if (cellDir === 'right' && activeCell === CHECKBOX_COL_ID) {
        // Вправо от чекбокса → первая колонка данных
        nextColId = visibleCols.length > 0 ? visibleCols[0].identifier : CHECKBOX_COL_ID;
      } else if (cellDir === 'left' && activeCell === CHECKBOX_COL_ID) {
        // Уже в крайней левой позиции — остаёмся
        nextColId = CHECKBOX_COL_ID;
      } else if (cellDir === 'left') {
        // Если активная — первая колонка данных, переходим к чекбоксу
        const firstVisibleId = visibleCols.length > 0 ? visibleCols[0].identifier : null;
        if (activeCell === firstVisibleId) {
          nextColId = CHECKBOX_COL_ID;
        } else {
          nextColId = computeNextActiveColId(columns, activeCell, cellDir);
        }
      } else {
        nextColId = computeNextActiveColId(columns, activeCell, cellDir);
      }
      if (nextColId === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (activeRow === null) setActiveRow(startRowId);
      setActiveCell(nextColId);
      return;
    }
    // ── Построчная навигация: ArrowUp/ArrowDown/PgUp/PgDn ──────────────
    const direction = getTableNavDirection(e.key);
    if (!direction) return;
    if (rows.length === 0) return;
    const nextId = computeNextActiveRowId(rows, activeRow, direction);
    if (nextId === null) return;
    e.preventDefault();
    e.stopPropagation();
    setActiveRow(nextId);
  }, [handleCreate, handleDeleteClick, rows, activeRow, activeCell, columns, variant, onSelectItem, openModelForm, refetch, isAllSelectedMode, selectedRows, excludedRows, setSelectedRows, setIsAllSelectedMode, setExcludedRows]);

  const handleConfigOpen = useCallback(() => {
    setConfigModalAction('open');
  }, []);

  const handleDateRangeToggle = useCallback(() => {
    // Кнопка "Период" в панели открывает модальное окно
    setDateRangeModalAction('open');
  }, []);

  const searchOnChangeRef = useRef(search.onChange);
  searchOnChangeRef.current = search.onChange;

  const handleSearchToggle = useCallback(() => {
    setVisibleFastSearch(v => {
      if (v) {
        // Скрываем поиск → очищаем значение
        searchOnChangeRef.current("");
      }
      return !v;
    });
  }, []);

  // Применить период из модалки → отправить фильтр dateRange
  const handleDateRangeApply = useCallback((start: string, end: string) => {
    // Отправляем как единый объект dateRange — бэкенд ожидает filter[dateRange][startDate] / filter[dateRange][endDate]
    const dateRangeValue: Record<string, string> = {};
    if (start) dateRangeValue.startDate = start;
    if (end) dateRangeValue.endDate = end;
    if (Object.keys(dateRangeValue).length > 0) {
      filtering.onFilterChange('dateRange', dateRangeValue);
    } else {
      filtering.onFilterChange('dateRange', undefined);
    }
  }, [filtering]);

  // Очистить период
  const handleDateRangeClear = useCallback(() => {
    filtering.onFilterChange('dateRange', undefined);
  }, [filtering]);

  // Открыть модалку периода (по клику на ссылку)
  const handleDateRangeBarClick = useCallback(() => {
    setDateRangeModalAction('open');
  }, []);

  return (
    <TableContextProvider value={contextValue} volatile={volatileValue}>
      {configModalAction === 'open' && (
        <TableConfigModalForm method={{ get: configModalAction, set: setConfigModalAction }} />
      )}
      {dateRangeModalAction === 'open' && (
        <FieldDateRangeModal
          method={{ get: dateRangeModalAction, set: setDateRangeModalAction }}
          startDate={currentStartDate}
          endDate={currentEndDate}
          onApply={handleDateRangeApply}
        />
      )}

      <div className={styles.TableWrapper}>
        <TableControlPanel
          variant={variant}
          componentName={componentName}
          showDateRangeButton={showDateRangeButton}
          isLoading={isLoading}
          visibleDateRange={hasDateRange}
          visibleFastSearch={visibleFastSearch}
          onConfigOpen={handleConfigOpen}
          onDateRangeToggle={handleDateRangeToggle}
          onSearchToggle={handleSearchToggle}
          onRefresh={handleRefresh}
          onAddClick={handleCreate}
          onDeleteClick={handleDeleteClick}
          hasSelection={isAllSelectedMode || selectedRows.size > 0 || activeRow !== null}
          search={search}
          extraButtons={extraButtons}
          readonly={isReadonly}
          disableAdd={disableAdd}
          hideAddDelete={hideAddDelete}
          hideAdd={hideAdd}
          hideReload={hideReload}
          canDelete={!!onDelete}
        />

        {showDateRangeButton && hasDateRange && (
          <DateRangeBar
            startDate={currentStartDate}
            endDate={currentEndDate}
            onClick={handleDateRangeBarClick}
            onClear={handleDateRangeClear}
          />
        )}

        <div className={styles.TableScrollContainer}>
          <div
            ref={scrollRef}
            className={`${styles.TableScrollWrapper} ${styles.NoOverflowAnchor}`}
            tabIndex={0}
            onKeyDown={handleScrollKeyDown}
          >
            <TableArea />
          </div>
          {(isLoading || isFetchingNextPage) && (
            <LoadingSpinner variant="overlay" />
          )}
        </div>
      </div>
    </TableContextProvider>
  );
});

Table.displayName = 'Table';

export default Table;
