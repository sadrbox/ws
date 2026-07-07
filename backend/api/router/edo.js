// HTTP-роутер ЭДО (документооборот с контрагентами) — P1 «Исходящие».
// Поток (аналог ЭСФ): создать черновик → build-xml → подпись NCALayer на клиенте →
// send. Отправитель = активная организация пользователя (req.user). Приём/входящие —
// на следующем этапе (P2). Орг-изоляция: отправитель видит только свои документы.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { EdoError } from "../../services/edo/index.js";
import {
	createEdoDocument, buildForSign, sendEdoDocument, loadAttachments,
	buildForAccept, acceptEdoDocument, rejectEdoDocument, revokeEdoDocument, annulEdoDocument,
} from "../../services/edo/documents.js";

const router = express.Router();
const ROUTE = "edo";

function requireAuth(req, res) {
	if (!req.user?.uuid) { res.status(401).json({ success: false, message: "Требуется авторизация" }); return false; }
	return true;
}
function requireOrg(req, res) {
	if (!req.user?.organizationUuid) {
		res.status(400).json({ success: false, message: "Не выбрана активная организация" });
		return false;
	}
	return true;
}
function respondEdoError(res, err) {
	if (err instanceof EdoError) return res.status(err.httpStatus || 400).json({ success: false, message: err.message });
	console.error("EDO router error:", err);
	return res.status(500).json({ success: false, message: err?.message || "Ошибка ЭДО" });
}

/** БИН активной организации пользователя. */
async function senderBinOf(orgUuid) {
	const org = await prisma.organization.findUnique({ where: { uuid: orgUuid }, select: { bin: true } });
	return org?.bin || "";
}

// ── Создать черновик исходящего документа ─────────────────────────────────────
router.post(`/${ROUTE}/documents`, async (req, res) => {
	if (!requireAuth(req, res) || !requireOrg(req, res)) return;
	try {
		const senderOrgUuid = req.user.organizationUuid;
		const { receiverBin, kind, title, number, date, comment, sourceDocType, sourceDocUuid } = req.body || {};
		if (!receiverBin) return res.status(400).json({ success: false, message: "Не указан БИН получателя" });
		const doc = await createEdoDocument({
			senderOrgUuid, senderBin: await senderBinOf(senderOrgUuid), authorUuid: req.user.uuid,
			receiverBin, kind, title, number, date, comment, sourceDocType, sourceDocUuid,
		});
		res.status(201).json({ success: true, item: doc });
	} catch (err) { respondEdoError(res, err); }
});

// ── Список исходящих (Outbox) активной организации ────────────────────────────
router.get(`/${ROUTE}/documents/outbox`, async (req, res) => {
	if (!requireAuth(req, res) || !requireOrg(req, res)) return;
	try {
		const items = await prisma.edoDocument.findMany({
			where: { senderOrgUuid: req.user.organizationUuid, deletedAt: null },
			orderBy: { id: "desc" }, take: 500,
		});
		res.json({ success: true, items });
	} catch (err) { respondEdoError(res, err); }
});

// ── Список входящих (Inbox) активной организации ──────────────────────────────
router.get(`/${ROUTE}/documents/inbox`, async (req, res) => {
	if (!requireAuth(req, res) || !requireOrg(req, res)) return;
	try {
		const items = await prisma.edoDocument.findMany({
			where: { receiverOrgUuid: req.user.organizationUuid, deletedAt: null },
			orderBy: { id: "desc" }, take: 500,
		});
		res.json({ success: true, items });
	} catch (err) { respondEdoError(res, err); }
});

// ── Счётчик новых входящих (статус DELIVERED — ещё не обработаны) ──────────────
router.get(`/${ROUTE}/documents/inbox/new-count`, async (req, res) => {
	if (!requireAuth(req, res) || !requireOrg(req, res)) return;
	try {
		const count = await prisma.edoDocument.count({
			where: { receiverOrgUuid: req.user.organizationUuid, deletedAt: null, status: "DELIVERED" },
		});
		res.json({ success: true, count });
	} catch (err) { respondEdoError(res, err); }
});

// ── Один документ (+ подписи + вложения). Виден отправителю или получателю ─────
router.get(`/${ROUTE}/documents/:uuid`, async (req, res) => {
	if (!requireAuth(req, res) || !requireOrg(req, res)) return;
	try {
		const orgUuid = req.user.organizationUuid;
		const doc = await prisma.edoDocument.findFirst({
			where: {
				uuid: req.params.uuid, deletedAt: null,
				OR: [{ senderOrgUuid: orgUuid }, { receiverOrgUuid: orgUuid }],
			},
			include: { signatures: { orderBy: { signedAt: "asc" } } },
		});
		if (!doc) return res.status(404).json({ success: false, message: "Документ ЭДО не найден" });
		const attachments = await loadAttachments(doc.uuid);
		res.json({ success: true, item: { ...doc, attachments } });
	} catch (err) { respondEdoError(res, err); }
});

