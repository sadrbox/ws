import styles from './Table.module.scss';
import { GLOBAL_ADAPTIVE_LIMIT_REF } from 'src/hooks/useInfiniteModelList';

import {
  TColumn,
  TDataItem,
  TypeFormAction,
  TypeFormMethod,
  TypeModalFormProps,
} from './types';

import { getTranslateColumn } from 'src/i18';
import { getFormatColumnValue, getTextAlignByColumnType } from './services';

import { Divider } from '../Field';
import Modal from '../Modal';
import { Group } from 'src/components/UI';
import { Button, ButtonImage } from '../Button';

import settingsForm_16 from '../../assets/form-setting_16.png';
import reloadImage_16 from '../../assets/reload_16.png';
import calendar_16 from '../../assets/calendar_16.png';
import searchField_16 from '../../assets/search-field_16.png';

import { DndContext, closestCenter } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PiDotsThreeVerticalDuotone } from 'react-icons/pi';

import {
  createContext,
  Dispatch,
  FC,
  memo,
  PropsWithChildren,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
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
}

const ROW_HEIGHT = 30;  // ← ИСПРАВИЛ: было 28, должно быть 30
const OVERSCAN = 8;

// ────────────────────────────────────────────────
// TableControlPanel - мемоизированная панель управления
// ────────────────────────────────────────────────

interface TableControlPanelProps {
  variant: TTableVariant;
  enableDateRange: boolean;
  isLoading: boolean;
  visibleDateRange: boolean;
  visibleFastSearch: boolean;
  onConfigOpen: () => void;
  onDateRangeToggle: () => void;
  onSearchToggle: () => void;
  onRefresh: () => void;
  onAddClick: () => void;
  onDeleteClick: () => void;
  search: { value: string; onChange: (value: string) => void };
}

