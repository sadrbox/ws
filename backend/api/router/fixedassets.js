// Справочник «Основные средства» (ОС). Стандартный CRUD справочника
// (ModelList/useFormStore): ключ по uuid или числовому id.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";

const router = express.Router();
const MODEL = "fixedAsset";
const ROUTE = "fixedassets";

const whereById = (p) => {
	const n = Number(p);
	return !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: String(p) };
};

router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
		const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
		const where = { deletedAt: null };
		if (typeof req.query.organizationUuid === "string" && req.query.organizationUuid) where.organizationUuid = req.query.organizationUuid;
		if (search) where.OR = [
			{ name: { contains: search, mode: "insensitive" } },
			{ inventoryNumber: { contains: search, mode: "insensitive" } },
		];
		const items = await prisma[MODEL].findMany({ where, orderBy: [{ name: "asc" }], take: limit });
		return res.json({ success: true, items, total: items.length });
	} catch (err) {
		console.error(`GET /${ROUTE} error:`, err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const item = await prisma[MODEL].findUnique({ where: whereById(req.params.id) });
		if (!item || item.deletedAt) return res.status(404).json({ success: false, message: "Не найдено" });
		return res.json({ success: true, item });
	} catch (err) {
		console.error(`GET /${ROUTE}/:id error:`, err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
		if (!name) return res.status(400).json({ success: false, message: "Наименование обязательно" });
		const item = await prisma[MODEL].create({
			data: {
				name,
				inventoryNumber: req.body?.inventoryNumber?.trim() || null,
				note: req.body?.note?.trim() || null,
				organizationUuid: req.body?.organizationUuid || null,
			},
		});
		return res.status(201).json({ success: true, item });
	} catch (err) {
		console.error(`POST /${ROUTE} error:`, err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const data = {};
		if (req.body.name !== undefined) {
			const nm = req.body.name?.trim();
			if (!nm) return res.status(400).json({ success: false, message: "Наименование обязательно" });
			data.name = nm;
		}
		if (req.body.inventoryNumber !== undefined) data.inventoryNumber = req.body.inventoryNumber?.trim() || null;
		if (req.body.note !== undefined) data.note = req.body.note?.trim() || null;
		if (req.body.organizationUuid !== undefined) data.organizationUuid = req.body.organizationUuid || null;
		const item = await prisma[MODEL].update({ where: whereById(req.params.id), data });
		return res.json({ success: true, item });
	} catch (err) {
		if (err?.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.delete(`/${ROUTE}/:id`, async (req, res) => {
	try {
		await prisma[MODEL].update({ where: whereById(req.params.id), data: { deletedAt: new Date() } });
		return res.json({ success: true });
	} catch (err) {
		if (err?.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`DELETE /${ROUTE}/:id error:`, err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.post(`/${ROUTE}/batch-delete`, async (req, res) => {
	try {
		const uuids = Array.isArray(req.body?.uuids) ? req.body.uuids.filter((x) => typeof x === "string" && x) : [];
		if (uuids.length) await prisma[MODEL].updateMany({ where: { uuid: { in: uuids } }, data: { deletedAt: new Date() } });
		return res.json({ success: true, failed: [] });
	} catch (err) {
		console.error(`POST /${ROUTE}/batch-delete error:`, err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
