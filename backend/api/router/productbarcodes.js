// Штрих-коды номенклатуры (один товар — много штрих-кодов).
// Sub-таблица товара: GET (по productUuid) / POST / PUT / DELETE / batch.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { findBarcodeOwner } from "../../utils/barcodeUniqueness.js";

const router = express.Router();

const MODEL = "productBarcode";
const ROUTE = "productbarcodes";

// ── GET list (по productUuid) ───────────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const { productUuid } = req.query;
		if (!productUuid)
			return res.status(400).json({ success: false, message: "Параметр productUuid обязателен" });

		const orderBy = [];
		const sortParam = typeof req.query.sort === "string" ? req.query.sort : null;
		if (sortParam) {
			try {
				const s = JSON.parse(sortParam);
				if (s && typeof s === "object")
					for (const [f, d] of Object.entries(s)) {
						if (d === "asc" || d === "desc") orderBy.push({ [f]: d });
					}
			} catch {}
		}
		if (orderBy.length === 0) orderBy.push({ id: "asc" });

		const items = await prisma[MODEL].findMany({
			where: { productUuid: String(productUuid) },
			orderBy,
		});
		return res.status(200).json({ success: true, items, total: items.length });
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET by id ────────────────────────────────────────────────────────────────
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({ where: w });
		if (!item) return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST ─────────────────────────────────────────────────────────────────────
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const { productUuid, barcode, comment } = req.body;
		if (!productUuid)
			return res.status(400).json({ success: false, message: "productUuid обязателен" });
		const bc = (barcode ?? "").trim();
		if (!bc)
			return res.status(400).json({ success: false, message: "Штрих-код обязателен и не может быть пустым" });
		const owner = await findBarcodeOwner(bc, productUuid);
		if (owner)
			return res.status(409).json({ success: false, message: `Штрих-код «${bc}» уже используется другим товаром` });
		const item = await prisma[MODEL].create({
			data: {
				productUuid,
				barcode: bc,
				comment: comment?.trim() || null,
			},
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── PUT ──────────────────────────────────────────────────────────────────────
router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const data = {};
		if (req.body.barcode !== undefined) {
			const bc = (req.body.barcode ?? "").trim();
			if (!bc)
				return res.status(400).json({ success: false, message: "Штрих-код не может быть пустым" });
			data.barcode = bc;
		}
		if (req.body.comment !== undefined) data.comment = req.body.comment?.trim() || null;
		if (data.barcode) {
			const existing = await prisma[MODEL].findUnique({ where: w, select: { productUuid: true } });
			const owner = await findBarcodeOwner(data.barcode, existing?.productUuid ?? null);
			if (owner)
				return res.status(409).json({ success: false, message: `Штрих-код «${data.barcode}» уже используется другим товаром` });
		}
		const item = await prisma[MODEL].update({ where: w, data });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE ─────────────────────────────────────────────────────────────────────
router.delete(`/${ROUTE}/:id`, (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL }),
);

// ── POST /batch ────────────────────────────────────────────────────────────────
router.post(`/${ROUTE}/batch`, async (req, res) => {
	try {
		const { operations } = req.body;
		if (!Array.isArray(operations) || operations.length === 0)
			return res.status(400).json({ success: false, message: "operations обязателен" });
		await prisma.$transaction(async (tx) => {
			for (const { action, uuid, data } of operations) {
				if (action === "create" && data?.productUuid) {
					const bc = (data.barcode ?? "").trim();
					if (!bc) {
						const e = new Error("Штрих-код обязателен и не может быть пустым");
						e.code = "BARCODE_INVALID";
						throw e;
					}
					const owner = await findBarcodeOwner(bc, data.productUuid, tx);
					if (owner) {
						const e = new Error(`Штрих-код «${bc}» уже используется другим товаром`);
						e.code = "BARCODE_DUPLICATE";
						throw e;
					}
					await tx[MODEL].create({
						data: {
							productUuid: data.productUuid,
							barcode: bc,
							comment: data.comment?.trim() || null,
						},
					});
				} else if (action === "update" && uuid && data) {
					const updateData = {};
					if (data.barcode !== undefined) {
						const bc = (data.barcode ?? "").trim();
						if (!bc) {
							const e = new Error("Штрих-код не может быть пустым");
							e.code = "BARCODE_INVALID";
							throw e;
						}
						updateData.barcode = bc;
					}
					if (data.comment !== undefined) updateData.comment = data.comment?.trim() || null;
					if (updateData.barcode) {
						const cur = await tx[MODEL].findUnique({ where: { uuid }, select: { productUuid: true } });
						const owner = await findBarcodeOwner(updateData.barcode, cur?.productUuid ?? null, tx);
						if (owner) {
							const e = new Error(`Штрих-код «${updateData.barcode}» уже используется другим товаром`);
							e.code = "BARCODE_DUPLICATE";
							throw e;
						}
					}
					if (Object.keys(updateData).length > 0)
						await tx[MODEL].update({ where: { uuid }, data: updateData });
				} else if (action === "delete" && uuid) {
					try { await tx[MODEL].delete({ where: { uuid } }); } catch {}
				}
			}
		});
		return res.status(200).json({ success: true });
	} catch (error) {
		if (error?.code === "BARCODE_INVALID")
			return res.status(400).json({ success: false, message: error.message });
		if (error?.code === "BARCODE_DUPLICATE")
			return res.status(409).json({ success: false, message: error.message });
		console.error(`POST /${ROUTE}/batch error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.post(`/${ROUTE}/batch-delete`, (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: MODEL }),
);

export default router;
