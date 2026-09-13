/**
 * Итог проверки наличия баз данных (P2, docs/TASKS_ONEC_FIXES_2026-09-13.md) — словами.
 *
 * ПРОВЕДЁННАЯ И НЕПРОВЕДЁННАЯ ПРОВЕРКА — РАЗНЫЕ ОТВЕТЫ. Агент без пароля СУБД возвращает
 * список без признаков и `note` «проверить нечем». Показать это успехом «Проверено: 0, нет
 * базы данных: 0» значило бы сказать «всё в порядке» там, где никто ничего не проверял.
 * Поэтому `note` делает итог предупреждением и называет причину.
 *
 * Отдельным модулем: итог проверяется тестом, а не-компонентный экспорт в модуле с
 * компонентом ломает Fast Refresh всему файлу.
 */
import { translate } from "src/i18";
import type { CheckBasesResult } from "src/services/onec/api";

export type CheckDbOutcome = {
	severity: "success" | "warning";
	text: string;
	checked: number;
	missing: number;
};

export function checkDbOutcome(d: CheckBasesResult): CheckDbOutcome {
	const items = Array.isArray(d.items) ? d.items : [];
	const missing = items.filter((i) => i.dbMissing === true).length;
	// Число проверенных — от агента; старая форма без него — по строкам с признаком.
	const checked = typeof d.checked === "number"
		? d.checked
		: items.filter((i) => typeof i.dbMissing === "boolean").length;
	const summary = `${translate("onecBasesDbChecked")}: ${checked}, ${translate("onecBasesDbMissing")}: ${missing}`;
	const note = typeof d.note === "string" ? d.note.trim() : "";
	return note
		? { severity: "warning", text: `${summary}. ${note}`, checked, missing }
		: { severity: "success", text: summary, checked, missing };
}
