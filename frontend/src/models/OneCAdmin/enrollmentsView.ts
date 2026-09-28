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

/**
 * ПОЧЕМУ ЭТУ ЗАЯВКУ НЕЛЬЗЯ ОДОБРИТЬ — есть более новая той же службы (КР-20 аудита 27.09; код называет сервис,
 * `newerPendingCode`). Агент сборки 19.09 повторяет заявку без секрета опроса, получает НОВУЮ и опрашивает уже её:
 * одобрение прежней отклонило бы ту, что ждёт агент, и токен не забрал бы никто. Сервис такое одобрение отклоняет
 * (409), панель объясняет заранее. `null` — можно (и когда сервис старее панели и поля не отдаёт).
 */
export function approveBlockReason(e: Pick<AgentEnrollment, "state" | "code" | "newerPendingCode">): string | null {
	if (e.state !== "PENDING" || !e.newerPendingCode) return null;
	return translate("onecEnrollNewerPending").replace(/\{code\}/g, e.newerPendingCode).replace("{own}", e.code);
}

/** Колонка «Ещё заявки службы»: более новая заявка важнее счётчика — её код и надо искать в окне агента. */
export function siblingsCell(e: Pick<AgentEnrollment, "state" | "pendingSiblings" | "newerPendingCode">): string {
	if (e.state === "PENDING" && e.newerPendingCode) return `${translate("onecEnrollNewerShort")} ${e.newerPendingCode}`;
	const n = siblingsCount(e);
	return n ? `${n} — ${translate("onecEnrollSiblingsShort")}` : "—";
}
