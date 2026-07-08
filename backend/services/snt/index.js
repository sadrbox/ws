// Сервис СНТ (SntWebService, namespace v1.snt). Переиспользует SOAP-клиент и
// сессию ИС ЭСФ. Загрузка — модель-агностичный релей (подпись готовит клиент
// через NCALayer): sntBody + signature? + x509Certificate (см. SntUploadInfo.xsd).
import { serviceUrl } from "../esf/config.js";
import { soapCall, EsfSoapError, extractTag, xmlEscape } from "../esf/soapClient.js";

const NS = { prefix: "snt", ns: "v1.snt" };
const URL = () => serviceUrl("SntWebService");

export { buildSntV1Xml, SNT_SALE_INCLUDE, validateSntProducts } from "./mapper.js";

/** Типы СНТ (SntType). */
export const SNT_TYPE = Object.freeze({
	PRIMARY_SNT: "PRIMARY_SNT", RETURNED_SNT: "RETURNED_SNT", FIXED_SNT: "FIXED_SNT",
});

function idListXml(ids) {
	const arr = (Array.isArray(ids) ? ids : [ids]).filter((x) => x != null && x !== "");
	if (!arr.length) throw new EsfSoapError("Не заданы id СНТ");
	return `<idList>${arr.map((id) => `<id>${xmlEscape(id)}</id>`).join("")}</idList>`;
}

/** Загрузить подписанную СНТ (uploadSnt). Структура — по SntUploadInfo.xsd. */
export async function uploadSnt({ sessionId, sntBody, signature, x509Certificate, version = "V1" } = {}) {
	if (!sessionId) throw new EsfSoapError("Нет sessionId");
	if (!sntBody) throw new EsfSoapError("Нет подписанного XML СНТ");
	const info =
		"<sntUploadInfo>" +
		`<sntBody>${xmlEscape(sntBody)}</sntBody>` +
		`<version>${xmlEscape(version)}</version>` +
		(signature ? `<signature>${xmlEscape(signature)}</signature>` : "") +
		"<signatureType>COMPANY</signatureType>" +
		"</sntUploadInfo>";
	const body =
		"<snt:uploadSntRequest>" +
		`<sessionId>${xmlEscape(sessionId)}</sessionId>` +
		`<sntUploadInfoList>${info}</sntUploadInfoList>` +
		(x509Certificate ? `<x509Certificate>${xmlEscape(x509Certificate)}</x509Certificate>` : "") +
		"</snt:uploadSntRequest>";
	const xml = await soapCall(URL(), body, { ns: NS });
	return {
		id: extractTag(xml, "id") || extractTag(xml, "sntId"),
		registrationNumber: extractTag(xml, "registrationNumber"),
		status: extractTag(xml, "status") || extractTag(xml, "sntStatus"),
		raw: xml,
	};
}

/** Статус/данные СНТ по id. */
export async function querySntById(sessionId, ids) {
	if (!sessionId) throw new EsfSoapError("Нет sessionId");
	const body = `<snt:querySntByIdRequest><sessionId>${xmlEscape(sessionId)}</sessionId>${idListXml(ids)}</snt:querySntByIdRequest>`;
	const xml = await soapCall(URL(), body, { ns: NS });
	return {
		status: extractTag(xml, "sntStatus") || extractTag(xml, "status"),
		registrationNumber: extractTag(xml, "registrationNumber"),
		raw: xml,
	};
}

/** ISO 8601 dateTime (для lastEventDate). */
function iso(d) {
	const dt = d instanceof Date ? d : new Date(d || 0);
	return Number.isNaN(dt.getTime()) ? new Date(0).toISOString() : dt.toISOString();
}

/**
 * Список СНТ по обновлениям (queryUpdate). Для «Входящих» direction=INBOUND.
 * @returns {Promise<{lastEventDate, lastSntId, lastBlock, items}>}
 */
