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
] as const;

// Endpoint формы документа — только для типов, у которых есть фронт-форма.
// Модели цепочек (commercial_offer, sales_order, reservation, purchase_order,
// bank_statement) пока без форм — для них endpoint не задаётся.
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
 * Типы документов БЕЗ признака «Проведён» (операционные/плановые: КП, заказы,
 * резерв, счёт на оплату). У их форм нет тоггла проведения
 * (createInvoiceLikeForm `hidePosted`), поэтому индикатор проведения для них
 * избыточен — напр. в дропдауне поля «Основание».
 */
const DOC_TYPES_WITHOUT_POSTING = new Set<string>([
	"commercial_offer", "sales_order", "reservation", "purchase_order", "payment_invoice",
]);

/** Использует ли тип документа признак «Проведён». Дефолт — да (как и тоггл
 *  проведения по умолчанию), кроме явно перечисленных операционных типов. */
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
