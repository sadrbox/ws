import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { translate } from "src/i18";
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
	parseSearchQuery,
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

// Модели, где свободные слова ищет СЕРВЕР, а не клиент по видимым колонкам.
// Признак: искомое не сводится к колонкам списка (у товара — несколько штрих-кодов,
// доп. коды лежат в отдельной таблице). Роутер такой модели ОБЯЗАН искать по
// надмножеству видимых колонок — иначе поиск по колонке молча сломается.
const SERVER_WORD_SEARCH = new Set(["products"]);

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

	// Шаблоны поиска «[номенклатура: ноут]» — это поиск по ВЛОЖЕННЫМ строкам документа
	// (позициям), а не по колонкам списка: колонки «Номенклатура» в списке Реализаций
	// нет и быть не может. Такой фильтр возможен только на сервере (Prisma `some`),
	// поэтому области уходят в запрос как nested[имя]=текст, а СВОБОДНЫЕ слова
	// по-прежнему фильтруются на клиенте по видимым колонкам (см. rows ниже).
	const nestedParams = useMemo(() => {
		const { scopes } = parseSearchQuery(search);
		if (scopes.length === 0) return undefined;
		const out: Record<string, string> = {};
		for (const { scope, text } of scopes) out[`nested[${scope}]`] = text;
		return out;
	}, [search]);

	// Свободные слова: где ищем — на клиенте или на сервере.
	//
	// По умолчанию клиент фильтрует ПОДГРУЖЕННЫЕ строки по видимым колонкам — этого
	// хватает, пока искомое видно в колонке. Для Номенклатуры не хватает: штрих-кодов
	// у товара несколько (основной в product.barcode, GTIN/EAN поставщиков — в
	// отдельной таблице), колонки под них нет, а товар может лежать на неподгруженной
	// странице. Поэтому слова уходят на СЕРВЕР (см. products.js: OR по name/sku/
	// штрих-кодам/бренду/единице — надмножеству видимых колонок), а клиент их не
	// перефильтровывает, иначе снова отсёк бы найденное по доп. штрих-коду.
	const serverWordSearch = SERVER_WORD_SEARCH.has(model);
	const searchParam = useMemo(() => {
		if (!serverWordSearch) return undefined;
		const { words } = parseSearchQuery(search);
		return words.length ? { search: words.join(" ") } : undefined;
	}, [serverWordSearch, search]);

	// Сортировка по «Номер» естественно-числовая на уровне БД: колонки `number`
	// имеют ICU-коллацию `app_natural_numeric` (миграция natural_document_number_sort),
	// поэтому ORDER BY number даёт «1,2,…,10» / «РЕАЛ-1…РЕАЛ-10» — спец-обработка не нужна.
	const params = useMemo(
		() => ({
			sort,
			filter: ownerFilter ? { ...ownerFilter, ...filter } : filter,
			extra:
				nestedParams || searchParam
					? { ...(extraQueryParams ?? {}), ...nestedParams, ...searchParam }
					: extraQueryParams,
		}),
		[sort, filter, ownerFilter, extraQueryParams, nestedParams, searchParam],
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
			// Поддерживаются шаблоны [Колонка: подстрока] — напр. «[номенклатура: ноутбук]»
			// или «[контрагент: строй]». Свободные слова ищутся как раньше, по всем
			// видимым колонкам. Разбор — parseSearchQuery (components/Table/services).
			const visibleCols = columns.filter((c) => c.visible);
			// Области (шаблоны) уже применил СЕРВЕР по строкам документа — на клиенте
			// остаются только свободные слова, по видимым колонкам (прежнее поведение).
			const { words } = parseSearchQuery(search);
			if (words.length > 0 && !serverWordSearch) {
				result = result.filter((row: TDataItem) =>
					matchRowBySearch(row, visibleCols, words),
				);
			}
		}

		return result;
	}, [cacheVersion, ownerFilter, search, columns, componentName, serverWordSearch]);

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
