// InvoiceService ИС ЭСФ — жизненный цикл ЭСФ (P2): статус, ошибки, подтверждение/
// отклонение/удаление/отзыв. Все операции требуют sessionId (см. SessionService)
// и id — идентификатор ЭСФ в ИС ЭСФ (возвращается syncInvoice/queryInvoiceById).
//
// Структуры запросов выверены по WSDL + soapui + живой валидации test3:
//  • query/confirm/queryError:  sessionId + idList/id[]
//  • delete:                    sessionId + idList/id[] + signature + x509Certificate
//  • decline/revoke/unrevoke:   sessionId + signature + x509Certificate +
//                               idWithReasonList/invoiceIdWithReason{id,reason}[]
// delete/decline/revoke/unrevoke — ПОДПИСАННЫЕ операции (как syncInvoice): подпись
// готовит клиент (NCALayer), backend — модель-агностичный релей (передаёт насквозь).
import { serviceUrl } from "./config.js";
import { soapCall, EsfSoapError, extractTag, xmlEscape } from "./soapClient.js";
import { enrichErrors } from "./errorCatalog.js";

const URL = () => serviceUrl("InvoiceService");

/** Возможные статусы ЭСФ (InvoiceStatus, ИС ЭСФ). */
export const ESF_INVOICE_STATUS = Object.freeze({
	DRAFT: "DRAFT", CREATED: "CREATED", IMPORTED: "IMPORTED", DELIVERED: "DELIVERED",
	CONFIRMED: "CONFIRMED", DECLINED: "DECLINED", REVOKED: "REVOKED", DELETED: "DELETED",
	FAILED: "FAILED", PROCESSED: "PROCESSED",
});

/** Нормализует id/массив id в непустой список строк. */
function idArray(ids) {
	const arr = (Array.isArray(ids) ? ids : [ids]).filter((x) => x != null && x !== "");
	if (!arr.length) throw new EsfSoapError("Не заданы id ЭСФ");
	return arr.map(String);
}

function idListXml(ids) {
	return `<idList>${idArray(ids).map((id) => `<id>${xmlEscape(id)}</id>`).join("")}</idList>`;
}

function idWithReasonListXml(items) {
	const arr = (Array.isArray(items) ? items : [items]).filter(Boolean);
	if (!arr.length) throw new EsfSoapError("Не заданы id/причины ЭСФ");
	return (
		"<idWithReasonList>" +
		arr.map((it) =>
			"<invoiceIdWithReason>" +
			`<id>${xmlEscape(it.id)}</id>` +
			`<reason>${xmlEscape(it.reason || "")}</reason>` +
			"</invoiceIdWithReason>",
		).join("") +
		"</idWithReasonList>"
	);
}

function req(op, inner) {
	return `<esf:${op}Request>${inner}</esf:${op}Request>`;
}

function requireSession(sessionId) {
	if (!sessionId) throw new EsfSoapError("Нет sessionId");
}

// ── Запрос статуса / ошибок (без подписи) ────────────────────────────────────

/** Статусы ЭСФ по id (принимает id или массив id). */
export async function queryInvoiceById(sessionId, ids) {
	requireSession(sessionId);
	const xml = await soapCall(URL(), req("queryInvoiceById",
		`<sessionId>${xmlEscape(sessionId)}</sessionId>${idListXml(ids)}`));
	return { ...parseStatuses(xml), raw: xml };
}

/** Ошибки ЭСФ по id (для статуса FAILED/DECLINED). */
export async function queryInvoiceErrorById(sessionId, ids) {
	requireSession(sessionId);
	const xml = await soapCall(URL(), req("queryInvoiceErrorById",
		`<sessionId>${xmlEscape(sessionId)}</sessionId>${idListXml(ids)}`));
	// Обогащаем каждую ошибку категорией (kind) + официальным текстом из каталога.
	const errors = await enrichErrors(parseErrors(xml));
	return { errors, raw: xml };
}

// ── Смена статуса ────────────────────────────────────────────────────────────

