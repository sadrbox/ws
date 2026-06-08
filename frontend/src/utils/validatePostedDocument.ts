/**
 * Валидация документов — обязательные поля.
 *
 * Правило: поля из REQUIRED_FIELDS_MAP обязательны ТОЛЬКО при проведении
 * (Проведён = true). Черновик (Проведён НЕ установлен) можно сохранять с
 * незаполненными полями. Логику реализует validateDocumentFields.
 */

// ═══════════════════════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════════════════════

export type DocumentType =
	| "purchase"
	| "sale"
	| "sale_return"
	| "purchase_return"
	| "outgoing_invoice"
	| "incoming_invoice"
	| "payment_invoice"
	| "purchase_requisition"
	| "inventory_transfer"
	| "cash_receipt_order"
	| "cash_expense_order"
	| "payroll_calculation"
	| "payroll_payment"
	| "commercial_offer"
	| "sales_order"
	| "reservation"
	| "purchase_order"
	| "bank_statement";

export interface ValidationError {
	field: string;
	message: string;
}

export interface ValidationResult {
	isValid: boolean;
	errors: ValidationError[];
}

// ═══════════════════════════════════════════════════════════════════════════
// КОНФИГУРАЦИЯ ОБЯЗАТЕЛЬНЫХ ПОЛЕЙ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Обязательные поля для каждого типа документа.
 * Проверяются при каждом сохранении (не только при проведении).
 */
export const REQUIRED_FIELDS_MAP: Record<DocumentType, readonly string[]> = {
	// ── Торговые документы ──────────────────────────────────────────────────
	sale: [
		"date",
		"organizationUuid",
		"counterpartyUuid",
		"warehouseUuid",
		"contractUuid",
	],
	sale_return: [
		"date",
		"organizationUuid",
		"counterpartyUuid",
		"warehouseUuid",
		"contractUuid",
	],
	purchase: [
		"date",
		"organizationUuid",
		"counterpartyUuid",
		"warehouseUuid",
	],
	purchase_return: [
		"date",
		"organizationUuid",
		"counterpartyUuid",
		"warehouseUuid",
	],

	// ── Счета-фактуры ────────────────────────────────────────────────────────
	// НК РК ст. 412: счёт-фактура — налоговый документ, склад не требуется
	outgoing_invoice: [
		"date",
		"organizationUuid",
		"counterpartyUuid",
		"contractUuid",
	],
	incoming_invoice: [
		"date",
		"organizationUuid",
		"counterpartyUuid",
		"contractUuid",
	],
	payment_invoice: [
		"date",
		"organizationUuid",
		"counterpartyUuid",
		"contractUuid",
	],
	purchase_requisition: [
		"date",
		"organizationUuid",
		"counterpartyUuid",
		"contractUuid",
	],

	// ── Складские документы ──────────────────────────────────────────────────
	inventory_transfer: [
		"date",
		"organizationUuid",
		"fromWarehouseUuid",
		"toWarehouseUuid",
	],

	// ── Кассовые ордера ──────────────────────────────────────────────────────
	cash_receipt_order: [
		"date",
		"organizationUuid",
		"counterpartyUuid",
		"contractUuid",
	],
	cash_expense_order: [
		"date",
		"organizationUuid",
		"counterpartyUuid",
		"contractUuid",
	],

	// ── Зарплата ─────────────────────────────────────────────────────────────
	payroll_calculation: ["date", "organizationUuid", "employeeUuid"],
	payroll_payment: ["date", "organizationUuid", "employeeUuid"],

	// ── Документы цепочек (заказы, КП, резерв) ───────────────────────────────
	commercial_offer: ["date", "organizationUuid", "counterpartyUuid"],
	sales_order: ["date", "organizationUuid", "counterpartyUuid"],
	reservation: ["date", "organizationUuid", "counterpartyUuid"],
	purchase_order: ["date", "organizationUuid", "counterpartyUuid"],

	// ── Банковская выписка ───────────────────────────────────────────────────
	bank_statement: ["date", "organizationUuid", "counterpartyUuid"],
};

// ═══════════════════════════════════════════════════════════════════════════
// ПУБЛИЧНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Валидировать обязательные поля документа.
 *
 * Черновик (Проведён НЕ установлен) разрешено сохранять с незаполненными
 * полями — обязательные поля проверяются ТОЛЬКО при проведении (posted === true).
 */
export function validateDocumentFields(
	docType: DocumentType,
	fields: Record<string, unknown>,
): ValidationResult {
	// posted !== true → черновик: пропускаем проверку обязательных полей.
	if (fields.posted !== true) return { isValid: true, errors: [] };

	const required = REQUIRED_FIELDS_MAP[docType];
	const errors: ValidationError[] = [];

	for (const fieldName of required) {
		const value = fields[fieldName];
		const isEmpty =
			value === undefined ||
			value === null ||
			(typeof value === "string" && value.trim() === "");

		if (isEmpty) {
			errors.push({
				field: fieldName,
				message: `Поле "${getFieldLabel(fieldName)}" обязательно`,
			});
		}
	}

	return { isValid: errors.length === 0, errors };
}

/** @deprecated Используй validateDocumentFields — проверяет только при проведении (posted). */
export function validatePostedDocument(
	docType: DocumentType,
	fields: Record<string, unknown>,
	_isPosted?: boolean,
): ValidationResult {
	return validateDocumentFields(docType, fields);
}

/** Форматировать ошибки валидации для вывода пользователю. */
export function formatValidationErrors(errors: ValidationError[]): string {
	if (errors.length === 0) return "";
	if (errors.length === 1) return errors[0].message;
	return `Не заполнены обязательные поля:\n${errors.map((e) => `• ${e.message}`).join("\n")}`;
}

/** Получить массив обязательных полей для типа документа. */
export function getRequiredFieldsForDocType(
	docType: DocumentType,
): readonly string[] {
	return REQUIRED_FIELDS_MAP[docType];
}

/** Человекочитаемые метки полей для сообщений об ошибках. */
export function getFieldLabel(fieldName: string): string {
	const labels: Record<string, string> = {
		date: "Дата",
		comment: "Комментарий",
		organizationUuid: "Организация",
		counterpartyUuid: "Контрагент",
		warehouseUuid: "Склад",
		fromWarehouseUuid: "Склад отправки",
		toWarehouseUuid: "Склад получения",
		contractUuid: "Договор",
		employeeUuid: "Сотрудник",
		period: "Период",
		amount: "Сумма",
	};
	return labels[fieldName] ?? fieldName;
}
