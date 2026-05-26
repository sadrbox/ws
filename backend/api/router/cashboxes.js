import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter, checkOwnership } from "../../utils/auth.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";

const router = express.Router();

const MODEL = "cashbox";
const ROUTE = "cashboxes";

// ============================================
// GET
// ============================================
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const search =
			typeof req.query.search === "string" ? req.query.search.trim() : "";
		const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : 500;
		const limitNumber = Math.min(Math.max(parsedLimit, 1), 999999);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;

		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0)) {
			return res
				.status(400)
				.json({ success: false, message: "Некорректный параметр cursor" });
		}

		// Сортировка — основная касса всегда первой
		const orderBy = [{ isPrimary: "desc" }, { id: "asc" }];

		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhereClause = {};
		if (searchWords.length > 0) {
			searchWhereClause = {
				AND: searchWords.map((word) => ({
					OR: [
						{ name: { contains: word, mode: "insensitive" } },
						...(Number.isInteger(Number(word)) && Number(word) > 0
							? [{ id: { equals: Number(word) } }]
							: []),
					],
				})),
			};
		}

		const filter =
			req.query.filter && typeof req.query.filter === "object"
				? req.query.filter
				: {};
		const ALLOWED_OPERATORS = ["contains", "equals", "gte", "lte", "gt", "lt"];
		const filterWhereClause = {};
		for (const [field, conditions] of Object.entries(filter)) {
			if (!conditions || typeof conditions !== "object") continue;
			for (const [operator, value] of Object.entries(conditions)) {
				if (!ALLOWED_OPERATORS.includes(operator)) continue;
				if (!filterWhereClause[field]) filterWhereClause[field] = {};
				filterWhereClause[field][operator === "contains"
					? "contains" : operator] = operator === "contains"
					? String(value) : value;
				if (operator === "contains") filterWhereClause[field].mode = "insensitive";
			}
		}

		const baseWhere = {
			...searchWhereClause,
			...filterWhereClause,
			...tenantFilter(req),
		};
		const queryOptions = {
			take: limitNumber,
			where: baseWhere,
			orderBy,
			include: { organization: true },
		};
		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const items = await prisma[MODEL].findMany(queryOptions);
		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;
		let total;
		if (cursorNumber === null) total = await prisma[MODEL].count({ where: baseWhere });

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

// ============================================
// GET /:id
// ============================================
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const where = !isNaN(numId) && Number.isInteger(numId) && numId > 0
			? { id: numId }
			: { uuid: param };
		const item = await prisma[MODEL].findUnique({ where, include: { organization: true } });
		if (!item || !checkOwnership(item, req)) return res.status(404).json({ success: false, message: "Касса не найдена" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// POST
// ============================================
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const { name, organizationUuid, isPrimary } = req.body;
		if (!name?.trim()) {
			return res.status(400).json({ success: false, message: "Наименование обязательно" });
		}

		const makePrimary = isPrimary === true;
		const orgUuid = organizationUuid || req.user?.organizationUuid || null;

		const item = await prisma.$transaction(async (tx) => {
			if (makePrimary && orgUuid) {
				await tx.cashbox.updateMany({
					where: { organizationUuid: orgUuid, isPrimary: true },
					data: { isPrimary: false },
				});
			}
			return tx.cashbox.create({
				data: {
					name: name.trim(),
					organizationUuid: orgUuid,
					isPrimary: makePrimary,
				},
				include: { organization: true },
			});
		});

		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// PUT /:id
// ============================================
router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const where = !isNaN(numId) && Number.isInteger(numId) && numId > 0
			? { id: numId }
			: { uuid: param };

		const data = {};
		if (req.body.name !== undefined) data.name = req.body.name?.trim() ?? null;
		if (req.body.organizationUuid !== undefined) data.organizationUuid = req.body.organizationUuid || null;
		if (req.body.isPrimary !== undefined) data.isPrimary = !!req.body.isPrimary;

		const preCheck = await prisma.cashbox.findUnique({ where, select: { organizationUuid: true } });
		if (!preCheck || !checkOwnership(preCheck, req))
			return res.status(404).json({ success: false, message: "Касса не найдена" });
		const item = await prisma.$transaction(async (tx) => {
			if (data.isPrimary === true) {
				const current = await tx.cashbox.findUnique({ where });
				if (current?.organizationUuid) {
					await tx.cashbox.updateMany({
						where: {
							organizationUuid: current.organizationUuid,
							isPrimary: true,
							NOT: { uuid: current.uuid },
						},
						data: { isPrimary: false },
					});
				}
			}
			return tx.cashbox.update({ where, data, include: { organization: true } });
		});

		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Касса не найдена" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// DELETE /:id
// ============================================
router.delete(`/${ROUTE}/:id`, (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL }),
);

// ── POST /cashboxes/batch ─────────────────────────────────────────────────
router.post(`/${ROUTE}/batch`, async (req, res) => {
	try {
		const { operations } = req.body;
		if (!Array.isArray(operations) || operations.length === 0)
			return res.status(400).json({ success: false, message: "operations обязателен" });
		await prisma.$transaction(async (tx) => {
			for (const { action, uuid, data } of operations) {
				if (action === "create" && data) {
					await tx[MODEL].create({
						data: {
							name: (data.name ?? "").trim(),
							organizationUuid: data.organizationUuid || null,
							isPrimary: data.isPrimary === true,
						},
					});
				} else if (action === "update" && uuid && data) {
					const updateData = {};
					if (data.name !== undefined) updateData.name = (data.name ?? "").trim();
					if (data.isPrimary !== undefined) updateData.isPrimary = data.isPrimary === true;
					if (Object.keys(updateData).length > 0)
						await tx[MODEL].update({ where: { uuid }, data: updateData });
				} else if (action === "delete" && uuid) {
					try { await tx[MODEL].delete({ where: { uuid } }); } catch {}
				}
			}
		});
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
