import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { checkOwnership } from "../../utils/auth.js";

const router = express.Router();

router.get("/contracts", async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const search =
			typeof req.query.search === "string" ? req.query.search.trim() : "";
		const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : 500;
		const limitNumber = Math.min(Math.max(parsedLimit, 1), 999999);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;
		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0)) {
			return res.status(400).json({ success: false, message: "bad cursor" });
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
			} catch {}
		}
		if (orderBy.length === 0) {
			orderBy.push({ id: "asc" });
		} else {
			if (!orderBy.some((o) => "id" in o)) orderBy.push({ id: "asc" });
		}

		// Primary items first when fetching for a counterparty
		if (typeof req.query.counterpartyUuid === "string" && req.query.counterpartyUuid.trim()) {
			orderBy.unshift({ isPrimary: "desc" });
		}

		const TEXT_FIELDS = ["name", "contractNumber"];
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

		const dateRange =
			filter.dateRange && typeof filter.dateRange === "object"
				? filter.dateRange
				: {};
		const startDate =
			typeof dateRange.startDate === "string" ? dateRange.startDate : null;
		const endDate =
			typeof dateRange.endDate === "string" ? dateRange.endDate : null;
		const dateRangeFilter =
			startDate || endDate
				? {
						startDate: {
							...(startDate ? { gte: new Date(startDate) } : {}),
							...(endDate ? { lte: new Date(endDate) } : {}),
						},
					}
				: {};

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

		// ── Фильтрация по organizationUuid / counterpartyUuid ────
		// Значение "null" (строка) означает «только записи без значения» (IS NULL).
		// Значение uuid → фильтр по конкретной записи.
		// Не передан параметр → нет фильтра.
		const fkFilter = {};
		if (
			typeof req.query.organizationUuid === "string" &&
			req.query.organizationUuid.trim()
		) {
			const orgVal = req.query.organizationUuid.trim();
			fkFilter.organizationUuid = orgVal === "null" ? null : orgVal;
		}
		if (
			typeof req.query.counterpartyUuid === "string" &&
			req.query.counterpartyUuid.trim()
		) {
			const cptyVal = req.query.counterpartyUuid.trim();
			if (cptyVal === "null") {
				// только договора без контрагента
				fkFilter.counterpartyUuid = null;
			} else {
				// договора этого контрагента ИЛИ общие (без контрагента)
				fkFilter.OR = [
					{ counterpartyUuid: cptyVal },
					{ counterpartyUuid: null },
				];
			}
		}

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
			include: { organization: true, counterparty: true },
		};
		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const items = await prisma.contract.findMany(queryOptions);
		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		let total;
		if (cursorNumber === null) {
			total = await prisma.contract.count({ where: baseWhere });
		}

		return res.status(200).json({
			success: true,
			items: items,
			nextCursor,
			hasMore,
			...(total !== undefined ? { total } : {}),
		});
	} catch (error) {
		console.error("GET /contracts error:", error);
		return res.status(500).json({ success: false, message: "Server error" });
	}
});

router.get("/contracts/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		const whereClause = isNumeric ? { id: numId } : { uuid: param };
		const item = await prisma.contract.findUnique({
			where: whereClause,
			include: { organization: true, counterparty: true },
		});
		if (!item || !checkOwnership(item, req))
			return res.status(404).json({ success: false, message: "Not found" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error("GET /contracts/:id error:", error);
		return res.status(500).json({ success: false, message: "Server error" });
	}
});

