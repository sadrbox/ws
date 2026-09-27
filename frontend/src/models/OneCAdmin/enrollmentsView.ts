/**
 * Заявки агентов (СВ5) — правила отображения без JSX (ради тестов и Fast Refresh).
 */
import { translate } from "src/i18";
import type { AgentEnrollment } from "src/services/onec/api";

/** Сколько ещё ожидающих заявок у той же службы: считает сервис (Б11 аудита 26.09); старый сервис поля не отдаёт. */
export const siblingsCount = (e: Pick<AgentEnrollment, "state" | "pendingSiblings">): number =>
	e.state === "PENDING" ? Math.max(0, Number(e.pendingSiblings ?? 0)) : 0;

/**
 * Предупреждение к одобрению: две ожидающие заявки одной службы — повтор без секрета завёл новую, и одобрение одной
 * отклонит остальные. Одобрять надо строго по коду, который продиктовали, иначе токен уйдёт не той службе.
 */
export function siblingsWarning(e: Pick<AgentEnrollment, "state" | "pendingSiblings">): string | null {
	const n = siblingsCount(e);
	return n > 0 ? translate("onecEnrollSiblingsWarn").replace("{n}", String(n)) : null;
}
