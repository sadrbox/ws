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

/** Поверенный/оператор покупателя (J 39–42). agent — резолвленный контрагент {name,bin,address}. */
function customerAgentXml(inv, agent) {
	const a = agent || {};
	return (
		tag("customerAgentAddress", a.address) +
		tag("customerAgentDocDate", inv.esfCustomerAgentDocDate) +
		tag("customerAgentDocNum", inv.esfCustomerAgentDocNum) +
		tag("customerAgentName", a.legalName || a.name) +
		tag("customerAgentTin", a.bin)
	);
}

/** Поверенный/оператор поставщика (I 35–38). agent — резолвленная организация {name,bin,address}. */
function sellerAgentXml(inv, agent) {
	const a = agent || {};
	return (
		tag("sellerAgentAddress", a.address) +
		tag("sellerAgentDocDate", inv.esfSellerAgentDocDate) +
		tag("sellerAgentDocNum", inv.esfSellerAgentDocNum) +
		tag("sellerAgentName", a.legalName || a.name) +
		tag("sellerAgentTin", a.bin)
	);
}

/** Госучреждение (госзакуп, C1 21–24). Опускается, если нет ни одного поля. */
function publicOfficeXml(inv) {
	if (!inv.esfPoBik && !inv.esfPoIik && !inv.esfPoPayPurpose && !inv.esfPoProductCode) return "";
	// Порядок PublicOffice (xs:sequence): bik(req), iik?, payPurpose?, productCode?
	return (
		"<publicOffice>" +
		reqTag("bik", inv.esfPoBik || "") +
		tag("iik", inv.esfPoIik) +
		tag("payPurpose", inv.esfPoPayPurpose) +
		tag("productCode", inv.esfPoProductCode) +
		"</publicOffice>"
	);
}

/** Грузоотправитель (D25) — из контрагента-отправителя. Опускается, если не задан. */
function consignorXml(cp) {
	if (!cp) return "";
	// Порядок Consignor (xs:sequence): address?, name?, tin?
	return "<consignor>" + tag("address", cp.address) + tag("name", cp.legalName || cp.name) + tag("tin", cp.bin) + "</consignor>";
}

/** Грузополучатель (D26) — из контрагента-получателя. Опускается, если не задан. */
function consigneeXml(cp) {
	if (!cp) return "";
	// Порядок Consignee (xs:sequence): address?, countryCode(req), name?, tin?
	return (
		"<consignee>" +
		tag("address", cp.address) +
		reqTag("countryCode", cp.countryCode || DEFAULT_COUNTRY) +
		tag("name", cp.legalName || cp.name) +
		tag("tin", cp.bin) +
		"</consignee>"
	);
}

/** Блок «Категория» (B10/C20): <statuses><status>TYPE</status></statuses> либо "". */
function statusesXml(type) {
	return type ? `<statuses><status>${xmlEscape(type)}</status></statuses>` : "";
}

function customerXml(counterparty, customerType) {
	// Порядок по Customer (xs:sequence): address?, countryCode(req), name(req), statuses?, tin?
	return (
		"<customer>" +
		tag("address", counterparty?.address) +
		reqTag("countryCode", counterparty?.countryCode || DEFAULT_COUNTRY) +
		reqTag("name", counterparty?.legalName || counterparty?.name || "") +
		statusesXml(customerType) +
		tag("tin", counterparty?.bin) +
		"</customer>"
	);
}

/** Первичный (или первый) банковский счёт организации. */
function primaryAccount(organization) {
	const accounts = organization?.bankAccounts || [];
	return accounts.find((a) => a.isPrimary) || accounts[0] || null;
}

