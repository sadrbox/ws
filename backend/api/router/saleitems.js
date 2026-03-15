import express from "express";
import cors from "cors";
import { prisma } from "../../prisma/prisma-client.js";

const router = express.Router();
router.use(cors());

const MODEL = "saleItem";
const ROUTE = "saleitems";

// ── GET list by saleUuid ────────────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const saleUuid =
			typeof req.query.saleUuid === "string" ? req.query.saleUuid.trim() : "";
		if (!saleUuid)
			return res
				.status(400)
				.json({ success: false, message: "saleUuid обязателен" });

		const items = await prisma[MODEL].findMany({
			where: { saleUuid },
			orderBy: { lineNumber: "asc" },
			include: { product: { include: { brand: true } } },
		});
		return res.status(200).json({ success: true, items, total: items.length });
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET by id ───────────────────────────────────────────────────────────
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({
			where: w,
			include: { product: { include: { brand: true } } },
		});
		if (!item)
			return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST ────────────────────────────────────────────────────────────────
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const { saleUuid, productUuid, quantity, price, lineNumber } = req.body;
		if (!saleUuid)
			return res
				.status(400)
				.json({ success: false, message: "saleUuid обязателен" });

		const qty = quantity != null ? parseFloat(quantity) : 0;
		const prc = price != null ? parseFloat(price) : 0;
		const amt = Math.round(qty * prc * 100) / 100;

		// Определяем номер строки если не указан
		let ln = lineNumber != null ? Number(lineNumber) : null;
		if (ln == null) {
			const last = await prisma[MODEL].findFirst({
				where: { saleUuid },
				orderBy: { lineNumber: "desc" },
				select: { lineNumber: true },
			});
			ln = (last?.lineNumber ?? 0) + 1;
		}

		const item = await prisma[MODEL].create({
			data: {
				saleUuid,
				productUuid: productUuid || null,
				quantity: qty,
				price: prc,
				amount: amt,
				lineNumber: ln,
			},
			include: { product: { include: { brand: true } } },
		});

		// Пересчитываем сумму документа
		await recalcSaleAmount(saleUuid);

		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── PUT ─────────────────────────────────────────────────────────────────
router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

		const data = {};
		if (req.body.productUuid !== undefined)
			data.productUuid = req.body.productUuid || null;
		if (req.body.lineNumber !== undefined)
			data.lineNumber = Number(req.body.lineNumber) || 0;

		const qty =
			req.body.quantity !== undefined
				? parseFloat(req.body.quantity)
				: undefined;
		const prc =
			req.body.price !== undefined ? parseFloat(req.body.price) : undefined;

		if (qty !== undefined) data.quantity = qty;
		if (prc !== undefined) data.price = prc;

		// Если обновились кол-во или цена — пересчитать сумму
		if (qty !== undefined || prc !== undefined) {
			const existing = await prisma[MODEL].findUnique({ where: w });
			if (!existing)
				return res.status(404).json({ success: false, message: "Не найдено" });
			const finalQty = qty !== undefined ? qty : Number(existing.quantity);
			const finalPrc = prc !== undefined ? prc : Number(existing.price);
			data.amount = Math.round(finalQty * finalPrc * 100) / 100;
		}

		const item = await prisma[MODEL].update({
			where: w,
			data,
			include: { product: { include: { brand: true } } },
		});

		// Пересчитываем сумму документа
		await recalcSaleAmount(item.saleUuid);

		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE ──────────────────────────────────────────────────────────────
router.delete(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

		const item = await prisma[MODEL].findUnique({ where: w });
		if (!item)
			return res.status(404).json({ success: false, message: "Не найдено" });

		await prisma[MODEL].delete({ where: w });

		// Пересчитываем сумму документа
		await recalcSaleAmount(item.saleUuid);

		return res.status(200).json({ success: true, message: "Удалено" });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`DELETE /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Пересчёт суммы документа Sale ──────────────────────────────────────
async function recalcSaleAmount(saleUuid) {
	try {
		const result = await prisma[MODEL].aggregate({
			where: { saleUuid },
			_sum: { amount: true },
		});
		const total = result._sum.amount ? Number(result._sum.amount) : 0;
		await prisma.sale.update({
			where: { uuid: saleUuid },
			data: { amount: total },
		});
	} catch (err) {
		console.error("recalcSaleAmount error:", err);
	}
}

export default router;
