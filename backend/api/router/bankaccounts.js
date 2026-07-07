import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { enrichWithOwnerName } from "../../utils/resolveOwnerName.js";
import { tenantFilter, orgQueryFilter } from "../../utils/auth.js";

const router = express.Router();

// Текстовые поля для полнотекстового поиска
const TEXT_FIELDS = ["name", "iban", "bik", "bankName"];

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

		// Primary items first when fetching for an owner
		if (typeof req.query.ownerUuid === "string" && req.query.ownerUuid.trim()) {
			orderBy.unshift({ isPrimary: "desc" });
		}

		// ── Поиск ─────────────────────────────────────────────────────────────
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

		// ── Фильтрация по ownerType + ownerUuid ────
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
			...orgQueryFilter(req),
		};

		// ── Курсорная пагинация ───────────────────────────────────────────────
		const queryOptions = {
			take: limitNumber,
			where: baseWhere,
			include: {
				currency: true,
			},
			orderBy,
		};

		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const items = await prisma.bankAccount.findMany(queryOptions);
		const enrichedItems = await enrichWithOwnerName(items);

		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		let total;
		if (cursorNumber === null) {
			total = await prisma.bankAccount.count({ where: baseWhere });
		}

		return res.status(200).json({
			success: true,
			items: enrichedItems,
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
				currency: true,
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
		const { name, iban, bik, bankName, kbe, currencyUuid, ownerType, ownerUuid } = req.body;

		if (!iban || typeof iban !== "string") {
			return res.status(400).json({ success: false, message: "IBAN обязателен" });
		}

		const orgUuid = req.user?.organizationUuid ?? null;
		const item = await prisma.bankAccount.create({
			data: {
				name: name?.trim() ?? null,
				iban: iban.trim(),
				bik: bik?.trim() ?? null,
				bankName: bankName?.trim() ?? null,
				kbe: kbe?.trim() ?? null,
				currencyUuid: currencyUuid ?? null,
				ownerType: ownerType?.trim() || null,
				ownerUuid: ownerUuid?.trim() || null,
				organizationUuid: orgUuid,
			},
			include: { currency: true },
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

		const { name, iban, bik, bankName, kbe, currencyUuid, ownerType, ownerUuid, isPrimary } = req.body;
		const data = {};

		if (name !== undefined) data.name = name?.trim() ?? null;
		if (iban !== undefined) data.iban = iban.trim();
		if (bik !== undefined) data.bik = bik?.trim() ?? null;
		if (bankName !== undefined) data.bankName = bankName?.trim() ?? null;
		if (kbe !== undefined) data.kbe = kbe?.trim() ?? null;
		if (currencyUuid !== undefined) data.currencyUuid = currencyUuid ?? null;
		if (ownerType !== undefined) data.ownerType = ownerType?.trim() || null;
		if (ownerUuid !== undefined) data.ownerUuid = ownerUuid?.trim() || null;
		if (isPrimary !== undefined) data.isPrimary = isPrimary === true;

		// When setting as primary, clear the flag on all other accounts of the same owner
		if (isPrimary === true) {
			const current = await prisma.bankAccount.findUnique({ where: whereClause, select: { ownerType: true, ownerUuid: true, uuid: true } });
			if (current?.ownerUuid) {
				await prisma.bankAccount.updateMany({
					where: { ownerType: current.ownerType, ownerUuid: current.ownerUuid, NOT: { uuid: current.uuid } },
					data: { isPrimary: false },
				});
			}
		}

		const item = await prisma.bankAccount.update({
			where: whereClause,
			data,
			include: { currency: true },
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
router.delete("/bankaccounts/:id", (req, res) =>
	handleDelete({
		req,
		res,
		prisma,
		modelName: "bankAccount",
		notFoundMessage: "Банковский счёт не найден",
	}),
);

// ── POST /bankaccounts/batch ──────────────────────────────────────────────
router.post("/bankaccounts/batch", async (req, res) => {
	try {
		const { operations } = req.body;
		if (!Array.isArray(operations) || operations.length === 0)
			return res.status(400).json({ success: false, message: "operations обязателен" });
		await prisma.$transaction(async (tx) => {
			for (const { action, uuid, data } of operations) {
				if (action === "create" && data) {
					await tx.bankAccount.create({
						data: {
							name: data.name?.trim() ?? null,
							iban: (data.iban ?? "").trim(),
							bik: data.bik?.trim() ?? null,
							bankName: data.bankName?.trim() ?? null,
							kbe: data.kbe?.trim() ?? null,
							currencyUuid: data.currencyUuid ?? null,
							ownerType: data.ownerType?.trim() || null,
							ownerUuid: data.ownerUuid?.trim() || null,
							organizationUuid: data.organizationUuid ?? null,
						},
					});
				} else if (action === "update" && uuid && data) {
					const updateData = {};
					if (data.name !== undefined) updateData.name = data.name?.trim() ?? null;
					if (data.iban !== undefined) updateData.iban = (data.iban ?? "").trim();
					if (data.bik !== undefined) updateData.bik = data.bik?.trim() ?? null;
					if (data.bankName !== undefined) updateData.bankName = data.bankName?.trim() ?? null;
					if (data.kbe !== undefined) updateData.kbe = data.kbe?.trim() ?? null;
					if (data.currencyUuid !== undefined) updateData.currencyUuid = data.currencyUuid ?? null;
					if (Object.keys(updateData).length > 0)
						await tx.bankAccount.update({ where: { uuid }, data: updateData });
				} else if (action === "delete" && uuid) {
					try { await tx.bankAccount.delete({ where: { uuid } }); } catch {}
				}
			}
		});
		return res.status(200).json({ success: true });
	} catch (error) {
		console.error("POST /bankaccounts/batch error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.post("/bankaccounts/batch-delete", (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: "bankAccount" }),
);

export default router;
