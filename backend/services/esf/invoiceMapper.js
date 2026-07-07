// Маппер «Счёт-фактура исходящая» (OutgoingInvoice) → InvoiceV2 XML для ИС ЭСФ.
// Формирует <esf:invoiceContainer> с одним <v2:invoice> (namespace v2.esf).
// ВАЖНО: порядок элементов строго по InvoiceV2.xsd (xs:sequence) — иначе XSD-
// валидация ИС ЭСФ отклонит документ. Дочерние элементы неквалифицированы.
//
// Обязательный минимум (ORDINARY_INVOICE): date, invoiceType, num,
// operatorFullname, turnoverDate, customers/customer(countryCode,name),
// productSet(currencyCode, products/product[...], итоги), sellers/seller(name,tin).
// Опциональные реквизиты (адрес, банк, свид-во НДС) опускаются, если их нет в
// моделях — это XSD-валидно (minOccurs=0). Уточнять по мере наполнения моделей.
import { xmlEscape } from "./soapClient.js";
import { isValidCode } from "./dictionaries.js";

// Признак происхождения ТРУ (G2, [1-6]). 1 — произведён/реализуется в РК.
// TODO: выводить из категории товара, когда появится классификация.
const DEFAULT_TRU_ORIGIN = "1";
// Идентификатор ТРУ в каталоге (G18). "1" — как в эталонном шаблоне SDK.
const DEFAULT_CATALOG_TRU_ID = "1";
const DEFAULT_CURRENCY = "KZT";
const DEFAULT_COUNTRY = "KZ";

/** Число → строка с фиксированным числом знаков (для xs:decimal fractionDigits). */
function money(v, digits = 2) {
	const n = Number(v ?? 0);
	return (Number.isFinite(n) ? n : 0).toFixed(digits);
}

