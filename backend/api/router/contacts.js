import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { enrichWithOwnerName } from "../../utils/resolveOwnerName.js";
import { tenantFilter } from "../../utils/auth.js";

const router = express.Router();

// ============================================
// GET /contacts — курсорная пагинация
// ============================================
router.get("/contacts", async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const search =
			typeof req.query.search === "string" ? req.query.search.trim() : "";

		const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : 500;
		const limitNumber = Math.min(Math.max(parsedLimit, 1), 999999);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;

		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0)) {
			return res.status(400).json({
				success: false,
				message: "Некорректный параметр cursor",
			});
		}

		const filter =
			req.query.filter && typeof req.query.filter === "object"
				? req.query.filter
				: {};

		// ── Сортировка ────────────────────────────────────────────────────────
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

		if (orderBy.length === 0) {
			// Основной контакт (isPrimary) всегда первым в SubTable
			orderBy.push({ isPrimary: "desc" });
			orderBy.push({ id: "asc" });
		} else {
			const hasId = orderBy.some((o) => "id" in o);
			if (!hasId) orderBy.push({ id: "asc" });
		}

		// ── Поиск ─────────────────────────────────────────────────────────────
		const TEXT_FIELDS = ["value"];
		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhereClause = {};

		if (searchWords.length > 0) {
			searchWhereClause = {
				AND: searchWords.map((word) => {
					const orConditions = TEXT_FIELDS.map((field) => ({
						[field]: { contains: word, mode: "insensitive" },
					}));
					const num = Number(word);
					if (idNum) orConditions.push(idNum);
					return { OR: orConditions };
				}),
			};
		}

		// ── Фильтр по дате ────────────────────────────────────────────────────
		const dateRange =
			filter.dateRange && typeof filter.dateRange === "object"
				? filter.dateRange
				: {};
		const startDate =
			typeof dateRange.startDate === "string" ? dateRange.startDate : null;
		const endDate =
			typeof dateRange.endDate === "string" ? dateRange.endDate : null;

		const dateRangeFilter = {};

		// ── Произвольные фильтры ──────────────────────────────────────────────
		const ALLOWED_OPERATORS = ["contains", "equals", "gte", "lte", "gt", "lt"];
		const SKIP_KEYS = ["searchBy", "dateRange"];
		const filterWhereClause = {};

		for (const [field, conditions] of Object.entries(filter)) {
			if (SKIP_KEYS.includes(field)) continue;
			if (!conditions || typeof conditions !== "object") continue;

			for (const [operator, value] of Object.entries(conditions)) {
				if (!ALLOWED_OPERATORS.includes(operator)) continue;
				if (!filterWhereClause[field]) filterWhereClause[field] = {};
				if (operator === "contains") {
					filterWhereClause[field] = {
						contains: String(value),
						mode: "insensitive",
					};
				} else {
					filterWhereClause[field][operator] = value;
				}
			}
		}

		// ── Фильтрация по ownerType + ownerUuid (SubTable передаёт как query-параметры) ────
		const fkFilter = {};
		if (typeof req.query.ownerType === "string" && req.query.ownerType.trim()) {
			fkFilter.ownerType = req.query.ownerType.trim();
		}
		if (typeof req.query.ownerUuid === "string" && req.query.ownerUuid.trim()) {
			fkFilter.ownerUuid = req.query.ownerUuid.trim();
		}

		// ── Итоговый where ────────────────────────────────────────────────────
		const baseWhere = {
			...searchWhereClause,
			...dateRangeFilter,
			...filterWhereClause,
			...fkFilter,
			...(fkFilter.ownerUuid ? {} : tenantFilter(req)),
		};

		const queryOptions = {
			take: limitNumber,
			where: baseWhere,
			orderBy,
		};

		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const items = await prisma.contact.findMany(queryOptions);
		const enrichedItems = await enrichWithOwnerName(items);

		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		let total;
		if (cursorNumber === null) {
			total = await prisma.contact.count({ where: baseWhere });
		}

		return res.status(200).json({
			success: true,
			items: enrichedItems,
			nextCursor,
			hasMore,
			...(total !== undefined ? { total } : {}),
		});
	} catch (error) {
		console.error("GET /contacts error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// GET /contacts/:id — поиск по ID или UUID
// ============================================
router.get("/contacts/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;

		const item = isNumeric
			? await prisma.contact.findUnique({ where: { id: numId } })
			: await prisma.contact.findUnique({ where: { uuid: param } });

		if (!item) {
			return res
				.status(404)
				.json({ success: false, message: "Контакт не найден" });
		}

		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error("GET /contacts/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// POST /contacts
// ============================================
router.post("/contacts", async (req, res) => {
	try {
		const { value, contactType, ownerType, ownerUuid, isPrimary } = req.body;

		if (!contactType) {
			return res.status(400).json({ success: false, message: "contactType is required" });
		}

		const makePrimary = isPrimary === true;
		const createData = {
			value: typeof value === "string" ? value.trim() : "",
			contactType,
			ownerType: ownerType?.trim() || null,
			ownerUuid: ownerUuid?.trim() || null,
			organizationUuid: req.user?.organizationUuid ?? null,
			isPrimary: makePrimary,
		};

		const item = await prisma.$transaction(async (tx) => {
			// Сбрасываем флаг у других контактов того же типа и владельца
			if (makePrimary && createData.contactType && createData.ownerType && createData.ownerUuid) {
				await tx.contact.updateMany({
					where: {
						contactType: createData.contactType,
						ownerType: createData.ownerType,
						ownerUuid: createData.ownerUuid,
						isPrimary: true,
					},
					data: { isPrimary: false },
				});
			}
			return tx.contact.create({ data: createData });
		});

		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error("POST /contacts error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// PUT /contacts/:id
// ============================================
router.put("/contacts/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		const whereClause = isNumeric ? { id: numId } : { uuid: param };

		const { value, contactType, ownerType, ownerUuid, isPrimary } = req.body;
		const data = {};
		if (value !== undefined) data.value = value?.trim() ?? null;
		if (contactType !== undefined) data.contactType = contactType || null;
		if (ownerType !== undefined) data.ownerType = ownerType?.trim() || null;
		if (ownerUuid !== undefined) data.ownerUuid = ownerUuid?.trim() || null;
		if (isPrimary !== undefined) data.isPrimary = !!isPrimary;

		const item = await prisma.$transaction(async (tx) => {
			// При установке основного — сбрасываем флаг у других контактов
			// того же типа и владельца (уникальность основного по типу контакта).
			if (data.isPrimary === true) {
				const current = await tx.contact.findUnique({ where: whereClause });
				if (current) {
					const cType = data.contactType ?? current.contactType;
					const oType = data.ownerType ?? current.ownerType;
					const oUuid = data.ownerUuid ?? current.ownerUuid;
					if (cType && oType && oUuid) {
						await tx.contact.updateMany({
							where: {
								contactType: cType,
								ownerType: oType,
								ownerUuid: oUuid,
								isPrimary: true,
								NOT: { uuid: current.uuid },
							},
							data: { isPrimary: false },
						});
					}
				}
			}
			return tx.contact.update({ where: whereClause, data });
		});

		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025") {
			return res
				.status(404)
				.json({ success: false, message: "Контакт не найден" });
		}
		console.error("PUT /contacts/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// DELETE /contacts/:id
// ============================================
router.delete("/contacts/:id", (req, res) =>
	handleDelete({
		req,
		res,
		prisma,
		modelName: "contact",
		notFoundMessage: "Контакт не найден",
	}),
);

// ── POST /contacts/batch ──────────────────────────────────────────────────
router.post("/contacts/batch", async (req, res) => {
	try {
		const { operations } = req.body;
		if (!Array.isArray(operations) || operations.length === 0)
			return res.status(400).json({ success: false, message: "operations обязателен" });
		await prisma.$transaction(async (tx) => {
			for (const { action, uuid, data } of operations) {
				if (action === "create" && data) {
					await tx.contact.create({
						data: {
							value: typeof data.value === "string" ? data.value.trim() : "",
							contactType: data.contactType ?? null,
							ownerType: data.ownerType?.trim() || null,
							ownerUuid: data.ownerUuid?.trim() || null,
							organizationUuid: data.organizationUuid ?? null,
							isPrimary: data.isPrimary === true,
						},
					});
				} else if (action === "update" && uuid && data) {
					const updateData = {};
					if (data.value !== undefined) updateData.value = typeof data.value === "string" ? data.value.trim() : "";
					if (data.contactType !== undefined) updateData.contactType = data.contactType;
					if (data.isPrimary !== undefined) updateData.isPrimary = data.isPrimary === true;
					if (Object.keys(updateData).length > 0)
						await tx.contact.update({ where: { uuid }, data: updateData });
				} else if (action === "delete" && uuid) {
					try { await tx.contact.delete({ where: { uuid } }); } catch {}
				}
			}
		});
		return res.status(200).json({ success: true });
	} catch (error) {
		console.error("POST /contacts/batch error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.post("/contacts/batch-delete", (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: "contact" }),
);

export default router;
