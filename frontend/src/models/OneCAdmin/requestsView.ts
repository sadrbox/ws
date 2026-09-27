/**
 * Заявки на подключение баз и запросы активации БИНов (СВ4) — правила отображения без JSX.
 *
 * Отдельно от компонентов — ради тестов и Fast Refresh.
 */
import { translate } from "src/i18";
import { getFormatDateOnly } from "src/utils/datetime";
import type {
	ActivationState, BaseRegistration, ErpOrganization, OnecOrgDetails, RegistrationOrganization, RegistrationState,
} from "src/services/onec/api";

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

/** БИН из заявки — по цифрам: 1С может прислать его с пробелами. Не 12 цифр — не БИН. */
export const registrationBin = (v?: string | null): string | null => {
	const d = String(v ?? "").replace(/\D/g, "");
	return /^\d{12}$/.test(d) ? d : null;
};

/**
 * Организации заявки, которых нет в ERP (26.09): одобрить заявку без организации ERP нельзя, и панель предлагает
 * создать её из реквизитов, пришедших из 1С. `bin: null` — БИН не пришёл, и создать такую нельзя: организация ERP
 * без БИН не бывает, а выдумывать его нельзя.
 */
export function missingOrganizations(r: BaseRegistration): { org: RegistrationOrganization; bin: string | null }[] {
	return r.organizations.filter((o) => !o.erp).map((o) => ({ org: o, bin: registrationBin(o.bin) }));
}

/** Реквизиты из 1С строками «подпись — значение»: человек видит, что именно запишется в ERP, до нажатия. */
export function orgDetailsLines(d: OnecOrgDetails | null | undefined): { label: string; value: string }[] {
	if (!d) return [];
	const person = (p: { fullName: string; position: string | null } | null) => (p ? `${p.fullName}${p.position ? `, ${p.position}` : ""}` : null);
	const vat = [d.vatSeries, d.vatNumber].filter(Boolean).join(" № ");
	const lines: [string, string | null][] = [
		[translate("legalName"), d.legalName],
		[translate("onecReqOrgVat"), vat ? `${vat}${d.vatDate ? ` (${getFormatDateOnly(d.vatDate) || d.vatDate})` : ""}` : null],
		[translate("onecReqOrgLegalAddress"), d.legalAddress],
		[translate("onecReqOrgActualAddress"), d.actualAddress && d.actualAddress !== d.legalAddress ? d.actualAddress : null],
		[translate("phone"), d.phones.join(", ") || null],
		[translate("email"), d.emails.join(", ") || null],
		[translate("onecReqOrgDirector"), person(d.director)],
		[translate("onecReqOrgChiefAccountant"), person(d.chiefAccountant)],
		[translate("BankAccountsList"), d.bankAccounts.map((a) => [a.iban, a.bankName, a.currency].filter(Boolean).join(" · ")).join("; ") || null],
		[translate("kbe"), d.bankAccounts.length ? d.kbe : null],
	];
	return lines.filter((x): x is [string, string] => !!x[1]).map(([label, value]) => ({ label, value }));
}
