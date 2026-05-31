// План счетов (ChartOfAccount). Видны типовые счета (organizationUuid=null) +
// счета активной организации. Создание/редактирование — только собственных
// счетов организации (типовые засеяны и не редактируются обычным пользователем).
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter, checkOwnership } from "../../utils/auth.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";

const router = express.Router();
const MODEL = "chartOfAccount";
const ROUTE = "chart-of-accounts";
const TEXT_FIELDS = ["code", "name", "description"];

// Область видимости: типовые (org=null) + доступные организации.
function scopeWhere(req) {
	if (req.user?.isSuperAdmin) return {};
	return { OR: [{ organizationUuid: null }, tenantFilter(req)] };
}

router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const limitNumber = Math.min(Math.max(rawLimit !== undefined ? Number(rawLimit) : 1000, 1), 999999);
		const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
		const rawCursor = req.query.cursor;
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;

		const filter = req.query.filter && typeof req.query.filter === "object" ? req.query.filter : {};
		const orderBy = [];
		if (typeof req.query.sort === "string") {
			try {
				const s = JSON.parse(req.query.sort);
				if (s) for (const [f, d] of Object.entries(s)) if (d === "asc" || d === "desc") orderBy.push({ [f]: d });
			} catch {}
		}
		if (!orderBy.length) orderBy.push({ code: "asc" });
		if (!orderBy.some((o) => "id" in o)) orderBy.push({ id: "asc" });

		const words = search ? search.split(/\s+/).filter(Boolean) : [];
		const searchWhere = words.length
			? { AND: words.map((w) => ({ OR: TEXT_FIELDS.map((f) => ({ [f]: { contains: w, mode: "insensitive" } })) })) }
			: {};

		const ALLOWED = ["contains", "equals", "gte", "lte", "gt", "lt"];
		const filterWhere = {};
		for (const [field, conds] of Object.entries(filter)) {
			if (field === "searchBy" || !conds || typeof conds !== "object") continue;
			for (const [op, val] of Object.entries(conds)) {
				if (!ALLOWED.includes(op)) continue;
				if (op === "contains") filterWhere[field] = { contains: String(val), mode: "insensitive" };
				else { if (!filterWhere[field]) filterWhere[field] = {}; filterWhere[field][op] = val; }
			}
		}

		const baseWhere = { deletedAt: null, ...searchWhere, ...filterWhere, ...scopeWhere(req) };
		const opts = { take: limitNumber, where: baseWhere, orderBy };
		if (cursorNumber !== null) { opts.cursor = { id: cursorNumber }; opts.skip = 1; }
		const items = await prisma[MODEL].findMany(opts);
		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;
		let total;
		if (cursorNumber === null) total = await prisma[MODEL].count({ where: baseWhere });
		return res.status(200).json({ success: true, items, nextCursor, hasMore, ...(total !== undefined ? { total } : {}) });
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
		const item = await prisma[MODEL].findUnique({ where: w, include: { parent: true } });
		if (!item || !checkOwnership(item, req))
			return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

const BOOL_FIELDS = ["isActive", "isCurrency", "isQuantitative", "isOffBalance"];
const STR_FIELDS = ["code", "name", "accountType", "description", "parentUuid", "subkonto1Type", "subkonto2Type", "subkonto3Type"];

router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const data = { organizationUuid: req.user?.organizationUuid || null };
		for (const f of STR_FIELDS) if (req.body[f] !== undefined) data[f] = req.body[f]?.trim?.() ?? req.body[f] ?? null;
		for (const f of BOOL_FIELDS) if (req.body[f] !== undefined) data[f] = !!req.body[f];
		if (!data.code || !data.name)
			return res.status(400).json({ success: false, message: "Код и наименование обязательны" });
		const item = await prisma[MODEL].create({ data });
		return res.status(201).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2002")
			return res.status(409).json({ success: false, message: "Счёт с таким кодом уже существует" });
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const existing = await prisma[MODEL].findUnique({ where: w, select: { organizationUuid: true } });
		if (!existing || !checkOwnership(existing, req))
			return res.status(404).json({ success: false, message: "Не найдено" });
		// Типовые счета (org=null) может править только суперадмин.
		if (existing.organizationUuid === null && !req.user?.isSuperAdmin)
			return res.status(403).json({ success: false, message: "Типовой счёт нельзя изменить" });
		const data = {};
		for (const f of STR_FIELDS) if (req.body[f] !== undefined) data[f] = req.body[f]?.trim?.() ?? req.body[f] ?? null;
		for (const f of BOOL_FIELDS) if (req.body[f] !== undefined) data[f] = !!req.body[f];
		const item = await prisma[MODEL].update({ where: w, data });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2002")
			return res.status(409).json({ success: false, message: "Счёт с таким кодом уже существует" });
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.delete(`/${ROUTE}/:id`, (req, res) => handleDelete({ req, res, prisma, modelName: MODEL }));
router.post(`/${ROUTE}/batch-delete`, (req, res) => handleBatchDelete({ req, res, prisma, modelName: MODEL }));

export default router;
