/**
 * ИТОГ ПРОВЕРКИ БАЗЫ ОДНОЙ СТРОКОЙ — для отчёта задания (С17, аудит 15.09).
 *
 * В строку задания из ответа попадали только путь и адрес, и проверка, нашедшая ошибки, в «Заданиях» и
 * «Прогрессе» выглядела как «Выполнено» с «—». Здесь из ответа `IB_CHECK` (`issues`, `repaired`,
 * `repairMode`, `skipped`) собирается итог словами, а найденное и не исправленное — предупреждением.
 */

const SKIP_LABEL: Record<string, string> = { reindex: "переиндексация", recalcTotals: "пересчёт итогов" };

const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

export function checkOutcome(
	r: { issues?: unknown; repaired?: unknown; repairMode?: unknown; skipped?: unknown } | null | undefined,
): { outcome: string; warning: string | null } | null {
	if (!r) return null;
	const issues = count(r.issues);
	const repaired = count(r.repaired);
	if (issues === null && repaired === null) return null;
	const repairMode = r.repairMode === true;

	const parts = [`найдено ошибок: ${issues ?? 0}`];
	if (repairMode) parts.push(`исправлено: ${repaired ?? 0}`);
	const skipped = Array.isArray(r.skipped)
		? r.skipped.filter((k): k is string => typeof k === "string").map((k) => SKIP_LABEL[k] ?? k)
		: [];
	if (skipped.length) parts.push(`не выполнено без «Исправлять»: ${skipped.join(", ")}`);

	const found = issues ?? 0;
	const left = repairMode ? found - (repaired ?? 0) : found;
	const warning = found > 0 && left > 0
		? (repairMode
			? `исправлены не все ошибки: осталось ${left} из ${found}`
			: `найдены ошибки: ${found} — нужна проверка с «Исправлять»`)
		: null;
	return { outcome: parts.join("; "), warning };
}
