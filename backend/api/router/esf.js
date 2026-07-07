// HTTP-роутер интеграции с ИС ЭСФ РК (электронные счета-фактуры).
// Поток подписи — ENVELOPED через NCALayer на клиенте (приватный ключ не покидает
// клиента). Backend: строит XML/тикет, ретранслирует подписанное в ИС ЭСФ (SOAP),
// хранит статус/рег.номер на OutgoingInvoice. См. services/esf/.
//
//  1) POST /esf/auth-ticket   {iin}                 → {authTicketXml}  (клиент подпишет)
//  2) POST /esf/session       {signedAuthTicket}    → {sessionId}
//  3) POST /esf/invoices/:uuid/build-xml            → {xml}            (клиент подпишет)
//  4) POST /esf/invoices/:uuid/sync {sessionId, signedXml} → загрузка + статус
//  5) POST /esf/invoices/:uuid/refresh-status {sessionId}  → актуальный статус
//  6) POST /esf/invoices/:uuid/errors {sessionId}          → ошибки ИС ЭСФ
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { getLegalAddress } from "../../services/legalAddress.js";
import { ESF_DICTIONARIES } from "../../services/esf/dictionaries.js";
import {
	esfConfig, EsfSoapError,
	getVersion, createAuthTicket, createSessionSigned,
	buildInvoiceV2Xml, INVOICE_ESF_INCLUDE,
	syncInvoice, queryInvoiceById, queryInvoiceErrorById, queryIncomingInvoices,
	confirmInvoiceById, declineInvoiceById,
} from "../../services/esf/index.js";

const router = express.Router();
const ROUTE = "esf";

/** Единый ответ на ошибку ЭСФ (SOAP/бизнес) — понятный текст для <Notice/>. */
function respondEsfError(res, err) {
	if (err instanceof EsfSoapError) {
		return res.status(502).json({
			success: false,
			message: err.message,
			faultCode: err.faultCode || undefined,
			// Категория для реакции UI (session→переавторизация, certificate→«замените ЭЦП»…).
			faultKind: err.faultKind || "unknown",
		});
	}
	console.error("ESF router error:", err);
	return res.status(500).json({ success: false, message: err?.message || "Ошибка ЭСФ" });
}

function requireAuth(req, res) {
	if (!req.user?.uuid) {
		res.status(401).json({ success: false, message: "Требуется авторизация" });
		return false;
	}
	return true;
}

/** Загружает исходящий счёт-фактуру с орг-изоляцией. */
async function loadInvoice(req, uuid) {
	return prisma.outgoingInvoice.findFirst({
		where: { uuid, deletedAt: null, ...tenantFilter(req) },
		include: INVOICE_ESF_INCLUDE,
	});
}

// ── Справочники (статические перечни ЭСФ) — для pick-list'ов форм ──────────────
router.get(`/${ROUTE}/dictionaries`, (req, res) => {
	if (!requireAuth(req, res)) return;
	res.json({ success: true, dictionaries: ESF_DICTIONARIES });
});

// ── Health / версия контура ──────────────────────────────────────────────────
router.get(`/${ROUTE}/version`, async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const version = await getVersion();
		res.json({ success: true, env: esfConfig.env, baseUrl: esfConfig.baseUrl, version });
	} catch (err) {
		respondEsfError(res, err);
	}
});

// ── 1. Тикет аутентификации (для подписи на клиенте) ───────────────────────────
router.post(`/${ROUTE}/auth-ticket`, async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { iin, ttlInMinutes } = req.body || {};
		if (!iin) return res.status(400).json({ success: false, message: "Не указан ИИН" });
		const authTicketXml = await createAuthTicket({ iin, ttlInMinutes });
		res.json({ success: true, authTicketXml });
	} catch (err) {
		respondEsfError(res, err);
	}
});

// ── 2. Создание сессии по подписанному тикету ──────────────────────────────────
router.post(`/${ROUTE}/session`, async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { signedAuthTicket, tin, projectCode } = req.body || {};
		if (!signedAuthTicket) return res.status(400).json({ success: false, message: "Нет подписанного тикета" });
		const { sessionId } = await createSessionSigned({ signedAuthTicket, tin, projectCode });
		res.json({ success: true, sessionId });
	} catch (err) {
		respondEsfError(res, err);
	}
});

// ── 3. Построение InvoiceV2 XML (для подписи на клиенте) ────────────────────────
router.post(`/${ROUTE}/invoices/:uuid/build-xml`, async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const invoice = await loadInvoice(req, req.params.uuid);
		if (!invoice) return res.status(404).json({ success: false, message: "Счёт-фактура не найдена" });
		if (!invoice.posted) return res.status(400).json({ success: false, message: "Сначала проведите счёт-фактуру" });
		// Юр.адрес продавца/покупателя — из контактов (legal_address), не из поля.
		if (invoice.organization) {
			invoice.organization.address = await getLegalAddress("organization", invoice.organizationUuid);
		}
		if (invoice.counterparty) {
			invoice.counterparty.address = await getLegalAddress("counterparty", invoice.counterpartyUuid);
		}
		const xml = buildInvoiceV2Xml(invoice, { num: invoice.esfNum || invoice.number });
		res.json({ success: true, xml });
	} catch (err) {
		respondEsfError(res, err);
	}
});

