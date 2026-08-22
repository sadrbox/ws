// Входящие ЭСФ (Трек B): локальное хранилище + разнесение в «Поступление».
//   GET  /esf-inbounds            — список (по активной организации)
//   GET  /esf-inbounds/:id        — шапка + строки
//   POST /esf-inbounds            — создать вручную (шапка+строки); живой pull строк
//                                    из ИС ЭСФ — под T7.1 (нужна сессия+ЭЦП)
//   POST /esf-inbounds/:id/to-purchase — разнести строки (ТМЗ/ОС) → создать Поступление
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { buildPurchaseFromInbound } from "../../services/esf/inboundToPurchase.js";

const router = express.Router();
const ROUTE = "esf-inbounds";

const whereById = (p) => {
	const n = Number(p);
	return !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
};

const num = (v, d = 0) => (v != null && v !== "" ? Number(v) : d);

// ── GET список ───────────────────────────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const items = await prisma.esfInbound.findMany({
			where: { deletedAt: null, ...tenantFilter(req) },
			orderBy: { id: "desc" },
			take: 500,
			include: { lines: false },
		});
		const total = await prisma.esfInbound.count({ where: { deletedAt: null, ...tenantFilter(req) } });
		return res.status(200).json({ success: true, items, total });
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET деталь (со строками) ─────────────────────────────────────────────────
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const item = await prisma.esfInbound.findUnique({
			where: whereById(req.params.id),
			include: { lines: { orderBy: { lineNumber: "asc" } } },
		});
		if (!item) return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST создать (ручной ввод/сидирование; живой pull строк — T7.1) ───────────
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const b = req.body || {};
		const lines = Array.isArray(b.lines) ? b.lines : [];
		const item = await prisma.esfInbound.create({
			data: {
				esfId: b.esfId || null,
				registrationNumber: b.registrationNumber || null,
				invoiceDate: b.invoiceDate ? new Date(b.invoiceDate) : null,
				supplierBin: b.supplierBin || null,
				supplierName: b.supplierName || null,
				totalAmount: num(b.totalAmount),
				organizationUuid: b.organizationUuid || null,
				lines: {
					create: lines.map((l, i) => ({
						lineNumber: l.lineNumber != null ? Number(l.lineNumber) : i + 1,
						name: l.name || `Строка ${i + 1}`,
						tnvedCode: l.tnvedCode || null,
						catalogTruId: l.catalogTruId || null,
						unitCode: l.unitCode || null,
						quantity: num(l.quantity),
						price: num(l.price),
						amount: num(l.amount),
						amountWithoutVat: num(l.amountWithoutVat),
						vatRate: num(l.vatRate, 12),
						vatAmount: num(l.vatAmount),
						assetKind: l.assetKind || "goods",
					})),
				},
			},
			include: { lines: true },
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST разнести → Поступление ──────────────────────────────────────────────
router.post(`/${ROUTE}/:id/to-purchase`, async (req, res) => {
	try {
		if (!req.user?.uuid) return res.status(401).json({ success: false, message: "Требуется авторизация" });
		const inbound = await prisma.esfInbound.findUnique({ where: whereById(req.params.id), select: { uuid: true } });
		if (!inbound) return res.status(404).json({ success: false, message: "Не найдено" });
		const overrides = req.body?.overrides && typeof req.body.overrides === "object" ? req.body.overrides : {};
		const result = await prisma.$transaction((tx) =>
			buildPurchaseFromInbound(tx, inbound.uuid, { authorUuid: req.user.uuid, overrides }),
		);
		return res.status(200).json({ success: true, ...result });
	} catch (error) {
		console.error(`POST /${ROUTE}/:id/to-purchase error:`, error);
		return res.status(500).json({ success: false, message: error.message || "Ошибка сервера" });
	}
});

export default router;
