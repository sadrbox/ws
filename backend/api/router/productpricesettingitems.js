// Строки документа «Установка цен номенклатуры» (товар + 3 цены).
// Sub-таблица: GET (по priceSettingUuid) / POST / PUT / DELETE / batch.
// После изменения строк пересчитываем текущие цены затронутых товаров.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { reconcilePricesForDoc, reconcileProductPrices } from "../../services/productPricing.js";

const router = express.Router();
const MODEL = "productPriceSettingItem";
const ROUTE = "product-price-setting-items";

const num = (v) => (v != null && v !== "" ? parseFloat(v) : null);

// ── GET list (по priceSettingUuid) ───────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const { priceSettingUuid } = req.query;
		if (!priceSettingUuid)
			return res.status(400).json({ success: false, message: "Параметр priceSettingUuid обязателен" });
		const items = await prisma[MODEL].findMany({
			where: { priceSettingUuid: String(priceSettingUuid) },
			include: { product: { select: { uuid: true, name: true } } },
			orderBy: [{ id: "asc" }],
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
		const item = await prisma[MODEL].findUnique({ where: w, include: { product: { select: { uuid: true, name: true } } } });
		if (!item) return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const { priceSettingUuid, productUuid, salePrice, purchasePrice, wholesalePrice } = req.body;
		if (!priceSettingUuid)
			return res.status(400).json({ success: false, message: "priceSettingUuid обязателен" });
		const item = await prisma[MODEL].create({
			data: { priceSettingUuid, productUuid: productUuid || null, salePrice: num(salePrice), purchasePrice: num(purchasePrice), wholesalePrice: num(wholesalePrice) },
		});
		await reconcilePricesForDoc(priceSettingUuid);
		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const data = {};
		if (req.body.productUuid !== undefined) data.productUuid = req.body.productUuid || null;
		if (req.body.salePrice !== undefined) data.salePrice = num(req.body.salePrice);
		if (req.body.purchasePrice !== undefined) data.purchasePrice = num(req.body.purchasePrice);
		if (req.body.wholesalePrice !== undefined) data.wholesalePrice = num(req.body.wholesalePrice);
		const item = await prisma[MODEL].update({ where: w, data });
		await reconcilePricesForDoc(item.priceSettingUuid);
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.delete(`/${ROUTE}/:id`, (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL, onDeleted: (doc) => reconcileProductPrices([doc.productUuid]) }),
);

// ── POST /batch ──────────────────────────────────────────────────────────────
router.post(`/${ROUTE}/batch`, async (req, res) => {
	try {
		const { operations } = req.body;
		if (!Array.isArray(operations) || operations.length === 0)
			return res.status(400).json({ success: false, message: "operations обязателен" });
		let parentUuid = null;
		const affected = new Set();
		await prisma.$transaction(async (tx) => {
			for (const { action, uuid, data } of operations) {
				if (action === "create" && data?.priceSettingUuid) {
					parentUuid = data.priceSettingUuid;
					if (data.productUuid) affected.add(data.productUuid);
					await tx[MODEL].create({
						data: { priceSettingUuid: data.priceSettingUuid, productUuid: data.productUuid || null, salePrice: num(data.salePrice), purchasePrice: num(data.purchasePrice), wholesalePrice: num(data.wholesalePrice) },
					});
				} else if (action === "update" && uuid && data) {
					const upd = {};
					if (data.productUuid !== undefined) { upd.productUuid = data.productUuid || null; if (data.productUuid) affected.add(data.productUuid); }
					if (data.salePrice !== undefined) upd.salePrice = num(data.salePrice);
					if (data.purchasePrice !== undefined) upd.purchasePrice = num(data.purchasePrice);
					if (data.wholesalePrice !== undefined) upd.wholesalePrice = num(data.wholesalePrice);
					if (Object.keys(upd).length) {
						const row = await tx[MODEL].update({ where: { uuid }, data: upd });
						if (row.productUuid) affected.add(row.productUuid);
						if (!parentUuid) parentUuid = row.priceSettingUuid;
					}
				} else if (action === "delete" && uuid) {
					try {
						const row = await tx[MODEL].delete({ where: { uuid } });
						if (row.productUuid) affected.add(row.productUuid);
						if (!parentUuid) parentUuid = row.priceSettingUuid;
					} catch {}
				}
			}
		});
		// Пересчёт цен затронутых товаров (включая весь документ — для корректного
		// учёта проведения).
		if (parentUuid) await reconcilePricesForDoc(parentUuid);
		else await reconcileProductPrices([...affected]);
		return res.status(200).json({ success: true });
	} catch (error) {
		console.error(`POST /${ROUTE}/batch error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.post(`/${ROUTE}/batch-delete`, (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: MODEL }),
);

export default router;
