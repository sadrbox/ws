/**
 * Форма «Организация базы 1С» (IbOrganizationForm) — правила без React: с каким объектом ERP связан реквизит 1С и чем
 * заполнить новый объект ERP, если связанного нет. Отдельным модулем — правила проверяются тестами, а в модуле-компоненте
 * только компоненты (Fast Refresh, памятка reference_fast_refresh_hubs).
 *
 * ПОЛЕ-ССЫЛКА ОТКРЫВАЕТСЯ ЗАПОЛНЕННЫМ. Реквизит 1С, у которого есть объект ERP, показывается LookupField-ом, и значение
 * в нём — уже найденный объект (uuid + подпись), а не пустое поле и не текст: организация — по БИН (её находит сервис),
 * банковский счёт — по IBAN среди счетов этой организации ERP, валюта — по коду, контактное лицо — по ФИО среди
 * контактных лиц организации ERP. Подпись — тем же полем, что показал бы сам LookupField после выбора (`displayField`),
 * иначе значение «прыгало» бы при первом же открытии списка.
 *
 * «СОЗДАТЬ» В ПОЛЕ — ИЗ РЕКВИЗИТОВ 1С. Связанного объекта нет — «Создать» у LookupField открывает форму ERP, уже
 * заполненную тем, что прочитано у 1С (`createDefaults`), с владельцем — организацией ERP. Ключи — ровно имена полей
 * формы ERP: useFormStore переносит в новую форму только известные ей поля. Созданный объект возвращается в поле
 * (write-back, памятка reference_lookup_write_back).
 */
import { translate } from "src/i18";
import { getFormatDateOnly } from "src/utils/datetime";
import { withStableIds } from "src/utils/stableRowId";
import type { TDataItem } from "src/components/Table/types";
import type { IbOrganization, OnecOrgContract, OnecOrgDetails } from "src/services/onec/api";

/** Значение поля-ссылки: uuid объекта ERP и подпись; пустой uuid — связи нет. */
export type ErpRef = { uuid: string; name: string };
export const NO_REF: ErpRef = { uuid: "", name: "" };

/** ФИО и наименования сравниваем без регистра, «ё», лишних пробелов и точек после инициалов. */
export const normName = (s: string | null | undefined): string =>
	(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/\./g, " ").replace(/\s+/g, " ").trim();

/** IBAN — без пробелов, заглавными: так его пишет и 1С, и ERP (services/orgFromOnec.iban). */
export const normIban = (s: string | null | undefined): string => (s ?? "").replace(/\s/g, "").toUpperCase();

/** Код валюты ISO — заглавными; числовой (398) и буквенный (KZT) сравниваются как есть. */
export const normCode = (s: string | null | undefined): string => (s ?? "").trim().toUpperCase();

export type ErpCurrency = { uuid: string; code: string; name?: string | null };
export type ErpBankAccount = { uuid: string; iban: string; name?: string | null };
export type ErpContactPerson = { uuid: string; fullName?: string | null };
export type ErpContact = { uuid: string; contactType?: string | null; value?: string | null };
export type ErpContract = {
	uuid: string; name?: string | null; contractNumber?: string | null;
	counterparty?: { uuid?: string | null; name?: string | null; bin?: string | null } | null;
};
export type ErpCounterparty = { uuid: string; name?: string | null; bin?: string | null };

/** Организация ERP строки: её нашёл сервис по БИН (`IbOrganization.erp`). */
export const erpOrganizationRef = (o: Pick<IbOrganization, "erp">): ErpRef =>
	(o.erp ? { uuid: o.erp.uuid, name: o.erp.name } : NO_REF);

/** Валюта ERP по коду из 1С; подпись — код, как у LookupField валют (`displayField="code"`). */
export function matchCurrency(list: readonly ErpCurrency[], code: string | null | undefined): ErpRef {
	const c = normCode(code);
	if (!c) return NO_REF;
	const hit = list.find((x) => normCode(x.code) === c);
	return hit ? { uuid: hit.uuid, name: hit.code } : NO_REF;
}

/** Банковский счёт организации ERP с тем же IBAN; подпись — IBAN (`displayField="iban"`). */
export function matchBankAccount(list: readonly ErpBankAccount[], iban: string | null | undefined): ErpRef {
	const n = normIban(iban);
	if (!n) return NO_REF;
	const hit = list.find((x) => normIban(x.iban) === n);
	return hit ? { uuid: hit.uuid, name: hit.iban } : NO_REF;
}

/**
 * Контактное лицо организации ERP с тем же ФИО. Двух одинаковых ФИО у организации быть не должно; если есть —
 * берём первое: связь только показывается, и открыть можно любое из них.
 */
