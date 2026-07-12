import { translate } from "src/i18";

/**
 * Единый словарь типов документов (documentType) → i18-ключ названия и
 * frontend-endpoint формы. Источник истины для отображения типа документа:
 * журнал проводок, карточка счёта, Drawer проводок и поле «Основание».
 *
 * Название берётся из i18 по ключу `docType_<type>` (RU/KK), поэтому
 * добавление языка не требует правок здесь.
 */
const DOC_TYPES = [
	"purchase", "sale", "sale_return", "purchase_return",
	"purchase_requisition", "purchase_order", "commercial_offer", "sales_order",
	"reservation", "incoming_invoice", "outgoing_invoice", "payment_invoice",
	"inventory_transfer", "bank_statement",
	"cash_receipt_order", "cash_expense_order",
	"payroll_calculation", "payroll_payment",
	"month_close",
	// Складские: участвуют в цепочке документов (см. backend DOC_REGISTRY) —
	// без них узел цепочки показывал бы сырой код типа и не открывался по клику.
	"stock_count", "write_off", "goods_receipt", "import_declaration",
] as const;

// Endpoint формы документа — только для типов, у которых есть фронт-форма.
const DOC_TYPE_TO_ENDPOINT: Record<string, string> = {
	purchase: "purchases",
	sale: "sales",
	sale_return: "sale-returns",
	purchase_return: "purchase-returns",
	purchase_requisition: "purchase-requisitions",
	incoming_invoice: "incoming-invoices",
	outgoing_invoice: "outgoing-invoices",
	payment_invoice: "payment-invoices",
	cash_receipt_order: "cash-receipt-orders",
	cash_expense_order: "cash-expense-orders",
	payroll_calculation: "payroll-calculations",
	payroll_payment: "payroll-payments",
	commercial_offer: "commercial-offers",
	sales_order: "sales-orders",
	reservation: "reservations",
	purchase_order: "purchase-orders",
	bank_statement: "bank-statements",
	month_close: "month-closes",
	stock_count: "stockcounts",
	write_off: "writeoffs",
	goods_receipt: "goodsreceipts",
	import_declaration: "importdeclarations",
};

/** Локализованное название типа документа (i18). Неизвестный тип → как есть. */
export function docTypeLabel(type: string): string {
	if (!type) return "";
	return DOC_TYPES.includes(type as (typeof DOC_TYPES)[number])
		? translate(`docType_${type}`)
		: type;
}

export function docTypeToEndpoint(type: string): string | undefined {
	return DOC_TYPE_TO_ENDPOINT[type];
}

/**
 * Типы документов БЕЗ признака «Проведён» — документы-НАМЕРЕНИЯ: они не двигают
 * регистры, не дают проводок, и их `posted` не читается на бэкенде НИГДЕ. У их форм
 * нет тоггла проведения (`hidePosted` в createInvoiceLikeForm), а в списках убрана
 * колонка «Проведён» — значит и индикатор проведения (точка в дропдауне поля
 * «Основание») для них рисовать нельзя: он всегда показывал бы «не проведён».
 *
 * ВАЖНО — держать в соответствии с формами. Если у документа появляется тоггл
 * «Проведён», его надо убрать отсюда. Так было с «Резервированием»: ему добавили
 * проведение (регистр резервов движет только проведённый резерв), а здесь он
 * оставался в списке — и индикатор в «Основании» для него не рисовался.
 */
const DOC_TYPES_WITHOUT_POSTING = new Set<string>([
	"commercial_offer", "sales_order", "purchase_order", "payment_invoice",
]);

/** Использует ли тип документа признак «Проведён». Дефолт — да (тоггл проведения
 *  есть у подавляющего большинства), кроме перечисленных документов-намерений. */
export function docTypeUsesPosted(type: string): boolean {
	return !!type && !DOC_TYPES_WITHOUT_POSTING.has(type);
}

/** Открыть форму документа-регистратора по типу+uuid (если endpoint известен). */
export async function openDocumentByType(
	documentType: string,
	documentUuid: string,
	addPane: (options: any) => void,
): Promise<void> {
	const endpoint = docTypeToEndpoint(documentType);
	if (!endpoint || !documentUuid) return;
	const { openFormByEndpoint } = await import("src/registry/formRegistry");
	await openFormByEndpoint(endpoint, documentUuid, addPane);
}
