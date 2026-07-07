// Юнит-тесты обработки ошибок ЭСФ: классификация SOAP-фолтов и кодов ошибок,
// извлечение полей из фолтов/declinedSet, обогащение ошибок категорией.
// Без БД и без сети (каталог не вызывается, т.к. у ошибок есть текст).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	classifyFault, EsfSoapError, extractTag, extractAllTags, xmlEscape, buildEnvelope,
} from "../services/esf/soapClient.js";
import { classifyCode, enrichError, enrichErrors } from "../services/esf/errorCatalog.js";

// ── Фикстуры SOAP-фолтов (по типам исключений ИС ЭСФ) ───────────────────────
const fault = (faultstring, extra = "") =>
	`<soap:Envelope><soap:Body><soap:Fault>` +
	`<faultcode>soap:Server</faultcode><faultstring>${faultstring}</faultstring>` +
	`<detail>${extra}</detail></soap:Fault></soap:Body></soap:Envelope>`;

test("classifyFault: session (SessionClosed / NO_AUTH)", () => {
	assert.equal(classifyFault(fault("No open session associated with user")), "session");
	assert.equal(classifyFault("<x/>", "SessionClosedException"), "session");
	assert.equal(classifyFault(fault("NO_AUTH")), "session");
});

test("classifyFault: access denied", () => {
	assert.equal(classifyFault("<x/>", "AccessDeniedException"), "access");
});

test("classifyFault: certificate (истёк/отозван/не тот тип)", () => {
	assert.equal(classifyFault(fault("CERTIFICATE_EXPIRED")), "certificate");
	assert.equal(classifyFault(fault("Сертификат отозван")), "certificate");
	assert.equal(classifyFault(fault("CERTIFICATE_IS_NOT_FOR_SIGNING")), "certificate");
});

test("classifyFault: ocsp (приоритет над certificate)", () => {
	assert.equal(classifyFault("<x/>", "TrustyOCSPNotAvailableException"), "ocsp");
});

test("classifyFault: signature", () => {
	assert.equal(classifyFault(fault("SIGNATURE_INVALID_FORMAT")), "signature");
	assert.equal(classifyFault(fault("Ошибка подписи")), "signature");
});

test("classifyFault: validation (XSD/unmarshalling)", () => {
	assert.equal(classifyFault(fault("Unmarshalling Error: cvc-complex-type.2.4.a: Invalid content")), "validation");
});

test("classifyFault: business / unknown", () => {
	assert.equal(classifyFault("<x/>", "BusinessException"), "business");
	assert.equal(classifyFault(fault("что-то совсем иное")), "unknown");
});

// ── Извлечение полей из фолта ────────────────────────────────────────────────
test("extractTag достаёт faultstring/faultcode", () => {
	const xml = fault("Boom", "");
	assert.equal(extractTag(xml, "faultstring"), "Boom");
	assert.equal(extractTag(xml, "faultcode"), "soap:Server");
});

test("EsfSoapError несёт faultKind", () => {
	const e = new EsfSoapError("x", { faultKind: "certificate", faultCode: "soap:Server" });
	assert.equal(e.faultKind, "certificate");
	assert.equal(e.name, "EsfSoapError");
});

// ── declinedSet: извлечение ошибок отклонённой ЭСФ ──────────────────────────
test("extractAllTags разбирает несколько ошибок из declinedSet", () => {
	const xml =
		"<declinedSet><invoice><num>42</num>" +
		"<error><errorCode>SELLER_TIN_ABSENT</errorCode><text>БИН продавца отсутствует</text></error>" +
		"<error><errorCode>VAT_RATE_WRONG</errorCode><text>Неверная ставка НДС</text></error>" +
		"</invoice></declinedSet>";
	assert.deepEqual(extractAllTags(xml, "errorCode"), ["SELLER_TIN_ABSENT", "VAT_RATE_WRONG"]);
	assert.equal(extractTag(xml, "num"), "42");
});

// ── classifyCode: таксономия по префиксу кода ────────────────────────────────
test("classifyCode покрывает основные категории", () => {
	assert.equal(classifyCode("NO_AUTH"), "session");
	assert.equal(classifyCode("USER_HAS_NOT_REGISTERED"), "session");
	assert.equal(classifyCode("CERTIFICATE_REVOKED"), "certificate");
	assert.equal(classifyCode("SIGNATURE_VERIFICATION_FAILED"), "signature");
	assert.equal(classifyCode("WRONG_INVOICE_DATE"), "validation");
	assert.equal(classifyCode("PASSWORD_EXPIRED"), "auth");
	assert.equal(classifyCode("SELLER_TIN_ABSENT"), "business");
	assert.equal(classifyCode(null), "unknown");
});

// ── enrichError/enrichErrors: категория + текст (без обращения к каталогу) ────
test("enrichError добавляет kind и сохраняет пришедший текст (без сети)", async () => {
	const e = await enrichError({ errorCode: "CERTIFICATE_EXPIRED", text: "Истёк срок сертификата" });
	assert.equal(e.kind, "certificate");
	assert.equal(e.text, "Истёк срок сертификата");
});

test("enrichErrors обрабатывает список", async () => {
	const list = await enrichErrors([
		{ errorCode: "VAT_RATE_WRONG", text: "Неверная ставка" },
		{ errorCode: "NO_AUTH", text: "Не авторизован" },
	]);
	assert.equal(list.length, 2);
	assert.equal(list[0].kind, "validation");
	assert.equal(list[1].kind, "session");
});

// ── xmlEscape / buildEnvelope ────────────────────────────────────────────────
test("xmlEscape экранирует спецсимволы", () => {
	assert.equal(xmlEscape('a & b < c > "d" \'e\''), "a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;");
});

test("buildEnvelope оборачивает тело в SOAP 1.1 конверт с ns esf", () => {
	const env = buildEnvelope("<esf:getVersion/>");
	assert.match(env, /<soapenv:Envelope[^>]*xmlns:esf="esf"/);
	assert.match(env, /<soapenv:Body><esf:getVersion\/><\/soapenv:Body>/);
});
