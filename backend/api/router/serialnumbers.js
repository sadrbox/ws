// Серийные номера (T6.1). Справочник серий (чтение) + операции приёмки/выбытия,
// вызываемые формами документов. Серии — не самостоятельный документ: создаются
// приёмкой, выбывают продажей/списанием. Ручное CRUD не предусмотрено —
// целостность держится через сервис serialNumbers.js.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { buildOrderBy } from "../../utils/sortOrder.js";
import {
	setReceiptSerials, issueSerials, SERIAL_STATUS,
} from "../../services/serialNumbers.js";

const router = express.Router();
const ROUTE = "serialnumbers";
const TEXT_FIELDS = ["serialNumber"];

const INCLUDE = { product: { select: { uuid: true, name: true, sku: true } } };

/** prisma-модель документа по его типу (для резолва номера/даты приёмки). */
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
 * Добавляет к сериям происхождение: receiptLabel = «Оприходование № 5 от 01.07.2026».
 * Документы резолвим ПАЧКОЙ (по одному запросу на тип), а не по серии — иначе на
 * 1000 серий было бы 1000 запросов.
 */
async function withReceiptOrigin(items) {
	const byType = new Map(); // docType → Set(uuid)
	for (const it of items) {
		if (!it.receiptDocType || !it.receiptDocUuid) continue;
		if (!RECEIPT_MODEL[it.receiptDocType]) continue;
		if (!byType.has(it.receiptDocType)) byType.set(it.receiptDocType, new Set());
		byType.get(it.receiptDocType).add(it.receiptDocUuid);
	}
	const docs = new Map(); // `${type}:${uuid}` → { number, date }
	for (const [type, uuids] of byType) {
		const model = RECEIPT_MODEL[type];
		try {
			const rows = await prisma[model].findMany({
				where: { uuid: { in: [...uuids] } },
				select: { uuid: true, number: true, date: true },
			});
			for (const r of rows) docs.set(`${type}:${r.uuid}`, r);
		} catch { /* тип без модели — просто не покажем номер */ }
	}
	return items.map((it) => {
		const base = RECEIPT_LABEL[it.receiptDocType] ?? it.receiptDocType ?? null;
		if (!base) return { ...it, receiptLabel: null };
		const d = docs.get(`${it.receiptDocType}:${it.receiptDocUuid}`);
		const parts = [base];
		if (d?.number) parts.push(`№ ${d.number}`);
		if (d?.date) parts.push(`от ${new Date(d.date).toLocaleDateString("ru-KZ")}`);
		return { ...it, receiptLabel: parts.join(" ") };
	});
}


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
		// Сортировка из UI (раньше orderBy был ЗАХАРДКОЖЕН, и ?sort= игнорировался —
		// клик по заголовку колонки ничего не менял). buildOrderBy валидирует поля по
		// схеме: скаляры (serialNumber/status/id) и пути «связь.поле» (product.name).
		const orderBy = buildOrderBy("serialNumber", req.query.sort, { fallback: { id: "desc" } });
		const items = await prisma.serialNumber.findMany({
			where, take: limitNumber, orderBy, include: INCLUDE,
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
		// ПРОИСХОЖДЕНИЕ серии: каким документом принята, его номер и дата. Без этого
		// пользователь выбирает серию вслепую — а серии физически различимы, и «не та
		// серия» = отгружен не тот экземпляр (гарантия, возврат, претензия).
		const enriched = await withReceiptOrigin(items);
		return res.status(200).json({ success: true, items: enriched });
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
