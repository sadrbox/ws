/**
 * Список агентов (п. 4, 5) — отборы и сводка «не на связи» без JSX: ради тестов и Fast Refresh.
 */
import type { OnecAgent } from "src/services/onec/api";

export type AgentRoleFilter = "" | "business" | "admin";
export type AgentStateFilter = "" | "online" | "offline" | "disabled";

/** Подходит ли агент под отборы. «Не на связи» — только включённые: отключённый молчит намеренно. */
export function agentMatches(a: Pick<OnecAgent, "role" | "online" | "disabled">, role: AgentRoleFilter, state: AgentStateFilter): boolean {
	if (role && a.role !== role) return false;
	if (state === "online") return !a.disabled && a.online;
	if (state === "offline") return !a.disabled && !a.online;
	if (state === "disabled") return a.disabled;
	return true;
}

/**
 * Кто пропал со связи: включённые и молчащие, дольше всех молчащие — первыми. `since` — последний сигнал; нет —
 * агент ни разу не выходил на связь (заведён, служба не запущена).
 */
export function agentOfflineSummary(items: readonly Pick<OnecAgent, "id" | "name" | "online" | "disabled" | "lastSeenAt">[]): { id: string; name: string; since: string | null }[] {
	return items
		.filter((a) => !a.disabled && !a.online)
		.map((a) => ({ id: a.id, name: a.name || a.id.slice(0, 8), since: a.lastSeenAt }))
		.sort((x, y) => (x.since ?? "").localeCompare(y.since ?? ""));
}