export function matchContactPerson(list: readonly ErpContactPerson[], fullName: string | null | undefined): ErpRef {
	const n = normName(fullName);
	if (!n) return NO_REF;
	const hit = list.find((x) => normName(x.fullName) === n);
	return hit ? { uuid: hit.uuid, name: hit.fullName ?? "" } : NO_REF;
}

/** Владелец создаваемого объекта — организация ERP; без неё новый объект владельца не получает. */
const ownerOf = (org: ErpRef): Record<string, string> =>
	(org.uuid ? { ownerType: "organization", ownerUuid: org.uuid, ownerName: org.name } : {});

/** Новая организация ERP — теми же полями, что кладёт в неё «Создать организацию» из заявки (orgFromOnec). */
export function organizationCreateDefaults(o: Pick<IbOrganization, "name" | "bin" | "details">): Record<string, string> {
	const d = o.details ?? null;
	const out: Record<string, string> = {};
	const put = (k: string, v: string | null | undefined) => { if (v?.trim()) out[k] = v.trim(); };
	put("bin", o.bin?.replace(/\D/g, ""));
	put("name", o.name || d?.legalName);
	put("legalName", d?.legalName || o.name);
	put("vatSeries", d?.vatSeries);
	put("vatNumber", d?.vatNumber);
	return out;
}

type Person = NonNullable<OnecOrgDetails["director"]>;

/**
 * Новое контактное лицо организации ERP — ФИО и должность из 1С; пометка «(из 1С)» — та же, что ставит «Создать
 * организацию» (orgFromOnec.person): видно, откуда запись.
 */
export function contactPersonCreateDefaults(p: Person, fallbackRole: string, org: ErpRef): Record<string, string> {
	return {
		fullName: p.fullName.trim(),
		comment: `${p.position?.trim() || fallbackRole} (из 1С)`,
		...ownerOf(org),
	};
}

type Account = OnecOrgDetails["bankAccounts"][number];

/**
 * Новый банковский счёт организации ERP — IBAN, банк, БИК, КБе организации и валюта (уже найденная в ERP: подпись
 * «код — наименование», как её показывает форма счёта). Непохожий на КБе код не переносим — так же, как orgFromOnec.
 */
export function bankAccountCreateDefaults(a: Account, kbe: string | null | undefined, currency: ErpRef & { title?: string }, org: ErpRef): Record<string, string> {
	const out: Record<string, string> = { iban: normIban(a.iban) };
	if (a.bik?.trim()) out.bik = a.bik.replace(/\s/g, "").toUpperCase();
	if (a.bankName?.trim()) out.bankName = a.bankName.trim();
	if (kbe && /^\d{2}$/.test(kbe.trim())) out.kbe = kbe.trim();
	if (currency.uuid) { out.currencyUuid = currency.uuid; out.currencyName = currency.title || currency.name; }
	return { ...out, ...ownerOf(org) };
}

/** Новая валюта ERP — код из 1С; наименование человек впишет сам (1С его в реквизитах счёта не отдаёт). */
export const currencyCreateDefaults = (code: string | null | undefined): Record<string, string> =>
	(normCode(code) ? { code: normCode(code) } : {});

/** Счета в порядке показа: основной — первым, как в таблице вкладки (bankAccountsText). */
export const orderedAccounts = (d: OnecOrgDetails | null | undefined): Account[] =>
	[...(d?.bankAccounts ?? [])].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

// ── Табличные части карточки (28.09): SubTable над строками 1С — колонки 1С + поле-ссылка на объект ERP ─────────

/** Поле карточки строки: подпись и значение 1С («—», если пусто). */
export type CardField = { label: string; value: string };

/**
 * Строка табличной части. Колонки — значения 1С (по одной строке, без переноса — паттерн SubTable); все реквизиты —
 * в карточке строки (`card`, двойной щелчок). `title` — подпись пейна карточки. Ссылку на объект ERP форма кладёт в
 * строку сама: она зависит от найденного в ERP и выбранного в поле.
 */
export type OrgPartRow = TDataItem & { id: number; uuid: string; isPrimary?: boolean; title: string; card: CardField[] };

/**
 * Данные пейна карточки строки (IbOrgPartCard) — СЕРИАЛИЗУЕМЫЕ (памятка reference_lookup_write_back): реквизиты 1С
 * строки и поле-ссылка на объект ERP с тем значением и заполнением «Создать», что было в таблице при открытии.
 */
