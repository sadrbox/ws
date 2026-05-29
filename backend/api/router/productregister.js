// ─────────────────────────────────────────────────────────────────────────────
// Регистр накопления «Товары» — API (только чтение).
//   GET /product-register           — движения (приход/расход) за период
//   GET /product-register/balances  — остатки (Σприход − Σрасход) по товар+склад
// Записи формируются автоматически при проведении документов
// (см. services/productRegister.js). Ручного создания/изменения нет.
//
// Параметры (query, плоские): dateFrom, dateTo, organizationUuid,
// warehouseUuid, productUuid, documentType, movementType.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { computeShortages } from "../../services/productRegister.js";

const router = express.Router();
const MODEL = "productRegister";
const ROUTE = "product-register";

const MAX_ROWS = 10000;

function buildWhere(req) {
	const q = req.query;
	const where = { ...tenantFilter(req) };
	// Период по дате движения.
	const dr = {};
	if (q.dateFrom) dr.gte = new Date(String(q.dateFrom));
	if (q.dateTo) {
		// включительно до конца дня
		const to = new Date(String(q.dateTo));
		to.setHours(23, 59, 59, 999);
		dr.lte = to;
	}
	if (Object.keys(dr).length) where.date = dr;
	// Орг-фильтр: если задан явно — пересекаем с tenantFilter (берём заданный).
	if (q.organizationUuid) where.organizationUuid = String(q.organizationUuid);
	if (q.warehouseUuid) where.warehouseUuid = String(q.warehouseUuid);
	if (q.productUuid) where.productUuid = String(q.productUuid);
	if (q.documentType) where.documentType = String(q.documentType);
	if (q.movementType) where.movementType = String(q.movementType);
	return where;
}

// ── GET список движений ──────────────────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const where = buildWhere(req);
		const items = await prisma[MODEL].findMany({
			where,
			take: MAX_ROWS,
			orderBy: [{ date: "asc" }, { id: "asc" }],
			include: {
				product: { include: { brand: true } },
				warehouse: true,
				unitOfMeasure: true,
				organization: true,
			},
		});
		return res.status(200).json({ success: true, items, total: items.length });
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET остатки (Σприход − Σрасход) по товар+склад ───────────────────────────
router.get(`/${ROUTE}/balances`, async (req, res) => {
	try {
		const where = buildWhere(req);
		const rows = await prisma[MODEL].findMany({
			where,
			take: MAX_ROWS,
			select: {
				productUuid: true,
				warehouseUuid: true,
				movementType: true,
				quantity: true,
				amount: true,
				product: { select: { name: true, sku: true } },
				warehouse: { select: { name: true } },
				unitOfMeasure: { select: { name: true } },
			},
		});

		// Агрегируем по ключу товар+склад (знак — по movementType).
		const map = new Map();
		for (const r of rows) {
			const key = `${r.productUuid ?? ""}|${r.warehouseUuid ?? ""}`;
			let acc = map.get(key);
			if (!acc) {
				acc = {
					productUuid: r.productUuid ?? null,
					productName: r.product?.name ?? "",
					sku: r.product?.sku ?? "",
					warehouseUuid: r.warehouseUuid ?? null,
					warehouseName: r.warehouse?.name ?? "",
					unitName: r.unitOfMeasure?.name ?? "",
					quantity: 0,
					amount: 0,
				};
				map.set(key, acc);
			}
			const sign = r.movementType === "out" ? -1 : 1;
			acc.quantity += sign * (Number(r.quantity) || 0);
			acc.amount += sign * (Number(r.amount) || 0);
		}
		const items = Array.from(map.values())
			.map((a) => ({
				...a,
				quantity: Math.round(a.quantity * 10000) / 10000,
				amount: Math.round(a.amount * 100) / 100,
			}))
			.sort((a, b) => a.productName.localeCompare(b.productName, "ru"));

		return res.status(200).json({ success: true, items, total: items.length });
	} catch (error) {
		console.error(`GET /${ROUTE}/balances error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST проверка доступности остатка (pre-check перед проведением) ──────────
// Body: { documentType, documentUuid?, warehouseUuid?, fromWarehouseUuid?,
//         items: [{ productUuid, quantity }] }
// Считает дефициты по ПЕРЕДАННЫМ (ещё не сохранённым) строкам — для UX-проверки
// в форме до сохранения. Источник истины — бэкенд-гард при проведении.
router.post(`/${ROUTE}/check-availability`, async (req, res) => {
	try {
		const {
			documentType,
			documentUuid,
			warehouseUuid,
			fromWarehouseUuid,
			items,
		} = req.body ?? {};
		if (!documentType || !Array.isArray(items)) {
			return res.status(400).json({
				success: false,
				message: "Требуются documentType и items[]",
			});
		}
		const shortages = await computeShortages({
			documentType,
			documentUuid: documentUuid || undefined,
			doc: { warehouseUuid, fromWarehouseUuid },
			items,
		});
		return res
			.status(200)
			.json({ success: true, ok: shortages.length === 0, shortages });
	} catch (error) {
		console.error(`POST /${ROUTE}/check-availability error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
