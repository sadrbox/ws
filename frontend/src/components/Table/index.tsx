import styles from './Table.module.scss';
import { GLOBAL_ADAPTIVE_LIMIT_REF } from 'src/hooks/useInfiniteModelList';
import { CellFieldStateScope } from 'src/hooks/useDirtyHighlight';

import {
  TColumn,
  TDataItem,
  TypeFormAction,
  TypeFormMethod,
  TypeModalFormProps,
} from './types';

import { getTranslateColumn, translate } from 'src/i18';
import { getFormatColumnValue } from './services';
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
import { Field } from 'src/components/Field';

import { DndContext, closestCenter } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PiDotsThreeVerticalDuotone } from 'react-icons/pi';

/**
 * Гарантирует, что последняя видимая колонка имеет width: 'auto',
 * чтобы она растягивалась на оставшееся место.
 */
function normalizeLastColumnWidth(cols: TColumn[]): TColumn[] {
  const visibleIds = cols.filter(c => c.visible).map(c => c.identifier);
  if (visibleIds.length === 0) return cols;
  const lastVisibleId = visibleIds[visibleIds.length - 1];
  return cols.map(c => {
    if (c.identifier === lastVisibleId) {
      return { ...c, width: 'auto' };
    }
    // Сбрасываем 'auto' у не-последних видимых колонок на их minWidth
    if (c.visible && c.width === 'auto') return { ...c, width: c.minWidth ?? '150px' };
    return c;
  });
}

import {
  createContext,
  Dispatch,
  FC,
  Fragment,
  KeyboardEvent as ReactKeyboardEvent,
  memo,
  PropsWithChildren,
  Ref,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { TPane } from 'src/app/types';

export type TOpenModelFormProps = Partial<TPane>;
export type TypeModelProps = TableContextProps;

export type TTableVariant = 'default' | 'select' | 'embedded';

// ────────────────────────────────────────────────
// Context
// ────────────────────────────────────────────────

export interface TableContextProps {
  variant: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
  componentName: string;
  rows: TDataItem[];  // Реальные строки для логики подгрузки
  deferredRowsForRender: TDataItem[];  // Отложенные строки для рендера (не блокируют скролл)
  columns: TColumn[];
  total: number;
  totalPages: number;
  isLoading: boolean;
  error: Error | null;

  pagination: {
    page: number;
    limit: number;
    onPageChange: (page: number) => void;
    onLimitChange: (limit: number) => void;
  };

  sorting: {
    sort: Record<string, 'asc' | 'desc'>;
    onSortChange: (sort: Record<string, 'asc' | 'desc'>) => void;
  };

  filtering: {
    filters: Record<string, { value: unknown; operator: string }> | undefined;
    onFilterChange: (field: string, value: unknown, operator?: string) => void;
    onClearAll: () => void;
  };

  search: {
    value: string;
    onChange: (value: string) => void;
  };

  actions: {
    openModelForm?: (props: TOpenModelFormProps) => void;
    refetch: () => void;
    setColumns: (columns: TColumn[]) => void;
    fetchNextPage?: () => void;
    setAdaptiveLimit?: (limit: number) => void; // Установить адаптивный лимит
  };

  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  adaptiveLimit?: number; // Текущий адаптивный лимит

  // ── Inline-редактирование ──────────────────────────────────────────────
  inlineEditing?: boolean;
  renderCell?: (row: TDataItem, col: TColumn) => React.ReactNode | undefined;
  onInlineAdd?: () => void;
  /** Если true — кнопка «Добавить» disabled */
  disableAdd?: boolean;

  // ── Refs для inline-editing (не триггерят ререндер contextValue) ───────
  renderCellRef?: React.RefObject<((row: TDataItem, col: TColumn) => React.ReactNode | undefined) | undefined>;
  inlineEditingRef?: React.RefObject<boolean | undefined>;
  /** Метаданные ячейки (error/required) — передаются в CellFieldStateScope для Field-компонентов. */
  getCellMetaRef?: React.RefObject<
    | ((row: TDataItem, col: TColumn) => { required?: boolean; error?: boolean; errorMessage?: string; errorTooltip?: React.ReactNode } | null)
    | undefined
  >;
  // ── Expandable rows ────────────────────────────────────────────────────
  /** UUID строк, которые сейчас раскрыты */
  expandedRowIds?: Set<string>;
  /** Функция для рендера содержимого раскрытой строки */
  renderExpandedRow?: (row: TDataItem) => React.ReactNode;

  states: {
    selectedRows: Set<number>;
    setSelectedRows: Dispatch<SetStateAction<Set<number>>>;
    // ── Режим "выбрать всё" ───────────────────────────────────────────────
    // true = выбраны ВСЕ строки в БД (кроме excludedRows)
    isAllSelectedMode: boolean;
    setIsAllSelectedMode: Dispatch<SetStateAction<boolean>>;
    // Строки исключённые из режима "выбрать всё"
    excludedRows: Set<number>;
    setExcludedRows: Dispatch<SetStateAction<Set<number>>>;
    activeRow: number | null;
    setActiveRow: Dispatch<SetStateAction<number | null>>;
    /** Идентификатор активной (выделенной) колонки в строке activeRow. */
    activeCell: string | null;
    setActiveCell: Dispatch<SetStateAction<string | null>>;
  };

  scrollRef: React.RefObject<HTMLDivElement | null>;
}

const TableContext = createContext<TableContextProps | undefined>(undefined);

export const useTableContext = () => {
  const context = useContext(TableContext);
  if (!context) throw new Error('useTableContext must be used within TableContextProvider');
  return context;
};

const TableContextProvider: FC<PropsWithChildren<{ value: TableContextProps }>> = ({ children, value }) => (
  <TableContext.Provider value={value}>{children}</TableContext.Provider>
);

// ────────────────────────────────────────────────
// TableProps
// ────────────────────────────────────────────────

export interface TableProps {
  variant?: TTableVariant;
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
  onDelete?: (selectedRows: Set<number>, rows: TDataItem[]) => void;
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
  /** Раскрытые строки (expand) */
  expandedRowIds?: Set<string>;
  /** Рендер содержимого раскрытой строки */
  renderExpandedRow?: (row: TDataItem) => React.ReactNode;
  /** Императивный ref для внешнего управления таблицей (activeRow, focus). */
  apiRef?: Ref<TableApi>;
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

const ROW_HEIGHT = 30;  // ← ИСПРАВИЛ: было 28, должно быть 30
const OVERSCAN = 8;

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
}: TableControlPanelProps) => {
  const isSelect = variant === 'select';
  const hideWrite = isSelect || isReadonly;
  return (
    <Toolbar
      right={visibleFastSearch ? <FieldFastSearchInternal value={search.value} onChange={search.onChange} /> : undefined}
    >
      {!hideWrite && <Button onClick={onAddClick} disabled={isLoading || disableAdd} title={disableAdd ? translate("allModelsAssigned") : undefined}><span>Добавить</span></Button>}
      {!hideWrite && <Button onClick={onDeleteClick} disabled={isLoading || !hasSelection} title={!hasSelection ? "Выделите одну или несколько строк" : undefined}><span>Удалить</span></Button>}
      {!isSelect && extraButtons}
      {!isSelect && <Toolbar.Divider />}
      <Toolbar.ReloadButton onClick={onRefresh} disabled={isLoading} />
      <Toolbar.SettingsButton onClick={onConfigOpen} />
      {/* <Toolbar.Divider /> */}
      {showDateRangeButton && (
        <Toolbar.PeriodButton onClick={onDateRangeToggle} active={visibleDateRange} />
      )}
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
    prevProps.disableAdd === nextProps.disableAdd
  );
});

