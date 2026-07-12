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

// ─── Происхождение партии: каким документом она пришла на склад ───────────────
// Без первоисточника пользователь выбирает партию вслепую: партии физически
// различимы (свой срок годности, своя поставка), и «не та партия» = отгружен не тот
// товар. Документ восстанавливаем из регистра: строки прихода с этим batchUuid.
const RECEIPT_MODEL = {
	purchase: "purchase",
	goods_receipt: "goodsReceipt",
	import_declaration: "importDeclaration",
	opening_balance: null, // ввод остатков — документа нет
};
const RECEIPT_LABEL = {
	purchase: "Поступление",
	goods_receipt: "Оприходование",
	import_declaration: "ГТД",
	opening_balance: "Ввод остатков",
};

/**
 * Добавляет к партиям `receipt` = { docType, docUuid, label } — документ-первоисточник.
 * Документы резолвим ПАЧКОЙ (по одному запросу на тип): иначе на каждую партию был бы
 * свой запрос.
 */
async function withBatchOrigin(items, { productUuid, warehouseUuid, organizationUuid }) {
	if (!items.length) return items;
	// Приходные движения этих партий — берём САМОЕ РАННЕЕ по каждой партии:
	// именно им партия попала на склад.
	const moves = await prisma.productRegister.findMany({
		where: {
			productUuid, warehouseUuid, movementType: "in",
			batchUuid: { in: items.map((b) => b.uuid) },
			...(organizationUuid ? { organizationUuid } : {}),
		},
		select: { batchUuid: true, documentType: true, documentUuid: true, date: true },
		orderBy: [{ date: "asc" }, { id: "asc" }],
	});
	const firstIn = new Map(); // batchUuid → движение
	for (const m of moves) if (!firstIn.has(m.batchUuid)) firstIn.set(m.batchUuid, m);

	// Резолвим номера/даты документов пачкой по типам.
	const byType = new Map();
	for (const m of firstIn.values()) {
		if (!m.documentType || !m.documentUuid || !RECEIPT_MODEL[m.documentType]) continue;
		if (!byType.has(m.documentType)) byType.set(m.documentType, new Set());
		byType.get(m.documentType).add(m.documentUuid);
	}
	const docs = new Map();
	for (const [type, uuids] of byType) {
		try {
			const rows = await prisma[RECEIPT_MODEL[type]].findMany({
				where: { uuid: { in: [...uuids] } },
				select: { uuid: true, number: true, date: true },
			});
			for (const r of rows) docs.set(`${type}:${r.uuid}`, r);
		} catch { /* нет модели — покажем хотя бы тип */ }
	}

	return items.map((b) => {
		const m = firstIn.get(b.uuid);
		if (!m?.documentType) return { ...b, receipt: null };
		const d = docs.get(`${m.documentType}:${m.documentUuid}`);
		return {
			...b,
			receipt: {
				docType: m.documentType,
				docUuid: m.documentUuid ?? null,
				// Метку собираем на бэке: номер/тип он знает, а фронт форматирует дату
				// проектной функцией — поэтому дату отдаём отдельно, в ISO.
				label: RECEIPT_LABEL[m.documentType] ?? m.documentType,
				number: d?.number ?? null,
				date: d?.date ?? m.date ?? null,
			},
		};
	});
}


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
		const scope = {
			productUuid: String(productUuid), warehouseUuid: String(warehouseUuid),
			organizationUuid: organizationUuid ? String(organizationUuid) : null,
		};
		const items = await availableBatchesFEFO({
			...scope,
			dateTo: dateTo ? new Date(String(dateTo) + "T23:59:59.999Z") : null,
		});
		return res.status(200).json({ success: true, items: await withBatchOrigin(items, scope) });
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
