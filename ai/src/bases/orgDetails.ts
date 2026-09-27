// Реквизиты организации из заявки на подключение базы (СВ4, docs/CONTRACT_BASE_REGISTRATION_2026-09-19.md,
// «Реквизиты организаций в заявке», 26.09).
//
// Зачем: база подаёт заявку, а её организации в ERP может ещё не быть. Одобрить заявку без организации ERP нельзя
// (на неё выпускается токен базы), и раньше администратор BuhProf заводил организацию руками, переписывая
// реквизиты с экрана 1С. Теперь 1С кладёт реквизиты в заявку, и панель создаёт организацию одной кнопкой.
//
// РАЗБОР МЯГКИЙ, А НЕ СТРОГИЙ. Заявка — единственный путь базы к сервису до одобрения: отказ из-за длинного адреса
// или лишнего поля оставил бы клиента вовсе без подключения. Поэтому строки обрезаются, мусор отбрасывается,
// неизвестные поля не сохраняются, а реквизиты целиком становятся `null`, если в них не нашлось ничего полезного.
// Данные анонимные: доверять им можно ровно настолько, насколько их проверит человек перед созданием организации.

export type OrgPerson = { fullName: string; position: string | null };

export type OrgBankAccount = { iban: string; bik: string | null; bankName: string | null; currency: string | null; isPrimary: boolean };

export type OrgDetails = {
	legalName: string | null;
	/** `legal` — юрлицо, `individual` — ИП (ЮрФизЛицо в 1С). */
	kind: "legal" | "individual" | null;
	kbe: string | null;
	vatSeries: string | null;
	vatNumber: string | null;
	vatDate: string | null;
	okedCode: string | null;
	okedName: string | null;
	legalAddress: string | null;
	actualAddress: string | null;
	phones: string[];
	emails: string[];
	website: string | null;
	director: OrgPerson | null;
	chiefAccountant: OrgPerson | null;
	bankAccounts: OrgBankAccount[];
};

const MAX_LIST = 10;
const MAX_ACCOUNTS = 20;

const str = (v: unknown, max: number): string | null => {
	if (typeof v !== "string" && typeof v !== "number") return null;
	const s = String(v).replace(/\s+/g, " ").trim();
	return s ? s.slice(0, max) : null;
};

const list = (v: unknown, max: number): string[] => {
	if (!Array.isArray(v)) return [];
	const out: string[] = [];
	for (const x of v) {
		const s = str(x, max);
		if (s && !out.includes(s)) out.push(s);
		if (out.length >= MAX_LIST) break;
	}
	return out;
};

const person = (v: unknown): OrgPerson | null => {
	if (!v || typeof v !== "object") return null;
	const o = v as Record<string, unknown>;
	const fullName = str(o.fullName, 255);
	return fullName ? { fullName, position: str(o.position, 200) } : null;
};

/** IBAN Казахстана — 20 знаков, но базы бывают и с иностранными счетами: берём любой правдоподобный IBAN. */
const iban = (v: unknown): string | null => {
	const s = str(v, 64)?.replace(/\s/g, "").toUpperCase() ?? null;
	return s && /^[A-Z]{2}[0-9A-Z]{8,32}$/.test(s) ? s : null;
};

const accounts = (v: unknown): OrgBankAccount[] => {
	if (!Array.isArray(v)) return [];
	const out: OrgBankAccount[] = [];
	for (const x of v) {
		if (!x || typeof x !== "object") continue;
		const o = x as Record<string, unknown>;
		const number = iban(o.iban);
		if (!number || out.some((a) => a.iban === number)) continue;
		out.push({
			iban: number,
			bik: str(o.bik, 11)?.replace(/\s/g, "").toUpperCase() ?? null,
			bankName: str(o.bankName, 300),
			currency: str(o.currency, 3)?.toUpperCase() ?? null,
			isPrimary: o.isPrimary === true,
		});
		if (out.length >= MAX_ACCOUNTS) break;
	}
	return out;
};

/** Разобрать реквизиты из заявки. Ничего полезного — `null`: пустой объект в панели выглядел бы как «реквизиты есть». */
export function normalizeOrgDetails(raw: unknown): OrgDetails | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const o = raw as Record<string, unknown>;
	const kind = o.kind === "legal" || o.kind === "individual" ? o.kind : null;
	// Проверка до обрезки: «170» не должно стать «17».
	const kbe = str(o.kbe, 10);
	const d: OrgDetails = {
		legalName: str(o.legalName, 500),
		kind,
		kbe: kbe && /^\d{2}$/.test(kbe) ? kbe : null,
		vatSeries: str(o.vatSeries, 20),
		vatNumber: str(o.vatNumber, 30),
		vatDate: str(o.vatDate, 10),
		okedCode: str(o.okedCode, 10),
		okedName: str(o.okedName, 300),
		legalAddress: str(o.legalAddress, 500),
		actualAddress: str(o.actualAddress, 500),
		phones: list(o.phones, 50),
		emails: list(o.emails, 200),
		website: str(o.website, 200),
		director: person(o.director),
		chiefAccountant: person(o.chiefAccountant),
		bankAccounts: accounts(o.bankAccounts),
	};
	const useful = Object.entries(d).some(([k, v]) => k !== "kind" && (Array.isArray(v) ? v.length > 0 : v !== null));
	return useful ? d : null;
}
