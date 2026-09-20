/**
 * Заявки на подключение баз и запросы активации БИНов (СВ4) — правила отображения без JSX.
 *
 * Отдельно от компонентов — ради тестов и Fast Refresh.
 */
import { translate } from "src/i18";
import type { ActivationState, BaseRegistration, ErpOrganization, RegistrationState } from "src/services/onec/api";

export const registrationStateLabel = (s: RegistrationState): string => ({
	PENDING: translate("onecReqPending"),
	APPROVED: translate("onecReqApproved"),
	REJECTED: translate("onecReqRejected"),
	EXPIRED: translate("onecReqExpired"),
}[s]);

export const activationStateLabel = (s: ActivationState): string => ({
	PENDING: translate("onecReqPending"),
	APPROVED: translate("onecReqApproved"),
	REJECTED: translate("onecReqRejected"),
}[s]);

/** Тон состояния — цвет поддерживает слово, а не заменяет его. */
export const stateTone = (s: RegistrationState | ActivationState): "wait" | "ok" | "bad" | "off" =>
	s === "PENDING" ? "wait" : s === "APPROVED" ? "ok" : s === "REJECTED" ? "bad" : "off";

/** Конфигурация одной строкой: «БухгалтерияДляКазахстана 3.0.44.1». */
export function configurationText(r: BaseRegistration): string {
	const c = r.base.configuration;
	return [c?.synonym || c?.name, c?.version].filter(Boolean).join(" ") || "—";
}

/** Где база: сервер 1С для серверной, компьютер — для файловой. */
export function whereText(r: BaseRegistration): string {
	if (r.base.kind === "file") return `${translate("onecReqFileBase")}${r.base.computer ? `, ${r.base.computer}` : ""}`;
	return [r.base.server, r.base.computer && r.base.computer !== r.base.server ? r.base.computer : null].filter(Boolean).join(" · ") || "—";
}

/** Что предложить при одобрении: организация ERP с тем же БИН, иначе пусто — выберет человек. */
export function approveDefaults(r: BaseRegistration): { organizationUuid: string; baseKey: string; baseId: string } {
	return {
		organizationUuid: r.suggestion.organizationUuid ?? "",
		baseKey: r.suggestion.baseKey,
		// Одна база реестра с этим ключом — она и есть; несколько — выбирает человек; нет — заведётся новая.
		baseId: r.suggestion.candidates.length === 1 ? r.suggestion.candidates[0].baseId : "",
	};
}

/** Варианты выбора организации ERP: совпавшие по БИН — первыми, с пометкой. */
export function organizationOptions(orgs: ErpOrganization[], r: BaseRegistration): { value: string; label: string }[] {
	const matched = new Set(r.organizations.map((o) => o.erp?.uuid).filter(Boolean));
	const label = (o: ErpOrganization) => `${o.name}${o.bin ? ` (${o.bin})` : ""}${matched.has(o.uuid) ? ` — ${translate("onecReqBinMatch")}` : ""}`;
	const first = orgs.filter((o) => matched.has(o.uuid));
	const rest = orgs.filter((o) => !matched.has(o.uuid));
	return [{ value: "", label: "—" }, ...first.map((o) => ({ value: o.uuid, label: label(o) })), ...rest.map((o) => ({ value: o.uuid, label: label(o) }))];
}
