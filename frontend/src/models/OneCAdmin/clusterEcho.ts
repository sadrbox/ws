/**
 * Список сеансов или соединений из ответа на их снятие.
 *
 * Агент `0.1.0+2026-09-13 12:12` и новее прикладывает к `CLUSTER_TERMINATE_SESSION` и
 * `CLUSTER_DISCONNECT` список всего кластера, прочитанный сразу после снятия. Раньше панель
 * после каждого снятия перечитывала список второй командой — ещё одно место в очереди агента
 * и ещё один проход `rac` ради того, что агент уже знал.
 * Спецификация: docs/TASK_PANEL_SESSIONS_ECHO.md.
 */
import type { ClusterListEcho } from "src/services/onec/api";

/**
 * СПИСОК ИЗ ОТВЕТА НА СНЯТИЕ — или null, и тогда перечитать, как раньше.
 *
 * null — старый агент или недочитанный кластер: частичный список показал бы закрытыми
 * сеансы, которые живы. Пустой полный список законен: снят последний сеанс, таблица
 * должна опустеть.
 */
export function echoList(
	result: { state?: Partial<Record<"sessions" | "connections" | "locks", ClusterListEcho>> } | undefined,
	what: "sessions" | "connections" | "locks",
): ClusterListEcho | null {
	const echo = result?.state?.[what];
	return echo && echo.complete === true && Array.isArray(echo.items) ? echo : null;
}
