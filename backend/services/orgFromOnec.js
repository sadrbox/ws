// Организация из реквизитов базы 1С (26.09) — чистые правила, без Prisma.
//
// ЗАЧЕМ. База 1С подаёт заявку на подключение расширения «БухПроф AI», а её организации в ERP нет. Одобрить заявку
// без организации ERP нельзя: на неё выпускается токен базы, ей принадлежат диалоги чата в 1С, задачи и находки
// проверок учёта. Раньше администратор BuhProf заводил организацию руками, переписывая реквизиты с экрана 1С;
// теперь 1С кладёт реквизиты в заявку (docs/CONTRACT_BASE_REGISTRATION_2026-09-19.md, «Реквизиты организаций в
// заявке»), а панель создаёт по ним организацию одной кнопкой — `POST /organizations/from-onec`.
//
// Здесь — разбор тела в записи: организация, контакты (адреса, телефоны, почта, сайт), контактные лица
// (руководитель, главный бухгалтер) и банковские счета. Работа с БД — в роутере, одной транзакцией.
//
// Реквизиты пришли из анонимной заявки и прошли через человека, поэтому правила мягкие: строки обрезаются,
// мусор отбрасывается. Строго проверяется только то, без чего организации не бывает, — БИН (12 цифр;
// контрольный разряд у данных из 1С не проверяем, как и везде, см. utils/bin.js).

const clip = (v, max) => {
	if (typeof v !== "string" && typeof v !== "number") return null;
	const s = String(v).replace(/\s+/g, " ").trim();
	return s ? s.slice(0, max) : null;
};

const list = (v, max, limit = 10) => {
	if (!Array.isArray(v)) return [];
	const out = [];
	for (const x of v) {
		const s = clip(x, max);
		if (s && !out.includes(s)) out.push(s);
		if (out.length >= limit) break;
	}
	return out;
};

/** БИН 1С может прийти с пробелами или дефисами — приводим к 12 цифрам, как pipeActor. */
export const normalizeBin = (v) => {
	const digits = String(v ?? "").replace(/\D/g, "");
	return /^\d{12}$/.test(digits) ? digits : null;
};

const person = (v, fallbackRole) => {
	if (!v || typeof v !== "object") return null;
	const fullName = clip(v.fullName, 255);
	if (!fullName) return null;
	return { fullName, comment: `${clip(v.position, 200) ?? fallbackRole} (из 1С)` };
};

const iban = (v) => {
	const s = clip(v, 64)?.replace(/\s/g, "").toUpperCase() ?? null;
	return s && /^[A-Z]{2}[0-9A-Z]{8,32}$/.test(s) ? s : null;
};

/**
 * Разобрать тело `POST /organizations/from-onec`.
 *
 * Вход: `{ bin, name, details }`, где `details` — реквизиты в формате заявки (контракт). Выход — записи для
 * создания или `{ error }` с текстом для человека.
 *
 * @returns {{ error: string } | { org: object, contacts: object[], persons: object[], accounts: object[] }}
 */
export function buildOrganizationSeed(body) {
	const b = body && typeof body === "object" ? body : {};
	const bin = normalizeBin(b.bin);
	if (!bin) return { error: "БИН обязателен и должен состоять из 12 цифр" };
	const d = b.details && typeof b.details === "object" && !Array.isArray(b.details) ? b.details : {};

	const name = clip(b.name, 300) ?? clip(d.legalName, 300) ?? `Организация ${bin}`;
	const org = {
		bin,
		name,
		legalName: clip(d.legalName, 500) ?? name,
		vatSeries: clip(d.vatSeries, 20),
		vatNumber: clip(d.vatNumber, 30),
		// Та же отметка, что у организаций, заведённых по событиям 1С (services/pipeActor.js): видно, откуда запись.
		externalSource: "1C",
		externalId: bin,
	};

	const contacts = [];
	const legal = clip(d.legalAddress, 500);
	const actual = clip(d.actualAddress, 500);
	if (legal) contacts.push({ contactType: "legal_address", value: legal, isPrimary: true });
	// Фактический адрес, совпавший с юридическим, — не второй адрес, а повтор.
	if (actual && actual !== legal) contacts.push({ contactType: "actual_address", value: actual, isPrimary: true });
	list(d.phones, 50).forEach((v, i) => contacts.push({ contactType: "telephone", value: v, isPrimary: i === 0 }));
	list(d.emails, 200).forEach((v, i) => contacts.push({ contactType: "email", value: v, isPrimary: i === 0 }));
	const website = clip(d.website, 200);
	if (website) contacts.push({ contactType: "website", value: website, isPrimary: true });

	const persons = [person(d.director, "Руководитель"), person(d.chiefAccountant, "Главный бухгалтер")].filter(Boolean);

	const kbe = clip(d.kbe, 10);
	const accounts = [];
	for (const a of Array.isArray(d.bankAccounts) ? d.bankAccounts : []) {
		if (!a || typeof a !== "object") continue;
		const number = iban(a.iban);
		if (!number || accounts.some((x) => x.iban === number)) continue;
		accounts.push({
			iban: number,
			bik: clip(a.bik, 11)?.replace(/\s/g, "").toUpperCase() ?? null,
			bankName: clip(a.bankName, 300),
			kbe: kbe && /^\d{2}$/.test(kbe) ? kbe : null,
			currencyCode: clip(a.currency, 3)?.toUpperCase() ?? null,
			isPrimary: a.isPrimary === true,
		});
		if (accounts.length >= 20) break;
	}
	// Основной счёт — один: первый отмеченный, а если 1С не отметила ни одного — первый по порядку.
	const primary = Math.max(0, accounts.findIndex((a) => a.isPrimary));
	accounts.forEach((a, i) => { a.isPrimary = i === primary; });

	return { org, contacts, persons, accounts };
}