/** Подтвердить входящие ЭСФ (без подписи). */
export async function confirmInvoiceById(sessionId, ids) {
	requireSession(sessionId);
	return soapCall(URL(), req("confirmInvoiceById",
		`<sessionId>${xmlEscape(sessionId)}</sessionId>${idListXml(ids)}`));
}

/** Удалить ЭСФ (подписанная операция: signature + x509Certificate от клиента). */
export async function deleteInvoiceById(sessionId, ids, { signature, x509Certificate } = {}) {
	requireSession(sessionId);
	return soapCall(URL(), req("deleteInvoiceById",
		`<sessionId>${xmlEscape(sessionId)}</sessionId>${idListXml(ids)}` +
		`<signature>${xmlEscape(signature || "")}</signature>` +
		`<x509Certificate>${xmlEscape(x509Certificate || "")}</x509Certificate>`));
}

/** Отклонить входящие ЭСФ с причинами (подписанная операция). */
export function declineInvoiceById(sessionId, idsWithReason, opts = {}) {
	return reasonOp("declineInvoiceById", sessionId, idsWithReason, opts);
}
/** Отозвать ЭСФ с причинами (подписанная операция). */
export function revokeInvoiceById(sessionId, idsWithReason, opts = {}) {
	return reasonOp("revokeInvoiceById", sessionId, idsWithReason, opts);
}
/** Отменить отзыв ЭСФ с причинами (подписанная операция). */
export function unrevokeInvoiceById(sessionId, idsWithReason, opts = {}) {
	return reasonOp("unrevokeInvoiceById", sessionId, idsWithReason, opts);
}

/** Общий шаблон подписанных операций с причинами. */
function reasonOp(op, sessionId, idsWithReason, { signature, x509Certificate } = {}) {
	requireSession(sessionId);
	return soapCall(URL(), req(op,
		`<sessionId>${xmlEscape(sessionId)}</sessionId>` +
		`<signature>${xmlEscape(signature || "")}</signature>` +
		`<x509Certificate>${xmlEscape(x509Certificate || "")}</x509Certificate>` +
		idWithReasonListXml(idsWithReason)));
}

// ── Разбор ответов ───────────────────────────────────────────────────────────

/** Разбирает список статусов из ответа queryInvoiceById. */
function parseStatuses(xml) {
	const blocks = xml.match(/<(?:\w+:)?invoiceStatus\b[^>]*>[\s\S]*?<\/(?:\w+:)?invoiceStatus>/gi)
		|| xml.match(/<(?:\w+:)?invoice\b[^>]*>[\s\S]*?<\/(?:\w+:)?invoice>/gi) || [];
	const statuses = blocks.map((b) => ({
		invoiceId: extractTag(b, "invoiceId") || extractTag(b, "id"),
		num: extractTag(b, "num"),
		status: extractTag(b, "status") || extractTag(b, "invoiceStatus"),
		registrationNumber: extractTag(b, "registrationNumber"),
	}));
	// Одиночный ответ без обёртки — вернём плоские поля.
	if (!statuses.length) {
		const status = extractTag(xml, "status") || extractTag(xml, "invoiceStatus");
		if (status) statuses.push({
			invoiceId: extractTag(xml, "invoiceId"), num: extractTag(xml, "num"),
			status, registrationNumber: extractTag(xml, "registrationNumber"),
		});
	}
	return { statuses };
}

/** Разбирает ошибки из ответа queryInvoiceErrorById. */
function parseErrors(xml) {
	const blocks = xml.match(/<(?:\w+:)?error\b[^>]*>[\s\S]*?<\/(?:\w+:)?error>/gi) || [];
	const errors = blocks.map((b) => ({
		errorCode: extractTag(b, "errorCode"),
		text: extractTag(b, "text") || extractTag(b, "description"),
		property: extractTag(b, "property"),
	}));
	if (!errors.length) {
		const text = extractTag(xml, "text") || extractTag(xml, "description");
		if (text) errors.push({ errorCode: extractTag(xml, "errorCode"), text, property: null });
	}
	return errors;
}

export default {
	ESF_INVOICE_STATUS,
	queryInvoiceById, queryInvoiceErrorById,
	confirmInvoiceById, deleteInvoiceById,
	declineInvoiceById, revokeInvoiceById, unrevokeInvoiceById,
};
