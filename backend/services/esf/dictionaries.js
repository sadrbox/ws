// Статические перечни (enum) ЭСФ — значения, которые принимают документы.
// Источник: XSD ИС ЭСФ (документация к enum'ам авторитетна). Используются как
// pick-list'ы в формах и для валидации маппера (замена хардкодов).
// СНТ/ЭАВР-перечни добавляются на этапах G2/G3.

/** Тип ЭСФ (A). */
export const INVOICE_TYPE = [
	{ code: "ORDINARY_INVOICE", label: "Основной ЭСФ" },
	{ code: "FIXED_INVOICE", label: "Исправленный ЭСФ" },
	{ code: "ADDITIONAL_INVOICE", label: "Дополнительный ЭСФ" },
];

/** Тип НДС (productSet.ndsRateType). */
export const NDS_RATE_TYPE = [
	{ code: "WITHOUT_NDS_NOT_KZ", label: "Без НДС – не РК" },
];

/** Причина выписки на бумажном носителе (2.1). */
export const PAPER_REASON_TYPE = [
	{ code: "DOWN_TIME", label: "Простой системы" },
	{ code: "MISSING_REQUIREMENT", label: "Отсутствовало требование по выписке ЭСФ" },
	{ code: "UNLAWFUL_REMOVAL_REGISTRATION", label: "Неправомерное снятие с регистрационного учёта" },
];

/** Категория поставщика (B 10). */
export const SELLER_TYPE = [
	{ code: "COMMITTENT", label: "Комитент" },
	{ code: "BROKER", label: "Комиссионер" },
	{ code: "FORWARDER", label: "Экспедитор" },
	{ code: "LESSOR", label: "Лизингодатель" },
	{ code: "JOINT_ACTIVITY_PARTICIPANT", label: "Участник договора о совместной деятельности" },
	{ code: "SHARING_AGREEMENT_PARTICIPANT", label: "Участник СРП или сделки в рамках СРП" },
	{ code: "EXPORTER", label: "Экспортёр" },
	{ code: "TRANSPORTER", label: "Международный перевозчик" },
	{ code: "PRINCIPAL", label: "Доверитель" },
	{ code: "LAWYER", label: "Адвокат" },
	{ code: "BAILIFF", label: "Частный судебный исполнитель" },
	{ code: "MEDIATOR", label: "Медиатор" },
	{ code: "NOTARY", label: "Нотариус" },
];

/** Категория получателя (C 20). */
export const CUSTOMER_TYPE = [
	{ code: "COMMITTENT", label: "Комитент" },
	{ code: "BROKER", label: "Комиссионер" },
	{ code: "LESSEE", label: "Лизингополучатель" },
	{ code: "JOINT_ACTIVITY_PARTICIPANT", label: "Участник договора о совместной деятельности" },
	{ code: "PUBLIC_OFFICE", label: "Государственное учреждение" },
	{ code: "NONRESIDENT", label: "Нерезидент" },
	{ code: "SHARING_AGREEMENT_PARTICIPANT", label: "Участник СРП или сделки в рамках СРП" },
	{ code: "PRINCIPAL", label: "Доверитель" },
	{ code: "RETAIL", label: "Розничная реализация" },
	{ code: "INDIVIDUAL", label: "Физическое лицо" },
	{ code: "LAWYER", label: "Адвокат" },
	{ code: "BAILIFF", label: "Частный судебный исполнитель" },
	{ code: "MEDIATOR", label: "Медиатор" },
	{ code: "NOTARY", label: "Нотариус" },
];

/**
 * Признак происхождения ТРУ (G 2), допустимые коды [1-6]. Подписи — по Правилам
 * выписки ЭСФ (в XSD отсутствуют, при необходимости уточнить формулировки).
 */
export const TRU_ORIGIN = [
	{ code: "1", label: "Товар РК, не из Перечня изъятий" },
	{ code: "2", label: "Товар из Перечня изъятий" },
	{ code: "3", label: "Товар, ввезённый из третьих стран (не ЕАЭС)" },
	{ code: "4", label: "Товар, ввезённый из ЕАЭС" },
	{ code: "5", label: "Работа, услуга" },
	{ code: "6", label: "Прочее (не относится к признакам 1-5)" },
];

/** Тип ЭЦП (signatureType при загрузке). */
export const SIGNATURE_TYPE = [
	{ code: "COMPANY", label: "ЭЦП юридического лица" },
	{ code: "OPERATOR", label: "ЭЦП уполномоченного лица" },
];

/** Все перечни ЭСФ одним объектом (для эндпоинта /esf/dictionaries). */
export const ESF_DICTIONARIES = {
	invoiceType: INVOICE_TYPE,
	ndsRateType: NDS_RATE_TYPE,
	paperReasonType: PAPER_REASON_TYPE,
	sellerType: SELLER_TYPE,
	customerType: CUSTOMER_TYPE,
	truOrigin: TRU_ORIGIN,
	signatureType: SIGNATURE_TYPE,
};

/** Проверка допустимости кода в перечне. */
export function isValidCode(dict, code) {
	return (ESF_DICTIONARIES[dict] || []).some((e) => e.code === String(code));
}

export default ESF_DICTIONARIES;