TableControlPanel.displayName = 'TableControlPanel';

// ────────────────────────────────────────────────
// Table
// ────────────────────────────────────────────────

const Table: FC<TableProps> = memo((props) => {
  const {
    variant = 'default',
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
    expandedRowIds,
    renderExpandedRow,
    apiRef,
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
  const activeCellRef = useRef(activeCell);
  activeCellRef.current = activeCell;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const onSelectItemRef = useRef(onSelectItem);
  onSelectItemRef.current = onSelectItem;

  // Автоматически активировать первую строку когда есть onSelectItem и загрузились данные
  useEffect(() => {
    if (!onSelectItem || rows.length === 0) return;
    setActiveRow(prev => {
      // Остаёмся на текущей строке если она ещё видна; иначе переходим на первую
      const stillVisible = prev !== null && rows.some(r => r.id === prev);
      return stillVisible ? prev : rows[0].id;
    });
  }, [onSelectItem, rows]);

  // Прокрутка к активной строке при изменении activeRow
  useEffect(() => {
    if (activeRow === null || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>('[data-active="true"]');
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeRow]);

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
        setActiveRow(prev => {
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
  const currentStartDate = (filtering.filters?.dateRange as any)?.startDate as string || '';
  const currentEndDate = (filtering.filters?.dateRange as any)?.endDate as string || '';
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
      variant, onSelectItem,
      componentName, rows, deferredRowsForRender: rows, columns, total, totalPages,
      isLoading, error,
      pagination, sorting, filtering, search,
      actions: extendedActions,
      hasNextPage, isFetchingNextPage,
      inlineEditing, renderCell, onInlineAdd,
      renderCellRef, inlineEditingRef, getCellMetaRef,
      scrollRef,
      expandedRowIds,
      renderExpandedRow,
      states: {
        selectedRows, setSelectedRows,
        isAllSelectedMode, setIsAllSelectedMode,
        excludedRows, setExcludedRows,
        activeRow, setActiveRow,
        activeCell, setActiveCell,
      },
    }),
    [
      variant, onSelectItem,
      componentName, rows, columns, total, totalPages,
      isLoading, error,
      pagination, sorting, filtering, search, extendedActions,
      hasNextPage, isFetchingNextPage,
      onInlineAdd,
      selectedRows, isAllSelectedMode, excludedRows, activeRow, activeCell,
    ]
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

  const handleDeleteClick = useCallback(() => {
    // Собираем реальный набор id выбранных строк
    let effectiveIds: Set<number>;
    if (isAllSelectedMode) {
      // Все строки выбраны, кроме excludedRows
      effectiveIds = new Set(
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

    // ── Вычисляем следующий activeRow ДО удаления ─────────────────────
    // Поведение: если активная строка удаляется — переносим фокус
    // на ближайшую строку НИЖЕ удаляемого блока (которая сама не удаляется);
    // если её нет — на ближайшую строку ВЫШЕ. Если все строки удалены —
    // сбрасываем activeRow в null.
    let nextActiveRow: number | null = activeRow;
    if (activeRow !== null && effectiveIds.has(activeRow)) {
      nextActiveRow = null;
      const idx = rows.findIndex(r => r.id === activeRow);
      if (idx !== -1) {
        for (let i = idx + 1; i < rows.length; i++) {
          if (!effectiveIds.has(rows[i].id)) { nextActiveRow = rows[i].id; break; }
        }
        if (nextActiveRow === null) {
          for (let i = idx - 1; i >= 0; i--) {
            if (!effectiveIds.has(rows[i].id)) { nextActiveRow = rows[i].id; break; }
          }
        }
      }
    }

    if (onDelete) {
      onDelete(effectiveIds, rows);
      // Сбрасываем выделение после удаления
      setSelectedRows(new Set());
      setIsAllSelectedMode(false);
      setExcludedRows(new Set());
      setActiveRow(nextActiveRow);
    } else {
      alert('Удалить выбранные');
    }
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
    <TableContextProvider value={contextValue}>
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

// ────────────────────────────────────────────────
// TableArea
// ────────────────────────────────────────────────

const TableArea = memo(() => {
  const { variant, columns } = useTableContext();
  const isSelect = variant === 'select';
  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);
  // console.log({ visibleColumns: visibleColumns.slice(0, -1), visibleColumnsLast: visibleColumns[visibleColumns.length - 1] });
  const lastVisibleColumn = visibleColumns[visibleColumns.length - 1];
  // console.log(lastVisibleColumn.identifier);
  return (
    <>
      <table>
        <colgroup>
          {!isSelect && <col className={styles.CheckboxCol} />}
          {visibleColumns.slice(0, -1).map(col => {
            // console.log(col.identifier);
            return (
              <col key={col.identifier}
                style={{ width: col.width && col.width !== 'auto' ? col.width : (col.minWidth ?? '150px'), minWidth: col.minWidth ?? '150px' }} />
            );
          })}
          {  /* {visibleColumns.length > 30 && ( */}
          <col
            key={lastVisibleColumn.identifier + '-last'}
            style={{ minWidth: lastVisibleColumn.minWidth ?? '150px', width: 'auto' }}
          />
          {/* )} */}
        </colgroup>
        <TableHeader />
        <TableBody />
        <TableFooter />
      </table>
    </>
  );
});

// ────────────────────────────────────────────────
// TableFooter — tfoot с итогами колонок (sticky bottom внутри скролла)
// ────────────────────────────────────────────────

const TableFooter = memo(() => {
  const { columns, rows } = useTableContext();
  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);

  // Проверяем есть ли хоть одна колонка с footer-итогом
  const hasFooter = visibleColumns.some(c => c.footer && c.footer !== 'none');
  if (!hasFooter) return null;

  return (
    <tfoot>
      <tr>
        {/* Колонка чекбокса */}
        <td />
        {visibleColumns.map(col => {
          const value = computeFooterValue(col, rows);
          return (
            <td key={col.identifier}>
              <div className={styles.TableFooterCell}>
                {value !== null && <span>{value}</span>}
              </div>
            </td>
          );
        })}
      </tr>
    </tfoot>
  );
});

TableFooter.displayName = 'TableFooter';

// Вычисляет итоговое значение колонки по загруженным строкам
function computeFooterValue(col: TColumn, rows: TDataItem[]): string | null {
  if (!col.footer || col.footer === 'none') return null;
  const vals = rows
    .map(r => {
      const v = r[col.identifier];
      return typeof v === 'number' ? v : parseFloat(String(v));
    })
    .filter(v => !isNaN(v));

  if (vals.length === 0) return null;

  switch (col.footer) {
    case 'sum': return vals.reduce((a, b) => a + b, 0).toLocaleString('ru-RU');
    case 'avg': return (vals.reduce((a, b) => a + b, 0) / vals.length).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
    case 'min': return Math.min(...vals).toLocaleString('ru-RU');
    case 'max': return Math.max(...vals).toLocaleString('ru-RU');
    case 'count': return vals.length.toLocaleString('ru-RU');
    default: return null;
  }
}

// ────────────────────────────────────────────────
// TableHeader
// ────────────────────────────────────────────────

const TableHeader = memo(() => {
  const {
    variant,
    columns, rows, componentName,
    sorting: { sort, onSortChange },
    states: {
      selectedRows, setSelectedRows,
      isAllSelectedMode, setIsAllSelectedMode,
      excludedRows, setExcludedRows,
    },
    isLoading,
  } = useTableContext();

  const isSelect = variant === 'select';

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
  } | null>(null);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    const th = (e.target as HTMLElement).closest('th');
    if (!th) return;
    const startWidth = th.getBoundingClientRect().width;

    resizingRef.current = { colIndex, startX: e.clientX, startWidth };
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const col = visibleColumns[resizingRef.current.colIndex];
      const minW = parseInt(col.minWidth ?? '50', 10);
      const newWidth = Math.max(minW, resizingRef.current.startWidth + delta);
      // Прямо обновляем DOM для плавности
      if (th) th.style.width = newWidth + 'px';
      // Также обновляем colgroup через соседний col элемент
      const table = th.closest('table');
      if (table) {
        // +1 только если есть чекбокс-колонка (не select-вариант)
        const colOffset = isSelect ? 0 : 1;
        const colEl = table.querySelector(`colgroup`)?.children[resizingRef.current.colIndex + colOffset] as HTMLElement;
        if (colEl) colEl.style.width = newWidth + 'px';
      }
    };

    const onMouseUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const col = visibleColumns[resizingRef.current.colIndex];
      const minW = parseInt(col.minWidth ?? '50', 10);
      const newWidth = Math.max(minW, resizingRef.current.startWidth + delta);
      // Коммитим новую ширину в стейт
      const updatedColumns = normalizeLastColumnWidth(columns.map(c =>
        c.identifier === col.identifier ? { ...c, width: newWidth + 'px' } : c
      ));
      actions.setColumns(updatedColumns);
      // Сохраняем ширины колонок в localStorage
      localStorage.setItem(`table_columns_${componentName}`, JSON.stringify(updatedColumns));
      resizingRef.current = null;
      // Сбрасываем флаг через setTimeout, чтобы click (который идёт после mouseup) был заблокирован
      setTimeout(() => { isResizingRef.current = false; }, 0);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [visibleColumns, columns, actions, componentName, isSelect]);

  return (
    <thead>
      <tr>
        {!isSelect && (
          <th className={styles.HeaderCheckboxCell}>
            <div className={styles.CenterContent}>
              <input
                ref={checkboxRef}
                type="checkbox"
                checked={isAllSelected}
                onChange={toggleAll}
                disabled={isLoading || rows.length === 0}
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
                width: isLast ? 'auto' : (col.width && col.width !== 'auto' ? col.width : undefined),
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

// ────────────────────────────────────────────────
// TableBody
// ────────────────────────────────────────────────

const TableBody = memo(() => {
  const {
    variant,
    rows, deferredRowsForRender, columns, isLoading, total,
    isFetchingNextPage, hasNextPage,
    actions, scrollRef,
  } = useTableContext();

  // scrollRenderTick используется ТОЛЬКО как триггер ре-рендера при скролле.
  // Реальное значение scrollTop читается синхронно из scrollTopRef.
  const [, forceScrollRender] = useState(0);
  // Ref для синхронного чтения scrollTop при расчёте padding (без задержки state)
  const scrollTopRef = useRef<number>(0);
  const [containerHeight, setContainerHeight] = useState(scrollRef.current?.clientHeight ?? 0);

  // Таймер для дебаунса скролла
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Курсор последнего отправленного запроса (rows.length на момент запроса).
  // -1 означает "ещё ничего не запрашивали" — позволяет запустить первый батч.
  const lastRequestedCursorRef = useRef<number>(-1);

  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);

  // ── Подписка на скролл и resize ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      // Обновляем scrollTop синхронно в ref и асинхронно тригерим ре-рендер
      scrollTopRef.current = el.scrollTop;
      forceScrollRender(v => v + 1);

      // Сбрасываем таймер — запрос выполняется только после остановки скролла
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        tryFetch(el);
      }, 200);
    };

    const ro = new ResizeObserver(() => {
      setContainerHeight(el.clientHeight);
    });

    setContainerHeight(el.clientHeight);
    el.addEventListener('scroll', onScroll, { passive: true });
    ro.observe(el);

    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
    // tryFetch намеренно не в deps — используем ref-версию ниже
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef]);

  // Держим актуальные значения в ref, чтобы tryFetch внутри setTimeout не устарел
  const fetchStateRef = useRef({ hasNextPage, isFetchingNextPage, rows, total, actions });
  useEffect(() => {
    fetchStateRef.current = { hasNextPage, isFetchingNextPage, rows, total, actions };
  });

  const tryFetch = useCallback((el: HTMLDivElement) => {
    const { hasNextPage, isFetchingNextPage, rows, total, actions } = fetchStateRef.current;

    if (!hasNextPage || isFetchingNextPage) return;
    if (rows.length >= total) return;
    if (!actions.fetchNextPage) return;

    const BATCH_SIZE = 500;
    const TRIGGER_OFFSET = 50; // триггер на 50-й строке каждой новой порции
    const JUMP_BUFFER = 500;

    const viewTopRow = Math.floor(el.scrollTop / ROW_HEIGHT);
    const viewBottomRow = Math.ceil((el.scrollTop + el.clientHeight) / ROW_HEIGHT);

    // ── Случай 1: Прыжок — видимая область ушла ЗА загруженные строки ────
    if (viewTopRow >= rows.length) {
      // Защита от повторного запроса для того же курсора
      if (rows.length === lastRequestedCursorRef.current) return;
      lastRequestedCursorRef.current = rows.length;

      // Грузим до нижней границы видимой области + буфер
      const limit = Math.max(BATCH_SIZE, viewBottomRow - rows.length + JUMP_BUFFER);
      GLOBAL_ADAPTIVE_LIMIT_REF.current = limit;
      if (actions.setAdaptiveLimit) actions.setAdaptiveLimit(limit);
      actions.fetchNextPage();
      return;
    }

    // ── Случай 2: Обычный скролл или прыжок внутри загруженных данных ────
    // triggerRow = начало последней порции + TRIGGER_OFFSET (50 строк)
    // rows=500  → lastBatchStart=0   → triggerRow=50
    // rows=1000 → lastBatchStart=500 → triggerRow=550
    // rows=1500 → lastBatchStart=1000 → triggerRow=1050
    const lastBatchStartRow = Math.max(0, rows.length - BATCH_SIZE);
    const triggerRow = lastBatchStartRow + TRIGGER_OFFSET;

    if (viewBottomRow < triggerRow) return;

    // Защита от повторного запроса для того же курсора
    if (rows.length === lastRequestedCursorRef.current) return;
    lastRequestedCursorRef.current = rows.length;

    GLOBAL_ADAPTIVE_LIMIT_REF.current = BATCH_SIZE;
    if (actions.setAdaptiveLimit) actions.setAdaptiveLimit(BATCH_SIZE);
    actions.fetchNextPage();
  }, []);

  // При сбросе rows до 0 (сортировка/refresh) — сбрасываем курсор,
  // чтобы первый батч новой загрузки не был заблокирован старым значением.
  const prevRowsLengthRef = useRef<number>(0);
  useEffect(() => {
    if (rows.length === 0 && prevRowsLengthRef.current > 0) {
      lastRequestedCursorRef.current = -1;
    }
    prevRowsLengthRef.current = rows.length;
  }, [rows.length]);

  // После загрузки новой порции данных — проверяем, нужно ли грузить следующую.
  // Это нужно когда пользователь не скроллит: данные пришли, viewport уже в зоне триггера.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || rows.length === 0) return;
    tryFetch(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  // ── Сохранение выделения при сбросе строк ──
  // При сортировке/refresh rows сбрасываются до 0, затем загружаются заново.
  // selectedRows и excludedRows НЕ очищаем — строки с теми же ID сохранят
  // своё состояние. isAllSelectedMode тоже сохраняется.
  const lastRowCountRef = useRef<number>(0);
  useEffect(() => {
    lastRowCountRef.current = deferredRowsForRender.length;
  }, [deferredRowsForRender.length]);

  // ── Фиксируем scrollTop при добавлении строк ──
  // useLayoutEffect срабатывает синхронно ПЕРЕД отрисовкой браузера.
  // Если DOM изменился (добавились строки) и scrollTop сдвинулся — восстанавливаем его.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Восстанавливаем позицию скролла из ref — она не должна меняться при добавлении строк
    if (el.scrollTop !== scrollTopRef.current) {
      el.scrollTop = scrollTopRef.current;
    }
  }, [deferredRowsForRender.length, scrollRef]);

  // ── Расчёт виртуализации ──
  const loadedCount = deferredRowsForRender.length;
  const effectiveContainerHeight = containerHeight > 0 ? containerHeight : 600;

  // Используем ref для расчёта padding — он всегда актуален, без задержки state.
  // Это предотвращает скачок полосы прокрутки при добавлении новых строк.
  const currentScrollTop = scrollTopRef.current;

  // Первая и последняя строка в пикельных координатах (с учётом overscan)
  const firstVisibleIndex = Math.max(0, Math.floor(currentScrollTop / ROW_HEIGHT) - OVERSCAN);
  const lastVisibleIndex = Math.ceil((currentScrollTop + effectiveContainerHeight) / ROW_HEIGHT) + OVERSCAN;

  // startIndexVirtual и endIndexVirtual — индексы ВНУТРИ загруженного массива
  const startIndexVirtual = Math.min(firstVisibleIndex, loadedCount);
  const endIndexVirtual = Math.min(loadedCount, lastVisibleIndex);
  const renderedRowsCount = endIndexVirtual - startIndexVirtual;

  // topPadding = высота строк до первой отрендеренной
  const topPaddingAll = startIndexVirtual * ROW_HEIGHT;

  // bottomPadding вычисляется так, чтобы СУММА всегда равнялась total * ROW_HEIGHT.
  // Это гарантирует стабильную высоту таблицы и неподвижный ползунок скролла.
  const totalTableHeight = total * ROW_HEIGHT;
  const bottomPaddingAll = Math.max(0, totalTableHeight - topPaddingAll - renderedRowsCount * ROW_HEIGHT);

  const visibleRows = useMemo(
    () => deferredRowsForRender.slice(startIndexVirtual, endIndexVirtual),
    [deferredRowsForRender, startIndexVirtual, endIndexVirtual]
  );

  // ── Рендер ──
  if (!isLoading && rows.length === 0) {
    return (
      <tbody>
        {/* <tr>
          <td colSpan={visibleColumns.length + (variant !== 'select' ? 1 : 0)} />
        </tr> */}
        <tr className={styles.TableFillerRow} aria-hidden="true">
          <td colSpan={visibleColumns.length + (variant !== 'select' ? 1 : 0)} />
        </tr>
      </tbody>
    );
  }

  return (
    <tbody>
      {topPaddingAll > 0 && (
        <tr className={styles.VirtualPaddingRow} style={{ height: `${topPaddingAll}px` }}>
          <td colSpan={visibleColumns.length + (variant !== 'select' ? 1 : 0)} />
        </tr>
      )}

      {visibleRows.map((row) => (
        <TableBodyRow
          key={row.id}
          row={row}
          columns={visibleColumns}
        />
      ))}

      {bottomPaddingAll > 0 && (
        <tr className={styles.VirtualPaddingRow} style={{ height: `${bottomPaddingAll}px` }}>
          <td colSpan={visibleColumns.length + (variant !== 'select' ? 1 : 0)} >

          </td>
        </tr>
      )}

      {/* Filler row: поглощает остаток высоты, чтобы tfoot прижимался
          к низу TableScrollWrapper, при этом обычные строки tbody
          сохраняют свою фиксированную высоту. */}
      <tr className={styles.TableFillerRow} aria-hidden="true">
        <td colSpan={visibleColumns.length + (variant !== 'select' ? 1 : 0)} />
      </tr>
    </tbody>
  );
});

// ────────────────────────────────────────────────
// TableBodyRow
// ────────────────────────────────────────────────

interface TableBodyRowProps {
  row: TDataItem;
  columns: TColumn[];
}


const TableBodyRow: FC<TableBodyRowProps> = memo(({ row, columns }) => {
  const {
    variant,
    onSelectItem,
    rows,
    renderCellRef,
    inlineEditingRef,
    getCellMetaRef,
    expandedRowIds,
    renderExpandedRow,
    states: {
      activeRow, setActiveRow,
      activeCell, setActiveCell,
      selectedRows, setSelectedRows,
      isAllSelectedMode, setIsAllSelectedMode,
      excludedRows, setExcludedRows,
    },
    actions: { openModelForm, refetch },
    isLoading,
    scrollRef,
  } = useTableContext();

  const isActive = activeRow === row.id;
  const isCheckboxCellActive = variant !== 'select' && isActive && activeCell === CHECKBOX_COL_ID;

  // Строка выбрана если:
  // 1. Режим "все" И строка НЕ в исключениях
  // 2. Или обычный режим И строка в selectedRows
  const isSelected = isAllSelectedMode
    ? !excludedRows.has(row.id)
    : selectedRows.has(row.id);

  const toggleSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const id = row.id;
    if (isAllSelectedMode) {
      // В режиме "все" управляем исключениями
      setExcludedRows(prev => {
        const next = new Set(prev);
        if (!e.target.checked) {
          next.add(id);     // Снимаем → добавляем в исключения
        } else {
          next.delete(id);  // Ставим → убираем из исключений
        }
        // Если исключены ВСЕ загруженные строки — выключаем режим "все"
        if (next.size >= rows.length) {
          setIsAllSelectedMode(false);
          setExcludedRows(new Set());
          setSelectedRows(new Set());
          return new Set(); // не используется, но нужен для типа
        }
        return next;
      });
    } else {
      // Обычный режим — управляем selectedRows
      setSelectedRows(prev => {
        const next = new Set(prev);
        if (e.target.checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
        // Если выбраны ВСЕ загруженные строки — переключаемся в режим "все"
        const allLoadedIds = rows.map(r => r.id);
        if (allLoadedIds.every(rid => next.has(rid))) {
          setIsAllSelectedMode(true);
          setExcludedRows(new Set());
          setSelectedRows(new Set());
          return new Set(); // не используется, но нужен для типа
        }
        return next;
      });
    }
  }, [row.id, rows, isAllSelectedMode, setIsAllSelectedMode, setSelectedRows, setExcludedRows]);

  // Флаг: mousedown произошёл на уже сфокусированном поле — клик должен быть стандартным
  const clickedFocusedInputRef = useRef(false);

  const handleRowClick = useCallback((e: React.MouseEvent) => {
    setActiveRow?.(row.id);
    // Если клик пришёлся на конкретную ячейку — синхронизируем activeCell с ней.
    const targetEl = e.target as HTMLElement | null;
    const td = targetEl?.closest('td[data-col-id]') as HTMLElement | null;
    const colId = td?.getAttribute('data-col-id') ?? null;
    if (colId) setActiveCell?.(colId);
    if (clickedFocusedInputRef.current) {
      // Клик по уже сфокусированному полю — не сбрасываем фокус, даём стандартное поведение
      clickedFocusedInputRef.current = false;
      return;
    }
    // Для всех остальных кликов — снимаем фокус с любого активного поля ввода
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT') && (active as HTMLInputElement).type !== 'checkbox') {
      active.blur();
    }
    // Гарантируем, что фокус остаётся на scroll-контейнере таблицы, чтобы
    // клавиатурная навигация (Up/Down/Left/Right/Home/End/PgUp/PgDn) работала
    // независимо от того, что в строке могут быть редактируемые поля (input),
    // у которых mousedown с preventDefault может «съесть» автофокус контейнера.
    // Без этого в SubTable (inline-editing) после клика по строке стрелки не
    // работают, потому что фокус остаётся на body.
    const scroller = scrollRef.current;
    if (scroller && !scroller.contains(document.activeElement)) {
      // preventScroll — чтобы не дёргать видимую область при программном фокусе
      try { scroller.focus({ preventScroll: true }); } catch { scroller.focus(); }
    }
  }, [setActiveRow, setActiveCell, row.id, scrollRef, variant]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!inlineEditingRef?.current) {
      clickedFocusedInputRef.current = false;
      return;
    }
    const target = e.target as HTMLElement;
    const isEditableInput =
      (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox') ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT';
    if (!isEditableInput) {
      clickedFocusedInputRef.current = false;
      return;
    }
    // Разрешаем стандартное поведение только если клик по тому же полю,
    // которое уже в фокусе (перемещение курсора, выделение текста внутри поля).
    // Для любого другого поля — блокируем авто-фокус; фокус только по двойному клику.
    if (target === document.activeElement) {
      clickedFocusedInputRef.current = true;
    } else {
      clickedFocusedInputRef.current = false;
      e.preventDefault();
    }
  }, [inlineEditingRef]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (inlineEditingRef?.current) {
      // В inline-режиме: двойной клик по полю ввода — фокусируем его
      const target = e.target as HTMLElement;
      const isEditableField =
        (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox') ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT';
      if (isEditableField) {
        (target as HTMLInputElement).focus();
        // select() для SELECT-элемента не определён — вызываем только для текстовых полей
        if (target.tagName !== 'SELECT') {
          try { (target as HTMLInputElement).select(); } catch { /* ignore */ }
        }
      } else {
        // Двойной клик по нередактируемой ячейке — пульс-индикация
        const td = (target as HTMLElement).closest('td');
        if (td) {
          td.removeAttribute('data-pulse');
          void (td as HTMLElement).offsetWidth;
          td.setAttribute('data-pulse', 'true');
          window.setTimeout(() => td.removeAttribute('data-pulse'), 300);
        }
      }
      return;
    }
    if (onSelectItem) {
      onSelectItem(row);
    } else if (openModelForm) {
      openModelForm({ data: row, onSave: refetch, onClose: () => { } });
    }
  }, [inlineEditingRef, onSelectItem, openModelForm, row, refetch]);

  const rowUuid = (row as any).uuid || String((row as any).id);
  const isExpanded = expandedRowIds?.has(rowUuid) ?? false;
  const visibleColCount = columns.filter(c => c.visible).length + (variant !== 'select' ? 1 : 0);

  // Класс выравнивания ячейки по типу колонки — вычисляется один раз на колонку
  const cellAlignClass = (col: TColumn) => {
    switch (col.type) {
      case 'number': return styles.JustifyRight;
      case 'switcher': return styles.JustifyCenter;
      default: return styles.JustifyLeft;
    }
  };

  const trClassName = [
    isActive && styles.activeRow,
    isLoading && styles.RowLoading,
  ].filter(Boolean).join(' ');

  return (
    <Fragment>
      <tr
        onClick={handleRowClick}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        className={trClassName}
        data-active={isActive || undefined}
        // data-row-id / data-selected — атрибуты для внешних обработчиков
        // (напр. SubTable.handleContainerKeyDown), чтобы по клавишам можно
        // было определить выбранные/активные строки без доступа к React-state.
        data-row-id={row.id}
        data-selected={isSelected || undefined}
        // Жирное выделение основной записи (см. tr[data-primary="true"] в Table.module.scss)
        // применяется ТОЛЬКО во вложенных таблицах (SubTable, variant="embedded"),
        // которые используются внутри форм организации/контрагента и форм основных записей.
        // В общих списках (variant="default") и в селекторах (variant="select") выделять не нужно.
        data-primary={row.isPrimary && variant === 'embedded' ? "true" : undefined}
      >
        {variant !== 'select' && (
          <td
            className={styles.CellCenter}
            data-col-id={CHECKBOX_COL_ID}
            onClick={e => {
              e.stopPropagation();
              setActiveRow?.(row.id);
              setActiveCell?.(CHECKBOX_COL_ID);
            }}
          >
            <div
              className={[styles.TableBodyCell, styles.CellJustifyCenter, isCheckboxCellActive ? styles.activeCell : undefined].filter(Boolean).join(' ')}
            >
              <input type="checkbox" checked={isSelected} onChange={toggleSelect} disabled={isLoading} />
            </div>
          </td>
        )}
        {columns.map(col => {
          // Кастомный рендер ячейки (переводы, спецзначения) — работает в любом режиме
          const currentRenderCell = renderCellRef?.current;
          const isCellActive = isActive && activeCell === col.identifier;

          const cellMeta = getCellMetaRef?.current?.(row, col) ?? null;

          const cellClassName = [
            styles.TableBodyCell,
            cellAlignClass(col),
            isCellActive ? styles.activeCell : null,
          ].filter(Boolean).join(' ');

          const cellTitle = cellMeta?.errorMessage;

          const tdProps = {
            'data-col-id': col.identifier,
            tabIndex: isCellActive ? -1 : undefined,
          } as const;

          const cellFieldState = cellMeta ? { required: cellMeta.required, error: cellMeta.error, errorMessage: cellMeta.errorMessage } : undefined;

          if (currentRenderCell) {
            const customCell = currentRenderCell(row, col);
            if (customCell !== undefined) {
              return (
                <td key={col.identifier} {...tdProps}>
                  <div className={cellClassName} {...(cellTitle ? { title: cellTitle } : {})}>
                    <CellFieldStateScope value={cellFieldState ?? {}}>
                      {customCell}
                    </CellFieldStateScope>
                    {cellMeta?.errorTooltip}
                  </div>
                </td>
              );
            }
          }
          // Fallback: plain read-only span. CellRequired applied here since no Field handles it.
          const fallbackClassName = [
            cellClassName,
            cellMeta?.required ? styles.CellRequired : null,
          ].filter(Boolean).join(' ');
          const value = getFormatColumnValue(row, col);
          return (
            <td key={col.identifier} {...tdProps}>
              <div className={fallbackClassName} {...(cellTitle ? { title: cellTitle } : {})}>
                <span>{value}</span>
                {cellMeta?.errorTooltip}
              </div>
            </td>
          );
        })}
      </tr>
      {
        isExpanded && renderExpandedRow && (
          <tr>
            <td
              colSpan={visibleColCount}
              className={styles.ExpandedRowCell}
            >
              {renderExpandedRow(row)}
            </td>
          </tr>
        )
      }
    </Fragment >
  );
});

