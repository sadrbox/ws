// Высокоуровневый клиент ИС ЭСФ РК. Сборка: config → soapClient → операции.
// P0: проверка версии (VersionService, без сессии) + сессия по подписанному
// тикету (SessionService.createSessionSigned). Тикет подписывается на КЛИЕНТЕ
// через NCALayer (ключ AUTHENTICATION) — приватный ключ не покидает клиента.
import { esfConfig, serviceUrl } from "./config.js";
import { soapCall, EsfSoapError, extractTag, extractAllTags, xmlEscape } from "./soapClient.js";
import { enrichErrors } from "./errorCatalog.js";

export { EsfSoapError, esfConfig };
export { loadErrorCatalog, describeError, classifyCode } from "./errorCatalog.js";
export { buildInvoiceV2Xml, INVOICE_ESF_INCLUDE } from "./invoiceMapper.js";
export {
	ESF_INVOICE_STATUS,
	queryInvoiceById, queryInvoiceErrorById,
	confirmInvoiceById, declineInvoiceById,
	deleteInvoiceById, revokeInvoiceById, unrevokeInvoiceById,
} from "./invoiceService.js";

// ── VersionService (без сессии) ─────────────────────────────────────────────

/** Версия ПО ИС ЭСФ (getVersion — без параметров). Годится как smoke-тест связи. */
export async function getVersion() {
	const xml = await soapCall(serviceUrl("VersionService"), "<esf:getVersion/>");
	return extractTag(xml, "version") || extractTag(xml, "return") || xml;
}

/** Версия API ИС ЭСФ (getApiVersion). */
export async function getApiVersion() {
	const xml = await soapCall(serviceUrl("VersionService"), "<esf:apiVersionRequest/>");
	return extractTag(xml, "version") || extractTag(xml, "return") || xml;
}

// ── AuthService (генерация тикета для подписи) ──────────────────────────────

/**
 * Создать XML-тикет аутентификации (createAuthTicket). Возвращаемый XML
 * подписывается на клиенте через NCALayer (ключ AUTHENTICATION), затем
 * передаётся в createSessionSigned.
 * @param {object} p
 * @param {string} p.iin — ИИН пользователя, проходящего аутентификацию.
 * @param {number} [p.ttlInMinutes] — срок действия тикета (1..1440, дефолт 30).
 * @returns {Promise<string>} authTicketXml — XML-тикет для подписи.
 */
export async function createAuthTicket({ iin, ttlInMinutes } = {}) {
	if (!iin) throw new EsfSoapError("Не задан ИИН пользователя (iin)");
	const body =
		"<esf:createAuthTicketRequest>" +
		`<iin>${xmlEscape(iin)}</iin>` +
		(ttlInMinutes ? `<ttlInMinutes>${xmlEscape(ttlInMinutes)}</ttlInMinutes>` : "") +
		"</esf:createAuthTicketRequest>";
	const xml = await soapCall(serviceUrl("AuthService"), body);
	const ticket = extractTag(xml, "authTicketXml");
	if (!ticket) throw new EsfSoapError("ИС ЭСФ не вернула authTicketXml", { raw: xml });
	return ticket;
}

// ── SessionService ──────────────────────────────────────────────────────────

/**
 * Создать сессию по подписанному тикету (createSessionSigned).
 * @param {object} p
 * @param {string} p.signedAuthTicket — XML Dsig-подписанный тикет (из NCALayer).
 * @param {string} [p.tin] — БИН предприятия (по умолчанию из конфига).
 * @param {string|number} [p.projectCode]
 * @returns {Promise<{ sessionId: string }>}
 */
export async function createSessionSigned({ signedAuthTicket, tin, projectCode } = {}) {
	if (!signedAuthTicket) throw new EsfSoapError("Нет подписанного тикета (signedAuthTicket)");
	const bin = tin || esfConfig.tin;
	if (!bin) throw new EsfSoapError("Не задан БИН предприятия (ESF_TIN)");
	const pc = projectCode ?? esfConfig.projectCode;

	const body =
		"<esf:createSessionSignedRequest>" +
		`<tin>${xmlEscape(bin)}</tin>` +
		(pc ? `<projectCode>${xmlEscape(pc)}</projectCode>` : "") +
		`<signedAuthTicket>${xmlEscape(signedAuthTicket)}</signedAuthTicket>` +
		"</esf:createSessionSignedRequest>";

	const xml = await soapCall(serviceUrl("SessionService"), body);
	const sessionId = extractTag(xml, "sessionId");
	if (!sessionId) throw new EsfSoapError("ИС ЭСФ не вернула sessionId", { raw: xml });
	return { sessionId };
}

