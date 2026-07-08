// Маппер «Реализация (услуги)» (Sale) → ЭАВР (AwpV1 XML, namespace v1.awp).
// Порядок элементов строго по AwpV1.xsd: сначала база AbstractAwp
// (date, number, performedDate, registrationNumber?), затем расширение
// (additionalInfo?, contract, recipients?, senders?, worksPerformed?).
// Юр.адрес участников берётся из Контактов (legal_address) — инжектится вызывающим.
import { xmlEscape } from "../esf/soapClient.js";

const DEFAULT_CURRENCY = "KZT";

function tag(name, value) {
	if (value === null || value === undefined || value === "") return "";
	return `<${name}>${xmlEscape(value)}</${name}>`;
}
function reqTag(name, value) {
	return `<${name}>${xmlEscape(value ?? "")}</${name}>`;
}
function money(v, digits = 2) {
	const n = Number(v ?? 0);
	return (Number.isFinite(n) ? n : 0).toFixed(digits);
}
/** Дата → dd.MM.yyyy (формат ИС ЭСФ). */
function awpDate(d) {
	const dt = d instanceof Date ? d : new Date(d);
	if (Number.isNaN(dt.getTime())) return "";
	const p = (x) => String(x).padStart(2, "0");
	return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

/** Первичный (или первый) банковский счёт. */
function primaryAccount(org) {
	const accs = org?.bankAccounts || [];
	return accs.find((a) => a.isPrimary) || accs[0] || null;
}

/** Банковские реквизиты (порядок: bank?, bik?, iik?, kbe?). */
function bankDetailsXml(acc) {
	if (!acc) return "";
	const inner = tag("bank", acc.bankName) + tag("bik", acc.bik) + tag("iik", acc.iban) +
		(acc.kbe && /^\d+$/.test(String(acc.kbe)) ? tag("kbe", acc.kbe) : "");
	return inner ? `<bankDetails>${inner}</bankDetails>` : "";
}

/** Договор (F). Порядок: date?, isContract, number?, registrationNumber? */
function contractXml(contract) {
	const has = !!contract;
	return (
		"<contract>" +
		tag("date", contract?.startDate ? awpDate(contract.startDate) : null) +
		reqTag("isContract", has ? "true" : "false") +
		tag("number", contract?.contractNumber) +
		"</contract>"
	);
}

/**
 * Заказчик (D/E). Порядок: [база: additionalInfo?, address?, branchTin?,
 * invitationEmail?, tin?] → bankDetails?, name, nonResident, registrationType?
 */
function recipientXml(counterparty) {
	return (
		"<recipients><recipient>" +
		tag("address", counterparty?.address) +
		tag("tin", counterparty?.bin) +
		reqTag("name", counterparty?.legalName || counterparty?.name || "") +
		reqTag("nonResident", "false") +
		"</recipient></recipients>"
	);
}

/**
 * Исполнитель (B/C). Порядок: [база: additionalInfo?, address?, branchTin?,
 * invitationEmail?, tin?] → bankDetails?, certificateNum?, certificateSeries?, name
 */
function senderXml(organization) {
	const acc = primaryAccount(organization);
	return (
		"<senders><sender>" +
		tag("address", organization?.address) +
		tag("tin", organization?.bin) +
		bankDetailsXml(acc) +
		tag("certificateNum", organization?.vatNumber) +
		tag("certificateSeries", organization?.vatSeries) +
		reqTag("name", organization?.legalName || organization?.name || "") +
		"</sender></senders>"
	);
}

/**
 * Работа/услуга (G). Порядок: additionalInfo?, measureUnitCode?, name, ndsAmount?,
 * ndsRate, quantity?, sumWithTax, sumWithoutTax, turnoverSize, unitPriceWithoutTax
 */
function workXml(item, index) {
	const product = item.product || {};
	const unit = item.unitOfMeasure || product.unitOfMeasure || null;
	const qty = Number(item.quantity ?? 0);
	const withoutTax = Number(item.amountWithoutVat ?? 0);
	return (
		"<work>" +
		tag("measureUnitCode", unit?.code) +
		reqTag("name", product.name || `Услуга ${index + 1}`) +
		tag("ndsAmount", money(item.vatAmount)) +
		reqTag("ndsRate", String(Math.round(Number(item.vatRate ?? 0)))) +
		tag("quantity", qty ? money(qty, 4) : null) +
		reqTag("sumWithTax", money(item.amount)) +
		reqTag("sumWithoutTax", money(withoutTax)) +
		reqTag("turnoverSize", money(withoutTax)) +
		reqTag("unitPriceWithoutTax", money(qty > 0 ? withoutTax / qty : withoutTax, 2)) +
		"</work>"
	);
}

/**
 * Данные по работам (G). Порядок: currencyCode, rate?, total?, totalNdsAmount,
 * totalSumWithTax, totalSumWithoutTax, totalTurnoverSize, works?
 */
function worksPerformedXml(sale, items) {
	return (
		"<worksPerformed>" +
		reqTag("currencyCode", DEFAULT_CURRENCY) +
		reqTag("totalNdsAmount", money(sale.vatAmount)) +
		reqTag("totalSumWithTax", money(sale.amount)) +
		reqTag("totalSumWithoutTax", money(sale.amountWithoutVat)) +
		reqTag("totalTurnoverSize", money(sale.amountWithoutVat)) +
		"<works>" + items.map((it, i) => workXml(it, i)).join("") + "</works>" +
		"</worksPerformed>"
	);
}

/**
 * Строит ЭАВР (AwpV1 XML) из документа «Реализация».
 * @param {object} sale — с organization(+bankAccounts,+address), counterparty(+address),
 *   contract, saleItems[{product,unitOfMeasure,...}].
 * @param {object} [opts] @param {Date|string} [opts.performedDate] — дата выполнения работ.
 * @returns {string} XML `<v1:awp xmlns:v1="v1.awp">…`
 */
export function buildAwpV1Xml(sale, opts = {}) {
	if (!sale) throw new Error("buildAwpV1Xml: нет данных документа");
	const items = sale.saleItems || [];
	const d = awpDate(sale.date);
	const performed = awpDate(opts.performedDate || sale.date);

	return (
		'<v1:awp xmlns:v1="v1.awp">' +
		reqTag("date", d) +
		reqTag("number", sale.number || "") +
		reqTag("performedDate", performed) +
		contractXml(sale.contract) +
		recipientXml(sale.counterparty) +
		senderXml(sale.organization) +
		worksPerformedXml(sale, items) +
		"</v1:awp>"
	);
}

/** Prisma-include для загрузки Реализации со всем необходимым для ЭАВР. */
export const AWP_SALE_INCLUDE = {
	saleItems: { include: { product: { include: { unitOfMeasure: true } }, unitOfMeasure: true } },
	organization: { include: { bankAccounts: { where: { deletedAt: null } } } },
	counterparty: true,
	contract: true,
};

export default buildAwpV1Xml;
