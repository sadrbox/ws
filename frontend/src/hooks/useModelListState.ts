import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
	useInfiniteModelList,
	GLOBAL_ADAPTIVE_LIMIT_REF,
} from "src/hooks/useInfiniteModelList";
import useQueryParams from "src/hooks/useQueryParams";
import { useModelDelete } from "src/hooks/useModelDelete";
import {
	getModelColumns,
	matchRowBySearch,
	loadTableView,
	saveTableView,
} from "src/components/Table/services";
import type {
	TColumn,
	TDataItem,
	TypeTableTypes,
} from "src/components/Table/types";
import type { TTableVariant } from "src/components/Table";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { ENDPOINT_TO_MODEL } from "src/utils/userAccessRightsMap";

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
	/** Дополнительные query-параметры, отправляемые напрямую (не через filter[...]) */
	extraQueryParams?: Record<string, string>;
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
	const {
		model,
		componentName,
		defaultSort = { id: "asc" },
		columnsVariant,
		ownerFilter,
		extraQueryParams,
	} = opts;

	const queryClient = useQueryClient();

	// ── Разрешения пользователей ─────────────────────────────────────────────────────
	const modelName = ENDPOINT_TO_MODEL[model] ?? "";
	const { canRead, canWrite } = useUserAccessRight(modelName);

	const [columns, setColumns] = useState<TColumn[]>(() =>
		getModelColumns(opts.columnsJson, componentName, columnsVariant),
	);
	// Восстанавливаем сохранённый на клиенте вид таблицы (сортировка + период).
	const persistedView = useMemo(() => loadTableView(componentName), [componentName]);
	const [sort, setSort] = useQueryParams<Record<string, "asc" | "desc">>(
		"sort",
		defaultSort,
		persistedView?.sort,
	);
	const [search, setSearch] = useQueryParams<string>("search", "");
	const [filter, setFilter] = useQueryParams<
		Record<string, { value: unknown; operator: string }> | undefined
	>(
		"filter",
		undefined,
		persistedView?.dateRange
			? { dateRange: persistedView.dateRange as unknown as { value: unknown; operator: string } }
			: undefined,
	);

	// Сохраняем сортировку и период (dateRange) на клиенте при изменении.
	useEffect(() => {
		saveTableView(componentName, {
			sort,
			dateRange: filter?.dateRange as unknown as { startDate?: string; endDate?: string } | undefined,
		});
	}, [componentName, sort, filter]);

	const [adaptiveLimit, setAdaptiveLimit] = useState(500);
	useEffect(() => {
		GLOBAL_ADAPTIVE_LIMIT_REF.current = adaptiveLimit;
	}, [adaptiveLimit]);
	const updateAdaptiveLimit = useCallback(
		(n: number) => setAdaptiveLimit(n),
		[],
	);

	// search не передаётся на бэкенд — фильтрация только client-side (см. rows ниже)
	// Сортировка по «Номер» естественно-числовая на уровне БД: колонки `number`
	// имеют ICU-коллацию `app_natural_numeric` (миграция natural_document_number_sort),
	// поэтому ORDER BY number даёт «1,2,…,10» / «РЕАЛ-1…РЕАЛ-10» — спец-обработка не нужна.
	const params = useMemo(
		() => ({
			sort,
			filter: ownerFilter ? { ...ownerFilter, ...filter } : filter,
			extra: extraQueryParams,
		}),
		[sort, filter, ownerFilter, extraQueryParams],
	);

	const {
		allItems,
		total,
		isAnythingLoading,
		isFetchingNextPage,
		hasNextPage,
		error,
		refetch,
		fetchNextPage,
		cancelAllRequests,
	} = useInfiniteModelList<TDataItem>({ model, params, queryOptions: {} });

	const handleDelete = useModelDelete(model, refetch);

	// ── Cached rows ────────────────────────────────────────────────────────
	const cachedRowsRef = useRef<TDataItem[]>([]);
	const [cacheVersion, setCacheVersion] = useState(0);
	useEffect(() => {
		cachedRowsRef.current = allItems;
		setCacheVersion((v) => v + 1);
	}, [allItems]);

	// Client-side фильтрация:
	// 1. ownerFilter — гарантирует отображение только записей владельца
	// 2. search — только по ВИДИМЫМ колонкам, включая ссылочные (reference) поля
	const rows = useMemo(() => {
		let result = cachedRowsRef.current;

		if (ownerFilter) {
			result = result.filter((row: TDataItem) => {
				for (const [field, cond] of Object.entries(ownerFilter)) {
					if (cond.operator === "equals" && (row as any)[field] !== cond.value)
						return false;
				}
				return true;
			});
		}

		if (search) {
			const visibleCols = columns.filter((c) => c.visible);
			const words = search
				.toLowerCase()
				.split(/\s+/)
				.filter(Boolean)
				.map((w) => w.replace(",", "."));
			result = result.filter((row: TDataItem) =>
				matchRowBySearch(row, visibleCols, words),
			);
		}

		return result;
	}, [cacheVersion, ownerFilter, search, columns]);

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
				// Спец-случай: dateRange — это объект { startDate, endDate },
				// который не нужно оборачивать в { value, operator }, т.к.
				// бэкенд ожидает filter[dateRange][startDate]=… / [endDate]=…
				else if (field === "dateRange" && typeof value === "object") {
					next[field] = value as { value: unknown; operator: string };
				} else next[field] = { value, operator };
				return Object.keys(next).length > 0 ? next : undefined;
			});
		},
		[setFilter],
	);

	const handleSearch = useCallback(
		(v: string) => setSearch(v.trim()),
		[setSearch],
	);
	const clearFilters = useCallback(() => {
		setSearch("");
		setFilter(undefined);
	}, [setSearch, setFilter]);

	const handleCleanRefresh = useCallback(() => {
		cancelAllRequests();
		cachedRowsRef.current = [];
		setCacheVersion(0);
		setSearch("");
		setFilter(undefined);
		setSort(defaultSort);
		updateAdaptiveLimit(500);
		void queryClient.resetQueries({ queryKey: [model] });
	}, [
		cancelAllRequests,
		queryClient,
		setSearch,
		setFilter,
		setSort,
		updateAdaptiveLimit,
		model,
		defaultSort,
	]);

	// ── tableProps — готовый объект для <Table /> ──────────────────────────
	const buildTableProps = useCallback(
		(extra: {
			variant?: TTableVariant;
			onSelectItem?: (item: TDataItem) => void;
			openModelForm: (formProps: any) => void;
			enableDateRange?: boolean;
			renderCell?: (row: TDataItem, col: TColumn) => ReactNode | undefined;
			highlightUuid?: string;
			highlightToken?: number;
		}) => ({
			variant: extra.variant,
			onSelectItem: extra.onSelectItem,
			highlightUuid: extra.highlightUuid,
			highlightToken: extra.highlightToken,
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
			pagination: {
				page: 1,
				limit: adaptiveLimit,
				onPageChange: () => {},
				onLimitChange: () => {},
			},
			sorting: { sort, onSortChange: handleSortChange },
			filtering: {
				filters: filter,
				onFilterChange: handleFilterChange,
				onClearAll: clearFilters,
			},
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
			componentName,
			rows,
			columns,
			total,
			adaptiveLimit,
			isAnythingLoading,
			error,
			hasNextPage,
			isFetchingNextPage,
			sort,
			search,
			filter,
			handleSortChange,
			handleFilterChange,
			handleSearch,
			clearFilters,
			handleCleanRefresh,
			setColumns,
			fetchNextPage,
			updateAdaptiveLimit,
			handleDelete,
			canWrite,
		],
	);

	return {
		rows,
		columns,
		total,
		error,
		refetch,
		isAnythingLoading,
		canRead,
		canWrite,
		buildTableProps,
	};
}
