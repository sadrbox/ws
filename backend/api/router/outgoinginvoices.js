import express from "express";
import cors from "cors";
import { prisma } from "../../prisma/prisma-client.js";
const router = express.Router();
router.use(cors());
const MODEL = "outgoingInvoice";
const ROUTE = "outgoing-invoices";
const TEXT_FIELDS = ["documentNumber", "description", "ownerName"];

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
						if (d === "asc" || d === "desc") orderBy.push({ [f]: d });
					}
			} catch {}
		}
		if (!orderBy.length) orderBy.push({ id: "desc" });
		else if (!orderBy.some((o) => "id" in o)) orderBy.push({ id: "asc" });
		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhere = {};
		if (searchWords.length)
			searchWhere = {
				AND: searchWords.map((w) => ({
					OR: TEXT_FIELDS.map((f) => ({
						[f]: { contains: w, mode: "insensitive" },
					})),
				})),
			};
		const ALLOWED = ["contains", "equals", "gte", "lte", "gt", "lt"];
		const filterWhere = {};
		for (const [field, conds] of Object.entries(filter)) {
			if (
				["searchBy", "dateRange"].includes(field) ||
				!conds ||
				typeof conds !== "object"
			)
				continue;
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
		const baseWhere = { ...searchWhere, ...filterWhere };
		const opts = {
			take: limitNumber,
			where: baseWhere,
			orderBy,
			include: { organization: true, counterparty: true },
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
		return res
			.status(200)
			.json({
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
			include: { organization: true, counterparty: true },
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
		const {
			documentNumber,
			documentDate,
			description,
			amount,
			status,
			organizationUuid,
			counterpartyUuid,
			ownerName,
		} = req.body;
		const item = await prisma[MODEL].create({
			data: {
				documentNumber: documentNumber?.trim() ?? null,
				documentDate: documentDate ? new Date(documentDate) : new Date(),
				description: description?.trim() ?? null,
				amount: amount != null ? parseFloat(amount) : null,
				status: status || "draft",
				organizationUuid: organizationUuid || null,
				counterpartyUuid: counterpartyUuid || null,
				ownerName: ownerName?.trim() ?? null,
			},
			include: { organization: true, counterparty: true },
		});
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
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const data = {};
		for (const f of [
			"documentNumber",
			"description",
			"status",
			"organizationUuid",
			"counterpartyUuid",
			"ownerName",
		]) {
			if (req.body[f] !== undefined)
				data[f] = req.body[f]?.trim?.() ?? req.body[f] ?? null;
		}
		if (req.body.documentDate !== undefined)
			data.documentDate = req.body.documentDate
				? new Date(req.body.documentDate)
				: null;
		if (req.body.amount !== undefined)
			data.amount =
				req.body.amount != null ? parseFloat(req.body.amount) : null;
		const item = await prisma[MODEL].update({
			where: w,
			data,
			include: { organization: true, counterparty: true },
		});
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});
router.delete(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		await prisma[MODEL].delete({ where: w });
		return res.status(200).json({ success: true, message: "Удалено" });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`DELETE /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});
export default router;
