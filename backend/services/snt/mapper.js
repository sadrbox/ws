// Маппер «Реализация»/«Перемещение» → СНТ (SntV1 XML, namespace v1.snt).
// Обязательный минимум по SntV1.xsd: база AbstractSnt (date, number, shippingDate?,
// sntType) → расширение в АЛФАВИТНОМ порядке sequence: contract, currencyCode,
// customer, productSet, seller. Опциональные наборы (алкоголь/нефть/маркировка/
// транспорт) не заполняются — добавлять по мере бизнес-потребности.
//
// ВАЖНО: у товара ОБЯЗАТЕЛЬНЫ tnvedCode (ТН ВЭД ЕАЭС) и truOriginCode [1-6] —
// берутся из Product (см. классификатор type="tnved").
import { xmlEscape } from "../esf/soapClient.js";

const DEFAULT_CURRENCY = "KZT";
const DEFAULT_COUNTRY = "KZ";
/** Признак происхождения по умолчанию, если не задан у товара. */
const DEFAULT_TRU_ORIGIN = "1";

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
function sntDate(d) {
	const dt = d instanceof Date ? d : new Date(d);
	if (Number.isNaN(dt.getTime())) return "";
	const p = (x) => String(x).padStart(2, "0");
	return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

/** Договор. Порядок: accountNumber?, date?, deliveryCondition?, isContract, number?, term? */
function contractXml(contract) {
	return (
		"<contract>" +
		tag("date", contract?.startDate ? sntDate(contract.startDate) : null) +
		reqTag("isContract", contract ? "true" : "false") +
		tag("number", contract?.contractNumber) +
		"</contract>"
	);
}

/**
 * Участник (продавец/покупатель). Порядок: [база SntAbstractParticipant:
 * branchTin?, name, tin?] → actualAddress?, countryCode, nonResident?,
 * registerCountryCode, ...
 */
function participantXml(el, party) {
	return (
		`<${el}>` +
		reqTag("name", party?.legalName || party?.name || "") +
		tag("tin", party?.bin) +
		tag("actualAddress", party?.address) +
		reqTag("countryCode", party?.countryCode || DEFAULT_COUNTRY) +
		reqTag("registerCountryCode", party?.countryCode || DEFAULT_COUNTRY) +
		`</${el}>`
	);
}

/**
 * Товар. Порядок: [база SntBaseProductV1 (алфавитно): ndsAmount?, ndsRate?,
 * priceWithTax, priceWithoutTax, productNumber, tnvedCode, truOriginCode]
 * → расширение: gtinCode?, measureUnitCode, price, productName, quantity
 */
function productXml(item, index) {
	const product = item.product || {};
	const unit = item.unitOfMeasure || product.unitOfMeasure || null;
	const qty = Number(item.quantity ?? 0);
	const withoutTax = Number(item.amountWithoutVat ?? 0);
	return (
		"<product>" +
		tag("ndsAmount", money(item.vatAmount)) +
		tag("ndsRate", item.vatRate != null ? String(Math.round(Number(item.vatRate))) : null) +
		reqTag("priceWithTax", money(item.amount)) +
		reqTag("priceWithoutTax", money(withoutTax)) +
		reqTag("productNumber", String(index + 1)) +
		reqTag("tnvedCode", product.tnvedCode || "") +
		reqTag("truOriginCode", product.truOriginCode || DEFAULT_TRU_ORIGIN) +
		tag("gtinCode", product.barcode) +
		reqTag("measureUnitCode", unit?.code || "") +
		reqTag("price", money(qty > 0 ? withoutTax / qty : withoutTax, 2)) +
		reqTag("productName", product.name || `Товар ${index + 1}`) +
		reqTag("quantity", money(qty, 4)) +
		"</product>"
	);
}

/** Проверка: у всех товаров должен быть ТН ВЭД (иначе ИС ЭСФ отклонит СНТ). */
export function validateSntProducts(items) {
	const missing = items
		.map((it, i) => (!it.product?.tnvedCode ? (it.product?.name || `позиция ${i + 1}`) : null))
		.filter(Boolean);
	return missing;
}

/**
 * Строит СНТ (SntV1 XML) из документа-источника (Реализация или Перемещение).
 * @param {object} doc — number/date/amount…, organization, counterparty?, contract?,
 *   items[{product{tnvedCode,truOriginCode,…}, unitOfMeasure, …}]
 * @param {object} [opts] @param {string} [opts.sntType="PRIMARY_SNT"] @param {Date} [opts.shippingDate]
 * @returns {string} XML `<v1:snt xmlns:v1="v1.snt">…`
 */
export function buildSntV1Xml(doc, opts = {}) {
	if (!doc) throw new Error("buildSntV1Xml: нет данных документа");
	const items = doc.items || [];
	const sntType = opts.sntType || "PRIMARY_SNT";

	return (
		'<v1:snt xmlns:v1="v1.snt">' +
		reqTag("date", sntDate(doc.date)) +
		reqTag("number", doc.number || "") +
		tag("shippingDate", sntDate(opts.shippingDate || doc.date)) +
		reqTag("sntType", sntType) +
		contractXml(doc.contract) +
		reqTag("currencyCode", DEFAULT_CURRENCY) +
		participantXml("customer", doc.counterparty || doc.organization) +
		"<productSet><products>" + items.map((it, i) => productXml(it, i)).join("") + "</products></productSet>" +
		participantXml("seller", doc.organization) +
		"</v1:snt>"
	);
}

/** Prisma-include для Реализации как источника СНТ. */
export const SNT_SALE_INCLUDE = {
	saleItems: { include: { product: { include: { unitOfMeasure: true } }, unitOfMeasure: true } },
	organization: true,
	counterparty: true,
	contract: true,
};

export default buildSntV1Xml;