// ── 4. Загрузка подписанного XML в ИС ЭСФ + сохранение статуса ─────────────────
router.post(`/${ROUTE}/invoices/:uuid/sync`, async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { sessionId, signedXml, x509Certificate } = req.body || {};
		if (!sessionId) return res.status(400).json({ success: false, message: "Нет сессии ЭСФ" });
		if (!signedXml) return res.status(400).json({ success: false, message: "Нет подписанного XML" });

		const invoice = await loadInvoice(req, req.params.uuid);
		if (!invoice) return res.status(404).json({ success: false, message: "Счёт-фактура не найдена" });

		// ENVELOPED: подписанный XML целиком в invoiceBody, отдельная signature пуста.
		const result = await syncInvoice({
			sessionId,
			invoices: [{ invoiceBody: signedXml, version: "InvoiceV2", num: invoice.number }],
			x509Certificate,
		});

		const accepted = result.accepted[0];
		const declined = result.declined[0];
		const data = declined
			? {
				esfStatus: "FAILED",
				esfErrorText: [declined.errorCode, declined.errorText].filter(Boolean).join(": ") || "Отклонено ИС ЭСФ",
			}
			: {
				esfStatus: accepted?.status || "IMPORTED",
				esfInvoiceId: accepted?.id || null,
				esfNum: accepted?.num || null,
				esfRegistrationNumber: accepted?.registrationNumber || null,
				esfErrorText: null,
			};

		const updated = await prisma.outgoingInvoice.update({
			where: { uuid: invoice.uuid },
			data: { ...data, esfSentAt: new Date(), esfXml: signedXml },
		});

		res.json({
			success: !declined,
			message: declined ? updated.esfErrorText : "ЭСФ загружена в ИС ЭСФ",
			esfStatus: updated.esfStatus,
			esfInvoiceId: updated.esfInvoiceId,
			esfNum: updated.esfNum,
			esfRegistrationNumber: updated.esfRegistrationNumber,
			esfErrorText: updated.esfErrorText,
		});
	} catch (err) {
		respondEsfError(res, err);
	}
});

// ── Входящие ЭСФ (queryInvoice direction=INBOUND) ─────────────────────────────
router.post(`/${ROUTE}/incoming`, async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { sessionId, dateFrom, dateTo, contragentTin, statuses, pageNum } = req.body || {};
		if (!sessionId) return res.status(400).json({ success: false, message: "Нет сессии ЭСФ" });
		const result = await queryIncomingInvoices({ sessionId, dateFrom, dateTo, contragentTin, statuses, pageNum });
		res.json({ success: true, ...result });
	} catch (err) {
		respondEsfError(res, err);
	}
});

// ── Подтвердить входящие ЭСФ (без подписи) ────────────────────────────────────
router.post(`/${ROUTE}/incoming/confirm`, async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { sessionId, ids } = req.body || {};
		if (!sessionId) return res.status(400).json({ success: false, message: "Нет сессии ЭСФ" });
		if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ success: false, message: "Не указаны ЭСФ" });
		await confirmInvoiceById(sessionId, ids);
		res.json({ success: true, message: "Подтверждено" });
	} catch (err) { respondEsfError(res, err); }
});

// ── Отклонить входящие ЭСФ (подписанная операция: signature+x509 от клиента) ───
router.post(`/${ROUTE}/incoming/decline`, async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { sessionId, items, signature, x509Certificate } = req.body || {};
		if (!sessionId) return res.status(400).json({ success: false, message: "Нет сессии ЭСФ" });
		if (!Array.isArray(items) || !items.length) return res.status(400).json({ success: false, message: "Не указаны ЭСФ/причины" });
		await declineInvoiceById(sessionId, items, { signature, x509Certificate });
		res.json({ success: true, message: "Отклонено" });
	} catch (err) { respondEsfError(res, err); }
});

// ── 5. Обновление статуса из ИС ЭСФ ────────────────────────────────────────────
router.post(`/${ROUTE}/invoices/:uuid/refresh-status`, async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { sessionId } = req.body || {};
		if (!sessionId) return res.status(400).json({ success: false, message: "Нет сессии ЭСФ" });

		const invoice = await loadInvoice(req, req.params.uuid);
		if (!invoice) return res.status(404).json({ success: false, message: "Счёт-фактура не найдена" });
		if (!invoice.esfInvoiceId) return res.status(400).json({ success: false, message: "ЭСФ ещё не отправлена" });

		const { statuses } = await queryInvoiceById(sessionId, [invoice.esfInvoiceId]);
		const st = statuses[0];
		if (!st) return res.status(404).json({ success: false, message: "Статус ЭСФ не получен" });

		const updated = await prisma.outgoingInvoice.update({
			where: { uuid: invoice.uuid },
			data: {
				esfStatus: st.status || invoice.esfStatus,
				esfRegistrationNumber: st.registrationNumber || invoice.esfRegistrationNumber,
			},
		});
		res.json({
			success: true,
			esfStatus: updated.esfStatus,
			esfRegistrationNumber: updated.esfRegistrationNumber,
		});
	} catch (err) {
		respondEsfError(res, err);
	}
});

// ── 6. Ошибки ИС ЭСФ по счёту-фактуре ─────────────────────────────────────────
router.post(`/${ROUTE}/invoices/:uuid/errors`, async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { sessionId } = req.body || {};
		if (!sessionId) return res.status(400).json({ success: false, message: "Нет сессии ЭСФ" });
		const invoice = await loadInvoice(req, req.params.uuid);
		if (!invoice) return res.status(404).json({ success: false, message: "Счёт-фактура не найдена" });
		if (!invoice.esfInvoiceId) return res.status(400).json({ success: false, message: "ЭСФ ещё не отправлена" });

		const { errors } = await queryInvoiceErrorById(sessionId, [invoice.esfInvoiceId]);
		res.json({ success: true, errors });
	} catch (err) {
		respondEsfError(res, err);
	}
});

export default router;
