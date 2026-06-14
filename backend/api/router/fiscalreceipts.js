// Фискальные чеки (ОФД/Kaspi). Создание чека по документу продажи, поллинг
// статуса Kaspi-оплаты, журнал. Провайдер — см. services/fiscal/ (по умолчанию
// stub: фейковые данные для разработки). НЕ юридически значимо в stub-режиме.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { handleDelete } from "../../utils/checkReferences.js";
import { getFiscalProvider, qrToDataUrl, FiscalError, respondFiscalError } from "../../services/fiscal/index.js";

const router = express.Router();
const ROUTE = "fiscal-receipts";

// Документы-источники чека: documentType → загрузка шапки и позиций.
const SOURCE = {
	sale: { model: "sale", itemModel: "saleItem", parentField: "saleUuid" },
	sale_return: { model: "saleReturn", itemModel: "saleReturnItem", parentField: "saleReturnUuid" },
};

async function loadSourceDoc(documentType, documentUuid) {
	const cfg = SOURCE[documentType];
	if (!cfg || !documentUuid) return null;
	const doc = await prisma[cfg.model].findUnique({ where: { uuid: documentUuid } });
	if (!doc) return null;
	const rawItems = await prisma[cfg.itemModel].findMany({
		where: { [cfg.parentField]: documentUuid, deletedAt: null },
		include: { product: { select: { name: true } } },
	});
	const items = rawItems.map((it) => ({
		name: it.product?.name ?? "Товар",
		quantity: Number(it.quantity) || 0,
		price: Number(it.price) || 0,
	}));
	return { doc, items };
}

// Чек + QR-картинка (data-URL) для ответа.
async function withQr(receipt) {
	const qrImage = await qrToDataUrl(receipt.qrPayload);
	return { ...receipt, qrImage };
}

