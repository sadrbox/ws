import type { TDataItem } from "src/components/Table/types";

/** Сводка расхождений инвентаризации в штуках: излишек и недостача. */
export interface DeviationSummary { surplus: number; shortage: number }

/**
 * Излишек / недостача по строкам (факт − учёт). Строки, помеченные на удаление, не считаются.
 * Округление до 4 знаков — как у количества в строках.
 */
export function deviationSummary(rows: readonly TDataItem[]): DeviationSummary {
	let s = 0, d = 0;
	for (const r of rows) {
		if (r._pendingAction === "delete") continue;
		const dev = (Number(r.quantity) || 0) - (Number(r.accountingQuantity) || 0);
		if (dev > 0) s += dev; else d += -dev;
	}
	return { surplus: Math.round(s * 10000) / 10000, shortage: Math.round(d * 10000) / 10000 };
}
