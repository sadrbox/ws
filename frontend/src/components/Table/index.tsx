import styles from './Table.module.scss';

import {
  TColumn,
  TDataItem,
  TypeFormAction,
  TypeModalFormProps,
} from './types';

import { getTranslateColumn } from 'src/app/i18';
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
  useMemo,
  useRef,
  useState,
} from 'react';
import { TPane } from 'src/app/types';

export type TOpenModelFormProps = Partial<TPane>;
export type TypeModelProps = TableContextProps;

// ────────────────────────────────────────────────
// Context
// ────────────────────────────────────────────────

export interface TableContextProps {
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

const ROW_HEIGHT = 28;
const OVERSCAN = 8;

// ────────────────────────────────────────────────
// TableControlPanel - мемоизированная панель управления
// ────────────────────────────────────────────────

interface TableControlPanelProps {
  isLoading: boolean;
  visibleDateRange: boolean;
  visibleFastSearch: boolean;
  onConfigOpen: () => void;
  onDateRangeToggle: () => void;
  onSearchToggle: () => void;
  onRefresh: () => void;
  onAddClick: () => void;
  onDeleteClick: () => void;
  filtering: { filters?: Record<string, { value: unknown; operator: string }>; onFilterChange: (field: string, value: unknown, operator?: string) => void };
  search: { value: string; onChange: (value: string) => void };
}

const TableControlPanel = memo(({
  isLoading,
  visibleDateRange,
  visibleFastSearch,
  onConfigOpen,
  onDateRangeToggle,
  onSearchToggle,
  onRefresh,
  onAddClick,
  onDeleteClick,
  filtering,
  search,
}: TableControlPanelProps) => {
  return (
    <div className={styles.TablePanel}>
      <div className={styles.TablePanelLeft}>
        <div className={[styles.colGroup, styles.gap6].join(' ')} style={{ justifyContent: 'flex-start' }}>
          <Divider />
          <Button onClick={onAddClick}><span>Добавить</span></Button>
          <Button onClick={onDeleteClick}><span>Удалить</span></Button>
          <Divider />
          <ButtonImage onClick={onRefresh} title="Обновить">
            <img src={reloadImage_16} alt="Reload" height={16} width={16}
              className={isLoading ? styles.animationLoop : ''} />
          </ButtonImage>
          <ButtonImage onClick={onConfigOpen} title="Настройки колонок">
            <img src={settingsForm_16} alt="Settings" height={16} width={16} />
          </ButtonImage>
          <Divider />
          <ButtonImage onClick={onDateRangeToggle} active={visibleDateRange} title="Период">
            <img src={calendar_16} alt="Calendar" height={16} width={16} />
          </ButtonImage>
          <ButtonImage onClick={onSearchToggle} active={visibleFastSearch} title="Поиск">
            <img src={searchField_16} alt="Search" height={16} width={16} />
          </ButtonImage>
          <Divider />
        </div>
      </div>
      {(visibleDateRange || visibleFastSearch) && (
        <div className={styles.TablePanelRight}>
          {visibleDateRange && <FieldDateRangeInternal filters={filtering.filters} onFilterChange={filtering.onFilterChange} />}
          {visibleFastSearch && <FieldFastSearchInternal value={search.value} onChange={search.onChange} />}
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - пересоздавать только если изменились важные свойства
  return (
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.visibleDateRange === nextProps.visibleDateRange &&
    prevProps.visibleFastSearch === nextProps.visibleFastSearch &&
    prevProps.filtering === nextProps.filtering &&
    prevProps.search === nextProps.search
  );
});

TableControlPanel.displayName = 'TableControlPanel';

// ────────────────────────────────────────────────
// Table
// ────────────────────────────────────────────────

const Table: FC<TableProps> = memo((props) => {
  console.log(`[Table] render: rows.length=${props.rows?.length ?? 0}`);
  const {
    componentName, rows, columns, total, totalPages,
    isLoading, error,
    pagination, sorting, filtering, search, actions,
    hasNextPage, isFetchingNextPage,
  } = props;


  const { openModelForm, refetch } = actions;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [configModalAction, setConfigModalAction] = useState<TypeFormAction>('');
  const [visibleDateRange, setVisibleDateRange] = useState(false);
  const [visibleFastSearch, setVisibleFastSearch] = useState(false);

  // extendedActions уже включают setAdaptiveLimit от родителя
  const extendedActions = useMemo(
    () => ({
      ...actions,
    }),
    [actions]
  );

  const contextValue = useMemo<TableContextProps>(
    () => ({
      componentName, rows, deferredRowsForRender: rows, columns, total, totalPages,
      isLoading, error,
      pagination, sorting, filtering, search,
      actions: extendedActions,
      hasNextPage, isFetchingNextPage,
      scrollRef,
      states: { selectedRows, setSelectedRows, activeRow, setActiveRow },
    }),
    [
      componentName, rows, columns, total, totalPages,
      isLoading, error,
      pagination, sorting, filtering, search, extendedActions,
      hasNextPage, isFetchingNextPage,
      selectedRows, activeRow,
    ]
  );
  // console.log(isLoading, isFetching)

  const handleCreate = useCallback(() => {
    if (openModelForm) openModelForm({ onSave: refetch, onClose: () => { } });
  }, [openModelForm, refetch]);

  const handleDeleteClick = useCallback(() => {
    alert('Удалить выбранные');
  }, []);

  const handleConfigOpen = useCallback(() => {
    setConfigModalAction('open');
  }, []);

  const handleDateRangeToggle = useCallback(() => {
    setVisibleDateRange(v => !v);
  }, []);

  const handleSearchToggle = useCallback(() => {
    setVisibleFastSearch(v => !v);
  }, []);

  return (
    <TableContextProvider value={contextValue}>
      {configModalAction === 'open' && (
        <TableConfigModalForm method={{ get: configModalAction, set: setConfigModalAction }} />
      )}

      <div className={styles.TableWrapper}>
        <TableControlPanel
          isLoading={isLoading}
          visibleDateRange={visibleDateRange}
          visibleFastSearch={visibleFastSearch}
          onConfigOpen={handleConfigOpen}
          onDateRangeToggle={handleDateRangeToggle}
          onSearchToggle={handleSearchToggle}
          onRefresh={refetch}
          onAddClick={handleCreate}
          onDeleteClick={handleDeleteClick}
          filtering={filtering}
          search={search}
        />

        <div ref={scrollRef} className={styles.TableScrollWrapper}>
          <TableArea />
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
  const { columns } = useTableContext();
  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);
  // console.log(isFetchi`ngNextPage)
  return (
    <>
      <table>
        <colgroup>
          <col style={{ width: '30px', maxWidth: '30px', minWidth: '30px' }} />
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
      </table>
      {/* {isLoading && (
        <div className={styles["table-loading-spinner"]}>
          <div className={styles.spinner}></div>
          <span>Загрузка...</span>
        </div>
      )} */}
    </>
  );
});

// ────────────────────────────────────────────────
// TableHeader
// ────────────────────────────────────────────────

const TableHeader = memo(() => {
  const {
    columns, rows,
    sorting: { sort, onSortChange },
    states: { selectedRows, setSelectedRows },
    isLoading,
  } = useTableContext();

  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);

  const isAllSelected = useMemo(
    () => {
      // Проверяем, все ли ЗАГРУЖЕННЫЕ строки выбраны
      // (не все возможные, а только те что загружены в текущий момент)
      return rows.length > 0 && rows.every(r => selectedRows.has(r.id as number));
    },
    [rows, selectedRows]
  );

  const toggleAll = useCallback(() => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (isAllSelected) {
        // Снимаем выделение со всех загруженных строк
        rows.forEach(r => next.delete(r.id as number));
      } else {
        // Выделяем все загруженные строки
        rows.forEach(r => next.add(r.id as number));
      }
      return next;
    });
  }, [isAllSelected, rows, setSelectedRows]);

  const handleSort = useCallback((field: string) => {
    const newDir = sort[field] === 'asc' ? 'desc' : 'asc';
    onSortChange({ [field]: newDir });
  }, [sort, onSortChange]);

  return (
    <thead>
      <tr>
        <th style={{ width: '30px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <input type="checkbox" checked={isAllSelected} onChange={toggleAll}
              disabled={isLoading || rows.length === 0} />
          </div>
        </th>
        {visibleColumns.map(col => {
          const isSorting = !!(sort && sort[col.identifier]);
          const dir = isSorting ? sort[col.identifier] : null;
          return (
            <th key={col.identifier} style={{ cursor: 'pointer' }} onClick={() => handleSort(col.identifier)}>
              <div className={styles.TableHeaderCell}>
                <span>{getTranslateColumn(col)}</span>
                {isSorting && (
                  <svg style={{ transform: dir === 'desc' ? 'scaleY(-1)' : 'none' }}
                    width="24px" height="24px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <g><path fill="none" d="M0 0h24v24H0z" /><path d="M12 14l-4-4h8z" /></g>
                  </svg>
                )}
              </div>
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
    rows, deferredRowsForRender, columns, isLoading, total,
    isFetchingNextPage, hasNextPage,
    actions, scrollRef,
  } = useTableContext();

  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(scrollRef.current?.clientHeight ?? 0);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  // ⚠️ Отслеживаем последний установленный лимит чтобы не вызывать setAdaptiveLimit без необходимости
  // Это предотвращает отмену запросов при быстром скроле
  const lastAdaptiveLimitRef = useRef<number>(500);
  // ⚠️ Отслеживаем, для скольких строк уже был выполнен запрос на подгрузку
  // Предотвращает повторные запросы при одном и том же триггере
  const lastFetchedAtRowCountRef = useRef<number>(0);
  // ⚠️ Отслеживаем предыдущую позицию скролла для вычисления разницы
  // Нужно для определения размера прыжка скролла
  const previousScrollDistanceRef = useRef<number>(0);
  // ⚠️ Отслеживаем последний запрошенный курсор и лимит
  // Если запросили с большим лимитом, не запрашиваем снова для того же диапазона
  const lastRequestedCursorRef = useRef<number>(0);
  const lastRequestedLimitRef = useRef<number>(0);

  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);

  // ── Единая функция проверки необходимости подгрузки ──
  const checkAndFetch = useCallback(() => {
    const el = scrollRef.current;
    // console.log(`[checkAndFetch] el=${!!el}, hasNextPage=${hasNextPage}, isFetchingNextPage=${isFetchingNextPage}`);
    if (!el || !hasNextPage || isFetchingNextPage) return;

    // Вычисляем какой диапазон строк видно в viewport
    const currentViewEnd = Math.ceil((el.scrollTop + el.clientHeight) / ROW_HEIGHT);
    const loadedRowsCount = rows.length;
    const currentScrollDistanceInRows = Math.floor(el.scrollTop / ROW_HEIGHT);
    const scrollDeltaInRows = Math.abs(currentScrollDistanceInRows - previousScrollDistanceRef.current);

    // ⚠️ ДИНАМИЧЕСКАЯ ЗАГРУЗКА НА ОСНОВЕ РАЗНИЦЫ СКРОЛЛА:
    // Стандартная загрузка: 500 строк
    // При прыжке: используем высоту прыжка как лимит
    // Триггер: при достижении первых 50 строк каждой новой порции
    const LOAD_SIZE_NORMAL = 500;  // Стандартная загрузка: 500 строк
    const SCROLL_JUMP_THRESHOLD = 500;  // Порог прыжка скролла (в строках)
    const FETCH_TRIGGER_ROW = 50;  // Триггер подгрузки при достижении строки 50 каждой порции

    // Вычисляем позицию триггера для текущей порции
    // Каждая порция по 500 строк, триггер срабатывает при первых 50 строках порции
    // Начальная порция: строки 0-500 → триггер при 50
    // Вторая порция: строки 500-1000 → триггер при 550 (500+50)
    // Третья порция: строки 1000-1500 → триггер при 1050 (1000+50)
    const portionsCount = Math.ceil(loadedRowsCount / LOAD_SIZE_NORMAL);
    const currentPortionStartRow = (portionsCount - 1) * LOAD_SIZE_NORMAL;
    const fetchTriggerRow = currentPortionStartRow + FETCH_TRIGGER_ROW;

    // Условие для загрузки: если видимая строка >= позиция триггера текущей порции
    if (currentViewEnd >= fetchTriggerRow && hasNextPage) {
      const fetchNextPage = actions.fetchNextPage;
      if (fetchNextPage) {
        // ⚠️ Если уже был запрос для текущего количества строк, пропускаем
        // Это предотвращает повторные запросы при быстром скроле одной и той же области
        if (loadedRowsCount === lastFetchedAtRowCountRef.current) {
          return;
        }

        // ⚠️ Проверяем: нужно ли нам загружать дополнительные данные?
        // Если последний запрос охватил нужный диапазон, пропускаем
        // Курсор обычно = loadedRowsCount (начало новой порции)
        const nextCursor = loadedRowsCount;

        // Если последний запрос покрывал этот диапазон, не запрашиваем заново
        // lastRequestedCursor + lastRequestedLimit = конец последнего запроса
        // Если nextCursor < конец последнего запроса, значит данные уже в кэше
        if (nextCursor < lastRequestedCursorRef.current + lastRequestedLimitRef.current) {
          return;
        }

        // ⚠️ Отметим, что уже выполняем запрос для текущего количества строк
        lastFetchedAtRowCountRef.current = loadedRowsCount;

        // Определяем размер загрузки на основе разницы скролла
        let newAdaptiveLimit = LOAD_SIZE_NORMAL;  // По умолчанию 500

        // Если разница скролла > порога → используем эту разницу как лимит
        if (scrollDeltaInRows > SCROLL_JUMP_THRESHOLD) {
          newAdaptiveLimit = scrollDeltaInRows;
        }

        // ⚠️ КРИТИЧНО: Установим лимит ДО вызова fetchNextPage
        // Это гарантирует, что запрос будет с правильным лимитом с первой попытки
        if (newAdaptiveLimit !== lastAdaptiveLimitRef.current) {
          lastAdaptiveLimitRef.current = newAdaptiveLimit;

          // Обновляем адаптивный лимит в контексте ПЕРЕД fetchNextPage
          if (actions.setAdaptiveLimit) {
            actions.setAdaptiveLimit(newAdaptiveLimit);
          }
        }

        // ⚠️ Сохраняем курсор и лимит текущего запроса для проверки кэша
        lastRequestedCursorRef.current = nextCursor;
        lastRequestedLimitRef.current = newAdaptiveLimit;

        // ⚠️ Обновляем предыдущую позицию скролла ПОСЛЕ вычисления разницы
        previousScrollDistanceRef.current = currentScrollDistanceInRows;

        // Вызываем fetchNextPage с установленным лимитом
        // Лимит уже установлен выше через setAdaptiveLimit
        setTimeout(() => {
          fetchNextPage();
        }, 0);
      }
    }
  }, [hasNextPage, isFetchingNextPage, actions, scrollRef, rows.length]);  // ── Дебаунсированная версия checkAndFetch
  const debouncedCheckAndFetch = useCallback(() => {
    // Отменяем предыдущий таймер если есть
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Устанавливаем новый таймер с задержкой
    debounceTimerRef.current = setTimeout(() => {
      checkAndFetch();
      debounceTimerRef.current = null;
    }, 150); // 150ms задержка - оптимальный баланс
  }, [checkAndFetch]);

  // ── Подписка на события ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      setScrollTop(el.scrollTop);
      debouncedCheckAndFetch();
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
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [scrollRef, debouncedCheckAndFetch]);

  // Проверка при изменении количества строк (когда пришла новая порция)
  useEffect(() => {
    checkAndFetch();
  }, [rows.length, checkAndFetch]);

  // ── Расчет виртуализации НА ОСНОВЕ ВСЕХ СТРОК В БД ──
  // total = количество всех строк в БД
  // ── Расчет виртуализации ──
  // Используем deferredRowsForRender для определения видимых строк
  const loadedCount = deferredRowsForRender.length;

  // Рассчитываем окно просмотра на основе высоты контейнера
  // ⚠️ Защита: если containerHeight еще не инициализирована, используем fallback
  const effectiveContainerHeight = containerHeight > 0 ? containerHeight : 600;

  const startIndexVirtual = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndexVirtual = Math.min(
    loadedCount,
    Math.ceil((scrollTop + effectiveContainerHeight) / ROW_HEIGHT) + OVERSCAN
  );

  // Видимые строки в контексте дефёрредного рендера
  const visibleRows = useMemo(() => {
    return deferredRowsForRender.slice(startIndexVirtual, endIndexVirtual);
  }, [deferredRowsForRender, startIndexVirtual, endIndexVirtual]);

  // Padding для правильного скроллинга
  // ⚠️ topPadding: сколько строк ПЕРЕД окном (в контексте загруженных)
  // ⚠️ bottomPadding: сколько строк ПОСЛЕ окна в контексте ВСЕХ строк в БД!
  const topPaddingAll = startIndexVirtual * ROW_HEIGHT;
  const bottomPaddingAll = Math.max(0, (total - endIndexVirtual) * ROW_HEIGHT);

  // DEBUG
  console.log(`[TableBody] render: loadedCount=${loadedCount}, startIdx=${startIndexVirtual}, endIdx=${endIndexVirtual}, visibleRows=${visibleRows.length}, containerHeight=${containerHeight}, effectiveHeight=${effectiveContainerHeight}`);

  // ── Рендер ──
  if (!isLoading && rows.length === 0) {
    console.log(`[TableBody] "Нет данных" condition: isLoading=${isLoading}, rows.length=${rows.length}`);
    return (
      <tbody>
        <tr>
          <td colSpan={visibleColumns.length + 1} style={{ textAlign: 'center', padding: '40px' }}>
            Нет данных
          </td>
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
          <td colSpan={visibleColumns.length + 1} />
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
          <td colSpan={visibleColumns.length + 1} />
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
    states: { activeRow, setActiveRow, selectedRows, setSelectedRows },
    actions: { openModelForm, refetch },
    isLoading,
  } = useTableContext();

  const isActive = activeRow === (row.id as number);
  const isSelected = selectedRows.has(row.id as number);

  const toggleSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (e.target.checked) next.add(row.id as number);
      else next.delete(row.id as number);
      return next;
    });
  }, [row.id, setSelectedRows]);

  const handleRowClick = useCallback(() => {
    setActiveRow?.(row.id as number);
  }, [setActiveRow, row.id]);

  const handleDoubleClick = useCallback(() => {
    if (openModelForm) openModelForm({ data: row, onSave: refetch, onClose: () => { } });
  }, [openModelForm, row, refetch]);

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
      <td style={{ textAlign: 'center' }}>
        <div className={styles.TableBodyCell} style={{ justifyContent: 'center' }}>
          <input type="checkbox" checked={isSelected} onChange={toggleSelect} disabled={isLoading} />
        </div>
      </td>
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
    localStorage.setItem(componentName, JSON.stringify(columnsConfig));
    actions?.setColumns?.(columnsConfig);
  }, [columnsConfig, componentName, actions]);

