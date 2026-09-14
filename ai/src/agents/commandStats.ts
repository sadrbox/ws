/**
 * Отказы и время команд из heartbeat (S5, docs/TASKS_ONEC_FIXES_2026-09-13.md).
 *
 * Агент шлёт `failuresByCode` («IB_BUSY: 87») и `durationsByType` (число, среднее, максимум,
 * 95-й перцентиль корзинами) — снимок за время работы процесса. Раньше `heartbeatSchema`
 * отбрасывала эти поля, и «агент тормозит» или «часть команд падает» мерили руками.
 *
 * РАЗБОР ОТДЕЛЬНО ОТ HEARTBEAT. В схеме heartbeat эти поля — `unknown`, а проверяются здесь:
 * неожиданная форма от какой-нибудь сборки агента не должна превращать весь heartbeat в 400 —
 * иначе агент перестал бы считаться на связи из-за диагностики. Кривое поле отбрасывается и
 * называется, остальное принимается.
 */
import { z } from "zod";

const count = z.number().int().nonnegative();
const millis = z.number().nonnegative();
const code = z.string().min(1).max(100);

export const durationStatSchema = z.object({
	count,
	avgMs: millis,
	maxMs: millis,
	/** Верхняя граница корзины, в которую попал 95-й перцентиль: 1 | 5 | 15 | 60 | 300; null — дольше 300 с. */
	p95LeSecs: z.number().int().nullable(),
	buckets: z.record(z.string().max(20), count),
});

export type DurationStat = z.infer<typeof durationStatSchema>;

// Предел числа ключей — защита от бессмысленно большого тела, а не от штатной работы:
// типов команд у агента десятки.
const failuresSchema = z.record(code, count).refine((r) => Object.keys(r).length <= 500);
const durationsSchema = z.record(code, durationStatSchema).refine((r) => Object.keys(r).length <= 500);

/**
 * Время по типам команд СВОДНО по агентам (R5): для экрана очереди неважно, какой из агентов
 * мерил, важно, сколько тип обычно идёт. Среднее — взвешенное по числу команд, максимум — общий,
 * корзина 95-го перцентиля — худшая (null, «дольше 300 с», побеждает).
 */
export function mergeDurationStats(
	list: (Record<string, DurationStat> | null | undefined)[],
): Record<string, Omit<DurationStat, "buckets">> {
	const acc: Record<string, { count: number; totalMs: number; maxMs: number; p95LeSecs: number | null }> = {};
	for (const one of list) {
		for (const [type, s] of Object.entries(one ?? {})) {
			if (!s || !s.count) continue;
			const cur = acc[type] ?? { count: 0, totalMs: 0, maxMs: 0, p95LeSecs: 0 };
			cur.count += s.count;
			cur.totalMs += s.avgMs * s.count;
			cur.maxMs = Math.max(cur.maxMs, s.maxMs);
			cur.p95LeSecs = cur.p95LeSecs === null || s.p95LeSecs === null ? null : Math.max(cur.p95LeSecs, s.p95LeSecs);
			acc[type] = cur;
		}
	}
	return Object.fromEntries(Object.entries(acc).map(([type, v]) => [type, {
		count: v.count, avgMs: Math.round(v.totalMs / v.count), maxMs: v.maxMs, p95LeSecs: v.p95LeSecs,
	}]));
}

export type CommandStats = {
	failuresByCode?: Record<string, number>;
	durationsByType?: Record<string, DurationStat>;
};

/**
 * Разобрать снимок. `stats: null` — полей не было (старая сборка): прежний снимок не
 * затираем. `rejected` — какие поля пришли, но не разобрались: их пропускаем и пишем в журнал.
 */
export function parseCommandStats(body: { failuresByCode?: unknown; durationsByType?: unknown }): {
	stats: CommandStats | null;
	rejected: string[];
} {
	const stats: CommandStats = {};
	const rejected: string[] = [];
	if (body.failuresByCode !== undefined) {
		const p = failuresSchema.safeParse(body.failuresByCode);
		if (p.success) stats.failuresByCode = p.data; else rejected.push("failuresByCode");
	}
	if (body.durationsByType !== undefined) {
		const p = durationsSchema.safeParse(body.durationsByType);
		if (p.success) stats.durationsByType = p.data; else rejected.push("durationsByType");
	}
	return { stats: Object.keys(stats).length ? stats : null, rejected };
}
