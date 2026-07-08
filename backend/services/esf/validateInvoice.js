// Валидация счёта-фактуры перед формированием/отправкой в ИС ЭСФ.
// Цель — понятные сообщения ДО отказа ИС ЭСФ (валидатор XSD/бизнес-правил контура).
// Только твёрдые правила (без спекуляций): обязательные реквизиты продавца/получателя,
// наличие позиций, требования типа ЭСФ (FIXED/ADDITIONAL) и категории (нерезидент).

const BIN_RE = /^\d{12}$/;

/**
 * @param {object} invoice — OutgoingInvoice с organization/counterparty/outgoingInvoiceItems,
 *   esfInvoiceType/esfCustomerType, а также (опц.) resolved `related` (основной ЭСФ).
 * @param {object} [opts]
 * @param {{found:boolean, registrationNumber?:string|null}} [opts.related] — результат
 *   резолвинга основного ЭСФ (для FIXED/ADDITIONAL).
 * @returns {string[]} список сообщений об ошибках (пусто — валидно).
 */
export function validateEsfInvoice(invoice, opts = {}) {
	const errors = [];
	if (!invoice) return ["Нет данных счёта-фактуры"];

	// ── Продавец (раздел B) ──
	const org = invoice.organization;
	if (!org) errors.push("Не указана организация (поставщик)");
	else {
		if (!(org.legalName || org.name)) errors.push("У организации не заполнено наименование");
		if (!org.bin) errors.push("У организации не указан БИН/ИИН");
		else if (!BIN_RE.test(String(org.bin))) errors.push("БИН/ИИН организации должен содержать 12 цифр");
	}

	// ── Получатель (раздел C) ──
	const cp = invoice.counterparty;
	if (!cp) errors.push("Не указан контрагент (получатель)");
	else if (!(cp.legalName || cp.name)) errors.push("У получателя не заполнено наименование");

	// ── Позиции (раздел G) ──
	const items = invoice.outgoingInvoiceItems || [];
	if (!items.length) errors.push("В документе нет ни одной позиции");

	// ── Тип ЭСФ (Э4): для исправленного/дополнительного нужен основной ЭСФ ──
	const type = invoice.esfInvoiceType;
	if (type === "FIXED_INVOICE" || type === "ADDITIONAL_INVOICE") {
		if (!invoice.esfRelatedInvoiceUuid) {
			errors.push("Для исправленного/дополнительного ЭСФ укажите основной (исправляемый) документ");
		} else if (opts.related) {
			if (!opts.related.found) errors.push("Основной ЭСФ не найден");
			else if (!opts.related.registrationNumber) errors.push("Основной ЭСФ ещё не зарегистрирован в ИС ЭСФ (нет рег. номера)");
		}
	}

	// ── Категория получателя (Э1): нерезидент → страна не РК ──
	if (invoice.esfCustomerType === "NONRESIDENT") {
		const country = cp?.countryCode || "KZ";
		if (country === "KZ") errors.push("Для получателя-нерезидента укажите код страны (не KZ) в карточке контрагента");
	}

	return errors;
}

export default validateEsfInvoice;
