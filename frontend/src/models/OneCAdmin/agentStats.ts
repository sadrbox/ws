/**
 * Время и отказы команд агента (S5) — строки для таблиц карточки агента.
 *
 * Время — по убыванию СРЕДНЕГО: вопрос «что тормозит» задают о самом медленном, а не о самом
 * частом. Отказы — по убыванию числа: «часть команд падает» — это про самый частый код.
 * 95-й перцентиль агент даёт корзиной («≤ 60 с»), а не точным числом: так и показываем.
 *
 * Отдельным модулем: строки проверяются тестом, а не-компонентный экспорт в модуле с
 * компонентом ломает Fast Refresh всему файлу.
 */
import { translate } from "src/i18";
import { formatDuration } from "./queueStats";

export type DurationStat = { count: number; avgMs: number; maxMs: number; p95LeSecs: number | null };

/** Миллисекунды словами: до минуты — секунды с десятыми («28,2 с»), дальше — как у очереди. */
export function formatMs(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "—";
	if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} ${translate("secShort")}`;
	return formatDuration(Math.round(ms / 1000));
}

/** Корзина 95-го перцентиля: null значит «дольше 300 с» — последней границы нет. */
export const p95Text = (p: number | null): string =>
	p === null ? `> 300 ${translate("secShort")}` : `≤ ${p} ${translate("secShort")}`;

export function durationRows(d: Record<string, DurationStat> | undefined): {
	type: string; count: number; avg: string; p95: string; max: string;
}[] {
	return Object.entries(d ?? {})
		.filter(([, s]) => !!s && typeof s.avgMs === "number")
		.sort((a, b) => b[1].avgMs - a[1].avgMs)
		.map(([type, s]) => ({
			type, count: s.count, avg: formatMs(s.avgMs), p95: p95Text(s.p95LeSecs ?? null), max: formatMs(s.maxMs),
		}));
}

export function failureRows(f: Record<string, number> | undefined): { code: string; count: number }[] {
	return Object.entries(f ?? {})
		.filter(([, n]) => typeof n === "number" && n > 0)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([code, count]) => ({ code, count }));
}