const TableControlPanel = memo(({
  variant,
  enableDateRange,
  isLoading,
  visibleDateRange,
  visibleFastSearch,
  onConfigOpen,
  onDateRangeToggle,
  onSearchToggle,
  onRefresh,
  onAddClick,
  onDeleteClick,
  search,
}: TableControlPanelProps) => {
  const isSelect = variant === 'select';
  return (
    <div className={styles.TablePanel}>
      <div className={styles.TablePanelLeft}>
        <div className={[styles.colGroup, styles.gap6].join(' ')} style={{ justifyContent: 'flex-start' }}>
          {/* <Divider /> */}
          {!isSelect && <Button onClick={onAddClick}><span>Добавить</span></Button>}
          {!isSelect && <Button onClick={onDeleteClick}><span>Удалить</span></Button>}
          {!isSelect && <Divider />}
          <ButtonImage onClick={onRefresh} title="Обновить">
            <img src={reloadImage_16} alt="Reload" height={16} width={16}
              className={isLoading ? styles.animationLoop : ''} />
          </ButtonImage>
          <ButtonImage onClick={onConfigOpen} title="Настройки колонок">
            <img src={settingsForm_16} alt="Settings" height={16} width={16} />
          </ButtonImage>
          <Divider />
          {enableDateRange && (
            <ButtonImage onClick={onDateRangeToggle} active={visibleDateRange} title="Период">
              <img src={calendar_16} alt="Calendar" height={16} width={16} />
            </ButtonImage>
          )}
          <ButtonImage onClick={onSearchToggle} active={visibleFastSearch} title="Поиск">
            <img src={searchField_16} alt="Search" height={16} width={16} />
          </ButtonImage>
          <Divider />
        </div>
      </div>
      {visibleFastSearch && (
        <div className={styles.TablePanelRight}>
          <FieldFastSearchInternal value={search.value} onChange={search.onChange} />
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.variant === nextProps.variant &&
    prevProps.enableDateRange === nextProps.enableDateRange &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.visibleDateRange === nextProps.visibleDateRange &&
    prevProps.visibleFastSearch === nextProps.visibleFastSearch &&
    prevProps.search === nextProps.search
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
  } = props;


  const { openModelForm, refetch } = actions;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [isAllSelectedMode, setIsAllSelectedMode] = useState<boolean>(false);
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set());
  const [configModalAction, setConfigModalAction] = useState<TypeFormAction>('');
  const [dateRangeModalAction, setDateRangeModalAction] = useState<TypeFormAction>('');
  const [visibleFastSearch, setVisibleFastSearch] = useState(false);

  // Текущие значения dateRange из фильтров
  const currentStartDate = (filtering.filters?.dateRange as any)?.startDate as string || '';
  const currentEndDate = (filtering.filters?.dateRange as any)?.endDate as string || '';
  const hasDateRange = !!(currentStartDate || currentEndDate);

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
      scrollRef,
      states: {
        selectedRows, setSelectedRows,
        isAllSelectedMode, setIsAllSelectedMode,
        excludedRows, setExcludedRows,
        activeRow, setActiveRow,
      },
    }),
    [
      variant, onSelectItem,
      componentName, rows, columns, total, totalPages,
      isLoading, error,
      pagination, sorting, filtering, search, extendedActions,
      hasNextPage, isFetchingNextPage,
      selectedRows, isAllSelectedMode, excludedRows, activeRow,
    ]
  );

  const handleCreate = useCallback(() => {
    if (openModelForm) openModelForm({ onSave: refetch, onClose: () => { } });
  }, [openModelForm, refetch]);

  // onRefresh — обновляет данные.
  // isAllSelectedMode, selectedRows и excludedRows НЕ сбрасываем:
  // строки с теми же ID после перезагрузки сохранят своё состояние выделения.
  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleDeleteClick = useCallback(() => {
    alert('Удалить выбранные');
  }, []);

  const handleConfigOpen = useCallback(() => {
    setConfigModalAction('open');
  }, []);

  const handleDateRangeToggle = useCallback(() => {
    // Кнопка "Период" в панели открывает модальное окно
    setDateRangeModalAction('open');
  }, []);

  const handleSearchToggle = useCallback(() => {
    setVisibleFastSearch(v => !v);
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
          enableDateRange={enableDateRange}
          isLoading={isLoading}
          visibleDateRange={hasDateRange}
          visibleFastSearch={visibleFastSearch}
          onConfigOpen={handleConfigOpen}
          onDateRangeToggle={handleDateRangeToggle}
          onSearchToggle={handleSearchToggle}
          onRefresh={handleRefresh}
          onAddClick={handleCreate}
          onDeleteClick={handleDeleteClick}
          search={search}
        />

        {enableDateRange && hasDateRange && (
          <DateRangeBar
            startDate={currentStartDate}
            endDate={currentEndDate}
            onClick={handleDateRangeBarClick}
            onClear={handleDateRangeClear}
          />
        )}

        <div className={styles.TableScrollContainer}>
          <div ref={scrollRef} className={styles.TableScrollWrapper} style={{ overflowAnchor: 'none' }}>
            <TableArea />
          </div>
          {(isLoading || isFetchingNextPage) && (
            <div className={styles.TableLoadingOverlay}>
              <div className={styles.TableSpinner} />
            </div>
          )}
        </div>
        {/* <TableStatusBar /> */}
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
  return (
    <>
      <table>
        <colgroup>
          {!isSelect && <col style={{ width: '30px', maxWidth: '30px', minWidth: '30px' }} />}
          {visibleColumns.slice(0, -1).map(col => (
            <col key={col.identifier}
              style={{ width: col.width ?? 'auto', minWidth: col.minWidth ?? '150px' }} />
          ))}
          {visibleColumns.length > 0 && (
            <col
              key={visibleColumns[visibleColumns.length - 1].identifier + '-last'}
              style={{ minWidth: '150px', width: 'auto' }}
            />
          )}
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
// TableStatusBar — строка состояния (снаружи скролла, всегда внизу)
// ────────────────────────────────────────────────

const TableStatusBar = memo(() => {
  const {
    total,
    states: { selectedRows, isAllSelectedMode, excludedRows },
  } = useTableContext();

  const selectedCount = isAllSelectedMode
    ? total - excludedRows.size
    : selectedRows.size;

  if (selectedCount === 0) return null;

  return (
    <div className={styles.TableStatusBar}>
      <div className={styles.TableStatusCell}>
        <span>
          Выбрано:{' '}
          <span className={styles.TableStatusSelected}>
            {selectedCount.toLocaleString('ru-RU')}
          </span>
          {' из '}
          {total.toLocaleString('ru-RU')}
        </span>
      </div>
    </div>
  );
});

TableStatusBar.displayName = 'TableStatusBar';

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
    return rows.length > 0 && rows.every(r => selectedRows.has(r.id as number));
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
      const updatedColumns = columns.map(c =>
        c.identifier === col.identifier ? { ...c, width: newWidth + 'px' } : c
      );
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
          <th style={{ width: '30px', textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
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
          return (
            <th key={col.identifier} style={{ cursor: `${isLoading ? 'default' : 'pointer'}` }} onClick={!isLoading ? () => handleSort(col.identifier) : undefined}>
              <div className={styles.TableHeaderCell}>
                <span>{getTranslateColumn(col)}</span>
                {isSorting && (
                  <svg style={{ transform: dir === 'desc' ? 'scaleY(-1)' : 'none' }}
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
        <tr>
          <td colSpan={visibleColumns.length + (variant !== 'select' ? 1 : 0)} />
        </tr>
      </tbody>
    );
  }

  return (
    <tbody
      // className={isLoading ? styles.blur5 : ''}
      style={{
        willChange: 'transform',
        transform: 'translate3d(0, 0, 0)',
      }}
    >
      {topPaddingAll > 0 && (
        <tr style={{ height: `${topPaddingAll}px`, border: '0px' }}>
          <td colSpan={visibleColumns.length + (variant !== 'select' ? 1 : 0)} />
        </tr>
      )}

      {visibleRows.map((row, visibleIndex) => (
        <TableBodyRow
          key={row.id ?? `row-${row.id}`}
          row={row}
          columns={visibleColumns}
          rowIndex={startIndexVirtual + visibleIndex}
        />
      ))}

      {bottomPaddingAll > 0 && (
        <tr style={{ height: `${bottomPaddingAll}px`, border: '0px' }}>
          <td colSpan={visibleColumns.length + (variant !== 'select' ? 1 : 0)} >

          </td>
        </tr>
      )}
    </tbody>
  );
});

// ────────────────────────────────────────────────
// TableBodyRow
// ────────────────────────────────────────────────

interface TableBodyRowProps {
  row: TDataItem;
  columns: TColumn[];
  rowIndex: number;
}


const TableBodyRow: FC<TableBodyRowProps> = memo(({ row, columns }) => {
  const {
    variant,
    onSelectItem,
    rows,
    states: {
      activeRow, setActiveRow,
      selectedRows, setSelectedRows,
      isAllSelectedMode, setIsAllSelectedMode,
      excludedRows, setExcludedRows,
    },
    actions: { openModelForm, refetch },
    isLoading,
  } = useTableContext();

  const isActive = activeRow === (row.id as number);

  // Строка выбрана если:
  // 1. Режим "все" И строка НЕ в исключениях
  // 2. Или обычный режим И строка в selectedRows
  const isSelected = isAllSelectedMode
    ? !excludedRows.has(row.id as number)
    : selectedRows.has(row.id as number);

  const toggleSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const id = row.id as number;
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
        const allLoadedIds = rows.map(r => r.id as number);
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

  const handleRowClick = useCallback(() => {
    setActiveRow?.(row.id as number);
  }, [setActiveRow, row.id]);

  const handleDoubleClick = useCallback(() => {
    if (variant === 'select' && onSelectItem) {
      onSelectItem(row);
    } else if (openModelForm) {
      openModelForm({ data: row, onSave: refetch, onClose: () => { } });
    }
  }, [variant, onSelectItem, openModelForm, row, refetch]);

  return (
    <tr
      onClick={handleRowClick}
      onDoubleClick={handleDoubleClick}
      className={[isActive && styles.activeRow].filter(r => !!r).join(' ')}
      style={{
        willChange: isActive ? 'background-color, box-shadow' : 'auto',
        transform: 'translate3d(0, 0, 0)',
        opacity: isLoading ? 0.3 : 1,
        pointerEvents: isLoading ? 'none' : 'auto',
      }}
    >
      {variant !== 'select' && (
        <td style={{ textAlign: 'center' }}>
          <div className={styles.TableBodyCell} style={{ justifyContent: 'center' }}>
            <input type="checkbox" checked={isSelected} onChange={toggleSelect} disabled={isLoading} />
          </div>
        </td>
      )}
      {columns.map(col => {
        const value = getFormatColumnValue(row, col);
        const align = getTextAlignByColumnType(col);
        return (
          <td key={col.identifier}>
            <div
              style={{
                ...align,
                willChange: 'contents',
                transform: 'translate3d(0, 0, 0)',
              }}
              className={styles.TableBodyCell}
            >
              <span>{value}</span>
            </div>
          </td>
        );
      })}
    </tr>
  );
});

// ────────────────────────────────────────────────
// TableConfigModalForm
// ────────────────────────────────────────────────

const TableConfigModalForm: FC<TypeModalFormProps> = ({ method }) => {
  const { columns, componentName, actions } = useTableContext();
  const [columnsConfig, setColumnsConfig] = useState<TColumn[]>(columns);

  const onApply = useCallback(() => {
    localStorage.setItem(`table_columns_${componentName}`, JSON.stringify(columnsConfig));
    actions?.setColumns?.(columnsConfig);
  }, [columnsConfig, componentName, actions]);

  useEffect(() => { setColumnsConfig(columns); }, [columns]);

  return (
    <Modal title="Колонки таблицы" method={method} onApply={onApply} style={{ width: '400px' }}>
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
            {columns.filter(col => col.inlist).map(column => (
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
      <button className={styles.ClearButton} onClick={onClear} title="Сбросить период">✕</button>
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
      style={{ maxWidth: 400 }}
    >
      <div className={styles.FilterGroup} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
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
    <div className={styles.FilterGroup}>
      <div className={styles.SearchContainer}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Быстрый поиск по всем полям"
          className={styles.SearchInput}
        // title="Быстрый поиск по всем полям"
        />
        <button
          onClick={handleClear}
          className={styles.ClearButton}
        // title="Очистить поиск"
        >
          ✕
        </button>
      </div>
    </div>
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
