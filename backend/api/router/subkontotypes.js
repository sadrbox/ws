// Виды субконто (SubkontoType) — глобальный справочник типов аналитики.
// Новые виды добавляются записями; структура таблиц не меняется.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";

const router = express.Router();
const MODEL = "subkontoType";
const ROUTE = "subkonto-types";
const TEXT_FIELDS = ["code", "name"];

router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const limitNumber = Math.min(Math.max(rawLimit !== undefined ? Number(rawLimit) : 500, 1), 999999);
		const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
		const words = search ? search.split(/\s+/).filter(Boolean) : [];
		const searchWhere = words.length
			? { AND: words.map((w) => ({ OR: TEXT_FIELDS.map((f) => ({ [f]: { contains: w, mode: "insensitive" } })) })) }
			: {};
		const orderBy = [];
		if (typeof req.query.sort === "string") {
			try {
				const s = JSON.parse(req.query.sort);
				if (s) for (const [f, d] of Object.entries(s)) if (d === "asc" || d === "desc") orderBy.push({ [f]: d });
			} catch {}
		}
		if (!orderBy.length) orderBy.push({ sortOrder: "asc" }, { name: "asc" });
		const baseWhere = { deletedAt: null, ...searchWhere };
		const items = await prisma[MODEL].findMany({ where: baseWhere, orderBy, take: limitNumber });
		const total = await prisma[MODEL].count({ where: baseWhere });
		return res.status(200).json({ success: true, items, nextCursor: null, hasMore: false, total });
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
		const item = await prisma[MODEL].findUnique({ where: w });
		if (!item) return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

const STR_FIELDS = ["code", "name", "referenceEndpoint", "referenceModel"];

router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const data = {};
		for (const f of STR_FIELDS) if (req.body[f] !== undefined) data[f] = req.body[f]?.trim?.() ?? req.body[f] ?? null;
		if (req.body.isActive !== undefined) data.isActive = !!req.body.isActive;
		if (req.body.sortOrder !== undefined) data.sortOrder = Number(req.body.sortOrder) || 0;
		if (!data.code || !data.name)
			return res.status(400).json({ success: false, message: "Код и наименование обязательны" });
		const item = await prisma[MODEL].create({ data });
		return res.status(201).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2002")
			return res.status(409).json({ success: false, message: "Вид субконто с таким кодом уже существует" });
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
		for (const f of STR_FIELDS) if (req.body[f] !== undefined) data[f] = req.body[f]?.trim?.() ?? req.body[f] ?? null;
		if (req.body.isActive !== undefined) data.isActive = !!req.body.isActive;
		if (req.body.sortOrder !== undefined) data.sortOrder = Number(req.body.sortOrder) || 0;
		const item = await prisma[MODEL].update({ where: w, data });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2002")
			return res.status(409).json({ success: false, message: "Вид субконто с таким кодом уже существует" });
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.delete(`/${ROUTE}/:id`, (req, res) => handleDelete({ req, res, prisma, modelName: MODEL }));
router.post(`/${ROUTE}/batch-delete`, (req, res) => handleBatchDelete({ req, res, prisma, modelName: MODEL }));

export default router;