// ── Построить канонический XML для подписи на клиенте ─────────────────────────
router.post(`/${ROUTE}/documents/:uuid/build-xml`, async (req, res) => {
	if (!requireAuth(req, res) || !requireOrg(req, res)) return;
	try {
		const { xml } = await buildForSign(req.params.uuid, req.user.organizationUuid);
		res.json({ success: true, xml });
	} catch (err) { respondEdoError(res, err); }
});

// ── Отправить (сохранить подпись отправителя + статус) ────────────────────────
router.post(`/${ROUTE}/documents/:uuid/send`, async (req, res) => {
	if (!requireAuth(req, res) || !requireOrg(req, res)) return;
	try {
		const { signedXml, certificate } = req.body || {};
		const doc = await sendEdoDocument({
			uuid: req.params.uuid, senderOrgUuid: req.user.organizationUuid,
			userUuid: req.user.uuid, signedXml, certificate,
		});
		res.json({
			success: true,
			status: doc.status,
			delivered: doc.status === "DELIVERED",
			message: doc.status === "DELIVERED" ? "Документ доставлен получателю" : "Документ отправлен (получатель не подключён к системе)",
		});
	} catch (err) { respondEdoError(res, err); }
});

// ── Построить XML для встречной подписи получателем ──────────────────────────
router.post(`/${ROUTE}/documents/:uuid/accept-xml`, async (req, res) => {
	if (!requireAuth(req, res) || !requireOrg(req, res)) return;
	try {
		const { xml } = await buildForAccept(req.params.uuid, req.user.organizationUuid);
		res.json({ success: true, xml });
	} catch (err) { respondEdoError(res, err); }
});

// ── Приём документа (со встречной подписью или без) ──────────────────────────
router.post(`/${ROUTE}/documents/:uuid/accept`, async (req, res) => {
	if (!requireAuth(req, res) || !requireOrg(req, res)) return;
	try {
		const { signedXml, certificate } = req.body || {};
		const doc = await acceptEdoDocument({
			uuid: req.params.uuid, receiverOrgUuid: req.user.organizationUuid,
			userUuid: req.user.uuid, signedXml, certificate,
		});
		res.json({ success: true, status: doc.status, message: doc.status === "SIGNED" ? "Документ подписан" : "Документ принят" });
	} catch (err) { respondEdoError(res, err); }
});

// ── Отклонение документа получателем с причиной ──────────────────────────────
router.post(`/${ROUTE}/documents/:uuid/reject`, async (req, res) => {
	if (!requireAuth(req, res) || !requireOrg(req, res)) return;
	try {
		const { reason } = req.body || {};
		if (!reason || !reason.trim()) return res.status(400).json({ success: false, message: "Укажите причину отклонения" });
		const doc = await rejectEdoDocument({ uuid: req.params.uuid, receiverOrgUuid: req.user.organizationUuid, reason: reason.trim() });
		res.json({ success: true, status: doc.status, message: "Документ отклонён" });
	} catch (err) { respondEdoError(res, err); }
});

// ── Отзыв документа отправителем ─────────────────────────────────────────────
router.post(`/${ROUTE}/documents/:uuid/revoke`, async (req, res) => {
	if (!requireAuth(req, res) || !requireOrg(req, res)) return;
	try {
		const { reason } = req.body || {};
		const doc = await revokeEdoDocument({ uuid: req.params.uuid, senderOrgUuid: req.user.organizationUuid, reason: reason?.trim() });
		res.json({ success: true, status: doc.status, message: "Документ отозван" });
	} catch (err) { respondEdoError(res, err); }
});

// ── Аннулирование по согласию (любой из сторон) ──────────────────────────────
router.post(`/${ROUTE}/documents/:uuid/annul`, async (req, res) => {
	if (!requireAuth(req, res) || !requireOrg(req, res)) return;
	try {
		const { reason } = req.body || {};
		if (!reason || !reason.trim()) return res.status(400).json({ success: false, message: "Укажите причину аннулирования" });
		const doc = await annulEdoDocument({ uuid: req.params.uuid, orgUuid: req.user.organizationUuid, reason: reason.trim() });
		res.json({ success: true, status: doc.status, message: "Документ аннулирован" });
	} catch (err) { respondEdoError(res, err); }
});

export default router;