/** Дата → dd.MM.yyyy (формат ИС ЭСФ). */
function esfDate(d) {
	const dt = d instanceof Date ? d : new Date(d);
	if (Number.isNaN(dt.getTime())) return "";
	const p = (x) => String(x).padStart(2, "0");
	return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

/** <tag>escaped</tag> либо "" если значение пустое (для опциональных полей). */
function tag(name, value) {
	if (value === null || value === undefined || value === "") return "";
	return `<${name}>${xmlEscape(value)}</${name}>`;
}

/** Обязательный тег (пишется даже при пустом значении — пусть XSD отловит). */
function reqTag(name, value) {
	return `<${name}>${xmlEscape(value ?? "")}</${name}>`;
}

// ── Секции ──────────────────────────────────────────────────────────────────

function customerXml(counterparty) {
	// Порядок по Customer (xs:sequence): address?, countryCode(req), name(req), tin?
	return (
		"<customer>" +
		tag("address", counterparty?.address) +
		reqTag("countryCode", counterparty?.countryCode || DEFAULT_COUNTRY) +
		reqTag("name", counterparty?.legalName || counterparty?.name || "") +
		tag("tin", counterparty?.bin) +
		"</customer>"
	);
}

/** Первичный (или первый) банковский счёт организации. */
function primaryAccount(organization) {
	const accounts = organization?.bankAccounts || [];
	return accounts.find((a) => a.isPrimary) || accounts[0] || null;
}

function sellerXml(organization) {
	const acc = primaryAccount(organization);
	// Порядок по Seller (xs:sequence): address?, bank?, bik?, certificateNum?,
	// certificateSeries?, iik?, kbe?, name(req), ..., tin(req).
	return (
		"<seller>" +
		tag("address", organization?.address) +
		tag("bank", acc?.bankName) +
		tag("bik", acc?.bik) +
		tag("certificateNum", organization?.vatNumber) +
		tag("certificateSeries", organization?.vatSeries) +
		tag("iik", acc?.iban) +
		tag("kbe", acc?.kbe) +
		reqTag("name", organization?.legalName || organization?.name || "") +
		reqTag("tin", organization?.bin || "") +
		"</seller>"
	);
}

function productXml(item, index) {
	const product = item.product || {};
	const unit = item.unitOfMeasure || product.unitOfMeasure || null;
	const qty = Number(item.quantity ?? 0);
	const priceWithoutTax = money(item.amountWithoutVat);
	const priceWithTax = money(item.amount);
	const ndsAmount = money(item.vatAmount);
	const ndsRate = item.vatRate != null ? String(Math.round(Number(item.vatRate))) : null;
	const turnoverSize = money(item.amountWithoutVat); // облагаемый оборот = без НДС
	const unitPrice = qty > 0 ? money(Number(item.amountWithoutVat ?? 0) / qty, 6) : null;
	// unitCode по XSD — только [0-9]{1,10}; иначе опускаем.
	const unitCode = unit?.code && /^[0-9]{1,10}$/.test(unit.code) ? unit.code : null;

	// Порядок по Product (xs:sequence): catalogTruId, description, ndsAmount,
	// ndsRate?, priceWithTax, priceWithoutTax, quantity?, truOriginCode,
	// turnoverSize, unitCode?, unitNomenclature?, unitPrice?
	return (
		"<product>" +
		reqTag("catalogTruId", DEFAULT_CATALOG_TRU_ID) +
		tag("description", product.name || `Позиция ${index + 1}`) +
		reqTag("ndsAmount", ndsAmount) +
		tag("ndsRate", ndsRate) +
		reqTag("priceWithTax", priceWithTax) +
		reqTag("priceWithoutTax", priceWithoutTax) +
		tag("quantity", qty ? money(qty, 6) : null) +
		reqTag("truOriginCode", DEFAULT_TRU_ORIGIN) +
		reqTag("turnoverSize", turnoverSize) +
		tag("unitCode", unitCode) +
		tag("unitNomenclature", unit?.name) +
		tag("unitPrice", unitPrice) +
		"</product>"
	);
}

function productSetXml(invoice) {
	const items = invoice.outgoingInvoiceItems || [];
	const totalExcise = items.reduce((s, i) => s + Number(i.exciseAmount ?? 0), 0);
	// Порядок по ProductSet: currencyCode, products, totalExciseAmount,
	// totalNdsAmount, totalPriceWithTax, totalPriceWithoutTax, totalTurnoverSize
	return (
		"<productSet>" +
		reqTag("currencyCode", DEFAULT_CURRENCY) +
		"<products>" +
		items.map((it, i) => productXml(it, i)).join("") +
		"</products>" +
		reqTag("totalExciseAmount", money(totalExcise)) +
		reqTag("totalNdsAmount", money(invoice.vatAmount)) +
		reqTag("totalPriceWithTax", money(invoice.amount)) +
		reqTag("totalPriceWithoutTax", money(invoice.amountWithoutVat)) +
		reqTag("totalTurnoverSize", money(invoice.amountWithoutVat)) +
		"</productSet>"
	);
}

/**
 * Строит InvoiceV2 XML для ИС ЭСФ из загруженного OutgoingInvoice.
 * @param {object} invoice — с полями amount/amountWithoutVat/vatAmount/date/number,
 *   вложениями outgoingInvoiceItems[{product, unitOfMeasure, ...}], organization,
 *   counterparty, author.
 * @param {object} [opts]
 * @param {string} [opts.invoiceType="ORDINARY_INVOICE"]
 * @param {string} [opts.num] — номер ЭСФ (по умолчанию invoice.number).
 * @returns {string} XML `<esf:invoiceContainer>…`.
 */
export function buildInvoiceV2Xml(invoice, opts = {}) {
	if (!invoice) throw new Error("buildInvoiceV2Xml: нет данных счёта-фактуры");
	// Тип ЭСФ — из справочника (invalid → основной ЭСФ).
	const invoiceType = isValidCode("invoiceType", opts.invoiceType) ? opts.invoiceType : "ORDINARY_INVOICE";
	const num = opts.num || invoice.number || "";
	const operator = invoice.author?.username || invoice.organization?.name || "";
	const d = esfDate(invoice.date);

	// Порядок AbstractInvoice: date, invoiceType, num, operatorFullname,
	// [relatedInvoice], turnoverDate — затем поля InvoiceV2 (customers, productSet, sellers).
	const invoiceBody =
		reqTag("date", d) +
		reqTag("invoiceType", invoiceType) +
		reqTag("num", num) +
		reqTag("operatorFullname", operator) +
		reqTag("turnoverDate", d) +
		"<customers>" + customerXml(invoice.counterparty) + "</customers>" +
		productSetXml(invoice) +
		"<sellers>" + sellerXml(invoice.organization) + "</sellers>";

	return (
		'<esf:invoiceContainer xmlns:esf="esf">' +
		"<invoiceSet>" +
		'<v2:invoice xmlns:a="abstractInvoice.esf" xmlns:v2="v2.esf">' +
		invoiceBody +
		"</v2:invoice>" +
		"</invoiceSet>" +
		"</esf:invoiceContainer>"
	);
}

/** Prisma-include для загрузки счёта-фактуры со всем необходимым для маппинга. */
export const INVOICE_ESF_INCLUDE = {
	outgoingInvoiceItems: { include: { product: { include: { unitOfMeasure: true } }, unitOfMeasure: true } },
	organization: { include: { bankAccounts: { where: { deletedAt: null } } } },
	counterparty: true,
	author: true,
};

export default buildInvoiceV2Xml;
