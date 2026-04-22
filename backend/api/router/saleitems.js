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

		// Поля, которые требуют nested-сортировки Prisma
		const NESTED_SORT_FIELDS = {
			"product.shortName": { product: { shortName: "asc" } },
		};

		const orderBy = [];
		const sortParam =
			typeof req.query.sort === "string" ? req.query.sort : null;
		if (sortParam) {
			try {
				const s = JSON.parse(sortParam);
				if (s && typeof s === "object")
					for (const [f, d] of Object.entries(s)) {
						if (d !== "asc" && d !== "desc") continue;
						if (NESTED_SORT_FIELDS[f]) {
							// Транслируем "product.shortName" → { product: { shortName: d } }
							const nested = JSON.parse(JSON.stringify(NESTED_SORT_FIELDS[f]));
							// Подставляем направление сортировки в последний уровень
							const setDir = (obj) => {
								for (const k of Object.keys(obj)) {
									if (typeof obj[k] === "object") setDir(obj[k]);
									else obj[k] = d;
								}
							};
							setDir(nested);
							orderBy.push(nested);
						} else {
							orderBy.push({ [f]: d });
						}
					}
			} catch {}
		}
		if (orderBy.length === 0) orderBy.push({ lineNumber: "asc" });
		else if (!orderBy.some((o) => "id" in o)) orderBy.push({ id: "asc" });

		const items = await prisma[MODEL].findMany({
			where: { saleUuid },
			orderBy,
			include: { product: { include: { brand: true } }, unitOfMeasure: true, vatRateRef: true },
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
			include: { product: { include: { brand: true } }, unitOfMeasure: true, vatRateRef: true },
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
		const { saleUuid, productUuid, quantity, price, lineNumber, unitOfMeasureUuid, vatRateUuid, vatRate, discountPercent } = req.body;
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
		const vat = vRate > 0
			? Math.round(amountAfterDiscount * vRate / (100 + vRate) * 100) / 100
			: 0;
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
				unitOfMeasureUuid: unitOfMeasureUuid || null,
				vatRateUuid: vatRateUuid || null,
				vatRate: vRate,
				vatAmount: vat,
				discountPercent: discPct,
				discountAmount: discAmt,
				lineNumber: ln,
			},
			include: { product: { include: { brand: true } }, unitOfMeasure: true, vatRateRef: true },
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
		// lineNumber управляется сервером автоматически — ручное обновление игнорируется
		if (req.body.unitOfMeasureUuid !== undefined)
			data.unitOfMeasureUuid = req.body.unitOfMeasureUuid || null;
		if (req.body.vatRateUuid !== undefined)
			data.vatRateUuid = req.body.vatRateUuid || null;

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
			const vatAmt = finalVatRate > 0
				? Math.round(amountAfterDiscount * finalVatRate / (100 + finalVatRate) * 100) / 100
				: 0;

			data.amount = amountAfterDiscount;
			data.discountAmount = discAmt;
			data.vatAmount = vatAmt;
		}

		const item = await prisma[MODEL].update({
			where: w,
			data,
			include: { product: { include: { brand: true } }, unitOfMeasure: true, vatRateRef: true },
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
		// Пересчитываем lineNumber оставшихся строк (восстанавливаем сплошную нумерацию)
		await reorderLineNumbers(item.saleUuid);

		return res.status(200).json({ success: true, message: "Удалено" });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`DELETE /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Пересчёт порядка строк (lineNumber) ────────────────────────────────
// Вызывается после удаления строки, чтобы восстановить сплошную нумерацию 1..N.
// Строки сортируются по текущему lineNumber (asc), затем по id (asc) как tiebreaker.
async function reorderLineNumbers(saleUuid) {
	try {
		const rows = await prisma[MODEL].findMany({
			where: { saleUuid },
			orderBy: [{ lineNumber: "asc" }, { id: "asc" }],
			select: { id: true },
		});
		// Обновляем каждую строку последовательно (1-based)
		await Promise.all(
			rows.map((row, idx) =>
				prisma[MODEL].update({
					where: { id: row.id },
					data: { lineNumber: idx + 1 },
				}),
			),
		);
	} catch (err) {
		console.error("reorderLineNumbers error:", err);
	}
}

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
