import { translate } from "src/i18";

/**
 * Проведённый кассовый ордер — только с суммой больше нуля (аудит 26.09, У8). Правило проводки
 * при нулевой сумме молча отдаёт пустой набор: документ «проведён», а в кассе и ГК его нет.
 * Черновик с пустой суммой записать можно. Возвращает текст для формы или "".
 */
export function cashAmountError(fields: { posted?: boolean; amount?: string | number | null }): string {
	if (fields.posted !== true) return "";
	const n = typeof fields.amount === "number" ? fields.amount : parseFloat(String(fields.amount ?? "").replace(",", "."));
	return Number.isFinite(n) && n > 0 ? "" : translate("cashOrderAmountPositive");
}
