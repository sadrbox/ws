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
	/*
	 * КАКИЕ БАЗЫ НЕ ПРОВЕРЕНЫ И ПОЧЕМУ (П6). Число пропущенных приходило, но не показывалось, а
	 * базы без признака читались как «всё в порядке». Называем их — с причиной, если агент её дал.
	 */
	/*
	 * ОТЛОЖЕННЫЕ — НЕ ОШИБКА (С32, агент 16:23). По базе с идущей операцией агента ibcmd её не открывает, чтобы не
	 * помешать; её решит следующая проверка. Считать такие «не проверены» предупреждением значило бы звать
	 * человека разбираться с тем, что в порядке.
	 */
	// По признаку `busy` (агент 17:30, П22); текст — запасной путь для старых сборок.
	const isBusy = (i: { reason?: string; busy?: boolean }) => i.busy === true || /идёт операция агента/i.test(i.reason ?? "");
	const busy = items.filter((i) => typeof i.dbMissing !== "boolean" && isBusy(i));
	const unchecked = items.filter((i) => typeof i.dbMissing !== "boolean" && !isBusy(i));
	const skipped = Math.max(0, (typeof d.skipped === "number" ? d.skipped : unchecked.length + busy.length) - busy.length);
	const LIST = 10;
	const named = unchecked.slice(0, LIST).map((i) => (i.reason ? `${i.key} — ${i.reason}` : i.key));
	const skippedText = skipped > 0
		? `${translate("onecBasesDbNotChecked")}: ${skipped}${named.length ? ` (${named.join("; ")}${unchecked.length > LIST ? "; …" : ""})` : ""}`
		: "";
	const busyText = busy.length
		? `${translate("onecBasesDbBusy")}: ${busy.length} (${busy.slice(0, LIST).map((i) => i.key).join(", ")}${busy.length > LIST ? ", …" : ""})`
		: "";
	const text = [summary, skippedText, busyText, note].filter(Boolean).join(". ");
	return { severity: note || skipped > 0 ? "warning" : "success", text, checked, missing };
}
