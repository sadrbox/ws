import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useInfiniteModelList, GLOBAL_ADAPTIVE_LIMIT_REF } from "src/hooks/useInfiniteModelList";
import useQueryParams from "src/hooks/useQueryParams";
import { useModelDelete } from "src/hooks/useModelDelete";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem, TypeTableTypes } from "src/components/Table/types";
import type { TTableVariant } from "src/components/Table";
import { useAccessRight } from "src/hooks/useAccessRight";
import { ENDPOINT_TO_MODEL } from "src/utils/accessRightsMap";

const stringifyJson = (v: any): string => {
  if (v == null) return "";
  try { const s = JSON.stringify(v); return s === "{}" || s === "[]" ? "" : s; } catch { return ""; }
};

export interface UseModelListStateOptions {
  /** API endpoint (например "organizations") */
  model: string;
  /** Имя компонента для columns.json (например "OrganizationsList") */
  componentName: string;
  /** JSON-конфиг колонок */
  columnsJson: any;
  /** Сортировка по умолчанию */
  defaultSort?: Record<string, "asc" | "desc">;
  /** Вариант "part" для вложенных списков */
  columnsVariant?: TypeTableTypes;
  /** Фильтр владельца для вложенных списков */
  ownerFilter?: Record<string, { value: unknown; operator: string }>;
}

/**
 * Хук, инкапсулирующий весь бойлерплейт List-компонента:
 * - columns, sort, search, filter state
 * - adaptiveLimit + GLOBAL_ADAPTIVE_LIMIT_REF sync
 * - cachedRows + cacheVersion
 * - useInfiniteModelList подключение
 * - handleSortChange, handleFilterChange, handleSearch, clearFilters, handleCleanRefresh
 * - handleDelete
 * - tableProps — готовый объект для <Table />
 *
 * Возвращает всё необходимое для рендера <Table {...tableProps} /> и openModelForm.
 */
