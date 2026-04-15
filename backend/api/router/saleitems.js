import express from "express";
import { prisma } from "../../prisma/prisma-client.js";

const router = express.Router();

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
		const { saleUuid, productUuid, quantity, price, lineNumber, unitOfMeasure, vatRate, discountPercent } = req.body;
		if (!saleUuid)
			return res
				.status(400)
				.json({ success: false, message: "saleUuid обязателен" });

		const qty = quantity != null ? parseFloat(quantity) : 0;
		const prc = price != null ? parseFloat(price) : 0;
		const discPct = discountPercent != null ? parseFloat(discountPercent) : 0;
		const vRate = vatRate != null ? parseFloat(vatRate) : 12;

		const baseAmount = Math.round(qty * prc * 100) / 100;
		const discAmt = Math.round(baseAmount * discPct / 100 * 100) / 100;
		const amountAfterDiscount = baseAmount - discAmt;
		const vat = Math.round(amountAfterDiscount * vRate / 112 * 100) / 100;
		const amt = amountAfterDiscount;

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
				unitOfMeasure: unitOfMeasure?.trim?.() ?? null,
				vatRate: vRate,
				vatAmount: vat,
				discountPercent: discPct,
				discountAmount: discAmt,
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
		if (req.body.unitOfMeasure !== undefined)
			data.unitOfMeasure = req.body.unitOfMeasure?.trim?.() ?? null;

		const qty =
			req.body.quantity !== undefined
				? parseFloat(req.body.quantity)
				: undefined;
		const prc =
			req.body.price !== undefined ? parseFloat(req.body.price) : undefined;
		const discPct =
			req.body.discountPercent !== undefined ? parseFloat(req.body.discountPercent) : undefined;
		const vRate =
			req.body.vatRate !== undefined ? parseFloat(req.body.vatRate) : undefined;

		if (qty !== undefined) data.quantity = qty;
		if (prc !== undefined) data.price = prc;
		if (discPct !== undefined) data.discountPercent = discPct;
		if (vRate !== undefined) data.vatRate = vRate;

		// Если обновились кол-во, цена, скидка или НДС — пересчитать суммы
		if (qty !== undefined || prc !== undefined || discPct !== undefined || vRate !== undefined) {
			const existing = await prisma[MODEL].findUnique({ where: w });
			if (!existing)
				return res.status(404).json({ success: false, message: "Не найдено" });
			const finalQty = qty !== undefined ? qty : Number(existing.quantity);
			const finalPrc = prc !== undefined ? prc : Number(existing.price);
			const finalDiscPct = discPct !== undefined ? discPct : Number(existing.discountPercent);
			const finalVatRate = vRate !== undefined ? vRate : Number(existing.vatRate);

			const baseAmount = Math.round(finalQty * finalPrc * 100) / 100;
			const discAmt = Math.round(baseAmount * finalDiscPct / 100 * 100) / 100;
			const amountAfterDiscount = baseAmount - discAmt;
			const vatAmt = Math.round(amountAfterDiscount * finalVatRate / 112 * 100) / 100;

			data.amount = amountAfterDiscount;
			data.discountAmount = discAmt;
			data.vatAmount = vatAmt;
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
			_sum: { amount: true, vatAmount: true, discountAmount: true },
		});
		const totalAmount = result._sum.amount ? Number(result._sum.amount) : 0;
		const totalVat = result._sum.vatAmount ? Number(result._sum.vatAmount) : 0;
		const totalDiscount = result._sum.discountAmount ? Number(result._sum.discountAmount) : 0;
		const amountWithoutVat = Math.round((totalAmount - totalVat) * 100) / 100;
		await prisma.sale.update({
			where: { uuid: saleUuid },
			data: {
				amount: totalAmount,
				vatAmount: totalVat,
				discountAmount: totalDiscount,
				amountWithoutVat: amountWithoutVat,
			},
		});
	} catch (err) {
		console.error("recalcSaleAmount error:", err);
	}
}

export default router;
