// Хелпер: пропсы для стандартного компонента <Table/> на СТАТИЧНОМ (не курсорном)
// источнике данных — единый вид списков для не-CRUD экранов (справочники,
// workflow-панели). Пагинация/фильтр — no-op; тулбар создания/удаления скрыт
// (hideAddDelete). Клик по строке → onRowClick(data).
//
// СОРТИРОВКА И ПОИСК. По умолчанию остаются заглушками (совместимость со списками, где
// порядок и отбор задаёт источник). Передайте `sorting` и `search` из useStaticTableView —
// и клик по заголовку начнёт переставлять строки, а строка быстрого поиска — отбирать их.
// Без этих пропов заголовок рисовал стрелку, поиск принимал текст, и ничего не менялось:
// оба выглядели рабочими и молча не делали ничего.
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
	/** Быстрый поиск: значение + сеттер (из useStaticTableView — он же и фильтрует). */
	search?: { value: string; onChange: (v: string) => void };
	/** Доп. кнопки тулбара Table. */
	extraButtons?: ReactNode;
	/** Подсветка/активация строки по uuid (для «Показать в списке» / «Выбор из списка»). */
	highlightUuid?: string;
	highlightToken?: number;
	/** Не рендерить панель управления Table (тулбар вынесен на уровень пейна). */
	hideToolbar?: boolean;
	/** Отметки строк (групповые операции над выбранным). По умолчанию выключены. */
	selectable?: boolean;
	onSelectionChange?: (selected: Set<number>, rows: TDataItem[]) => void;
	/** Рабочая сортировка на клиенте — из useStaticTableView. */
	sorting?: { sort: Record<string, "asc" | "desc">; onSortChange: (s: Record<string, "asc" | "desc">) => void };
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
		sorting: p.sorting ?? { sort: { id: "asc" as const }, onSortChange: () => {} },
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
		hideToolbar: !!p.hideToolbar,
		readonly: true,
		// read-only списки без массового выбора → без колонки-чекбокса; включается там,
		// где над выбранными строками выполняются групповые операции.
		selectable: !!p.selectable,
		...(p.onSelectionChange ? { onSelectionChange: p.onSelectionChange } : {}),
		...(p.extraButtons ? { extraButtons: p.extraButtons } : {}),
		...(p.renderCell ? { renderCell: p.renderCell } : {}),
		...(p.highlightUuid ? { highlightUuid: p.highlightUuid } : {}),
		...(p.highlightToken !== undefined ? { highlightToken: p.highlightToken } : {}),
	};
}

export default buildStaticTableProps;