export type OrgPartCardData = {
	/** Что это: «Банковский счёт организации 1С», «Договор организации 1С»… */
	kind: string;
	title: string;
	fields: CardField[];
	erp: {
		label: string; endpoint: string; displayField: string; value: ErpRef;
		extraParams?: Record<string, string>; createDefaults: Record<string, string>;
	};
};

const field = (label: string, value: string | null | undefined): CardField => ({ label, value: value?.trim() || "—" });
const dateText = (v: string | null | undefined): string | null => (v ? getFormatDateOnly(v) || v : null);
const yesNo = (v: boolean) => translate(v ? "yes" : "no");

/** Наименование счёта: как в 1С, а пока агент его не шлёт (задача агенту Д3) — банк, иначе IBAN. */
export const accountName = (a: Account): string => a.name?.trim() || a.bankName?.trim() || a.iban;

export type AccountRow = OrgPartRow & { account: Account; name: string; iban: string };

/** Счета: основной — первым и полужирным, ключ строки — IBAN. */
export const accountRows = (d: OnecOrgDetails | null | undefined): AccountRow[] =>
	withStableIds(orderedAccounts(d), (a) => normIban(a.iban)).map((a) => ({
		id: a.id, uuid: normIban(a.iban), isPrimary: a.isPrimary, account: a,
		name: accountName(a), iban: a.iban, title: accountName(a),
		card: [
			field(translate("name"), a.name ?? null),
			field(translate("iban"), a.iban),
			field(translate("onecOrgBank"), a.bankName),
			field(translate("bik"), a.bik),
			field(translate("currency"), a.currency),
			field(translate("isPrimary"), yesNo(a.isPrimary)),
		],
	}));

export type PersonRow = OrgPartRow & { key: string; role: string; person: Person; fullName: string; onecOrgPosition: string };

/** Ответственные лица: руководитель и главный бухгалтер — кто указан. */
export function personRows(d: OnecOrgDetails | null | undefined): PersonRow[] {
	const list = [
		{ key: "director", role: translate("onecReqOrgDirector"), person: d?.director ?? null },
		{ key: "chief", role: translate("onecReqOrgChiefAccountant"), person: d?.chiefAccountant ?? null },
	].filter((x): x is { key: string; role: string; person: Person } => !!x.person);
	return withStableIds(list, (x) => x.key).map((x) => ({
		id: x.id, uuid: x.key, key: x.key, role: x.role, person: x.person,
		fullName: x.person.fullName, onecOrgPosition: x.person.position ?? "", title: x.person.fullName,
		card: [
			field(translate("role"), x.role),
			field(translate("fullName"), x.person.fullName),
			field(translate("onecOrgPosition"), x.person.position),
		],
	}));
}

/** Вид контакта ERP (Contact.contactType) — те же, что заводит «Создать организацию» (backend services/orgFromOnec). */
export type ContactKind = "legal_address" | "actual_address" | "telephone" | "email" | "website";
/** `contactType` — подпись вида (колонка), `kind` — код вида ERP (сопоставление и «Создать»). */
export type ContactRow = OrgPartRow & { kind: ContactKind; contactType: string; value: string };

/**
 * Контакты: адреса, телефоны, почта, сайт — по строке на значение, как их заводит в ERP «Создать организацию».
 * Первое значение каждого вида — основное (полужирное), фактический адрес, совпавший с юридическим, — не второй адрес.
 */
export function contactRows(d: OnecOrgDetails | null | undefined): ContactRow[] {
	if (!d) return [];
	const list: { kind: ContactKind; value: string; isPrimary: boolean }[] = [];
	if (d.legalAddress) list.push({ kind: "legal_address", value: d.legalAddress, isPrimary: true });
	if (d.actualAddress && d.actualAddress !== d.legalAddress) list.push({ kind: "actual_address", value: d.actualAddress, isPrimary: true });
	d.phones.forEach((v, i) => list.push({ kind: "telephone", value: v, isPrimary: i === 0 }));
	d.emails.forEach((v, i) => list.push({ kind: "email", value: v, isPrimary: i === 0 }));
	if (d.website) list.push({ kind: "website", value: d.website, isPrimary: true });
	return withStableIds(list, (x) => `${x.kind}:${x.value}`).map((x) => {
		const label = translate(`ct_${x.kind}`);
		return {
			id: x.id, uuid: `${x.kind}:${x.value}`, kind: x.kind, contactType: label, value: x.value, isPrimary: x.isPrimary,
			title: `${label}: ${x.value}`,
			card: [field(translate("contactType"), label), field(translate("value"), x.value), field(translate("isPrimary"), yesNo(x.isPrimary))],
		};
	});
}

export type ContractRow = OrgPartRow & { contract: OnecOrgContract; name: string; contractNumber: string; date: string; counterparty: string };

