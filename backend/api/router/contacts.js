import express from "express";
import { prisma } from "../../prisma/prisma-client.js";

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
					if (Number.isInteger(num) && num > 0) {
						orConditions.push({ id: { equals: num } });
					}
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
		};

		const queryOptions = {
			take: limitNumber,
			where: baseWhere,
			orderBy,
			include: {
				contactType: true,
			},
		};

		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const items = await prisma.contact.findMany(queryOptions);

		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		let total;
		if (cursorNumber === null) {
			total = await prisma.contact.count({ where: baseWhere });
		}

		return res.status(200).json({
			success: true,
			items,
			nextCursor,
			hasMore,
			...(total !== undefined ? { total } : {}),
		});
	} catch (error) {
		console.error("GET /contacts error:", error?.message, error?.stack);
		return res.status(500).json({ success: false, message: "Ошибка сервера", debug: error?.message });
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
			? await prisma.contact.findUnique({
					where: { id: numId },
					include: {
						contactType: true,
					},
				})
			: await prisma.contact.findUnique({
					where: { uuid: param },
					include: {
						contactType: true,
					},
				});

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
		const {
			value,
			contactTypeUuid,
			ownerType,
			ownerUuid,
		} = req.body;

		const item = await prisma.contact.create({
			data: {
				value: typeof value === "string" ? value.trim() : "",
				contactTypeUuid: contactTypeUuid || null,
				ownerType: ownerType?.trim() || null,
				ownerUuid: ownerUuid?.trim() || null,
			},
			include: {
				contactType: true,
			},
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

		const {
			value,
			contactTypeUuid,
			ownerType,
			ownerUuid,
		} = req.body;
		const data = {};
		if (value !== undefined) data.value = value?.trim() ?? null;
		if (contactTypeUuid !== undefined)
			data.contactTypeUuid = contactTypeUuid || null;
		if (ownerType !== undefined) data.ownerType = ownerType?.trim() || null;
		if (ownerUuid !== undefined) data.ownerUuid = ownerUuid?.trim() || null;

		const item = await prisma.contact.update({
			where: isNumeric ? { id: numId } : { uuid: param },
			data,
			include: {
				contactType: true,
			},
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
router.delete("/contacts/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;

		await prisma.contact.delete({
			where: isNumeric ? { id: numId } : { uuid: param },
		});

		return res.status(200).json({ success: true, message: "Удалено" });
	} catch (error) {
		if (error.code === "P2025") {
			return res
				.status(404)
				.json({ success: false, message: "Контакт не найден" });
		}
		console.error("DELETE /contacts/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
