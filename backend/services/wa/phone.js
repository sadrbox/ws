// ─────────────────────────────────────────────────────────────────────────────
// Нормализация телефонов для резолвинга WhatsApp-номера (ТЗ §5).
// ЧИСТЫЕ функции (без БД) — тестируются headless.
//
// Канон: только цифры, E.164 без «+». Казахстан/Россия: местная запись «8XXXXXXXXXX»
// (11 цифр, ведущая 8) → «7XXXXXXXXXX»; 10 цифр без кода страны → префикс 7.
// ─────────────────────────────────────────────────────────────────────────────

/** Строка любого вида → канонический номер (только цифры, E.164 без «+»). */
export function normalizePhone(raw) {
	const digits = String(raw ?? "").replace(/\D/g, "");
	if (!digits) return "";
	// 8XXXXXXXXXX → 7XXXXXXXXXX (местная запись КЗ/РФ)
	if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
	// XXXXXXXXXX (10 цифр, без кода страны) → 7XXXXXXXXXX
	if (digits.length === 10) return `7${digits}`;
	return digits;
}

/** Совпадают ли два номера после нормализации (пустые никогда не совпадают). */
export function phonesEqual(a, b) {
	const na = normalizePhone(a);
	const nb = normalizePhone(b);
	return !!na && na === nb;
}

export default { normalizePhone, phonesEqual };