// ── POST /fiscal-receipts ────────────────────────────────────────────────────
// { documentType, documentUuid, paymentMethod } → создаёт чек. Для kaspi —
// сначала платёж (QR, payment_pending); для cash/card — сразу фискализация.
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		if (!req.user?.uuid) return res.status(401).json({ success: false, message: "Требуется авторизация" });
		const { documentType, documentUuid, paymentMethod } = req.body;
		if (!SOURCE[documentType]) return res.status(400).json({ success: false, message: "Неподдерживаемый тип документа" });
		const method = ["cash", "card", "kaspi"].includes(paymentMethod) ? paymentMethod : "cash";

		const loaded = await loadSourceDoc(documentType, documentUuid);
		if (!loaded) return res.status(404).json({ success: false, message: "Документ не найден" });
		const { doc, items } = loaded;

		// Идемпотентность: незавершённый/успешный чек по документу — возвращаем его.
		const existing = await prisma.fiscalReceipt.findFirst({
			where: { documentType, documentUuid, deletedAt: null, status: { in: ["created", "payment_pending", "paid", "fiscalized"] } },
			orderBy: { id: "desc" },
		});
		if (existing) return res.status(200).json({ success: true, item: await withQr(existing) });

		const provider = getFiscalProvider();
		const amount = Number(doc.amount) || items.reduce((s, it) => s + it.quantity * it.price, 0);

		const data = {
			documentType, documentUuid, documentId: doc.id ?? null,
			organizationUuid: doc.organizationUuid ?? null,
			provider: provider.name, paymentMethod: method, amount,
			authorUuid: req.user.uuid,
		};

		if (method === "kaspi") {
			const pay = await provider.createPayment({ amount, orderId: documentUuid, organizationUuid: doc.organizationUuid });
			data.status = "payment_pending";
			data.paymentId = pay.paymentId || null;
			data.qrPayload = pay.qrPayload || null;
		} else {
			const fz = await provider.fiscalize({ documentType, documentUuid, amount, items, organizationUuid: doc.organizationUuid, paymentMethod: method });
			data.status = "fiscalized";
			data.fiscalSign = fz.fiscalSign || null;
			data.fiscalNumber = fz.fiscalNumber || null;
			data.fiscalDate = fz.fiscalDate ?? new Date();
			data.qrPayload = fz.qrPayload || null;
			data.raw = fz.raw ?? undefined;
		}

		const item = await prisma.fiscalReceipt.create({ data });
		return res.status(201).json({ success: true, item: await withQr(item) });
	} catch (error) {
		if (respondFiscalError(error, res)) return;
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST /fiscal-receipts/:id/check-payment ──────────────────────────────────
// Поллинг статуса Kaspi-оплаты; при "paid" — фискализация чека.
router.post(`/${ROUTE}/:id/check-payment`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const receipt = await prisma.fiscalReceipt.findUnique({ where: w });
		if (!receipt) return res.status(404).json({ success: false, message: "Чек не найден" });
		if (receipt.status !== "payment_pending") return res.status(200).json({ success: true, item: await withQr(receipt) });

		const provider = getFiscalProvider(receipt.provider);
		const payStatus = await provider.getPaymentStatus(receipt.paymentId);

		if (payStatus === "failed") {
			const upd = await prisma.fiscalReceipt.update({ where: { id: receipt.id }, data: { status: "failed", errorMessage: "Оплата не прошла" } });
			return res.status(200).json({ success: true, item: await withQr(upd) });
		}
		if (payStatus !== "paid") {
			return res.status(200).json({ success: true, item: await withQr(receipt) }); // всё ещё ожидание
		}

		// Оплачено → фискализируем.
		const loaded = await loadSourceDoc(receipt.documentType, receipt.documentUuid);
		const items = loaded?.items ?? [];
		const fz = await provider.fiscalize({
			documentType: receipt.documentType, documentUuid: receipt.documentUuid,
			amount: Number(receipt.amount) || 0, items, organizationUuid: receipt.organizationUuid, paymentMethod: receipt.paymentMethod,
		});
		const upd = await prisma.fiscalReceipt.update({
			where: { id: receipt.id },
			data: {
				status: "fiscalized",
				fiscalSign: fz.fiscalSign || null, fiscalNumber: fz.fiscalNumber || null,
				fiscalDate: fz.fiscalDate ?? new Date(), qrPayload: fz.qrPayload || receipt.qrPayload, raw: fz.raw ?? undefined,
			},
		});
		return res.status(200).json({ success: true, item: await withQr(upd) });
	} catch (error) {
		if (respondFiscalError(error, res)) return;
		console.error(`POST /${ROUTE}/:id/check-payment error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST /fiscal-receipts/kaspi-webhook ──────────────────────────────────────
// Плейсхолдер подтверждения оплаты от Kaspi (для будущего боевого режима).
// TODO(kaspi-docs): проверка подписи вебхука + сопоставление платежа.
router.post(`/${ROUTE}/kaspi-webhook`, async (req, res) => {
	try {
		const paymentId = req.body?.paymentId ?? req.body?.PaymentId;
		if (!paymentId) return res.status(400).json({ success: false, message: "paymentId обязателен" });
		const receipt = await prisma.fiscalReceipt.findFirst({ where: { paymentId: String(paymentId), status: "payment_pending" } });
		if (receipt) await prisma.fiscalReceipt.update({ where: { id: receipt.id }, data: { status: "paid" } });
		return res.status(200).json({ success: true });
	} catch (error) {
		console.error(`POST /${ROUTE}/kaspi-webhook error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET list / by id ─────────────────────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const items = await prisma.fiscalReceipt.findMany({
			where: { ...tenantFilter(req), deletedAt: null },
			include: { organization: { select: { name: true } } },
			orderBy: { id: "desc" },
			take: 1000,
		});
		return res.status(200).json({ success: true, items, total: items.length });
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma.fiscalReceipt.findUnique({ where: w, include: { organization: { select: { name: true } } } });
		if (!item) return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item: await withQr(item) });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.delete(`/${ROUTE}/:id`, (req, res) => handleDelete({ req, res, prisma, modelName: "fiscalReceipt", softDelete: true }));

export default router;