/** Закрыть сессию (closeSession). */
export async function closeSession(sessionId) {
	if (!sessionId) return;
	const body =
		"<esf:closeSessionRequest>" +
		`<sessionId>${xmlEscape(sessionId)}</sessionId>` +
		"</esf:closeSessionRequest>";
	await soapCall(serviceUrl("SessionService"), body);
}

/** Данные текущего пользователя сессии (currentUser) — для проверки авторизации. */
export async function currentUser(sessionId) {
	const body =
		"<esf:currentUserRequest>" +
		`<sessionId>${xmlEscape(sessionId)}</sessionId>` +
		"</esf:currentUserRequest>";
	const xml = await soapCall(serviceUrl("SessionService"), body);
	return {
		iin: extractTag(xml, "iin"),
		tin: extractTag(xml, "tin"),
		fio: extractTag(xml, "fio") || extractTag(xml, "name"),
		raw: xml,
	};
}

// ── UploadInvoiceService ────────────────────────────────────────────────────

/**
 * Загрузить подписанные ЭСФ (syncInvoice). МОДЕЛЬ-АГНОСТИЧНЫЙ РЕЛЕЙ: не фиксирует
 * способ подписи — передаёт то, что подготовил клиент (invoiceBody + signature +
 * x509Certificate). Так поддерживаются обе схемы: detached (тело + отдельная ЭЦП)
 * и enveloped-XMLDSIG (весь подписанный XML в invoiceBody, signature пуст).
 *
 * @param {object} p
 * @param {string} p.sessionId
 * @param {Array<{invoiceBody:string, signature?:string, signatureType?:string, version?:string, num?:string}>} p.invoices
 * @param {string} [p.x509Certificate] — PEM/base64 сертификата (для проверки подписи).
 * @returns {Promise<{accepted:Array, declined:Array, raw:string}>}
 */
export async function syncInvoice({ sessionId, invoices = [], x509Certificate } = {}) {
	if (!sessionId) throw new EsfSoapError("Нет sessionId для syncInvoice");
	if (!invoices.length) throw new EsfSoapError("Нет ЭСФ для загрузки");

	const infoList = invoices
		.map((inv) =>
			"<invoiceUploadInfo>" +
			`<invoiceBody>${xmlEscape(inv.invoiceBody)}</invoiceBody>` +
			`<version>${xmlEscape(inv.version || "InvoiceV2")}</version>` +
			(inv.signature ? `<signature>${xmlEscape(inv.signature)}</signature>` : "") +
			`<signatureType>${xmlEscape(inv.signatureType || "COMPANY")}</signatureType>` +
			"</invoiceUploadInfo>",
		)
		.join("");

	const body =
		"<esf:syncInvoiceRequest>" +
		`<sessionId>${xmlEscape(sessionId)}</sessionId>` +
		`<invoiceUploadInfoList>${infoList}</invoiceUploadInfoList>` +
		(x509Certificate ? `<x509Certificate>${xmlEscape(x509Certificate)}</x509Certificate>` : "") +
		"</esf:syncInvoiceRequest>";

	const xml = await soapCall(serviceUrl("UploadInvoiceService"), body);
	const parsed = parseSyncResult(xml);
	// Обогащаем отклонённые официальным описанием + категорией из каталога.
	const declined = await enrichErrors(
		parsed.declined.map((d) => ({ ...d, errorCode: d.errorCode, text: d.errorText })),
	).then((errs) => parsed.declined.map((d, i) => ({ ...d, kind: errs[i].kind, errorText: errs[i].text })));
	return { accepted: parsed.accepted, declined, raw: xml };
}

/** Разбирает acceptedSet/declinedSet из ответа syncInvoice. */
function parseSyncResult(xml) {
	const block = (name) => {
		const m = xml.match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "i"));
		return m ? m[1] : "";
	};
	const items = (blockXml) => extractAllTags(blockXml, "invoiceStatus").length
		? extractAllTags(blockXml, "invoiceStatus")
		: extractAllTags(blockXml, "invoice");
	const parseEntry = (frag) => ({
		num: extractTag(frag, "num"),
		id: extractTag(frag, "id"),
		registrationNumber: extractTag(frag, "registrationNumber"),
		errorCode: extractTag(frag, "errorCode"),
		errorText: extractTag(frag, "text") || extractTag(frag, "description"),
	});
	return {
		accepted: items(block("acceptedSet")).map(parseEntry),
		declined: items(block("declinedSet")).map(parseEntry),
	};
}

export default {
	getVersion, getApiVersion, createAuthTicket,
	createSessionSigned, closeSession, currentUser,
	syncInvoice,
};
