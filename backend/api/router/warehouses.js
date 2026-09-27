import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter, orgQueryFilter, checkOwnership } from "../../utils/auth.js";
import { idSearchCondition } from "../../utils/searchId.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { clampLimit, sendError, buildFilterWhere } from "../../utils/listQuery.js";

const router = express.Router();

const MODEL = "warehouse";
const ROUTE = "warehouses";
const TEXT_FIELDS = ["name", "address", "comment"];

// ============================================
// GET
// ============================================
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const search =
			typeof req.query.search === "string" ? req.query.search.trim() : "";
		// Потолок выдачи — общий (Н3 аудита 26.09): utils/listQuery.js.
		const limitNumber = clampLimit(rawLimit);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;

		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0)) {
			return res
				.status(400)
				.json({ success: false, message: "Некорректный параметр cursor" });
		}

		const filter =
			req.query.filter && typeof req.query.filter === "object"
				? req.query.filter
				: {};

		const orderBy = [];
		const sortParam =
			typeof req.query.sort === "string" ? req.query.sort : null;
		if (sortParam) {
			try {
				const sortObj = JSON.parse(sortParam);
				if (sortObj && typeof sortObj === "object") {
					for (const [field, dir] of Object.entries(sortObj)) {
						if (dir !== "asc" && dir !== "desc") continue;
						orderBy.push({ [field]: dir });
					}
				}
			} catch {}
		}
		if (!orderBy.some((o) => "id" in o)) orderBy.push({ id: "asc" });

		// Поиск
		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhereClause = {};
		if (searchWords.length > 0) {
			searchWhereClause = {
				AND: searchWords.map((word) => {
					const orConditions = TEXT_FIELDS.map((field) => ({
						[field]: { contains: word, mode: "insensitive" },
					}));
					const idNum = idSearchCondition(word);
					if (idNum) orConditions.push(idNum);
					return { OR: orConditions };
				}),
			};
		}

		// Фильтры
		// Фильтры — по схеме модели: неизвестное поле, кривая дата или число → 400, а не 500 из Prisma
		// (Н10 аудита 26.09): utils/listQuery.js.
		const filterWhereClause = buildFilterWhere("warehouse", filter);

		const baseWhere = {
			...searchWhereClause,
			...filterWhereClause,
			...tenantFilter(req),
			...orgQueryFilter(req),
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
		// Ошибка ввода (кривая дата, неизвестное поле фильтра или сортировки) — 400, прочее — 500
		// (Н10 аудита 26.09): utils/listQuery.js.
		return sendError(res, error, { message: "Ошибка сервера", label: `GET /${ROUTE}` });
	}
});

// ============================================
// GET /:id
// ============================================
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		const where = isNumeric ? { id: numId } : { uuid: param };

		const item = await prisma[MODEL].findUnique({
			where,
			include: { organization: true },
		});
		if (!item || !checkOwnership(item, req))
			return res.status(404).json({ success: false, message: "Не найдено" });
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
		const { name, address, comment, organizationUuid } = req.body;
		if (!name?.trim()) {
			return res
				.status(400)
				.json({ success: false, message: "Наименование обязательно" });
		}

		const orgUuid = organizationUuid || req.user?.organizationUuid || null;

		const item = await prisma[MODEL].create({
			data: {
				name: name.trim(),
				address: address?.trim() ?? null,
				comment: comment?.trim() ?? null,
				organizationUuid: orgUuid,
			},
			include: { organization: true },
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
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		const where = isNumeric ? { id: numId } : { uuid: param };

		const data = {};
		const scalarFields = ["name", "address", "comment", "organizationUuid"];
		for (const f of scalarFields) {
			if (req.body[f] !== undefined)
				data[f] = req.body[f]?.trim?.() ?? req.body[f] ?? null;
		}

		const preCheck = await prisma.warehouse.findUnique({ where, select: { organizationUuid: true } });
		if (!preCheck || !checkOwnership(preCheck, req))
			return res.status(404).json({ success: false, message: "Не найдено" });

		const item = await prisma[MODEL].update({
			where,
			data,
			include: { organization: true },
		});

		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
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

// ── POST /warehouses/batch ────────────────────────────────────────────────
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
							address: data.address?.trim() ?? null,
							comment: data.comment?.trim() ?? null,
							organizationUuid: data.organizationUuid || null,
						},
					});
				} else if (action === "update" && uuid && data) {
					const updateData = {};
					if (data.name !== undefined) updateData.name = (data.name ?? "").trim();
					if (data.address !== undefined) updateData.address = data.address?.trim() ?? null;
					if (data.comment !== undefined) updateData.comment = data.comment?.trim() ?? null;
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
