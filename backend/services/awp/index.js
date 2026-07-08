// Сервис ЭАВР (AwpWebService, namespace v1.awp). Переиспользует SOAP-клиент и
// сессию ИС ЭСФ. Загрузка — модель-агностичный релей (подпись готовит клиент
// через NCALayer): awpBody + signature? + x509Certificate.
import { serviceUrl } from "../esf/config.js";
import { soapCall, EsfSoapError, extractTag, xmlEscape } from "../esf/soapClient.js";

const NS = { prefix: "awp", ns: "v1.awp" };
const URL = () => serviceUrl("AwpWebService");

export { buildAwpV1Xml, AWP_SALE_INCLUDE } from "./mapper.js";

/** Статусы ЭАВР (по аналогии с ЭСФ; уточняются по ответам контура). */
export const AWP_STATUS = Object.freeze({
	DRAFT: "DRAFT", CREATED: "CREATED", DELIVERED: "DELIVERED",
	CONFIRMED: "CONFIRMED", DECLINED: "DECLINED", REVOKED: "REVOKED", FAILED: "FAILED",
});

function idListXml(ids) {
	const arr = (Array.isArray(ids) ? ids : [ids]).filter((x) => x != null && x !== "");
	if (!arr.length) throw new EsfSoapError("Не заданы id ЭАВР");
	return `<idList>${arr.map((id) => `<id>${xmlEscape(id)}</id>`).join("")}</idList>`;
}

/**
 * Загрузить подписанный ЭАВР (uploadAwp). Релей: awpBody — подписанный XML
 * (enveloped NCALayer), signature/x509Certificate — опционально.
 */
export async function uploadAwp({ sessionId, awpBody, signature, x509Certificate, version = "v1" } = {}) {
	if (!sessionId) throw new EsfSoapError("Нет sessionId");
	if (!awpBody) throw new EsfSoapError("Нет подписанного XML ЭАВР");
	const info =
		"<awpUploadInfo>" +
		`<awpBody>${xmlEscape(awpBody)}</awpBody>` +
		`<version>${xmlEscape(version)}</version>` +
		(signature ? `<signature>${xmlEscape(signature)}</signature>` : "") +
		"<signatureType>COMPANY</signatureType>" +
		"</awpUploadInfo>";
	const body =
		"<awp:uploadAwpRequest>" +
		`<sessionId>${xmlEscape(sessionId)}</sessionId>` +
		`<awpUploadInfoList>${info}</awpUploadInfoList>` +
		(x509Certificate ? `<x509Certificate>${xmlEscape(x509Certificate)}</x509Certificate>` : "") +
		"</awp:uploadAwpRequest>";
	const xml = await soapCall(URL(), body, { ns: NS });
	return {
		id: extractTag(xml, "id") || extractTag(xml, "awpId"),
		registrationNumber: extractTag(xml, "registrationNumber"),
		status: extractTag(xml, "status") || extractTag(xml, "awpStatus"),
		raw: xml,
	};
}

/** Статус/данные ЭАВР по id. */
export async function queryAwpById(sessionId, ids) {
	if (!sessionId) throw new EsfSoapError("Нет sessionId");
	const body = `<awp:queryAwpByIdRequest><sessionId>${xmlEscape(sessionId)}</sessionId>${idListXml(ids)}</awp:queryAwpByIdRequest>`;
	const xml = await soapCall(URL(), body, { ns: NS });
	return {
		status: extractTag(xml, "awpStatus") || extractTag(xml, "status"),
		registrationNumber: extractTag(xml, "registrationNumber"),
		raw: xml,
	};
}

function iso(d) {
	const dt = d instanceof Date ? d : new Date(d || 0);
	return Number.isNaN(dt.getTime()) ? new Date(0).toISOString() : dt.toISOString();
}

/**
 * Список ЭАВР по обновлениям (queryUpdate). Порядок: lastEventDate, lastAwpId?, limit?.
 * @returns {Promise<{lastEventDate, lastAwpId, items}>}
 */
