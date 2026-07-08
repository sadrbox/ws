// Роутер гос-документов РК: ЭАВР (акт работ/услуг) и СНТ (сопроводительная
// накладная). Источники — существующие документы: ЭАВР ← Реализация;
// СНТ ← Реализация / Перемещение. Поток как у ЭСФ: build-xml → подпись NCALayer
// на клиенте → upload → статус. Сессия ИС ЭСФ приходит от клиента (sessionId).
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { getLegalAddress } from "../../services/legalAddress.js";
import { EsfSoapError } from "../../services/esf/soapClient.js";
import { buildAwpV1Xml, AWP_SALE_INCLUDE, uploadAwp, queryAwpById, queryAwpUpdates, buildAwpActionXml, changeAwpStatus, AWP_ACTION } from "../../services/awp/index.js";
import { buildSntV1Xml, SNT_SALE_INCLUDE, validateSntProducts, uploadSnt, querySntById, querySntUpdates, buildSntActionXml, changeSntStatus, SNT_ACTION } from "../../services/snt/index.js";

const router = express.Router();

/** Источники СНТ: url-сегмент → prisma-модель + include + поле позиций. */
const SNT_SOURCES = {
	"sales": { model: "sale", include: SNT_SALE_INCLUDE, itemsKey: "saleItems" },
	"inventory-transfers": {
		model: "inventoryTransfer",
		include: {
			inventoryTransferItems: { include: { product: { include: { unitOfMeasure: true } }, unitOfMeasure: true } },
			organization: true,
		},
		itemsKey: "inventoryTransferItems",
	},
};

function requireAuth(req, res) {
	if (!req.user?.uuid) { res.status(401).json({ success: false, message: "Требуется авторизация" }); return false; }
	return true;
}
function respondErr(res, err) {
	if (err instanceof EsfSoapError) {
		return res.status(502).json({ success: false, message: err.message, faultKind: err.faultKind || "unknown" });
	}
	console.error("govdocs error:", err);
	return res.status(500).json({ success: false, message: err?.message || "Ошибка гос-документа" });
}

/** Подставляет юр.адрес (из Контактов) участникам документа. */
async function injectAddresses(doc) {
	if (doc.organization) doc.organization.address = await getLegalAddress("organization", doc.organizationUuid);
	if (doc.counterparty) doc.counterparty.address = await getLegalAddress("counterparty", doc.counterpartyUuid);
	return doc;
}

// ═══════════════════════════ Исходящие (списки выписанных) ══════════════════

// Исходящие ЭАВР — Реализации, по которым выписан ЭАВР (awpStatus задан).
router.get("/awp/outbox", async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const rows = await prisma.sale.findMany({
			where: { deletedAt: null, awpStatus: { not: null }, ...tenantFilter(req) },
			orderBy: { awpSentAt: "desc" }, take: 500,
			select: { uuid: true, number: true, date: true, awpStatus: true, awpRegistrationNumber: true, awpSentAt: true, counterparty: { select: { name: true } } },
		});
		res.json({ success: true, items: rows.map((r) => ({ ...r, counterpartyName: r.counterparty?.name || "" })) });
	} catch (err) { respondErr(res, err); }
});

// Исходящие СНТ — Реализации + Перемещения, по которым выписана СНТ (sntStatus задан).
router.get("/snt/outbox", async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const [sales, transfers] = await Promise.all([
			prisma.sale.findMany({
				where: { deletedAt: null, sntStatus: { not: null }, ...tenantFilter(req) },
				orderBy: { sntSentAt: "desc" }, take: 500,
				select: { uuid: true, number: true, date: true, sntStatus: true, sntRegistrationNumber: true, sntSentAt: true, counterparty: { select: { name: true } } },
			}),
			prisma.inventoryTransfer.findMany({
				where: { deletedAt: null, sntStatus: { not: null }, ...tenantFilter(req) },
				orderBy: { sntSentAt: "desc" }, take: 500,
				select: { uuid: true, number: true, date: true, sntStatus: true, sntRegistrationNumber: true, sntSentAt: true },
			}),
		]);
		const items = [
			...sales.map((r) => ({ ...r, source: "sales", contragent: r.counterparty?.name || "", counterparty: undefined })),
			...transfers.map((r) => ({ ...r, source: "inventory-transfers", contragent: "" })),
		].sort((a, b) => new Date(b.sntSentAt || 0) - new Date(a.sntSentAt || 0));
		res.json({ success: true, items });
	} catch (err) { respondErr(res, err); }
});

// ═══════════════════════════ Входящие (из ИС ЭСФ, опрос) ════════════════════

// Входящие ЭАВР (queryUpdate). Требует сессию (от клиента).
router.post("/awp/incoming", async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { sessionId, lastEventDate } = req.body || {};
		if (!sessionId) return res.status(400).json({ success: false, message: "Нет сессии ЭСФ" });
		const r = await queryAwpUpdates({ sessionId, lastEventDate });
		res.json({ success: true, ...r });
	} catch (err) { respondErr(res, err); }
});