  useEffect(() => { setColumnsConfig(columns); }, [columns]);

  return (
    <Modal title="Настройки таблицы" method={method} onApply={onApply} style={{ width: '400px' }}>
      <Group align='row' type="easy">
        <TableConfigColumns columns={columnsConfig} setColumns={setColumnsConfig} />
      </Group>
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
      <div className={styles.TableConfigListHeader}>
        <div className={styles.TableConfigListHeaderTitle}>Видимость</div>
      </div>
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
// FieldDateRange - встроенный компонент фильтра по датам
// ────────────────────────────────────────────────

const FieldDateRangeInternal = memo(({ filters, onFilterChange }: {
  filters?: Record<string, { value: unknown; operator: string }>;
  onFilterChange: (field: string, value: unknown, operator?: string) => void;
}) => {
  const startDate = filters?.startDate?.value as string | undefined;
  const endDate = filters?.endDate?.value as string | undefined;

  const handleStartDateChange = useCallback((value: string) => {
    onFilterChange('startDate', value || undefined, 'gte');
  }, [onFilterChange]);

  const handleEndDateChange = useCallback((value: string) => {
    onFilterChange('endDate', value || undefined, 'lte');
  }, [onFilterChange]);

  return (
    <div className={styles.FilterGroup}>
      <label>Период:</label>
      <div className={styles.DateRangeContainer}>
        <input
          type="date"
          value={startDate || ''}
          onChange={(e) => handleStartDateChange(e.target.value)}
          placeholder="От"
          className={styles.DateInput}
          title="Дата начала"
        />
        <span className={styles.DateRangeSeparator}>—</span>
        <input
          type="date"
          value={endDate || ''}
          onChange={(e) => handleEndDateChange(e.target.value)}
          placeholder="До"
          className={styles.DateInput}
          title="Дата окончания"
        />
        <button
          onClick={() => {
            handleStartDateChange('');
            handleEndDateChange('');
          }}
          className={styles.ClearButton}
          title="Очистить период"
        >
          ✕
        </button>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison для memo
  return (
    prevProps.filters?.startDate?.value === nextProps.filters?.startDate?.value &&
    prevProps.filters?.endDate?.value === nextProps.filters?.endDate?.value &&
    prevProps.onFilterChange === nextProps.onFilterChange
  );
});

FieldDateRangeInternal.displayName = 'FieldDateRange';

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
      <label>Поиск:</label>
      <div className={styles.SearchContainer}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Введите текст для поиска..."
          className={styles.SearchInput}
          title="Быстрый поиск по всем полям"
        />
        {inputValue && (
          <button
            onClick={handleClear}
            className={styles.ClearButton}
            title="Очистить поиск"
          >
            ✕
          </button>
        )}
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
