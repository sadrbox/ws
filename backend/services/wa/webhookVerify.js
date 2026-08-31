// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Cloud API — верификация вебхука (P0 трека «Коммуникации», см.
// docs/TZ_WHATSAPP_COMMUNICATIONS.md §4.1). Чистые функции без Express/БД —
// тестируются headless.
//
//  • Подписка (GET): Meta шлёт hub.mode=subscribe&hub.verify_token=…&hub.challenge=…
//    — при совпадении токена нужно вернуть challenge как text/plain 200.
//  • События (POST): подпись X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(appSecret,
//    СЫРОЕ тело). Сравнение — timing-safe.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Проверка подписочного GET. @returns {string|null} challenge для ответа или null (403).
 */
export function checkVerifyRequest(query, verifyToken) {
	if (!verifyToken) return null; // токен не настроен → подписку не подтверждаем
	if (query?.["hub.mode"] !== "subscribe") return null;
	if (query?.["hub.verify_token"] !== verifyToken) return null;
	const challenge = query?.["hub.challenge"];
	return typeof challenge === "string" && challenge ? challenge : null;
}

/**
 * Проверка подписи POST-события.
 * @param {Buffer} rawBody СЫРОЕ тело (до JSON.parse)
 * @param {string|undefined} signatureHeader заголовок X-Hub-Signature-256
 * @param {string} appSecret App Secret приложения Meta; ПУСТОЙ → проверка выключена
 *   (допустимо на этапе настройки; в проде секрет обязателен)
 */
export function checkSignature(rawBody, signatureHeader, appSecret) {
	if (!appSecret) return true; // выключено явно (секрет не задан)
	if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
	const theirs = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
	const ours = createHmac("sha256", appSecret).update(rawBody).digest();
	return theirs.length === ours.length && timingSafeEqual(theirs, ours);
}

/**
 * Извлечь события из тела вебхука Cloud API → плоский список.
 * @returns {{ messages: object[], statuses: object[], phoneNumberId: string|null }[]}
 *   по одному элементу на entry.changes[].value
 */
export function extractEvents(body) {
	const out = [];
	if (body?.object !== "whatsapp_business_account") return out;
	for (const entry of body.entry ?? []) {
		for (const change of entry.changes ?? []) {
			const v = change?.value;
			if (!v) continue;
			out.push({
				phoneNumberId: v.metadata?.phone_number_id ?? null,
				messages: Array.isArray(v.messages) ? v.messages : [],
				statuses: Array.isArray(v.statuses) ? v.statuses : [],
			});
		}
	}
	return out;
}

export default { checkVerifyRequest, checkSignature, extractEvents };
