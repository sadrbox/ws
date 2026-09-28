/**
 * Табличный вид дашборда (28.09): колонки и строки для SubTableSheets — без JSX (Fast Refresh, проверяются тестом).
 *
 * Значения колонок — числами: по ним сортирует заголовок. Вид даёт `perfCellText` теми же fmtValue/fmtMaybe,
 * что у графиков и плиток. Средние без данных остаются null: в ячейке «—», а не ложный ноль, в сортировке — в конце.
 */
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { withStableIds } from "src/utils/stableRowId";
import { fmtMaybe, fmtValue, type ValueFormat } from "./format";
import { metric, num } from "./metrics";

// ── Строки источников (их же читают графики в index.tsx) ─────────────────────
export interface ManagerRow {
	managerUuid: string | null;
	managerName: string;
	salesCount: number;
	netRevenue: number;
	grossProfit: number;
	[k: string]: unknown;
}
export interface PerfRow {
	userUuid: string;
	userName: string;
	docs: number;
	tasksTotal: number;
	tasksDone: number;
	tasksActive: number;
	tasksOverdue: number;
	// E17 (СК1.8): качество работы с задачами. Средние и доля — null, если считать не из чего.
	doneWithResult?: number;
	reminders?: number;
	returned?: number;
	requests?: number;
	reactionMinutesAvg?: number | null;
	resultShare?: number | null;
	ratingAvg?: number | null;
	[k: string]: unknown;
}

/**
 * Колонка: identifier — ключ перевода заголовка. Подсказка `hint` — готовый текст (SubTableSheets кладёт её
 * в title заголовка), поэтому колонки строятся функцией на рендере, а не константой: язык берётся текущий.
 */
const col = (identifier: string, type: "string" | "number", width: string, hintKey?: string): TColumn => ({
	identifier,
	type,
	width,
	minWidth: type === "number" ? "90px" : "140px",
	visible: true,
	inlist: true,
	...(hintKey ? { hint: translate(hintKey) } : {}),
});

export const managerColumns = (): TColumn[] => [
	col("perfManager", "string", "260px"),
	col("perfRevenue", "number", "160px"),
	col("perfGrossProfit", "number", "160px"),
	col("perfSalesCount", "number", "120px"),
];

export const userColumns = (): TColumn[] => [
	col("perfUser", "string", "220px"),
	col("perfDocuments", "number", "110px"),
	col("perfTasksDone", "number", "110px"),
	col("perfTasksActive", "number", "110px"),
	col("perfTasksOverdue", "number", "110px"),
	// E17 (СК1.8): качество работы с задачами. «—» — считать не из чего, а не ноль.
	col("perfResultShare", "number", "130px", "perfBlockResultShareSub"),
	col("perfRequests", "number", "110px"),
	col("perfReaction", "number", "120px", "perfBlockReactionSub"),
	col("perfReminders", "number", "120px", "perfBlockRemindersSub"),
	col("perfReturned", "number", "110px", "perfBlockReturnedSub"),
	col("perfRating", "number", "100px", "perfBlockRatingSub"),
];

export function managerTableRows(rows: readonly ManagerRow[]): TDataItem[] {
	return withStableIds(rows, (r) => r.managerUuid ?? r.managerName).map((r) => ({
		id: r.id,
		uuid: r.managerUuid || `manager-${r.id}`,
		perfManager: r.managerName,
		perfRevenue: num(r.netRevenue),
		perfGrossProfit: num(r.grossProfit),
		perfSalesCount: num(r.salesCount),
	}));
}

export function userTableRows(rows: readonly PerfRow[]): TDataItem[] {
	return withStableIds(rows, (r) => r.userUuid).map((r) => ({
		id: r.id,
		uuid: r.userUuid || `user-${r.id}`,
		perfUser: r.userName,
		perfDocuments: num(r.docs),
		perfTasksDone: num(r.tasksDone),
		perfTasksActive: num(r.tasksActive),
		perfTasksOverdue: num(r.tasksOverdue),
		perfResultShare: metric(r.resultShare),
		perfRequests: num(r.requests),
		perfReaction: metric(r.reactionMinutesAvg),
		perfReminders: num(r.reminders),
		perfReturned: num(r.returned),
		perfRating: metric(r.ratingAvg),
	}));
}

/** Деньги — всегда число; доля, реакция и оценка могут отсутствовать (null → «—»). */
const MONEY = new Set(["perfRevenue", "perfGrossProfit"]);
const MAYBE: Record<string, ValueFormat> = { perfResultShare: "percent", perfReaction: "minutes", perfRating: "rating" };

/**
 * Вид числовой ячейки. Строку или число SubTableSheets сам кладёт в <span> ячейки; штуки — как есть, без
 * разрядов, как было в таблице. Текстовые колонки — undefined: их показывает общее форматирование по типу.
 */
export function perfCellText(row: TDataItem, column: TColumn): string | number | undefined {
	const v = row[column.identifier];
	if (MONEY.has(column.identifier)) return fmtValue(num(v), "money");
	const maybe = MAYBE[column.identifier];
	if (maybe) return fmtMaybe(v as number | null, maybe);
	if (column.type === "number") return num(v);
	return undefined;
}
