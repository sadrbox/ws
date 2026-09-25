/**
 * Данные дашборда из строк отчётов — чистые функции без JSX (Fast Refresh; проверяются тестом).
 *
 * E17 (СК1.8) добавил показатели, у которых «нет данных» и «ноль» — разные ответы: доля задач с
 * результатом, среднее время реакции, средняя оценка приходят null, когда считать не из чего.
 * Поэтому значение читается через `metric` (null остаётся null), а не через `Number(v) || 0`.
 */
import { asText } from "src/utils/asText";
import type { CatDatum, TaskDatum } from "./charts";
import type { DashboardBlockDef, KpiTileDef } from "./dashboardBlocks";

/** Сколько строк показывает график (остальные — в табличном виде). */
export const TOP_N = 15;

export const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

/** Значение показателя или null, если его нет: пустое среднее — не ноль. */
export function metric(v: unknown): number | null {
	if (v === null || v === undefined || v === "") return null;
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : null;
}

/** Столбики блока: без пустых значений, нули — по `keepZero`, порядок — по `sortDir`, первые TOP_N. */
export function barData(
	rows: ReadonlyArray<Record<string, unknown>>,
	nameKey: string,
	valueKey: string,
	opts: Pick<DashboardBlockDef, "keepZero" | "sortDir"> = {},
): CatDatum[] {
	const out: CatDatum[] = [];
	for (const r of rows) {
		const value = metric(r[valueKey]);
		if (value === null || (value === 0 && !opts.keepZero)) continue;
		out.push({ name: asText(r[nameKey] ?? "—"), value });
	}
	out.sort((a, b) => (opts.sortDir === "asc" ? a.value - b.value : b.value - a.value));
	return out.slice(0, TOP_N);
}

/** Стек задач по исполнителям: выполнено / в работе / просрочено. */
export function taskData(rows: ReadonlyArray<Record<string, unknown>>): TaskDatum[] {
	return rows
		.map((r) => ({ name: asText(r.userName), done: num(r.tasksDone), active: num(r.tasksActive), overdue: num(r.tasksOverdue) }))
		.filter((d) => d.done + d.active + d.overdue > 0)
		.sort((a, b) => b.done + b.active + b.overdue - (a.done + a.active + a.overdue))
		.slice(0, TOP_N);
}

/**
 * Значение KPI-плитки по строкам «по пользователям»: сумма `key` или — у доли (`ratioOf`) —
 * отношение сумм в процентах. Доля без знаменателя (ни одной закрытой задачи) — null, а не 0 %.
 */
export function userTileValue(rows: ReadonlyArray<Record<string, unknown>>, tile: Pick<KpiTileDef, "key" | "ratioOf">): number | null {
	const sum = (k: string) => rows.reduce((s, r) => s + num(r[k]), 0);
	if (!tile.ratioOf) return sum(tile.key);
	const den = sum(tile.ratioOf);
	return den > 0 ? Math.round((sum(tile.key) / den) * 100) : null;
}
