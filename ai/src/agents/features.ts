/**
 * «АГЕНТ УСТАРЕЛ» И ЧЕГО В ЕГО СБОРКЕ НЕТ (R3, docs/TASKS_DEV_2026-09-14.md).
 *
 * Агенту менять нечего: версия со сборкой («0.1.0+2026-09-14 23:16 (+05)») и способности приходят в
 * регистрации и heartbeat. Сервис сравнивает сборку с эталоном из настройки и называет функции
 * панели, которых эта сборка не умеет, — чтобы «кнопка не работает» читалось как «обновите агента»,
 * а не как поломка.
 */
import type { DurationStat } from "./commandStats.ts";

/** Сборка из строки версии: «ГГГГ-ММ-ДД чч:мм»; не разобрали — null. */
export function agentBuild(version: string | null | undefined): string | null {
	const m = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(version ?? "");
	return m ? `${m[1]} ${m[2]}` : null;
}

/**
 * Старше ли сборка эталона. null — сравнивать не с чем: эталон не задан или сборку не разобрали.
 * Строки вида «ГГГГ-ММ-ДД чч:мм» сравниваются как строки — порядок совпадает со временем.
 */
export function buildOutdated(version: string | null | undefined, latest: string | undefined): boolean | null {
	const want = agentBuild(latest);
	const have = agentBuild(version);
	if (!want || !have) return null;
	return have < want;
}

/** Функции панели, которые требуют чего-то от агента. Ключи — панель переводит их в слова. */
export type AgentFeature = "abort" | "roles" | "commandStats" | "health" | "log" | "selftest";

/**
 * Чего не хватает сборке. Только у админ-агента: бизнес-агенту эти функции не нужны вовсе.
 * Типы команд проверяются, если агент перечисляет их в способностях (как делает agentCanRun);
 * не перечисляет ни одного — сборка старше перечня, и служебных команд у неё нет.
 */
export function missingFeatures(agent: {
	role: string; capabilities: string[];
	commandStats: { durationsByType?: Record<string, DurationStat> } | null;
}): AgentFeature[] {
	if (agent.role !== "admin") return [];
	const has = (c: string) => agent.capabilities.includes(c);
	const out: AgentFeature[] = [];
	if (!has("agent.cancel")) out.push("abort");
	if (!has("ib.roles")) out.push("roles");
	if (!agent.commandStats) out.push("commandStats");
	if (!has("AGENT_HEALTH")) out.push("health");
	if (!has("AGENT_LOG_TAIL")) out.push("log");
	if (!has("IB_SELFTEST")) out.push("selftest");
	return out;
}
