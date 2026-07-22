/**
 * Контекст таблицы (T4 — вынесен из Table/index.tsx). Два контекста по P1-сплиту:
 *   TableContext          — стабильные данные/сеттеры/refs (не меняются при навигации);
 *   TableVolatileContext  — высокочастотное состояние выделения/навигации.
 * Разделение убирает «шторм перерисовок» строк при езде активной ячейки (см. P1).
 *
 * index.tsx ре-экспортирует публичную поверхность (useTableContext/useTableVolatile
 * + типы), поэтому внешние импорты `from "src/components/Table"` не ломаются.
 */
import {
  createContext, useContext,
  type FC, type PropsWithChildren, type ReactNode, type RefObject,
  type Dispatch, type SetStateAction,
} from 'react';
import type { TPane } from 'src/app/types';
import type { TColumn, TDataItem } from './types';

export type TTableVariant = 'default' | 'select' | 'embedded';
export type TOpenModelFormProps = Partial<TPane>;

export interface TableContextProps {
  variant: TTableVariant;
  /** false — скрыть колонку чекбоксов выбора строк (напр. таблица-настройка). */
  selectable: boolean;
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
  renderCell?: (row: TDataItem, col: TColumn) => ReactNode | undefined;
  onInlineAdd?: () => void;
  /** Если true — кнопка «Добавить» disabled */
  disableAdd?: boolean;
  /** Если false — скрыть кнопку «Удалить» и чекбоксы выбора строк */
  canDelete?: boolean;

  // ── Refs для inline-editing (не триггерят ререндер contextValue) ───────
  renderCellRef?: RefObject<((row: TDataItem, col: TColumn) => ReactNode | undefined) | undefined>;
  inlineEditingRef?: RefObject<boolean | undefined>;
  /** Метаданные ячейки (error/required) — передаются в CellFieldStateScope для Field-компонентов. */
  getCellMetaRef?: RefObject<
    | ((row: TDataItem, col: TColumn) => { required?: boolean; error?: boolean; errorMessage?: string; errorTooltip?: ReactNode } | null)
    | undefined
  >;
  // ── Expandable rows ────────────────────────────────────────────────────
  /** UUID строк, которые сейчас раскрыты */
  expandedRowIds?: Set<string>;
  /** Функция для рендера содержимого раскрытой строки */
  renderExpandedRow?: (row: TDataItem) => ReactNode;

  // ТОЛЬКО сеттеры (стабильная идентичность). Сами ЗНАЧЕНИЯ выделения/навигации
  // вынесены в отдельный TableVolatileContext — иначе смена activeCell на КАЖДОЕ
  // нажатие стрелки меняла бы contextValue и перерисовывала ВСЕ строки в обход
  // memo (P1: шторм перерисовок). Теперь основной контекст стабилен при навигации.
  states: {
    setSelectedRows: Dispatch<SetStateAction<Set<number>>>;
    setIsAllSelectedMode: Dispatch<SetStateAction<boolean>>;
    setExcludedRows: Dispatch<SetStateAction<Set<number>>>;
    setActiveRow: Dispatch<SetStateAction<number | null>>;
    setActiveCell: Dispatch<SetStateAction<string | null>>;
  };

  scrollRef: RefObject<HTMLDivElement | null>;
}

/** Высокочастотное состояние выделения/навигации — отдельный контекст. */
export interface TableVolatileState {
  selectedRows: Set<number>;
  // true = выбраны ВСЕ строки в БД (кроме excludedRows).
  isAllSelectedMode: boolean;
  excludedRows: Set<number>;
  activeRow: number | null;
  /** Идентификатор активной (выделенной) колонки в строке activeRow. */
  activeCell: string | null;
}

const TableContext = createContext<TableContextProps | undefined>(undefined);
const TableVolatileContext = createContext<TableVolatileState | undefined>(undefined);

export const useTableContext = () => {
  const context = useContext(TableContext);
  if (!context) throw new Error('useTableContext must be used within TableContextProvider');
  return context;
};

/** Доступ к состоянию выделения/навигации. Меняется часто — подписчики
 *  (TableHeader-чекбокс) перерисовываются на каждую навигацию, но их единицы.
 *  Строки (TableBodyRow) НЕ подписываются на него — получают производные булевы
 *  пропсами, поэтому перерисовываются только затронутые. */
export const useTableVolatile = () => {
  const context = useContext(TableVolatileContext);
  if (!context) throw new Error('useTableVolatile must be used within TableContextProvider');
  return context;
};

export const TableContextProvider: FC<PropsWithChildren<{ value: TableContextProps; volatile: TableVolatileState }>> = ({ children, value, volatile }) => (
  <TableContext.Provider value={value}>
    <TableVolatileContext.Provider value={volatile}>{children}</TableVolatileContext.Provider>
  </TableContext.Provider>
);