export function useModelListState(opts: UseModelListStateOptions) {
  const { model, componentName, defaultSort = { id: "asc" }, columnsVariant, ownerFilter } = opts;

  const queryClient = useQueryClient();

  // ── Права доступа ─────────────────────────────────────────────────────
  const modelName = ENDPOINT_TO_MODEL[model] ?? "";
  const { canRead, canWrite } = useAccessRight(modelName);

  const [columns, setColumns] = useState<TColumn[]>(() =>
    getModelColumns(opts.columnsJson, componentName, columnsVariant),
  );
  const [sort, setSort] = useQueryParams<Record<string, "asc" | "desc">>(
    "sort", defaultSort, undefined, { stringify: stringifyJson },
  );
  const [search, setSearch] = useQueryParams<string>("search", "");
  const [filter, setFilter] = useQueryParams<
    Record<string, { value: unknown; operator: string }> | undefined
  >("filter", undefined, undefined, { stringify: stringifyJson });

  const [adaptiveLimit, setAdaptiveLimit] = useState(500);
  useEffect(() => { GLOBAL_ADAPTIVE_LIMIT_REF.current = adaptiveLimit; }, [adaptiveLimit]);
  const updateAdaptiveLimit = useCallback((n: number) => setAdaptiveLimit(n), []);

  const params = useMemo(
    () => ({
      sort,
      search,
      filter: ownerFilter ? { ...ownerFilter, ...filter } : filter,
    }),
    [sort, search, filter, ownerFilter],
  );

  const {
    allItems, total, isAnythingLoading, isFetchingNextPage,
    hasNextPage, error, refetch, fetchNextPage, cancelAllRequests,
  } = useInfiniteModelList<TDataItem>({ model, params, queryOptions: {} });

  const handleDelete = useModelDelete(model, refetch);

  // ── Cached rows ────────────────────────────────────────────────────────
  const cachedRowsRef = useRef<TDataItem[]>([]);
  const [cacheVersion, setCacheVersion] = useState(0);
  useEffect(() => { cachedRowsRef.current = allItems; setCacheVersion(v => v + 1); }, [allItems]);

  // Защитный слой: фильтруем строки на фронтенде по ownerFilter,
  // чтобы гарантировать отображение только записей владельца
  const rows = useMemo(() => {
    const cached = cachedRowsRef.current;
    if (!ownerFilter) return cached;
    return cached.filter((row: TDataItem) => {
      for (const [field, cond] of Object.entries(ownerFilter)) {
        if (cond.operator === "equals" && (row as any)[field] !== cond.value) return false;
      }
      return true;
    });
  }, [cacheVersion, ownerFilter]);

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleSortChange = useCallback(
    (s: typeof sort) => {
      cachedRowsRef.current = [];
      setCacheVersion(0);
      updateAdaptiveLimit(500);
      setSort(s ?? defaultSort);
    },
    [setSort, updateAdaptiveLimit, defaultSort],
  );

  const handleFilterChange = useCallback(
    (field: string, value: unknown, operator = "contains") => {
      setFilter((prev: typeof filter) => {
        const next = { ...(prev ?? {}) };
        if (value == null || value === "") delete next[field];
        else next[field] = { value, operator };
        return Object.keys(next).length > 0 ? next : undefined;
      });
    },
    [setFilter],
  );

  const handleSearch = useCallback((v: string) => setSearch(v.trim()), [setSearch]);
  const clearFilters = useCallback(() => { setSearch(""); setFilter(undefined); }, [setSearch, setFilter]);

  const handleCleanRefresh = useCallback(() => {
    cancelAllRequests();
    cachedRowsRef.current = [];
    setCacheVersion(0);
    setSearch("");
    setFilter(undefined);
    setSort(defaultSort);
    updateAdaptiveLimit(500);
    queryClient.resetQueries({ queryKey: [model] });
  }, [cancelAllRequests, queryClient, setSearch, setFilter, setSort, updateAdaptiveLimit, model, defaultSort]);

  // ── tableProps — готовый объект для <Table /> ──────────────────────────
  const buildTableProps = useCallback(
    (extra: {
      variant?: TTableVariant;
      onSelectItem?: (item: TDataItem) => void;
      openModelForm: (formProps: any) => void;
      enableDateRange?: boolean;
      renderCell?: (row: TDataItem, col: TColumn) => ReactNode | undefined;
    }) => ({
      variant: extra.variant,
      onSelectItem: extra.onSelectItem,
      enableDateRange: extra.enableDateRange ?? false,
      componentName,
      rows,
      columns,
      total,
      totalPages: Math.ceil(total / adaptiveLimit),
      isLoading: isAnythingLoading,
      isFetching: isAnythingLoading,
      error,
      hasNextPage,
      isFetchingNextPage,
      pagination: { page: 1, limit: adaptiveLimit, onPageChange: () => {}, onLimitChange: () => {} },
      sorting: { sort, onSortChange: handleSortChange },
      filtering: { filters: filter, onFilterChange: handleFilterChange, onClearAll: clearFilters },
      search: { value: search, onChange: handleSearch },
      actions: {
        openModelForm: extra.openModelForm,
        refetch: handleCleanRefresh,
        setColumns,
        fetchNextPage,
        setAdaptiveLimit: updateAdaptiveLimit,
      },
      onDelete: handleDelete,
      readonly: !canWrite,
      renderCell: extra.renderCell,
    }),
    [
      componentName, rows, columns, total, adaptiveLimit,
      isAnythingLoading, error, hasNextPage, isFetchingNextPage,
      sort, search, filter,
      handleSortChange, handleFilterChange, handleSearch, clearFilters,
      handleCleanRefresh, setColumns, fetchNextPage, updateAdaptiveLimit,
      handleDelete, canWrite,
    ],
  );

  return {
    rows, columns, total, error, refetch, isAnythingLoading,
    canRead, canWrite,
    buildTableProps,
  };
}
