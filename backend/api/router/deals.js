// deals — CRM-сделки (E9). Справочно-документная сущность воронки продаж:
// движений регистра/проводок НЕ даёт. Изоляция по организации через tenantFilter.
// Стадия won/lost автоматически проставляет status (открыта/выиграна/проиграна).
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { idSearchCondition } from "../../utils/searchId.js";

const router = express.Router();

const MODEL = "deal";
const ROUTE = "deals";
const TEXT_FIELDS = ["number", "title", "comment"];

const REL_INCLUDE = {
	counterparty: { select: { uuid: true, name: true } },
	organization: { select: { uuid: true, name: true } },
	responsible: { select: { uuid: true, username: true } },
};

// status выводится из стадии: won/lost — терминальные, остальное — открыта.
const statusFromStage = (stage) => (stage === "won" ? "won" : stage === "lost" ? "lost" : "open");

// Плоские имена связей — для колонок списка и подстановки в LookupField формы.
const flatten = (d) => (d ? {
	...d,
	counterpartyName: d.counterparty?.name ?? "",
	organizationName: d.organization?.name ?? "",
	responsibleName: d.responsible?.username ?? "",
} : d);

// ── GET list ────────────────────────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
		const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : 500;
		const limitNumber = Math.min(Math.max(parsedLimit, 1), 999999);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;
		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0))
			return res.status(400).json({ success: false, message: "Некорректный параметр cursor" });

		const filter = req.query.filter && typeof req.query.filter === "object" ? req.query.filter : {};
		const orderBy = [];
		const sortParam = typeof req.query.sort === "string" ? req.query.sort : null;
		if (sortParam) {
			try {
				const s = JSON.parse(sortParam);
				if (s && typeof s === "object")
					for (const [f, d] of Object.entries(s)) {
						if (d === "asc" || d === "desc") { const parts = f.split("."); orderBy.push(parts.length === 2 ? { [parts[0]]: { [parts[1]]: d } } : { [f]: d }); }
					}
			} catch {}
		}
		if (orderBy.length === 0) orderBy.push({ id: "desc" });
		else if (!orderBy.some((o) => "id" in o)) orderBy.push({ id: "desc" });

		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhere = {};
		if (searchWords.length > 0)
			searchWhere = {
				AND: searchWords.map((w) => {
					const orConditions = TEXT_FIELDS.map((f) => ({ [f]: { contains: w, mode: "insensitive" } }));
					const idNum = idSearchCondition(w);
					if (idNum) orConditions.push(idNum);
					return { OR: orConditions };
				}),
			};

		const ALLOWED = ["contains", "equals", "gte", "lte", "gt", "lt"];
		const filterWhere = {};
		for (const [field, conds] of Object.entries(filter)) {
			if (["searchBy", "dateRange"].includes(field) || !conds || typeof conds !== "object") continue;
			for (const [op, val] of Object.entries(conds)) {
				if (!ALLOWED.includes(op)) continue;
				if (op === "contains") filterWhere[field] = { contains: String(val), mode: "insensitive" };
				else {
					if (!filterWhere[field]) filterWhere[field] = {};
					filterWhere[field][op] = val;
				}
			}
		}

		const baseWhere = { ...searchWhere, ...filterWhere, ...tenantFilter(req) };
		const opts = { take: limitNumber, where: baseWhere, orderBy, include: REL_INCLUDE };
		if (cursorNumber !== null) {
			opts.cursor = { id: cursorNumber };
			opts.skip = 1;
		}

		const items = await prisma[MODEL].findMany(opts);
		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;
		let total;
		if (cursorNumber === null) total = await prisma[MODEL].count({ where: baseWhere });

		return res.status(200).json({ success: true, items: items.map(flatten), nextCursor, hasMore, ...(total !== undefined ? { total } : {}) });
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET by id ───────────────────────────────────────────────────────────
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({ where: w, include: REL_INCLUDE });
		if (!item) return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item: flatten(item) });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST ────────────────────────────────────────────────────────────────
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const b = req.body ?? {};
		if (!b.title?.trim())
			return res.status(400).json({ success: false, message: "Заголовок обязателен (title)" });
		const stage = typeof b.stage === "string" && b.stage ? b.stage : "new";
		const item = await prisma[MODEL].create({
			data: {
				number: b.number?.trim() || null,
				title: b.title.trim(),
				stage,
				status: statusFromStage(stage),
				amount: b.amount != null ? Number(b.amount) : 0,
				currency: b.currency?.trim() || "KZT",
				probability: b.probability != null ? Number(b.probability) : 0,
				expectedCloseDate: b.expectedCloseDate ? new Date(b.expectedCloseDate) : null,
				comment: b.comment?.trim() || null,
				counterpartyUuid: b.counterpartyUuid || null,
				responsibleUuid: b.responsibleUuid || null,
				organizationUuid: b.organizationUuid || req.user?.organizationUuid || null,
			},
			include: REL_INCLUDE,
		});
		return res.status(201).json({ success: true, item: flatten(item) });
	} catch (error) {
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── PUT ─────────────────────────────────────────────────────────────────
router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const b = req.body ?? {};
		const data = {};
		if (b.number !== undefined) data.number = b.number?.trim() || null;
		if (b.title !== undefined) data.title = b.title?.trim() ?? null;
		if (b.stage !== undefined) { data.stage = b.stage; data.status = statusFromStage(b.stage); }
		if (b.status !== undefined && b.stage === undefined) data.status = b.status;
		if (b.amount !== undefined) data.amount = b.amount != null ? Number(b.amount) : 0;
		if (b.currency !== undefined) data.currency = b.currency?.trim() || "KZT";
		if (b.probability !== undefined) data.probability = b.probability != null ? Number(b.probability) : 0;
		if (b.expectedCloseDate !== undefined) data.expectedCloseDate = b.expectedCloseDate ? new Date(b.expectedCloseDate) : null;
		if (b.comment !== undefined) data.comment = b.comment?.trim() || null;
		if (b.counterpartyUuid !== undefined) data.counterpartyUuid = b.counterpartyUuid || null;
		if (b.responsibleUuid !== undefined) data.responsibleUuid = b.responsibleUuid || null;
		if (b.organizationUuid !== undefined) data.organizationUuid = b.organizationUuid || null;
		const item = await prisma[MODEL].update({ where: w, data, include: REL_INCLUDE });
		return res.status(200).json({ success: true, item: flatten(item) });
	} catch (error) {
		if (error.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE ──────────────────────────────────────────────────────────────
router.delete(`/${ROUTE}/:id`, (req, res) => handleDelete({ req, res, prisma, modelName: MODEL }));
router.post(`/${ROUTE}/batch-delete`, (req, res) => handleBatchDelete({ req, res, prisma, modelName: MODEL }));

export default router;
