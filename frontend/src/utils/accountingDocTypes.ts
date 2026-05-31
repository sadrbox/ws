/**
 * Соответствие documentType проводки → метка и frontend-endpoint формы документа.
 * Используется в журнале проводок, карточке счёта и Drawer проводок документа
 * для кликабельной колонки «Документ».
 */
export const ACCOUNTING_DOC_TYPE_LABELS: Record<string, string> = {
	purchase: "Поступление товаров и услуг",
	sale: "Реализация товаров и услуг",
	sale_return: "Возврат от покупателя",
	purchase_return: "Возврат поставщику",
	cash_receipt_order: "Приходный кассовый ордер",
	cash_expense_order: "Расходный кассовый ордер",
	payroll_calculation: "Начисление зарплаты",
	payroll_payment: "Выплата зарплаты",
};

const DOC_TYPE_TO_ENDPOINT: Record<string, string> = {
	purchase: "purchases",
	sale: "sales",
	sale_return: "sale-returns",
	purchase_return: "purchase-returns",
	cash_receipt_order: "cash-receipt-orders",
	cash_expense_order: "cash-expense-orders",
	payroll_calculation: "payroll-calculations",
	payroll_payment: "payroll-payments",
};

export function docTypeLabel(type: string): string {
	return ACCOUNTING_DOC_TYPE_LABELS[type] ?? type;
}

export function docTypeToEndpoint(type: string): string | undefined {
	return DOC_TYPE_TO_ENDPOINT[type];
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