// ────────────────────────────────────────────────
// TableConfigModalForm
// ────────────────────────────────────────────────

const TableConfigModalForm: FC<TypeModalFormProps> = ({ method }) => {
  const { columns, componentName, actions } = useTableContext();
  const [columnsConfig, setColumnsConfig] = useState<TColumn[]>(columns);

  const onApply = useCallback(() => {
    const normalized = normalizeLastColumnWidth(columnsConfig);
    localStorage.setItem(`table_columns_${componentName}`, JSON.stringify(normalized));
    actions?.setColumns?.(normalized);
  }, [columnsConfig, componentName, actions]);

  useEffect(() => { setColumnsConfig(columns); }, [columns]);

  return (
    <Modal title="Колонки таблицы" method={method} onApply={onApply} className={styles.ColumnsModal}>
      <TableConfigColumns columns={columnsConfig} setColumns={setColumnsConfig} />
    </Modal>
  );
};

// ────────────────────────────────────────────────
// TableConfigColumns
// ────────────────────────────────────────────────

type TypeTableConfigColumnsProps = {
  columns: TColumn[];
  setColumns: Dispatch<SetStateAction<TColumn[]>>;
};

const TableConfigColumns: FC<TypeTableConfigColumnsProps> = ({ columns, setColumns }) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const updateColumnVisibility = useCallback((identifier: string, visible: boolean) => {
    setColumns(prev => prev.map(col =>
      col.identifier === identifier ? { ...col, visible } : col
    ));
  }, [setColumns]);

  const onDragStart = useCallback((event: any) => setDraggingId(String(event.active.id)), []);

  const onDragEnd = useCallback((event: any) => {
    const { active, over } = event;
    setDraggingId(null);
    if (active.id !== over?.id) {
      setColumns(prev => {
        const oldIndex = prev.findIndex(col => col.identifier === active.id);
        const newIndex = prev.findIndex(col => col.identifier === over?.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }, [setColumns]);

  const dndItems = useMemo(() => columns.map(col => col.identifier), [columns]);

  return (
    <>
      {/* <div className={styles.TableConfigListHeader}>
        <div className={styles.TableConfigListHeaderTitle}>Видимость</div>
      </div> */}
      <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd} onDragStart={onDragStart}>
        <SortableContext items={dndItems} strategy={verticalListSortingStrategy}>
          <ul className={styles.CheckboxList}>
            {columns.filter(col => col.inlist !== false).map(column => (
              <TableConfigColumnsItem
                key={column.identifier}
                column={column}
                isDragging={column.identifier === draggingId}
                toggleVisibility={updateColumnVisibility}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </>
  );
};

// ────────────────────────────────────────────────
// TableConfigColumnsItem
// ────────────────────────────────────────────────

type TypeTableConfigColumnsItemProps = {
  column: TColumn;
  isDragging: boolean;
  toggleVisibility: (identifier: string, visible: boolean) => void;
};

const TableConfigColumnsItem: FC<TypeTableConfigColumnsItemProps> = memo(({ column, isDragging, toggleVisibility }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: column.identifier });

  const handleVisibilityChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    toggleVisibility(column.identifier, e.target.checked);
  }, [column.identifier, toggleVisibility]);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${styles.ListItem} ${isDragging ? styles.dragging : ''}`}
    >
      <div {...listeners} {...attributes} className={styles.DragAndDrop} title="Переместить">
        <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
      </div>
      <div className={styles.CheckboxWrapper}>
        <input
          type="checkbox"
          id={`column-visibility-${column.identifier}`}
          checked={column.visible}
          onChange={handleVisibilityChange}
        />
        <label htmlFor={`column-visibility-${column.identifier}`}>{getTranslateColumn(column)}</label>
      </div>
    </li>
  );
});

// ────────────────────────────────────────────────
// FieldDateRange - модальный компонент фильтра по датам
// ────────────────────────────────────────────────

// Форматирование datetime-local строки в читаемый вид (DD.MM.YYYY HH:MM)
function formatDateTimeRu(dateStr: string): string {
  if (!dateStr) return '';
  // Поддерживаем оба формата: "YYYY-MM-DD" и "YYYY-MM-DDTHH:MM"
  const [datePart, timePart] = dateStr.split('T');
  const [y, m, d] = datePart.split('-');
  const date = `${d}.${m}.${y}`;
  return timePart ? `${date} ${timePart}` : date;
}

// Строка активного периода — ссылка между панелью и таблицей
const DateRangeBar = memo(({ startDate, endDate, onClick, onClear }: {
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
      <span className={styles.DateRangeBarLabel}>Период:</span>
      <a className={styles.DateRangeLink} onClick={onClick} title="Изменить период">{label}</a>
      <Toolbar.CloseButton onClick={onClear} title="Сбросить период" />
    </div>
  );
});

DateRangeBar.displayName = 'DateRangeBar';

// Модальная форма выбора периода
const FieldDateRangeModal = memo(({ method, startDate, endDate, onApply }: {
  method: TypeFormMethod;
  startDate: string;
  endDate: string;
  onApply: (start: string, end: string) => void;
}) => {
  // Добавляет время по умолчанию к дате (только если дата непустая)
  const withDefaultTime = (val: string, defaultTime: string) => {
    if (!val) return '';
    return val.includes('T') ? val : `${val}T${defaultTime}`;
  };

  // Извлекает только дату из datetime-local строки
  const getDatePart = (val: string) => val ? val.split('T')[0] : '';

  const [localStart, setLocalStart] = useState(() => withDefaultTime(startDate, '00:00'));
  const [localEnd, setLocalEnd] = useState(() => withDefaultTime(endDate, '23:59'));

  // Синхронизация при открытии
  useEffect(() => {
    setLocalStart(withDefaultTime(startDate, '00:00'));
    setLocalEnd(withDefaultTime(endDate, '23:59'));
  }, [startDate, endDate]);

  // При выборе даты «С» — если дата новая или была пустой, подставляем 00:00
  const handleStartChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) { setLocalStart(''); return; }
    setLocalStart(prev => {
      if (!prev) return `${getDatePart(val)}T00:00`; // первый выбор — ставим 00:00
      const prevDate = getDatePart(prev);
      const newDate = getDatePart(val);
      if (prevDate !== newDate) return `${newDate}T00:00`; // дата изменилась — ставим 00:00
      return val; // дата та же — пользователь менял время
    });
  }, []);

  // При выборе даты «По» — если дата новая или была пустой, подставляем 23:59
  const handleEndChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) { setLocalEnd(''); return; }
    setLocalEnd(prev => {
      if (!prev) return `${getDatePart(val)}T23:59`; // первый выбор — ставим 23:59
      const prevDate = getDatePart(prev);
      const newDate = getDatePart(val);
      if (prevDate !== newDate) return `${newDate}T23:59`; // дата изменилась — ставим 23:59
      return val;
    });
  }, []);

  const handleApply = useCallback(() => {
    onApply(localStart, localEnd);
  }, [onApply, localStart, localEnd]);

  return (
    <Modal
      method={method}
      onApply={handleApply}
      title="Период"
      className={styles.DateRangeModal}
    >
      <div className={`${styles.FilterGroup} ${styles.DateRangeFilterGroup}`}>
        <div className={styles.SearchContainer}>
          <input
            type="datetime-local"
            value={localStart}
            onChange={handleStartChange}
            className={styles.SearchInput}
          />
          <input
            type="datetime-local"
            value={localEnd}
            onChange={handleEndChange}
            className={styles.SearchInput}
          />
        </div>
      </div>
    </Modal>
  );
});

FieldDateRangeModal.displayName = 'FieldDateRangeModal';

// ────────────────────────────────────────────────
// FieldFastSearch - встроенный компонент быстрого поиска
// ────────────────────────────────────────────────

const FieldFastSearchInternal = memo(({ value, onChange }: {
  value: string;
  onChange: (value: string) => void;
}) => {
  const [inputValue, setInputValue] = useState(value);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Синхронизируем внешние изменения
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleChange = useCallback((newValue: string) => {
    setInputValue(newValue);

    // Отменяем предыдущий таймер
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Устанавливаем новый таймер (300ms debounce для виртуального скролла)
    debounceTimerRef.current = setTimeout(() => {
      onChange(newValue);
      debounceTimerRef.current = null;
    }, 300);
  }, [onChange]);

  const handleClear = useCallback(() => {
    setInputValue('');
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    onChange('');
  }, [onChange]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return (
    <Field
      name="fastSearch"
      value={inputValue}
      onChange={(e) => handleChange(e.target.value)}
      placeholder="Быстрый поиск"
      autoFocus
      actions={[{ type: 'clear', onClick: handleClear }]}
    />
  );
}, (prevProps, nextProps) => {
  // Custom comparison для memo
  return (
    prevProps.value === nextProps.value &&
    prevProps.onChange === nextProps.onChange
  );
});

FieldFastSearchInternal.displayName = 'FieldFastSearch';

export default Table;