// Входящие СНТ (queryUpdate direction=INBOUND). Требует сессию.
router.post("/snt/incoming", async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { sessionId, lastEventDate } = req.body || {};
		if (!sessionId) return res.status(400).json({ success: false, message: "Нет сессии ЭСФ" });
		const r = await querySntUpdates({ sessionId, direction: "INBOUND", lastEventDate });
		res.json({ success: true, ...r });
	} catch (err) { respondErr(res, err); }
});

// ─── Приём входящих (changeStatus — подписанная операция) ─────────────────────
// Валидные действия приёмщика: CONFIRM (принять), DECLINE (отклонить, нужна причина).
const INCOMING_ACTIONS = new Set(["CONFIRM", "DECLINE"]);

// Построить XML действия по ЭАВР (для подписи на клиенте)
router.post("/awp/incoming/build-action", async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { awpId, actionType, cause } = req.body || {};
		if (!INCOMING_ACTIONS.has(actionType)) return res.status(400).json({ success: false, message: "Недопустимое действие" });
		res.json({ success: true, xml: buildAwpActionXml({ actionType: AWP_ACTION[actionType], cause, awpId }) });
	} catch (err) { respondErr(res, err); }
});

// Применить подписанное действие по ЭАВР (принять/отклонить)
router.post("/awp/incoming/change-status", async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { sessionId, awpId, signedActionBody, x509Certificate } = req.body || {};
		if (!sessionId) return res.status(400).json({ success: false, message: "Нет сессии ЭСФ" });
		if (!signedActionBody) return res.status(400).json({ success: false, message: "Нет подписанного действия" });
		const r = await changeAwpStatus({ sessionId, awpId, actionBody: signedActionBody, x509Certificate });
		res.json({ success: true, status: r.status });
	} catch (err) { respondErr(res, err); }
});

// Построить XML действия по СНТ (для подписи на клиенте)
router.post("/snt/incoming/build-action", async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { sntId, actionType, cause } = req.body || {};
		if (!INCOMING_ACTIONS.has(actionType)) return res.status(400).json({ success: false, message: "Недопустимое действие" });
		res.json({ success: true, xml: buildSntActionXml({ actionType: SNT_ACTION[actionType], cause, sntId }) });
	} catch (err) { respondErr(res, err); }
});

// Применить подписанное действие по СНТ (принять/отклонить)
router.post("/snt/incoming/change-status", async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { sessionId, sntId, signedActionBody, x509Certificate } = req.body || {};
		if (!sessionId) return res.status(400).json({ success: false, message: "Нет сессии ЭСФ" });
		if (!signedActionBody) return res.status(400).json({ success: false, message: "Нет подписанного действия" });
		const r = await changeSntStatus({ sessionId, sntId, actionBody: signedActionBody, x509Certificate });
		res.json({ success: true, status: r.status });
	} catch (err) { respondErr(res, err); }
});

// ═══════════════════════════ ЭАВР (из Реализации) ═══════════════════════════

async function loadSaleForAwp(req, uuid) {
	return prisma.sale.findFirst({ where: { uuid, deletedAt: null, ...tenantFilter(req) }, include: AWP_SALE_INCLUDE });
}

// Построить XML ЭАВР (для подписи на клиенте)
router.post("/awp/sales/:uuid/build-xml", async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const sale = await loadSaleForAwp(req, req.params.uuid);
		if (!sale) return res.status(404).json({ success: false, message: "Реализация не найдена" });
		if (!sale.posted) return res.status(400).json({ success: false, message: "Сначала проведите документ" });
		await injectAddresses(sale);
		res.json({ success: true, xml: buildAwpV1Xml(sale, { performedDate: req.body?.performedDate }) });
	} catch (err) { respondErr(res, err); }
});

// Загрузить подписанный ЭАВР + сохранить статус
router.post("/awp/sales/:uuid/upload", async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { sessionId, signedXml, x509Certificate } = req.body || {};
		if (!sessionId) return res.status(400).json({ success: false, message: "Нет сессии ЭСФ" });
		if (!signedXml) return res.status(400).json({ success: false, message: "Нет подписанного XML" });
		const sale = await loadSaleForAwp(req, req.params.uuid);
		if (!sale) return res.status(404).json({ success: false, message: "Реализация не найдена" });

		const r = await uploadAwp({ sessionId, awpBody: signedXml, x509Certificate });
		const updated = await prisma.sale.update({
			where: { uuid: sale.uuid },
			data: {
				awpStatus: r.status || "CREATED", awpId: r.id || null,
				awpRegistrationNumber: r.registrationNumber || null,
				awpSentAt: new Date(), awpXml: signedXml, awpErrorText: null,
			},
		});
		res.json({ success: true, awpStatus: updated.awpStatus, awpId: updated.awpId, awpRegistrationNumber: updated.awpRegistrationNumber });
	} catch (err) { respondErr(res, err); }
});

