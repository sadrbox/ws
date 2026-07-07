// Каталог кодов ошибок ИС ЭСФ (VersionService.getErrorCodes) — ~1000+ кодов,
// динамический. Скачиваем один раз и кэшируем в памяти; используем для показа
// официального описания по коду (многие коды приходят без текста) и для
// классификации кода по категории (см. classifyCode).
import { serviceUrl } from "./config.js";
import { soapCall, extractAllTags } from "./soapClient.js";

let cache = null; // Map<errorCode, description>
let loadedAt = 0;
const TTL_MS = 24 * 60 * 60 * 1000; // сутки

/** Загружает (с кэшем) каталог кодов ошибок ЭСФ. */
export async function loadErrorCatalog(force = false) {
	if (!force && cache && Date.now() - loadedAt < TTL_MS) return cache;
	const xml = await soapCall(serviceUrl("VersionService"), "<esf:errorCodesRequest/>");
	const codes = extractAllTags(xml, "errorCode");
	const descs = extractAllTags(xml, "description");
	const map = new Map();
	for (let i = 0; i < codes.length; i++) {
		const code = codes[i];
		const desc = descs[i] && descs[i] !== code ? descs[i] : "";
		if (code) map.set(code, desc);
	}
	cache = map;
	loadedAt = Date.now();
	return cache;
}

/** Официальное описание по коду ошибки (из каталога) или сам код, если нет. */
export async function describeError(code) {
	if (!code) return "";
	try {
		const map = await loadErrorCatalog();
		return map.get(code) || code;
	} catch {
		return code; // каталог недоступен — отдаём хотя бы код
	}
}

/** Классифицирует код ошибки по категории (та же таксономия, что faultKind). */
export function classifyCode(code) {
	if (!code) return "unknown";
	const c = String(code).toUpperCase();
	if (/^(NO_AUTH|USER_HAS_NOT_REGISTERED|SESSION)/.test(c)) return "session";
	if (/ACCESS_DENIED|FORBIDDEN|NO_RIGHT/.test(c)) return "access";
	if (/OCSP/.test(c)) return "ocsp";
	if (/^CERTIFICATE_/.test(c)) return "certificate";
	if (/^SIGNATURE_|SIGN_/.test(c)) return "signature";
	if (/^(WRONG|INVALID)_|_WRONG$|_INVALID$|FORMAT/.test(c)) return "validation";
	if (/^PASSWORD_/.test(c)) return "auth";
	return "business";
}

/**
 * Обогащает одну ошибку: категория (kind) + официальный текст из каталога,
 * если текст не пришёл. Вход: {errorCode, text?/errorText?, property?}.
 */
export async function enrichError(e = {}) {
	const errorCode = e.errorCode || null;
	const kind = classifyCode(errorCode);
	let text = e.text || e.errorText || "";
	if (!text && errorCode) text = await describeError(errorCode);
	return { errorCode, kind, text: text || null, property: e.property ?? null };
}

/** Обогащает список ошибок (см. enrichError). */
export async function enrichErrors(list) {
	return Promise.all((list || []).map(enrichError));
}

/** Сбрасывает кэш каталога (для тестов/принудительной перезагрузки). */
export function resetCatalogCache() {
	cache = null;
	loadedAt = 0;
}

export default { loadErrorCatalog, describeError, classifyCode, resetCatalogCache };
