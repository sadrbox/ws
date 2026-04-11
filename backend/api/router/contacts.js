import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
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
			orderBy.push({ id: "asc" });
		} else {
			const hasId = orderBy.some((o) => "id" in o);
			if (!hasId) orderBy.push({ id: "asc" });
		}

		// ── Поиск ─────────────────────────────────────────────────────────────
		const TEXT_FIELDS = ["value", "ownerName"];
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

		// ── Фильтрация по FK-полям (SubTable передаёт как query-параметры) ────
		const fkFilter = {};
		const FK_FIELDS = ["organizationUuid", "counterpartyUuid", "contactPersonUuid", "employeeUuid", "userUuid"];
		for (const fk of FK_FIELDS) {
			if (typeof req.query[fk] === "string" && req.query[fk].trim()) {
				fkFilter[fk] = req.query[fk].trim();
			}
		}

		// ── Итоговый where ────────────────────────────────────────────────────
		const baseWhere = {
			...searchWhereClause,
			...dateRangeFilter,
			...filterWhereClause,
			...fkFilter,
			...tenantFilter(req),
		};

		const queryOptions = {
			take: limitNumber,
			where: baseWhere,
			orderBy,
			include: {
				contactType: true,
				organization: true,
				counterparty: true,
				contactPerson: true,
				employee: true,
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
			? await prisma.contact.findUnique({
					where: { id: numId },
					include: {
						contactType: true,
						organization: true,
						counterparty: true,
						contactPerson: true,
						employee: true,
					},
				})
			: await prisma.contact.findUnique({
					where: { uuid: param },
					include: {
						contactType: true,
						organization: true,
						counterparty: true,
						contactPerson: true,
						employee: true,
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

// ── Авто-вычисление ownerName из FK-связей ─────────────────────────────
async function resolveOwnerName({ organizationUuid, counterpartyUuid, contactPersonUuid, employeeUuid }) {
	if (organizationUuid) {
		const org = await prisma.organization.findUnique({ where: { uuid: organizationUuid }, select: { shortName: true } });
		if (org) return org.shortName || null;
	}
	if (counterpartyUuid) {
		const cp = await prisma.counterparty.findUnique({ where: { uuid: counterpartyUuid }, select: { shortName: true } });
		if (cp) return cp.shortName || null;
	}
	if (contactPersonUuid) {
		const cp = await prisma.contactPerson.findUnique({ where: { uuid: contactPersonUuid }, select: { fullName: true } });
		if (cp) return cp.fullName || null;
	}
	if (employeeUuid) {
		const emp = await prisma.employee.findUnique({ where: { uuid: employeeUuid }, select: { fullName: true } });
		if (emp) return emp.fullName || null;
	}
	return null;
}

// ============================================
// POST /contacts
// ============================================
router.post("/contacts", async (req, res) => {
	try {
		const {
			value,
			contactTypeUuid,
			ownerName,
			organizationUuid,
			counterpartyUuid,
			contactPersonUuid,
			employeeUuid,
		} = req.body;

		// Авто-вычисление ownerName если не передано явно
		const computedOwnerName = ownerName?.trim() || await resolveOwnerName({ organizationUuid, counterpartyUuid, contactPersonUuid, employeeUuid });

		const item = await prisma.contact.create({
			data: {
				value: typeof value === "string" ? value.trim() : "",
				contactTypeUuid: contactTypeUuid || null,
				ownerName: computedOwnerName ?? null,
				organizationUuid: organizationUuid || null,
				counterpartyUuid: counterpartyUuid || null,
				contactPersonUuid: contactPersonUuid || null,
				employeeUuid: employeeUuid || null,
			},
			include: {
				contactType: true,
				organization: true,
				counterparty: true,
				contactPerson: true,
				employee: true,
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
			ownerName,
			organizationUuid,
			counterpartyUuid,
			contactPersonUuid,
			employeeUuid,
		} = req.body;
		const data = {};
		if (value !== undefined) data.value = value?.trim() ?? null;
		if (contactTypeUuid !== undefined)
			data.contactTypeUuid = contactTypeUuid || null;
		if (organizationUuid !== undefined)
			data.organizationUuid = organizationUuid || null;
		if (counterpartyUuid !== undefined)
			data.counterpartyUuid = counterpartyUuid || null;
		if (contactPersonUuid !== undefined)
			data.contactPersonUuid = contactPersonUuid || null;
		if (employeeUuid !== undefined) data.employeeUuid = employeeUuid || null;

		// Авто-вычисление ownerName при изменении FK-полей
		if (ownerName !== undefined) {
			data.ownerName = ownerName?.trim() ?? null;
		} else if (organizationUuid !== undefined || counterpartyUuid !== undefined || contactPersonUuid !== undefined || employeeUuid !== undefined) {
			// FK изменился — пересчитываем ownerName из актуальных FK
			const existing = await prisma.contact.findUnique({ where: isNumeric ? { id: numId } : { uuid: param } });
			const fks = {
				organizationUuid: organizationUuid !== undefined ? (organizationUuid || null) : existing?.organizationUuid,
				counterpartyUuid: counterpartyUuid !== undefined ? (counterpartyUuid || null) : existing?.counterpartyUuid,
				contactPersonUuid: contactPersonUuid !== undefined ? (contactPersonUuid || null) : existing?.contactPersonUuid,
				employeeUuid: employeeUuid !== undefined ? (employeeUuid || null) : existing?.employeeUuid,
			};
			data.ownerName = await resolveOwnerName(fks);
		}

		const item = await prisma.contact.update({
			where: isNumeric ? { id: numId } : { uuid: param },
			data,
			include: {
				contactType: true,
				organization: true,
				counterparty: true,
				contactPerson: true,
				employee: true,
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
