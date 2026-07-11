// Партии товара (T6.1 Stage 2). Справочник партий (чтение) + операции для форм
// документов: создать/найти партию при приёмке, получить доступные партии по FEFO
// при выбытии. Целостность остатков держится регистром (product_register.batchUuid).
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { findOrCreateBatch, availableBatchesFEFO } from "../../services/batches.js";

const router = express.Router();
const ROUTE = "productbatches";

const INCLUDE = { product: { select: { uuid: true, name: true, sku: true } } };

// Справочник партий (только чтение).
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
		const limitNumber = Math.min(Math.max(rawLimit !== undefined ? Number(rawLimit) : 500, 1), 999999);
		const filter = req.query.filter && typeof req.query.filter === "object" ? req.query.filter : {};

		const where = { deletedAt: null, ...tenantFilter(req) };
		if (search) where.batchNumber = { contains: search, mode: "insensitive" };
		for (const f of ["productUuid"]) {
			const v = filter?.[f]?.equals ?? filter?.[f];
			if (typeof v === "string" && v) where[f] = v;
		}
		const items = await prisma.productBatch.findMany({ where, take: limitNumber, orderBy: [{ expiryDate: "asc" }, { id: "desc" }], include: INCLUDE });
		const total = await prisma.productBatch.count({ where });
		return res.status(200).json({ success: true, items, total, hasMore: items.length === limitNumber, nextCursor: null });
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// Доступные партии товара на складе в порядке FEFO (для выбора при выбытии).
router.get(`/${ROUTE}/available`, async (req, res) => {
	try {
		const { productUuid, warehouseUuid, organizationUuid, dateTo } = req.query;
		if (!productUuid || !warehouseUuid) return res.status(400).json({ success: false, message: "productUuid и warehouseUuid обязательны" });
		const items = await availableBatchesFEFO({
			productUuid: String(productUuid), warehouseUuid: String(warehouseUuid),
			organizationUuid: organizationUuid ? String(organizationUuid) : null,
			dateTo: dateTo ? new Date(String(dateTo) + "T23:59:59.999Z") : null,
		});
		return res.status(200).json({ success: true, items });
	} catch (error) {
		console.error(`GET /${ROUTE}/available error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// Партия по uuid (для отображения выбранной партии в строке документа).
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const item = await prisma.productBatch.findUnique({ where: { uuid: req.params.id }, include: INCLUDE });
		if (!item) return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// Создать/найти партию (приёмка): по (организация, товар, номер), с уточнением срока.
router.post(`/${ROUTE}/find-or-create`, async (req, res) => {
	try {
		const { productUuid, batchNumber, expiryDate, manufactureDate, organizationUuid } = req.body;
		if (!productUuid || !batchNumber) return res.status(400).json({ success: false, message: "productUuid и batchNumber обязательны" });
		const batch = await findOrCreateBatch({
			productUuid, batchNumber, expiryDate: expiryDate || null,
			manufactureDate: manufactureDate || null, organizationUuid: organizationUuid || null,
		});
		return res.status(200).json({ success: true, item: batch });
	} catch (error) {
		console.error(`POST /${ROUTE}/find-or-create error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