// Обновить статус ЭАВР
router.post("/awp/sales/:uuid/status", async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { sessionId } = req.body || {};
		if (!sessionId) return res.status(400).json({ success: false, message: "Нет сессии ЭСФ" });
		const sale = await prisma.sale.findFirst({ where: { uuid: req.params.uuid, deletedAt: null, ...tenantFilter(req) } });
		if (!sale?.awpId) return res.status(400).json({ success: false, message: "ЭАВР ещё не отправлен" });
		const r = await queryAwpById(sessionId, [sale.awpId]);
		const updated = await prisma.sale.update({
			where: { uuid: sale.uuid },
			data: { awpStatus: r.status || sale.awpStatus, awpRegistrationNumber: r.registrationNumber || sale.awpRegistrationNumber },
		});
		res.json({ success: true, awpStatus: updated.awpStatus, awpRegistrationNumber: updated.awpRegistrationNumber });
	} catch (err) { respondErr(res, err); }
});

// ═══════════════ СНТ (из Реализации / Перемещения) ═══════════════

async function loadSntSource(req, source, uuid) {
	const cfg = SNT_SOURCES[source];
	if (!cfg) return null;
	const doc = await prisma[cfg.model].findFirst({ where: { uuid, deletedAt: null, ...tenantFilter(req) }, include: cfg.include });
	if (!doc) return null;
	return { doc, items: doc[cfg.itemsKey] || [], model: cfg.model };
}

// Построить XML СНТ (с проверкой ТН ВЭД)
router.post("/snt/:source/:uuid/build-xml", async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const loaded = await loadSntSource(req, req.params.source, req.params.uuid);
		if (!loaded) return res.status(404).json({ success: false, message: "Документ-источник не найден" });
		const { doc, items } = loaded;
		if (!doc.posted) return res.status(400).json({ success: false, message: "Сначала проведите документ" });

		const missing = validateSntProducts(items);
		if (missing.length) {
			return res.status(400).json({ success: false, message: `Не указан код ТН ВЭД у товаров: ${missing.join(", ")}` });
		}
		await injectAddresses(doc);
		const xml = buildSntV1Xml({ ...doc, items }, { sntType: req.body?.sntType, shippingDate: req.body?.shippingDate });
		res.json({ success: true, xml });
	} catch (err) { respondErr(res, err); }
});

// Загрузить подписанную СНТ + сохранить статус
router.post("/snt/:source/:uuid/upload", async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { sessionId, signedXml, x509Certificate } = req.body || {};
		if (!sessionId) return res.status(400).json({ success: false, message: "Нет сессии ЭСФ" });
		if (!signedXml) return res.status(400).json({ success: false, message: "Нет подписанного XML" });
		const loaded = await loadSntSource(req, req.params.source, req.params.uuid);
		if (!loaded) return res.status(404).json({ success: false, message: "Документ-источник не найден" });

		const r = await uploadSnt({ sessionId, sntBody: signedXml, x509Certificate });
		const updated = await prisma[loaded.model].update({
			where: { uuid: loaded.doc.uuid },
			data: {
				sntStatus: r.status || "CREATED", sntId: r.id || null,
				sntRegistrationNumber: r.registrationNumber || null,
				sntSentAt: new Date(), sntXml: signedXml, sntErrorText: null,
			},
		});
		res.json({ success: true, sntStatus: updated.sntStatus, sntId: updated.sntId, sntRegistrationNumber: updated.sntRegistrationNumber });
	} catch (err) { respondErr(res, err); }
});

// Обновить статус СНТ
router.post("/snt/:source/:uuid/status", async (req, res) => {
	if (!requireAuth(req, res)) return;
	try {
		const { sessionId } = req.body || {};
		if (!sessionId) return res.status(400).json({ success: false, message: "Нет сессии ЭСФ" });
		const cfg = SNT_SOURCES[req.params.source];
		if (!cfg) return res.status(400).json({ success: false, message: "Неподдерживаемый источник" });
		const doc = await prisma[cfg.model].findFirst({ where: { uuid: req.params.uuid, deletedAt: null, ...tenantFilter(req) } });
		if (!doc?.sntId) return res.status(400).json({ success: false, message: "СНТ ещё не отправлена" });
		const r = await querySntById(sessionId, [doc.sntId]);
		const updated = await prisma[cfg.model].update({
			where: { uuid: doc.uuid },
			data: { sntStatus: r.status || doc.sntStatus, sntRegistrationNumber: r.registrationNumber || doc.sntRegistrationNumber },
		});
		res.json({ success: true, sntStatus: updated.sntStatus, sntRegistrationNumber: updated.sntRegistrationNumber });
	} catch (err) { respondErr(res, err); }
});

export default router;
