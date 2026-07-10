// Серийные номера (T6.1). Справочник серий (чтение) + операции приёмки/выбытия,
// вызываемые формами документов. Серии — не самостоятельный документ: создаются
// приёмкой, выбывают продажей/списанием. Ручное CRUD не предусмотрено —
// целостность держится через сервис serialNumbers.js.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import {
	setReceiptSerials, issueSerials, SERIAL_STATUS,
} from "../../services/serialNumbers.js";

const router = express.Router();
const ROUTE = "serialnumbers";
const TEXT_FIELDS = ["serialNumber"];

const INCLUDE = { product: { select: { uuid: true, name: true, sku: true } } };

// ── Справочник серий (только чтение) ─────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
		const limitNumber = Math.min(Math.max(rawLimit !== undefined ? Number(rawLimit) : 500, 1), 999999);
		const filter = req.query.filter && typeof req.query.filter === "object" ? req.query.filter : {};

		const where = { deletedAt: null, ...tenantFilter(req) };
		if (search) {
			where.OR = TEXT_FIELDS.map((f) => ({ [f]: { contains: search, mode: "insensitive" } }));
		}
		for (const f of ["status", "productUuid", "warehouseUuid", "receiptDocUuid", "issueDocUuid"]) {
			const v = filter?.[f]?.equals ?? filter?.[f];
			if (typeof v === "string" && v) where[f] = v;
		}
		const items = await prisma.serialNumber.findMany({
			where, take: limitNumber, orderBy: [{ id: "desc" }], include: INCLUDE,
		});
		const total = await prisma.serialNumber.count({ where });
		return res.status(200).json({ success: true, items, total, hasMore: items.length === limitNumber, nextCursor: null });
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// Серии, ПРИНЯТЫЕ конкретным документом по товару (для формы приёмки).
router.get(`/${ROUTE}/receipt`, async (req, res) => {
	try {
		const { docType, docUuid, productUuid } = req.query;
		if (!docUuid || !productUuid) return res.status(400).json({ success: false, message: "docUuid и productUuid обязательны" });
		const items = await prisma.serialNumber.findMany({
			where: { receiptDocType: docType || undefined, receiptDocUuid: String(docUuid), productUuid: String(productUuid), deletedAt: null },
			orderBy: [{ id: "asc" }],
		});
		return res.status(200).json({ success: true, items });
	} catch (error) {
		console.error(`GET /${ROUTE}/receipt error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// Доступные (in_stock) серии товара на складе — для выбора при выбытии.
router.get(`/${ROUTE}/available`, async (req, res) => {
	try {
		const { productUuid, warehouseUuid, issueDocUuid } = req.query;
		if (!productUuid) return res.status(400).json({ success: false, message: "productUuid обязателен" });
		const where = {
			productUuid: String(productUuid), deletedAt: null, ...tenantFilter(req),
			OR: [
				{ status: SERIAL_STATUS.IN_STOCK },
				// уже выбранные ЭТИМ документом (чтобы показать их в пикере как отмеченные)
				...(issueDocUuid ? [{ issueDocUuid: String(issueDocUuid) }] : []),
			],
		};
		if (warehouseUuid) where.warehouseUuid = String(warehouseUuid);
		const items = await prisma.serialNumber.findMany({ where, orderBy: [{ serialNumber: "asc" }], take: 1000 });
		return res.status(200).json({ success: true, items });
	} catch (error) {
		console.error(`GET /${ROUTE}/available error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// Установить серии, принятые документом приёмки по товару (идемпотентно).
router.post(`/${ROUTE}/receipt`, async (req, res) => {
	try {
		const { docType, docUuid, productUuid, warehouseUuid, organizationUuid, serials } = req.body;
		if (!docType || !docUuid || !productUuid) return res.status(400).json({ success: false, message: "docType, docUuid, productUuid обязательны" });
		const result = await setReceiptSerials({ docType, docUuid, productUuid, warehouseUuid: warehouseUuid || null, organizationUuid: organizationUuid || null, serials });
		return res.status(200).json({ success: true, ...result });
	} catch (error) {
		console.error(`POST /${ROUTE}/receipt error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// Пометить серии выбывшими по документу выбытия (переустановка выбора).
router.post(`/${ROUTE}/issue`, async (req, res) => {
	try {
		const { docType, docUuid, serialUuids } = req.body;
		if (!docType || !docUuid) return res.status(400).json({ success: false, message: "docType, docUuid обязательны" });
		// Полная переустановка: сначала возвращаем прежние в in_stock, затем помечаем выбранные.
		await prisma.serialNumber.updateMany({
			where: { issueDocType: docType, issueDocUuid: docUuid, deletedAt: null },
			data: { status: SERIAL_STATUS.IN_STOCK, issueDocType: null, issueDocUuid: null },
		});
		const status = docType === "write_off" ? SERIAL_STATUS.WRITTEN_OFF : SERIAL_STATUS.ISSUED;
		const count = await issueSerials({ docType, docUuid, serialUuids, status });
		return res.status(200).json({ success: true, count });
	} catch (error) {
		console.error(`POST /${ROUTE}/issue error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