export async function queryAwpUpdates({ sessionId, lastEventDate, lastAwpId, limit = 50 } = {}) {
	if (!sessionId) throw new EsfSoapError("Нет sessionId");
	const body =
		"<awp:queryUpdateRequest>" +
		`<sessionId>${xmlEscape(sessionId)}</sessionId>` +
		`<lastEventDate>${xmlEscape(iso(lastEventDate))}</lastEventDate>` +
		(lastAwpId ? `<lastAwpId>${xmlEscape(lastAwpId)}</lastAwpId>` : "") +
		`<limit>${xmlEscape(limit)}</limit>` +
		"</awp:queryUpdateRequest>";
	const xml = await soapCall(URL(), body, { ns: NS });
	const rows = (xml.match(/<(?:\w+:)?awpInfo\b[^>]*>[\s\S]*?<\/(?:\w+:)?awpInfo>/gi) || []).map((f) => ({
		awpId: extractTag(f, "awpId") || extractTag(f, "id"),
		registrationNumber: extractTag(f, "registrationNumber"),
		status: extractTag(f, "status") || extractTag(f, "awpStatus"),
		date: extractTag(f, "date") || extractTag(f, "inputDate"),
	}));
	return {
		lastEventDate: extractTag(xml, "lastEventDate"),
		lastAwpId: extractTag(xml, "lastAwpId"),
		items: rows,
	};
}

/** Действия приёмщика по ЭАВР (AwpActionType). */
export const AWP_ACTION = Object.freeze({ CONFIRM: "CONFIRM", DECLINE: "DECLINE", REVOKE: "REVOKE" });

/**
 * XML тела действия по ЭАВР (awpActionBody) — подписывается на клиенте (enveloped).
 * CONFIRM — без причины; DECLINE — cause обязателен. Точная схема тела действия
 * проверяется на живой сессии с реальным ЭЦП (в AwpActionInfo поля actionType нет).
 */
export function buildAwpActionXml({ actionType, cause, awpId } = {}) {
	if (!actionType) throw new EsfSoapError("Не указан тип действия ЭАВР");
	if (actionType === AWP_ACTION.DECLINE && !cause) throw new EsfSoapError("Для отклонения нужна причина");
	return "<action>" +
		`<actionType>${xmlEscape(actionType)}</actionType>` +
		(awpId ? `<documentId>${xmlEscape(awpId)}</documentId>` : "") +
		(cause ? `<cause>${xmlEscape(cause)}</cause>` : "") +
		"</action>";
}

/**
 * Смена статуса ЭАВР (приём/отклонение) — ПОДПИСАННАЯ операция.
 * @param {{sessionId, awpId, actionBody(подписанный XML), signature?, x509Certificate?, version?}} p
 */
export async function changeAwpStatus({ sessionId, awpId, actionBody, signature, x509Certificate, version = "v1" } = {}) {
	if (!sessionId) throw new EsfSoapError("Нет sessionId");
	if (!actionBody) throw new EsfSoapError("Нет подписанного XML действия ЭАВР");
	const info =
		"<awpActionInfo>" +
		`<awpActionBody>${xmlEscape(actionBody)}</awpActionBody>` +
		`<awpVersion>${xmlEscape(version)}</awpVersion>` +
		(awpId ? `<awpId>${xmlEscape(awpId)}</awpId>` : "") +
		`<signature>${xmlEscape(signature || "")}</signature>` +
		"<signatureType>COMPANY</signatureType>" +
		(x509Certificate ? `<certificate>${xmlEscape(x509Certificate)}</certificate>` : "") +
		"</awpActionInfo>";
	const body =
		"<awp:changeStatusRequest>" +
		`<sessionId>${xmlEscape(sessionId)}</sessionId>` +
		`<awpActionInfoList>${info}</awpActionInfoList>` +
		"</awp:changeStatusRequest>";
	const xml = await soapCall(URL(), body, { ns: NS });
	return { status: extractTag(xml, "awpStatus") || extractTag(xml, "status"), raw: xml };
}

export default { AWP_STATUS, AWP_ACTION, uploadAwp, queryAwpById, queryAwpUpdates, buildAwpActionXml, changeAwpStatus };
