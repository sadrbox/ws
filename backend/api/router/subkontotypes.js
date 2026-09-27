// Виды субконто (SubkontoType) — глобальный справочник типов аналитики.
// Новые виды добавляются записями; структура таблиц не меняется.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { buildOrderBy } from "../../utils/sortOrder.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { invalidateRefCache } from "../../services/refCache.js";
import { clampLimit, sendError } from "../../utils/listQuery.js";

const router = express.Router();
const MODEL = "subkontoType";
const ROUTE = "subkonto-types";

// E3: запись в справочник субконто сбрасывает L2-кэш resolveSubkontoType.
// Только для СВОИХ путей (роутер смонтирован на /api/v1, и без проверки пути сброс — теперь ещё и
// рассылка по всем воркерам — шёл на каждый POST соседних роутеров) и дважды: до записи и после
// ответа. Сброс только «до» оставлял окно: запрос, пришедший между сбросом и фиксацией записи,
// снова клал в кэш старое значение на весь TTL (Н7 аудита 26.09).
router.use((req, res, next) => {
	if (req.method !== "GET" && req.path.startsWith(`/${ROUTE}`)) {
		invalidateRefCache("subkontoType");
		res.on("finish", () => invalidateRefCache("subkontoType"));
	}
	next();
});
const TEXT_FIELDS = ["code", "name"];

router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		// Потолок выдачи — общий (Н3 аудита 26.09): utils/listQuery.js.
		const limitNumber = clampLimit(rawLimit);
		const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
		const words = search ? search.split(/\s+/).filter(Boolean) : [];
		const searchWhere = words.length
			? { AND: words.map((w) => ({ OR: TEXT_FIELDS.map((f) => ({ [f]: { contains: w, mode: "insensitive" } })) })) }
			: {};
		// Сортировка валидируется по схеме — неизвестные поля не улетают в Prisma.
		const orderBy = buildOrderBy(MODEL, req.query.sort, { fallback: [{ sortOrder: "asc" }, { name: "asc" }] });
		const baseWhere = { deletedAt: null, ...searchWhere };
		const items = await prisma[MODEL].findMany({ where: baseWhere, orderBy, take: limitNumber });
		const total = await prisma[MODEL].count({ where: baseWhere });
		return res.status(200).json({ success: true, items, nextCursor: null, hasMore: false, total });
	} catch (error) {
		// Ошибка ввода (кривая дата, неизвестное поле фильтра или сортировки) — 400, прочее — 500
		// (Н10 аудита 26.09): utils/listQuery.js.
		return sendError(res, error, { message: "Ошибка сервера", label: `GET /${ROUTE}` });
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