export async function querySntUpdates({ sessionId, direction = "INBOUND", lastEventDate, lastSntId, limit = 50 } = {}) {
	if (!sessionId) throw new EsfSoapError("Нет sessionId");
	// Порядок sequence: direction?, lastEventDate, lastSntId?, limit?
	const body =
		"<snt:queryUpdateRequest>" +
		`<sessionId>${xmlEscape(sessionId)}</sessionId>` +
		`<direction>${xmlEscape(direction)}</direction>` +
		`<lastEventDate>${xmlEscape(iso(lastEventDate))}</lastEventDate>` +
		(lastSntId ? `<lastSntId>${xmlEscape(lastSntId)}</lastSntId>` : "") +
		`<limit>${xmlEscape(limit)}</limit>` +
		"</snt:queryUpdateRequest>";
	const xml = await soapCall(URL(), body, { ns: NS });
	const rows = (xml.match(/<(?:\w+:)?sntInfo\b[^>]*>[\s\S]*?<\/(?:\w+:)?sntInfo>/gi) || []).map((f) => ({
		sntId: extractTag(f, "sntId") || extractTag(f, "id"),
		registrationNumber: extractTag(f, "registrationNumber"),
		status: extractTag(f, "status") || extractTag(f, "sntStatus"),
		date: extractTag(f, "date") || extractTag(f, "inputDate"),
	}));
	return {
		lastEventDate: extractTag(xml, "lastEventDate"),
		lastSntId: extractTag(xml, "lastSntId"),
		lastBlock: (extractTag(xml, "lastBlock") || "").toLowerCase() === "true",
		items: rows,
	};
}

/** Действия приёмщика по СНТ (SntActionType). */
export const SNT_ACTION = Object.freeze({ CONFIRM: "CONFIRM", DECLINE: "DECLINE", REVOKE: "REVOKE" });

/**
 * XML тела действия по СНТ (sntActionBody) — подписывается на клиенте (enveloped).
 * Тип действия кодируется внутри тела (в SntActionInfo отдельного поля нет).
 * CONFIRM — без причины; DECLINE — cause обязателен (SNT_DECLINE_CAUSE_IS_NULL).
 * ВНИМАНИЕ: корневой элемент/namespace тела действия — по аналогии с семейством
 * ЭСФ (fno/isgo: <action><actionType/><cause/>…); ТОЧНАЯ схема проверяется на
 * живой сессии с реальным ЭЦП на входящем документе.
 */
export function buildSntActionXml({ actionType, cause, sntId } = {}) {
	if (!actionType) throw new EsfSoapError("Не указан тип действия СНТ");
	if (actionType === SNT_ACTION.DECLINE && !cause) throw new EsfSoapError("Для отклонения нужна причина");
	return "<action>" +
		`<actionType>${xmlEscape(actionType)}</actionType>` +
		(sntId ? `<documentId>${xmlEscape(sntId)}</documentId>` : "") +
		(cause ? `<cause>${xmlEscape(cause)}</cause>` : "") +
		"</action>";
}

/**
 * Смена статуса СНТ (приём/отклонение) — ПОДПИСАННАЯ операция.
 * @param {{sessionId, sntId, actionBody(подписанный XML), signature?, x509Certificate?, version?}} p
 */
export async function changeSntStatus({ sessionId, sntId, actionBody, signature, x509Certificate, version = "V1" } = {}) {
	if (!sessionId) throw new EsfSoapError("Нет sessionId");
	if (!actionBody) throw new EsfSoapError("Нет подписанного XML действия СНТ");
	const info =
		"<sntActionInfo>" +
		`<sntActionBody>${xmlEscape(actionBody)}</sntActionBody>` +
		`<sntVersion>${xmlEscape(version)}</sntVersion>` +
		(sntId ? `<sntId>${xmlEscape(sntId)}</sntId>` : "") +
		`<signature>${xmlEscape(signature || "")}</signature>` +
		"<signatureType>COMPANY</signatureType>" +
		(x509Certificate ? `<certificate>${xmlEscape(x509Certificate)}</certificate>` : "") +
		"</sntActionInfo>";
	const body =
		"<snt:changeStatusRequest>" +
		`<sessionId>${xmlEscape(sessionId)}</sessionId>` +
		`<sntActionInfoList>${info}</sntActionInfoList>` +
		"</snt:changeStatusRequest>";
	const xml = await soapCall(URL(), body, { ns: NS });
	return { status: extractTag(xml, "sntStatus") || extractTag(xml, "status"), raw: xml };
}

export default { SNT_TYPE, SNT_ACTION, uploadSnt, querySntById, querySntUpdates, buildSntActionXml, changeSntStatus };