/** Договоры в порядке агента (от новых к старым); ключ — ссылка 1С, иначе наименование, номер и контрагент. */
export const contractRows = (d: OnecOrgDetails | null | undefined): ContractRow[] =>
	// Договор — внутри строки: withStableIds кладёт номер строки в `id`, а у договора `id` — ссылка 1С.
	withStableIds((d?.contracts ?? []).map((c, i) => ({
		contract: c, key: c.id || `${c.name}|${c.number ?? ""}|${c.counterparty?.bin ?? c.counterparty?.name ?? ""}#${i}`,
	})), (x) => x.key).map(({ id, key, contract: c }) => ({
		id, uuid: key, contract: c,
		name: c.name, contractNumber: c.number ?? "", date: dateText(c.date) ?? "", counterparty: c.counterparty?.name ?? "",
		title: c.name,
		card: [
			field(translate("name"), c.name),
			field(translate("contractNumber"), c.number),
			field(translate("date"), dateText(c.date)),
			field(translate("onecOrgContractValidUntil"), dateText(c.validUntil)),
			field(translate("onecOrgContractKind"), c.kind),
			field(translate("currency"), c.currency),
			field(translate("counterparty"), c.counterparty?.name),
			field(translate("binIin"), c.counterparty?.bin),
		],
	}));

/** Телефон сравниваем по цифрам, прочее — без регистра и лишних пробелов. */
const contactKey = (type: string, v: string | null | undefined): string =>
	(type === "telephone" ? (v ?? "").replace(/\D/g, "") : normName(v));

/** Контакт организации ERP того же вида и с тем же значением; подпись — значение (`displayField="value"`). */
export function matchContact(list: readonly ErpContact[], type: string, value: string): ErpRef {
	const k = contactKey(type, value);
	if (!k) return NO_REF;
	const hit = list.find((x) => x.contactType === type && contactKey(type, x.value) === k);
	return hit ? { uuid: hit.uuid, name: hit.value ?? "" } : NO_REF;
}

const normNumber = (s: string | null | undefined): string => (s ?? "").toLowerCase().replace(/[\s№#]/g, "");

/**
 * Договор организации ERP: у того же контрагента (по БИН) — с тем же номером, а без номера — с тем же наименованием.
 * Контрагента без БИН не сравниваем по имени: одноимённых контрагентов больше, чем кажется.
 */
export function matchContract(list: readonly ErpContract[], c: OnecOrgContract): ErpRef {
	const bin = c.counterparty?.bin?.replace(/\D/g, "") ?? "";
	if (!bin) return NO_REF;
	const same = list.filter((x) => (x.counterparty?.bin ?? "").replace(/\D/g, "") === bin);
	const byNumber = c.number ? same.find((x) => normNumber(x.contractNumber) === normNumber(c.number)) : undefined;
	const hit = byNumber ?? (c.number ? undefined : same.find((x) => normName(x.name) === normName(c.name)));
	return hit ? { uuid: hit.uuid, name: hit.name ?? "" } : NO_REF;
}

/** Контрагент организации ERP с БИН контрагента договора — для «Создать» договора. */
export function matchCounterparty(list: readonly ErpCounterparty[], bin: string | null | undefined): ErpRef {
	const b = (bin ?? "").replace(/\D/g, "");
	if (!b) return NO_REF;
	const hit = list.find((x) => (x.bin ?? "").replace(/\D/g, "") === b);
	return hit ? { uuid: hit.uuid, name: hit.name ?? "" } : NO_REF;
}

/** Новый контакт организации ERP — вид и значение из 1С. */
export const contactCreateDefaults = (type: string, value: string, org: ErpRef): Record<string, string> =>
	({ contactType: type, value, ...ownerOf(org) });

/**
 * Новый договор организации ERP — наименование, номер, даты (формат поля даты формы — `ГГГГ-ММ-ДД`), организация и
 * контрагент, если он уже есть в ERP. Нет контрагента — поле пустое: заводить контрагента молча форма не должна.
 */
export function contractCreateDefaults(c: OnecOrgContract, org: ErpRef, counterparty: ErpRef): Record<string, string> {
	const out: Record<string, string> = { name: c.name };
	if (c.number) out.contractNumber = c.number;
	if (c.date) out.startDate = c.date.slice(0, 10);
	if (c.validUntil) out.endDate = c.validUntil.slice(0, 10);
	if (org.uuid) { out.organizationUuid = org.uuid; out.organizationName = org.name; }
	if (counterparty.uuid) { out.counterpartyUuid = counterparty.uuid; out.counterpartyName = counterparty.name; }
	return out;
}
