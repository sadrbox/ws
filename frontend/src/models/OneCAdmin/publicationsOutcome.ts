/**
 * Итог проверки публикаций внутри «Обновить» списка баз (17.09) — словами, и только когда есть что сказать.
 *
 * «Обновить» перечитывает список баз и публикации одним запросом. Успешный срез публикаций говорить нечего: его
 * видно в колонке «Публикация». А вот срез, который сервис не принял (ни одной опубликованной базы — неотличимо от
 * неудачного чтения), отказ агента и сервис старее правки — человеку нужно знать, иначе «Обновить» молча оставит
 * прежнее состояние публикаций и выдаст его за свежее.
 *
 * Отдельным модулем: итог проверяется тестом, а не-компонентный экспорт в модуле с компонентом ломает Fast Refresh.
 */
import { translate } from "src/i18";
import type { DbCheckRefresh, PublicationReport, PublicationsRefresh } from "src/services/onec/api";

/** Разбор среза, который сервис не принял, — с тем, где агент искал. `null` — срез принят. */
export function rejectedReportText(r: PublicationReport): string | null {
	if (r.accepted) return null;
	const where = r.lookedIn
		? ` ${translate("onecPublicationsLookedIn")}: ${r.lookedIn}${r.source ? ` (${r.source})` : ""}.`
		: "";
	return `${translate("onecPublicationsNoneFound")} ${translate("onecPublicationsNotApplied")}${where}`;
}

/**
 * Что сказать о публикациях после «Обновить»: `null` — ничего (приняты, ещё идут или сервис их не проверял).
 * Ожидание (`pending`) здесь не решается: его дожидаются отдельно и разбирают тем же `rejectedReportText`.
 */
export function publicationsProblem(p: PublicationsRefresh | undefined): string | null {
	if (!p || "pending" in p) return null;
	if ("error" in p) {
		const message = p.error?.message?.trim();
		return `${translate("onecPublicationsCheckFailed")}${message ? `: ${message}` : ""}`;
	}
	return rejectedReportText(p.report);
}

/**
 * Что сказать о выборочной проверке баз данных после «Обновить» (18.09): `null` — ничего.
 *
 * Молчим, когда проверять было нечего или всё на месте: человек нажал «Обновить», а не «Проверить базы данных».
 * Говорим, когда база из СУБД пропала — это то, ради чего проверка и нужна, — и когда проверка не выполнена.
 */
export function dbCheckProblem(d: DbCheckRefresh | undefined): { severity: "warning"; text: string } | null {
	if (!d || "pending" in d) return null;
	if ("error" in d) {
		const message = d.error?.message?.trim();
		return { severity: "warning", text: `${translate("onecBasesDbCheckFailed")}${message ? `: ${message}` : ""}` };
	}
	if (!d.missing) return null;
	return {
		severity: "warning",
		text: `${translate("onecBasesDbChecked")}: ${d.checked}, ${translate("onecBasesDbMissing")}: ${d.missing}`,
	};
}