router.post("/contracts", async (req, res) => {
	try {
		const { name, contractNumber, contractText, startDate, endDate, organizationUuid, counterpartyUuid } = req.body;
		if (!name || typeof name !== "string")
			return res.status(400).json({ success: false, message: "name required" });

		const item = await prisma.contract.create({
			data: {
				name: name.trim(),
				contractNumber: contractNumber?.trim() ?? null,
				contractText: contractText ?? null,
				startDate: startDate ? new Date(startDate) : null,
				endDate: endDate ? new Date(endDate) : null,
				organizationUuid: organizationUuid || null,
				counterpartyUuid: counterpartyUuid || null,
			},
			include: { organization: true, counterparty: true },
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error("POST /contracts error:", error);
		return res.status(500).json({ success: false, message: "Server error" });
	}
});

router.put("/contracts/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		const whereClause = isNumeric ? { id: numId } : { uuid: param };
		const { name, contractNumber, contractText, startDate, endDate, organizationUuid, counterpartyUuid, isPrimary } = req.body;

		const data = {};
		if (name !== undefined) data.name = name.trim();
		if (contractNumber !== undefined) data.contractNumber = contractNumber?.trim() ?? null;
		if (contractText !== undefined) data.contractText = contractText ?? null;
		if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
		if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
		if (organizationUuid !== undefined) data.organizationUuid = organizationUuid || null;
		if (counterpartyUuid !== undefined) data.counterpartyUuid = counterpartyUuid || null;
		if (isPrimary !== undefined) data.isPrimary = isPrimary === true;

		// When setting as primary, clear the flag on all other contracts of the same counterparty
		if (isPrimary === true) {
			const current = await prisma.contract.findUnique({ where: whereClause, select: { counterpartyUuid: true, uuid: true } });
			if (current?.counterpartyUuid) {
				await prisma.contract.updateMany({
					where: { counterpartyUuid: current.counterpartyUuid, NOT: { uuid: current.uuid } },
					data: { isPrimary: false },
				});
			}
		}

		const preCheck = await prisma.contract.findUnique({ where: whereClause, select: { organizationUuid: true } });
		if (!preCheck || !checkOwnership(preCheck, req))
			return res.status(404).json({ success: false, message: "Not found" });
		const item = await prisma.contract.update({
			where: whereClause,
			data,
			include: { organization: true, counterparty: true },
		});
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Not found" });
		console.error("PUT /contracts/:id error:", error);
		return res.status(500).json({ success: false, message: "Server error" });
	}
});

router.delete("/contracts/:id", (req, res) =>
	handleDelete({
		req,
		res,
		prisma,
		modelName: "contract",
		notFoundMessage: "Not found",
	}),
);

// ── POST /contracts/batch ─────────────────────────────────────────────────
router.post("/contracts/batch", async (req, res) => {
	try {
		const { operations } = req.body;
		if (!Array.isArray(operations) || operations.length === 0)
			return res.status(400).json({ success: false, message: "operations обязателен" });
		await prisma.$transaction(async (tx) => {
			for (const { action, uuid, data } of operations) {
				if (action === "create" && data) {
					await tx.contract.create({
						data: {
							name: (data.name ?? "").trim(),
							contractNumber: data.contractNumber?.trim() ?? null,
							contractText: data.contractText ?? null,
							startDate: data.startDate ? new Date(data.startDate) : null,
							endDate: data.endDate ? new Date(data.endDate) : null,
							organizationUuid: data.organizationUuid || null,
							counterpartyUuid: data.counterpartyUuid || null,
						},
					});
				} else if (action === "update" && uuid && data) {
					const updateData = {};
					if (data.name !== undefined) updateData.name = (data.name ?? "").trim();
					if (data.contractNumber !== undefined) updateData.contractNumber = data.contractNumber?.trim() ?? null;
					if (data.contractText !== undefined) updateData.contractText = data.contractText ?? null;
					if (data.startDate !== undefined) updateData.startDate = data.startDate ? new Date(data.startDate) : null;
					if (data.endDate !== undefined) updateData.endDate = data.endDate ? new Date(data.endDate) : null;
					if (data.organizationUuid !== undefined) updateData.organizationUuid = data.organizationUuid || null;
					if (data.counterpartyUuid !== undefined) updateData.counterpartyUuid = data.counterpartyUuid || null;
					if (Object.keys(updateData).length > 0)
						await tx.contract.update({ where: { uuid }, data: updateData });
				} else if (action === "delete" && uuid) {
					try { await tx.contract.delete({ where: { uuid } }); } catch {}
				}
			}
		});
		return res.status(200).json({ success: true });
	} catch (error) {
		console.error("POST /contracts/batch error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.post("/contracts/batch-delete", (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: "contract" }),
);

export default router;
