import express from "express";
import cors from "cors";
import { prisma } from "../../prisma/prisma-client.js";

const router = express.Router();
router.use(cors());

// ============================================
// GET /bankaccounts — курсорная пагинация
// ============================================
router.get("/bankaccounts", async (req, res) => {
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
						if (field.includes(".")) {
							const parts = field.split(".");
							let nested = { [parts[parts.length - 1]]: dir };
							for (let i = parts.length - 2; i >= 0; i--) {
								nested = { [parts[i]]: nested };
							}
							orderBy.push(nested);
						} else {
							orderBy.push({ [field]: dir });
						}
					}
				}
			} catch {
				// Некорректный JSON — игнорируем
			}
		}

		if (orderBy.length === 0) {
			orderBy.push({ id: "asc" });
		} else {
			const hasId = orderBy.some((o) => "id" in o);
			if (!hasId) orderBy.push({ id: "asc" });
		}

		// ── Поиск ─────────────────────────────────────────────────────────────
		const TEXT_FIELDS = [
			"shortName",
			"iban",
			"bik",
			"bankName",
			"currency",
			"accountType",
			"ownerName",
		];
		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhereClause = {};

		if (searchWords.length > 0) {
			searchWhereClause = {
				AND: searchWords.map((word) => ({
					OR: TEXT_FIELDS.map((field) => ({
						[field]: { contains: word, mode: "insensitive" },
					})),
				})),
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

		// ── Итоговый where ────────────────────────────────────────────────────
		const baseWhere = {
			...searchWhereClause,
			...dateRangeFilter,
			...filterWhereClause,
		};

		// ── Курсорная пагинация ───────────────────────────────────────────────
		const queryOptions = {
			take: limitNumber,
			where: baseWhere,
			include: {
				organization: true,
				counterparty: true,
			},
			orderBy,
		};

		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const items = await prisma.bankAccount.findMany(queryOptions);

		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		let total;
		if (cursorNumber === null) {
			total = await prisma.bankAccount.count({ where: baseWhere });
		}

		return res.status(200).json({
			success: true,
			items,
			nextCursor,
			hasMore,
			...(total !== undefined ? { total } : {}),
		});
	} catch (error) {
		console.error("GET /bankaccounts error:", error);
		return res.status(500).json({
			success: false,
			message: "Ошибка сервера при получении банковских счетов",
		});
	}
});

// ============================================
// GET /bankaccounts/:id
// ============================================
router.get("/bankaccounts/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		const whereClause = isNumeric ? { id: numId } : { uuid: param };

		const item = await prisma.bankAccount.findUnique({
			where: whereClause,
			include: {
				organization: true,
				counterparty: true,
			},
		});

		if (!item) {
			return res
				.status(404)
				.json({ success: false, message: "Банковский счёт не найден" });
		}

		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error("GET /bankaccounts/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// POST /bankaccounts
// ============================================
router.post("/bankaccounts", async (req, res) => {
	try {
		const {
			shortName,
			iban,
			bik,
			bankName,
			currency,
			accountType,
			ownerName,
			organizationUuid,
			counterpartyUuid,
		} = req.body;

		if (!iban || typeof iban !== "string") {
			return res.status(400).json({
				success: false,
				message: "IBAN обязателен",
			});
		}

		const item = await prisma.bankAccount.create({
			data: {
				shortName: shortName?.trim() ?? null,
				iban: iban.trim(),
				bik: bik?.trim() ?? null,
				bankName: bankName?.trim() ?? null,
				currency: currency?.trim() ?? null,
				accountType: accountType?.trim() ?? null,
				ownerName: ownerName?.trim() ?? null,
				organizationUuid: organizationUuid ?? null,
				counterpartyUuid: counterpartyUuid ?? null,
			},
			include: {
				organization: true,
				counterparty: true,
			},
		});

		return res.status(201).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2002") {
			return res.status(409).json({
				success: false,
				message: "Такой IBAN уже существует для данного владельца",
			});
		}
		console.error("POST /bankaccounts error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// PUT /bankaccounts/:id
// ============================================
router.put("/bankaccounts/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		const whereClause = isNumeric ? { id: numId } : { uuid: param };

		const {
			shortName,
			iban,
			bik,
			bankName,
			currency,
			accountType,
			ownerName,
			organizationUuid,
			counterpartyUuid,
		} = req.body;
		const data = {};

		if (shortName !== undefined) data.shortName = shortName?.trim() ?? null;
		if (iban !== undefined) data.iban = iban.trim();
		if (bik !== undefined) data.bik = bik?.trim() ?? null;
		if (bankName !== undefined) data.bankName = bankName?.trim() ?? null;
		if (currency !== undefined) data.currency = currency?.trim() ?? null;
		if (accountType !== undefined)
			data.accountType = accountType?.trim() ?? null;
		if (ownerName !== undefined) data.ownerName = ownerName?.trim() ?? null;
		if (organizationUuid !== undefined)
			data.organizationUuid = organizationUuid ?? null;
		if (counterpartyUuid !== undefined)
			data.counterpartyUuid = counterpartyUuid ?? null;

		const item = await prisma.bankAccount.update({
			where: whereClause,
			data,
			include: {
				organization: true,
				counterparty: true,
			},
		});

		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025") {
			return res
				.status(404)
				.json({ success: false, message: "Банковский счёт не найден" });
		}
		console.error("PUT /bankaccounts/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// DELETE /bankaccounts/:id
// ============================================
router.delete("/bankaccounts/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		const whereClause = isNumeric ? { id: numId } : { uuid: param };

		await prisma.bankAccount.delete({ where: whereClause });

		return res.status(200).json({ success: true, message: "Удалено" });
	} catch (error) {
		if (error.code === "P2025") {
			return res
				.status(404)
				.json({ success: false, message: "Банковский счёт не найден" });
		}
		console.error("DELETE /bankaccounts/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// GET /bankaccounts
// ============================================
router.get("/", async (req, res) => {
	try {
		const {
			search,
			sortField,
			sortOrder,
			page = 1,
			limit = 50,
			ownerUuid,
			ownerField,
		} = req.query;

		const where = {};

		if (ownerUuid && ownerField) {
			where[ownerField] = ownerUuid;
		}

		if (search) {
			where.OR = TEXT_FIELDS.map((field) => ({
				[field]: { contains: search, mode: "insensitive" },
			}));
		}

		const totalCount = await prisma.bankAccount.count({ where });
		const items = await prisma.bankAccount.findMany({
			where,
			orderBy: sortField ? { [sortField]: sortOrder || "asc" } : { id: "asc" },
			skip: (parseInt(page) - 1) * parseInt(limit),
			take: parseInt(limit),
		});

		res.json({ items, totalCount });
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: "Ошибка при получении банковских счетов" });
	}
});

export default router;
