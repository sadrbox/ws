/**
 * Система валидации документов при их проведении (posted=true)
 *
 * Определяет обязательные поля для каждого типа документа и проверяет их корректность
 * перед сохранением документа со статусом "Проведён".
 */

// ═══════════════════════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════════════════════

export type DocumentType =
	| "purchase"
	| "sale"
	| "outgoing_invoice"
	| "incoming_invoice"
	| "payment_invoice"
	| "inventory_transfer";

export interface RequiredFieldsConfig {
	/** Тип документа */
	docType: DocumentType;
	/** Массив обязательных полей (ключи из объекта fields) */
	requiredFields: string[];
	/** Опциональное описание для каждого документа */
	description?: string;
}

export interface ValidationError {
	field: string;
	message: string;
}

export interface ValidationResult {
	isValid: boolean;
	errors: ValidationError[];
}

// ═══════════════════════════════════════════════════════════════════════════
// КОНФИГУРАЦИЯ ОБЯЗАТЕЛЬНЫХ ПОЛЕЙ ПО ДОКУМЕНТАМ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Конфигурация обязательных полей для документов со статусом "Проведён"
 *
 * Правило: если документ сохраняется с posted=true, то должны быть заполнены
 * все поля из соответствующего массива requiredFields.
 *
 * Исключаются системные поля:
 * - id, uuid (автогенерируемые)
 * - author, authorId, authorUuid (автоустанавливаемые)
 * - createdBy, createdById, createdByUuid (автоустанавливаемые)
 */
export const REQUIRED_FIELDS_MAP: Record<DocumentType, string[]> = {
	// ──────────────────────────────────────────────────────────────────────
	// Поступление товаров (Покупка)
	// ──────────────────────────────────────────────────────────────────────
	purchase: [
		"date", // Дата документа обязательна
		"organizationUuid", // Организация (покупатель)
		"counterpartyUuid", // Контрагент (поставщик)
		"warehouseUuid", // Склад получения
		// "contractUuid" — опционально, но если указан, должен быть валидным
	],

	// ──────────────────────────────────────────────────────────────────────
	// Продажа товаров (Sale)
	// ──────────────────────────────────────────────────────────────────────
	sale: ["date", "organizationUuid", "counterpartyUuid", "warehouseUuid"],

	// ──────────────────────────────────────────────────────────────────────
	// ──────────────────────────────────────────────────────────────────────
	outgoing_invoice: [
		"date", // Дата документа
		"organizationUuid", // Организация (продавец)
		"counterpartyUuid", // Контрагент (покупатель)
		// "contractUuid" — опционально
	],

	// ──────────────────────────────────────────────────────────────────────
	// Входящий счёт-фактура (Полученный счёт)
	// ──────────────────────────────────────────────────────────────────────
	incoming_invoice: [
		"date", // Дата документа
		"organizationUuid", // Организация (покупатель)
		"counterpartyUuid", // Контрагент (поставщик)
		// "contractUuid" — опционально
	],

	// ──────────────────────────────────────────────────────────────────────
	// Расчётный счёт-фактура (Счёт за оплату)
	// ──────────────────────────────────────────────────────────────────────
	payment_invoice: [
		"date", // Дата документа
		"organizationUuid", // Организация
		"counterpartyUuid", // Контрагент
		// "contractUuid" — опционально
	],

	// ──────────────────────────────────────────────────────────────────────
	// Внутреннее перемещение ТМЗ
	// ──────────────────────────────────────────────────────────────────────
	inventory_transfer: [
		"date", // Дата документа
		"organizationUuid", // Организация
		"fromWarehouseUuid", // Склад отправки
		"toWarehouseUuid", // Склад получения
	],
};

// ═══════════════════════════════════════════════════════════════════════════
// ПУБЛИЧНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Получить конфигурацию обязательных полей для типа документа
 *
 * @param docType тип документа
 * @returns массив имён обязательных полей
 */
export function getRequiredFieldsForDocType(docType: DocumentType): string[] {
	return REQUIRED_FIELDS_MAP[docType] || [];
}

/**
 * Валидировать поля документа при сохранении с posted=true
 *
 * @param docType тип документа
 * @param fields объект с полями формы
 * @param isPosted флаг "Проведён"
 * @returns результат валидации {isValid, errors}
 *
 * @example
 * ```tsx
 * const result = validatePostedDocument("purchase", formFields, true);
 * if (!result.isValid) {
 *   return `Не удалось сохранить: ${result.errors[0].message}`;
 * }
 * ```
 */
export function validatePostedDocument(
	docType: DocumentType,
	fields: Record<string, any>,
	isPosted: boolean,
): ValidationResult {
	// Если не проведён — не проверяем
	if (!isPosted) {
		return { isValid: true, errors: [] };
	}

	const requiredFields = getRequiredFieldsForDocType(docType);
	const errors: ValidationError[] = [];

	for (const fieldName of requiredFields) {
		const value = fields[fieldName];
		const isEmptyString = typeof value === "string" && value.trim() === "";

		if (value === undefined || value === null || isEmptyString) {
			errors.push({
				field: fieldName,
				message: `Поле "${getFieldLabel(fieldName)}" обязательно для проведённого документа`,
			});
		}
	}

	return {
		isValid: errors.length === 0,
		errors,
	};
}

/**
 * Получить отформатированное описание ошибок валидации для вывода пользователю
 *
 * @param errors массив ошибок валидации
 * @returns строка с описанием всех ошибок
 */
export function formatValidationErrors(errors: ValidationError[]): string {
	if (errors.length === 0) return "";

	if (errors.length === 1) {
		return errors[0].message;
	}

	const list = errors.map((e) => `• ${e.message}`).join("\n");
	return `Ошибки валидации:\n${list}`;
}

/**
 * Получить человекочитаемое имя поля для отображения в ошибках
 *
 * @param fieldName имя поля в коде (например "organizationUuid")
 * @returns имя для показа пользователю
 */
export function getFieldLabel(fieldName: string): string {
	const labels: Record<string, string> = {
		date: "Дата",
		description: "Описание",
		organizationUuid: "Организация",
		counterpartyUuid: "Контрагент",
		warehouseUuid: "Склад",
		fromWarehouseUuid: "Склад отправки",
		toWarehouseUuid: "Склад получения",
		contractUuid: "Договор",
	};
	return labels[fieldName] || fieldName;
}

// ═══════════════════════════════════════════════════════════════════════════
// ЭКСПОРТ КОНФИГУРАЦИИ ДЛЯ ИСПОЛЬЗОВАНИЯ В КОМПОНЕНТАХ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Массив всех доступных конфигураций документов (для добавления новых тестов, docs и т.д.)
 */
export const ALL_DOCUMENT_CONFIGS: RequiredFieldsConfig[] = [
	{
		docType: "purchase",
		requiredFields: REQUIRED_FIELDS_MAP.purchase,
		description: "Поступление товаров",
	},
	{
		docType: "outgoing_invoice",
		requiredFields: REQUIRED_FIELDS_MAP.outgoing_invoice,
		description: "Исходящий счёт-фактура",
	},
	{
		docType: "incoming_invoice",
		requiredFields: REQUIRED_FIELDS_MAP.incoming_invoice,
		description: "Входящий счёт-фактура",
	},
	{
		docType: "payment_invoice",
		requiredFields: REQUIRED_FIELDS_MAP.payment_invoice,
		description: "Расчётный счёт-фактура",
	},
	{
		docType: "inventory_transfer",
		requiredFields: REQUIRED_FIELDS_MAP.inventory_transfer,
		description: "Внутреннее перемещение ТМЗ",
	},
];
