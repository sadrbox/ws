/**
 * Базы бизнес-агента и лимит тарифа (ПН, 19.09) — правила отображения без JSX.
 *
 * Решение «сверх лимита» принимает сервис (тем же правилом, по которому отвергает команды); панель только
 * называет его словами. Отдельно от компонента — ради тестов и Fast Refresh.
 */
import { translate } from "src/i18";
import type { AgentBaseRow, AgentLimits } from "src/services/onec/api";

/** «3 из 5»; без лимита — «3 (без ограничения)». */
export function usageText(used: number, max: number | null): string {
	if (max === null) return `${used} (${translate("onecLimitNone")})`;
	return translate("onecLimitOf").replace("{used}", String(used)).replace("{max}", String(max));
}

/** Подключено больше, чем разрешено тарифом. */
export const overUsage = (used: number, max: number | null): boolean => max !== null && used > max;

/** Поле лимита: пусто — без ограничения; целое ≥ 0 — число; остальное — `undefined` (ошибка ввода). */
export function parseLimitInput(text: string): number | null | undefined {
	const t = text.trim();
	if (!t) return null;
	return /^\d{1,6}$/.test(t) ? Number(t) : undefined;
}

export const limitInput = (v: number | null): string => (v === null ? "" : String(v));

/** Одинаковы ли два лимита — чтобы не предлагать сохранить то, что уже сохранено. */
export const sameLimits = (a: AgentLimits, b: AgentLimits): boolean => a.maxBases === b.maxBases && a.maxBins === b.maxBins;

export type BaseState = "overLimit" | "online" | "offline" | "unknown";

/** Состояние базы одним словом. «Сверх лимита» главнее связи: команды в неё не уходят, даже если она на связи. */
export function baseState(b: Pick<AgentBaseRow, "status" | "overLimit" | "overLimitService">): BaseState {
	if (b.overLimitService || b.overLimit === true || b.status === "OVER_LIMIT") return "overLimit";
	if (b.status === "ONLINE") return "online";
	if (b.status === "OFFLINE") return "offline";
	return "unknown";
}

export const baseStateLabel = (s: BaseState): string => ({
	overLimit: translate("onecOverLimit"),
	online: translate("onecAgentOnline"),
	offline: translate("onecAgentOffline"),
	unknown: "—",
}[s]);

export const transportLabel = (t: AgentBaseRow["transport"]): string => (t === "http" ? "HTTP" : t === "com" ? "COM" : "—");
