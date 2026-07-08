// Хелпер: пропсы для стандартного компонента <Table/> на СТАТИЧНОМ (не курсорном)
// источнике данных — единый вид списков для не-CRUD экранов (справочники,
// workflow-панели). Пагинация/сортировка/фильтр — no-op; тулбар создания/удаления
// скрыт (hideAddDelete). Клик по строке → onRowClick(data).
import type { ReactNode } from "react";
import type { TColumn, TDataItem } from "src/components/Table/types";

interface Params {
	componentName: string;
	rows: TDataItem[];
	columns: TColumn[];
	setColumns: (c: TColumn[]) => void;
	renderCell?: (row: TDataItem, col: TColumn) => ReactNode;
	onRowClick?: (data: Partial<TDataItem>) => void;
	onReload?: () => void;
	isLoading?: boolean;
	/** Поиск (проброс во встроенную строку поиска Table). */
	search?: { value: string; onChange: (v: string) => void };
	/** Доп. кнопки тулбара Table. */
	extraButtons?: ReactNode;
}

/** Собирает объект пропсов для <Table {...props} /> на статичных данных. */
export function buildStaticTableProps(p: Params) {
	return {
		enableDateRange: false,
		componentName: p.componentName,
		rows: p.rows,
		columns: p.columns,
		total: p.rows.length,
		totalPages: 1,
		isLoading: !!p.isLoading,
		isFetching: false,
		error: null as Error | null,
		hasNextPage: false,
		isFetchingNextPage: false,
		pagination: { page: 1, limit: 500, onPageChange: () => {}, onLimitChange: () => {} },
		sorting: { sort: { id: "asc" as const }, onSortChange: () => {} },
		filtering: { filters: undefined, onFilterChange: () => {}, onClearAll: () => {} },
		search: p.search
			? { value: p.search.value, onChange: (e: unknown) => p.search!.onChange(typeof e === "string" ? e : (e as { target?: { value?: string } })?.target?.value ?? "") }
			: { value: "", onChange: () => {} },
		actions: {
			openModelForm: ({ data }: { data?: Partial<TDataItem> }) => { if (data && p.onRowClick) p.onRowClick(data); },
			refetch: p.onReload ?? (() => {}),
			setColumns: p.setColumns,
			fetchNextPage: () => {},
			setAdaptiveLimit: () => {},
		},
		hideAddDelete: true,
		hideReload: !p.onReload,
		readonly: true,
		selectable: false, // read-only списки без массового выбора → без колонки-чекбокса
		...(p.extraButtons ? { extraButtons: p.extraButtons } : {}),
		...(p.renderCell ? { renderCell: p.renderCell } : {}),
	};
}

export default buildStaticTableProps;
