/**
 * Реестр блоков показателей дашборда эффективности.
 *
 * Каждый блок объявляет:
 *   • requires — имя модели прав (AccessPermission.modelName). Блок доступен, только
 *     если у пользователя есть чтение этой модели (useAccessPermission). Это и есть
 *     «выбор блоков по правам доступа»: недоступные блоки не предлагаются и не грузят
 *     свой источник.
 *   • source — какой отчёт-источник его питает (одна из двух выборок):
 *       "managers" → GET /reports/sales-by-manager (разрез ПО МЕНЕДЖЕРАМ);
 *       "users"    → GET /reports/user-performance (разрез по пользователям).
 *   • kind/valueKey/… — как построить график (реализация в charts.tsx / index.tsx).
 *
 * JSX здесь НЕТ намеренно — модуль данных (Fast Refresh: не смешивать с компонентами).
 */

export type BlockSource = "managers" | "users";
export type ChartKind = "bars" | "tasks";
export type ValueFormat = "money" | "int";

export interface DashboardBlockDef {
	id: string;
	title: string;
	subtitle: string;
	/** Модель прав: блок виден при canRead этой модели. */
	requires: string;
	source: BlockSource;
	kind: ChartKind;
	/** Поле строки-источника для простого бара (kind="bars"). */
	valueKey?: string;
	format?: ValueFormat;
	/** CSS-переменная цвета серии (тема-независимая, из index.html). */
	colorVar?: string;
}

/** KPI-плитка сводки (шапка дашборда). Тоже гейтится правами. */
export interface KpiTileDef {
	id: string;
	label: string;
	requires: string;
	source: BlockSource;
	/** Поле итога в totals (managers) или агрегат по строкам (users). */
	key: string;
	format: ValueFormat;
	/** Направление «хорошо»: рост зелёный (up) или падение зелёное (down). */
	good?: "up" | "down";
}

export const BLOCKS: DashboardBlockDef[] = [
	{
		id: "rev-by-manager",
		title: "Выручка по менеджерам",
		subtitle: "Чистая выручка за период (продажи − возвраты)",
		requires: "Sale",
		source: "managers",
		kind: "bars",
		valueKey: "netRevenue",
		format: "money",
		colorVar: "--color-link",
	},
	{
		id: "profit-by-manager",
		title: "Валовая прибыль по менеджерам",
		subtitle: "Выручка − себестоимость (COGS)",
		requires: "Sale",
		source: "managers",
		kind: "bars",
		valueKey: "grossProfit",
		format: "money",
		colorVar: "--success",
	},
	{
		id: "sales-count-by-manager",
		title: "Продажи по менеджерам",
		subtitle: "Количество проведённых реализаций, шт",
		requires: "Sale",
		source: "managers",
		kind: "bars",
		valueKey: "salesCount",
		format: "int",
		colorVar: "--c-teal-61",
	},
	{
		id: "docs-by-user",
		title: "Документы по пользователям",
		subtitle: "Сколько документов провёл каждый за период",
		requires: "Todo",
		source: "users",
		kind: "bars",
		valueKey: "docs",
		format: "int",
		colorVar: "--color-link",
	},
	{
		id: "tasks-by-user",
		title: "Задачи по исполнителям",
		subtitle: "Выполнено / в работе / просрочено",
		requires: "Todo",
		source: "users",
		kind: "tasks",
	},
];

export const KPI_TILES: KpiTileDef[] = [
	{ id: "kpi-revenue", label: "Выручка", requires: "Sale", source: "managers", key: "netRevenue", format: "money", good: "up" },
	{ id: "kpi-profit", label: "Валовая прибыль", requires: "Sale", source: "managers", key: "grossProfit", format: "money", good: "up" },
	{ id: "kpi-docs", label: "Документов проведено", requires: "Todo", source: "users", key: "docs", format: "int", good: "up" },
	{ id: "kpi-overdue", label: "Просроченных задач", requires: "Todo", source: "users", key: "tasksOverdue", format: "int", good: "down" },
];

/** localStorage-ключ выбранных блоков (по id). */
export const SELECTED_BLOCKS_KEY = "userperf.selectedBlocks.v1";
