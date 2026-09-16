/**
 * СКОЛЬКО ЖДАТЬ И ЧЕГО ЖДЁТ ОЧЕРЕДЬ.
 *
 * ЗАЧЕМ. Человек запускает проверку ста десяти баз и видит счётчик «сделано 7 из 110». Из
 * него не следует главного: это сорок минут или три. А команда в состоянии «в очереди»
 * выглядит так же, как выполняющаяся, — не отличить «агент занят другой базой» от «агента
 * нет на связи». Оба ответа есть в данных сервиса, их просто никто не спрашивал.
 *
 * ОЦЕНКА СТРОИТСЯ НА ИЗМЕРЕННОМ, а не на константе в коде: сервис считает среднюю
 * длительность по каждому типу команд за неделю (время от выдачи агенту до ответа). На
 * живом сервере это 19 с на чтение пользователей базы и 34 с на чтение расширений — разница
 * почти вдвое, и общее среднее не сказало бы ни о чём.
 */
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { fetchQueueStats, type OnecQueueStats } from "src/services/onec/api";

/** Состояние очереди опрашивается редко: это справка, а не наблюдение за командой. */
export const useQueueStats = () => useQuery({
	queryKey: ["onec", "queue-stats"],
	queryFn: fetchQueueStats,
	staleTime: 30_000,
	refetchInterval: 60_000,
});

/**
 * Сколько займёт операция: число баз × средняя длительность ÷ параллельность.
 *
 * Ноль означает «сказать нечего» — типа не видели ни разу. Врать округлым числом в такой
 * ситуации хуже, чем молчать: человек поверит.
 */
export function estimateSecs(
	stats: OnecQueueStats | undefined, type: string, count: number,
): number {
	if (!stats || count <= 0) return 0;
	const known = stats.types.find((t) => t.type === type);
	if (!known || !known.avgSecs || known.samples < 3) return 0;
	const parallel = Math.max(1, stats.ibParallel || 1);
	return Math.round((known.avgSecs * count) / parallel);
}

/**
 * Длительность словами. Секунды — до минуты, дальше минуты, после часа — часы и минуты:
 * «2 700 секунд» верно и бесполезно.
 */
export function formatDuration(secs: number): string {
	if (secs <= 0) return "";
	if (secs < 60) return `${secs} ${translate("secShort")}`;
	const mins = Math.round(secs / 60);
	if (mins < 60) return `${mins} ${translate("minShort")}`;
	const hours = Math.floor(mins / 60);
	const rest = mins % 60;
	return rest
		? `${hours} ${translate("hourShort")} ${rest} ${translate("minShort")}`
		: `${hours} ${translate("hourShort")}`;
}

/**
 * ЧЕГО ЖДЁТ ОЧЕРЕДЬ — словами, а не состоянием команды.
 *
 * Три разных ответа, которые раньше выглядели одинаково: некому забрать (агента нет на
 * связи), агент занят другой базой, и «идёт работа». Первый чинится на сервере 1С, второй —
 * терпением, третий не чинится вовсе.
 */
export function queueReason(stats: OnecQueueStats | undefined): string {
	if (!stats || (!stats.queued && !stats.running)) return "";
	if (!stats.agentsOnline) return translate("onecQueueNoAgent");
	if (stats.queued && stats.agentsBusy) return translate("onecQueueAgentBusy");
	if (stats.queued) return translate("onecQueueWaiting");
	return translate("onecQueueRunning");
}


/**
 * ВРЕМЯ ПО ЭТАПАМ — одной строкой (П28): «вход в базу 3 мин 12 с; запись 41 с». Отвечает на «почему так долго»: у
 * типовой на БСП минуты обычно уходят на вход в базу, а не на саму операцию. Этапы короче секунды не показываем.
 */
export function stagesText(stages: { name: string; ms: number }[] | null | undefined): string {
	const parts = (stages ?? [])
		.filter((s) => s && typeof s.name === "string" && typeof s.ms === "number" && s.ms >= 1000)
		.map((s) => `${s.name} ${formatDuration(Math.round(s.ms / 1000))}`);
	return parts.join("; ");
}
