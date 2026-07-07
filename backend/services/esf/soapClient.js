// Лёгкий SOAP 1.1-клиент для ИС ЭСФ (без внешних зависимостей, поверх axios).
// ИС ЭСФ использует namespace "esf" с НЕквалифицированными дочерними элементами
// (напр. <tin>, а не <esf:tin>) и пустой SOAPAction. Ответы разбираем минимально:
// извлекаем нужные теги и детектируем SOAP Fault (парсер под сложные структуры
// подключим позже, на этапе разбора ответов инвойсов).
import axios from "axios";
import { esfConfig } from "./config.js";

const SOAP_ENV = "http://schemas.xmlsoap.org/soap/envelope/";

/**
 * Категории ошибок ЭСФ — по типу SOAP-исключения / характеру фолта. UI реагирует
 * по категории (session → переавторизация; certificate/ocsp → «замените ЭЦП» и т.п.).
 *   session      — сессия закрыта/не авторизован (пересоздать сессию)
 *   access       — нет прав (AccessDeniedException)
 *   certificate  — проблема сертификата (истёк/отозван/не тот тип)
 *   ocsp         — OCSP-проверка сертификата недоступна/провалена
 *   signature    — ошибка/формат подписи
 *   validation   — запрос не прошёл XSD/структурную валидацию
 *   business     — бизнес-ошибка ИС ЭСФ (BusinessException)
 *   transport    — сеть/таймаут/HTTP
 *   unknown      — не удалось классифицировать
 */
export class EsfSoapError extends Error {
	constructor(message, { faultCode, httpStatus, raw, faultKind } = {}) {
		super(message);
		this.name = "EsfSoapError";
		this.faultCode = faultCode || null;
		this.httpStatus = httpStatus || null;
		this.raw = raw || null;
		this.faultKind = faultKind || "unknown";
	}
}

/** Классифицирует SOAP-фолт по типу исключения / ключевым словам. */
export function classifyFault(xml, faultString = "") {
	const hay = `${xml || ""}\n${faultString || ""}`;
	const has = (re) => re.test(hay);
	if (has(/TrustyOCSP\w*Exception|OCSP/i)) return "ocsp";
	if (has(/SessionClosedException|NO_AUTH|USER_HAS_NOT_REGISTERED|no open session|not authorized|session/i)) return "session";
	if (has(/AccessDeniedException|ACCESS_DENIED|access denied|доступ запрещ/i)) return "access";
	if (has(/CERTIFICATE_\w+|certificate|сертификат/i)) return "certificate";
	if (has(/SIGNATURE_\w+|signature.*(fail|invalid)|подпис/i)) return "signature";
	if (has(/Unmarshalling|cvc-|not-valid|SAXParse|validation|invalid content/i)) return "validation";
	if (has(/BusinessException/i)) return "business";
	return "unknown";
}

/** Экранирование значения для вставки в XML-текст. */
export function xmlEscape(value) {
	if (value == null) return "";
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * Собирает SOAP 1.1-конверт. `bodyXml` — уже готовый XML тела запроса
 * (напр. `<esf:apiVersionRequest/>`).
 */
export function buildEnvelope(bodyXml) {
	return (
		`<soapenv:Envelope xmlns:soapenv="${SOAP_ENV}" xmlns:esf="esf">` +
		`<soapenv:Body>${bodyXml}</soapenv:Body>` +
		`</soapenv:Envelope>`
	);
}

/** Извлекает текстовое содержимое первого тега `name` (без учёта префикса ns). */
export function extractTag(xml, name) {
	if (!xml) return null;
	const re = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "i");
	const m = xml.match(re);
	if (!m) return null;
	return m[1]
		.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"').replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&")
		.trim();
}

/** Извлекает все вхождения тега `name` (текст). */
export function extractAllTags(xml, name) {
	if (!xml) return [];
	const re = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "gi");
	const out = [];
	let m;
	while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
	return out;
}

/**
 * Выполняет SOAP-вызов к сервису ИС ЭСФ.
 * @param {string} url — полный URL сервиса (см. serviceUrl()).
 * @param {string} bodyXml — XML тела (внутри <soapenv:Body>).
 * @returns {Promise<string>} сырой XML ответа.
 * @throws {EsfSoapError} при SOAP Fault или транспортной ошибке.
 */
export async function soapCall(url, bodyXml, { soapAction = "", timeoutMs } = {}) {
	const envelope = buildEnvelope(bodyXml);
	let resp;
	try {
		resp = await axios.post(url, envelope, {
			headers: {
				"Content-Type": "text/xml; charset=utf-8",
				SOAPAction: soapAction,
			},
			timeout: timeoutMs || esfConfig.timeoutMs,
			// Ошибки HTTP (в т.ч. 500 с SOAP Fault) обрабатываем сами.
			validateStatus: () => true,
			responseType: "text",
			transitional: { silentJSONParsing: false },
		});
	} catch (err) {
		throw new EsfSoapError(`Транспортная ошибка ЭСФ: ${err.message}`, {
			raw: err.code, faultKind: "transport",
		});
	}

	const xml = typeof resp.data === "string" ? resp.data : String(resp.data ?? "");

	// SOAP Fault (обычно приходит с HTTP 500).
	if (/<(?:\w+:)?Fault\b/i.test(xml)) {
		const faultString = extractTag(xml, "faultstring") || extractTag(xml, "Reason") || "SOAP Fault";
		const faultCode = extractTag(xml, "faultcode") || extractTag(xml, "Code");
		throw new EsfSoapError(`ЭСФ вернул ошибку: ${faultString}`, {
			faultCode,
			httpStatus: resp.status,
			raw: xml,
			faultKind: classifyFault(xml, faultString),
		});
	}

	if (resp.status < 200 || resp.status >= 300) {
		throw new EsfSoapError(`ЭСФ: HTTP ${resp.status}`, {
			httpStatus: resp.status, raw: xml, faultKind: "transport",
		});
	}

	return xml;
}

export default soapCall;
