import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { assertOrgFieldMembership, respondOrgFieldError } from "../../utils/orgFieldValidation.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
const router = express.Router();
const MODEL = "incomingInvoice";
const ROUTE = "incoming-invoices";
const TEXT_FIELDS = ["comment"];

router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const search =
			typeof req.query.search === "string" ? req.query.search.trim() : "";
		const limitNumber = Math.min(
			Math.max(rawLimit !== undefined ? Number(rawLimit) : 500, 1),
			999999,
		);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;
		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0))
			return res
				.status(400)
				.json({ success: false, message: "Некорректный cursor" });
		const filter =
			req.query.filter && typeof req.query.filter === "object"
				? req.query.filter
				: {};
		const orderBy = [];
		if (typeof req.query.sort === "string") {
			try {
				const s = JSON.parse(req.query.sort);
				if (s)
					for (const [f, d] of Object.entries(s)) {
						if (d === "asc" || d === "desc") { const parts = f.split("."); orderBy.push(parts.length === 2 ? { [parts[0]]: { [parts[1]]: d } } : { [f]: d }); }
					}
			} catch {}
		}
		if (!orderBy.length) orderBy.push({ id: "desc" });
		else if (!orderBy.some((o) => "id" in o)) orderBy.push({ id: "asc" });
		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhere = {};
		if (searchWords.length)
			searchWhere = {
				AND: searchWords.map((w) => {
					const orConditions = TEXT_FIELDS.map((f) => ({
						[f]: { contains: w, mode: "insensitive" },
					}));
					const num = Number(w);
					if (Number.isInteger(num) && num > 0) {
						orConditions.push({ id: { equals: num } });
					}
					return { OR: orConditions };
				}),
			};
		const ALLOWED = ["contains", "equals", "gte", "lte", "gt", "lt"];
		const filterWhere = {};
		for (const [field, conds] of Object.entries(filter)) {
			if (field === "searchBy" || !conds || typeof conds !== "object") continue;
			if (field === "dateRange") {
				const dr = {};
				if (conds.startDate) dr.gte = new Date(conds.startDate);
				if (conds.endDate) dr.lte = new Date(conds.endDate);
				if (Object.keys(dr).length > 0) filterWhere.date = dr;
				continue;
			}
			for (const [op, val] of Object.entries(conds)) {
				if (!ALLOWED.includes(op)) continue;
				if (op === "contains")
					filterWhere[field] = { contains: String(val), mode: "insensitive" };
				else {
					if (!filterWhere[field]) filterWhere[field] = {};
					filterWhere[field][op] = val;
				}
			}
		}
		const baseWhere = { ...searchWhere, ...filterWhere, ...tenantFilter(req) };
		const opts = {
			take: limitNumber,
			where: baseWhere,
			orderBy,
			include: {
				organization: true,
				counterparty: true,
				contract: true,
				author: { select: { uuid: true, username: true, email: true } },
			},
		};
		if (cursorNumber !== null) {
			opts.cursor = { id: cursorNumber };
			opts.skip = 1;
		}
		const items = await prisma[MODEL].findMany(opts);
		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;
		let total;
		if (cursorNumber === null)
			total = await prisma[MODEL].count({ where: baseWhere });
		return res.status(200).json({
			success: true,
			items,
			nextCursor,
			hasMore,
			...(total !== undefined ? { total } : {}),
		});
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({
			where: w,
			include: {
				organization: true,
				counterparty: true,
				contract: true,
				author: { select: { uuid: true, username: true, email: true } },
			},
		});
		if (!item)
			return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		if (!req.user?.uuid) {
			return res.status(401).json({
				success: false,
				message: "Автор документа обязателен: требуется авторизация",
			});
		}
		const {
			date,
			comment,
			amount,
			organizationUuid,
			counterpartyUuid,
			contractUuid,
			posted,
		} = req.body;
		// Stage D: договор принадлежит организации документа.
		await assertOrgFieldMembership({ organizationUuid, contractUuid }, prisma);
		const item = await prisma[MODEL].create({
			data: {
				date: date ? new Date(date) : new Date(),
				comment: comment?.trim() ?? null,
				amount: amount != null ? parseFloat(amount) : null,
				posted: typeof posted === "boolean" ? posted : false,
				organizationUuid: organizationUuid || null,
				counterpartyUuid: counterpartyUuid || null,
				contractUuid: contractUuid || null,
				authorUuid: req.user.uuid,
			},
			include: {
				organization: true,
				counterparty: true,
				contract: true,
				author: { select: { uuid: true, username: true, email: true } },
			},
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
		if (respondOrgFieldError(error, res)) return;
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});
router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const data = {};
		for (const f of [
			"comment",
			"organizationUuid",
			"counterpartyUuid",
			"contractUuid",
		]) {
			if (req.body[f] !== undefined)
				data[f] = req.body[f]?.trim?.() ?? req.body[f] ?? null;
		}
		if (req.body.date !== undefined)
			data.date = req.body.date ? new Date(req.body.date) : null;
		if (req.body.amount !== undefined)
			data.amount =
				req.body.amount != null ? parseFloat(req.body.amount) : null;
		if (req.body.posted !== undefined) data.posted = !!req.body.posted;
		// Stage D: договор принадлежит организации документа (мерж с текущими).
		const _ex = await prisma[MODEL].findUnique({ where: w, select: { organizationUuid: true, contractUuid: true } });
		await assertOrgFieldMembership({
			organizationUuid: data.organizationUuid !== undefined ? data.organizationUuid : _ex?.organizationUuid,
			contractUuid: data.contractUuid !== undefined ? data.contractUuid : _ex?.contractUuid,
		}, prisma);
		const item = await prisma[MODEL].update({
			where: w,
			data,
			include: {
				organization: true,
				counterparty: true,
				contract: true,
				author: { select: { uuid: true, username: true, email: true } },
			},
		});
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (respondOrgFieldError(error, res)) return;
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});
router.delete(`/${ROUTE}/:id`, (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL }),
);
router.post(`/${ROUTE}/batch-delete`, (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: MODEL }),
);

export default router;