function sellerXml(organization, sellerType) {
	const acc = primaryAccount(organization);
	// Порядок по Seller (xs:sequence): address?, bank?, bik?, certificateNum?,
	// certificateSeries?, iik?, kbe?, name(req), …, statuses?, tin(req).
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
		statusesXml(sellerType) +
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
	// unitCode (G 4) — это КОД ТОВАРА ТН ВЭД ЕАЭС (не код ед.изм!); по XSD [0-9]{1,10}.
	const unitCode = product.tnvedCode && /^[0-9]{1,10}$/.test(product.tnvedCode) ? product.tnvedCode : null;
	// truOriginCode (G 2) — признак происхождения ТРУ [1-6] из карточки товара.
	const truOrigin = /^[1-6]$/.test(String(product.truOriginCode || "")) ? String(product.truOriginCode) : DEFAULT_TRU_ORIGIN;
	// gtinCode (G 17.1) — из штрихкода товара, если это валидный GTIN (8/12/13/14 цифр).
	const gtin = /^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(String(product.barcode || "")) ? String(product.barcode) : null;
	// Акциз (G 9/10) — из позиции; опускаем при нуле.
	const exciseRateN = Number(item.exciseRate ?? 0);
	const exciseAmountN = Number(item.exciseAmount ?? 0);
	// tnvedName (G 3.1) — наименование по классификатору ТН ВЭД (проставляется в esf.js).
	const tnvedName = product.tnvedName || null;

	// Порядок по Product (xs:sequence, алфавитный): catalogTruId, description,
	// exciseAmount?, exciseRate?, gtinCode?, ndsAmount, ndsRate?, priceWithTax,
	// priceWithoutTax, quantity?, tnvedName?, truOriginCode, turnoverSize,
	// unitCode?, unitNomenclature?, unitPrice?
	return (
		"<product>" +
		reqTag("catalogTruId", DEFAULT_CATALOG_TRU_ID) +
		tag("description", product.name || `Позиция ${index + 1}`) +
		tag("exciseAmount", exciseAmountN ? money(exciseAmountN) : null) +
		tag("exciseRate", exciseRateN ? String(exciseRateN) : null) +
		tag("gtinCode", gtin) +
		reqTag("ndsAmount", ndsAmount) +
		tag("ndsRate", ndsRate) +
		reqTag("priceWithTax", priceWithTax) +
		reqTag("priceWithoutTax", priceWithoutTax) +
		tag("quantity", qty ? money(qty, 6) : null) +
		tag("tnvedName", tnvedName) +
		reqTag("truOriginCode", truOrigin) +
		reqTag("turnoverSize", turnoverSize) +
		tag("unitCode", unitCode) +
		tag("unitNomenclature", unit?.name) +
		tag("unitPrice", unitPrice) +
		"</product>"
	);
}

/** Связь с основным ЭСФ (relatedInvoice) — для исправленного/дополнительного. Опускается, если нет. */
function relatedInvoiceXml(r) {
	if (!r || (!r.num && !r.registrationNumber)) return "";
	// Порядок RelatedInvoice (xs:sequence): date(req), num(req), registrationNumber?
	return (
		"<relatedInvoice>" +
		reqTag("date", esfDate(r.date)) +
		reqTag("num", r.num || "") +
		tag("registrationNumber", r.registrationNumber) +
		"</relatedInvoice>"
	);
}

/** Условия поставки (раздел E) — из привязанного договора. Опускается, если договора нет. */
function deliveryTermXml(invoice) {
	const c = invoice.contract;
	if (!c) return "";
	// Порядок DeliveryTerm (xs:sequence, алфавитный): accountNumber?, contractDate?,
	// contractNum?, deliveryConditionCode?, destination?, hasContract(req), term?,
	// transportTypeCode?, warrant?, warrantDate?
	return (
		"<deliveryTerm>" +
		tag("contractDate", esfDate(c.startDate)) +
		tag("contractNum", c.contractNumber || c.name) +
		reqTag("hasContract", "true") +
		"</deliveryTerm>"
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
	// Категории (роль в документе) — из документа; невалидное значение опускаем.
	const sellerType = isValidCode("sellerType", invoice.esfSellerType) ? invoice.esfSellerType : null;
	const customerType = isValidCode("customerType", invoice.esfCustomerType) ? invoice.esfCustomerType : null;

	// Порядок AbstractInvoice: date, invoiceType, num, operatorFullname,
	// [relatedInvoice], turnoverDate — затем поля InvoiceV2 (customers, productSet, sellers).
	const invoiceBody =
		reqTag("date", d) +
		reqTag("invoiceType", invoiceType) +
		reqTag("num", num) +
		reqTag("operatorFullname", operator) +
		relatedInvoiceXml(opts.related) +
		reqTag("turnoverDate", d) +
		tag("addInf", invoice.comment) +
		consigneeXml(opts.consignee) +
		consignorXml(opts.consignor) +
		customerAgentXml(invoice, opts.customerAgent) +
		"<customers>" + customerXml(invoice.counterparty, customerType) + "</customers>" +
		deliveryTermXml(invoice) +
		productSetXml(invoice) +
		publicOfficeXml(invoice) +
		sellerAgentXml(invoice, opts.sellerAgent) +
		"<sellers>" + sellerXml(invoice.organization, sellerType) + "</sellers>";

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
	contract: true,
	author: true,
};

export default buildInvoiceV2Xml;
