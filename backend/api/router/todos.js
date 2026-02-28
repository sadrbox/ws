import express from "express";
import cors from "cors";
import { prisma } from "../../prisma/prisma-client.js";

const router = express.Router();
router.use(cors());

const TEXT_FIELDS = ["shortName", "description", "ownerName", "status"];

const INCLUDE = {
	organization: true,
	counterparty: true,
	curator: true,
	executor: true,
	files: true,
};

// ============================================
// GET /todos — курсорная пагинация
// ============================================
router.get("/todos", async (req, res) => {
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
			orderBy.push({ id: "desc" });
		} else {
			const hasId = orderBy.some((o) => "id" in o);
			if (!hasId) orderBy.push({ id: "desc" });
		}

		// ── Поиск ─────────────────────────────────────────────────────────────
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
			...filterWhereClause,
		};

		// ── Курсорная пагинация ───────────────────────────────────────────────
		const queryOptions = {
			take: limitNumber,
			where: baseWhere,
			include: INCLUDE,
			orderBy,
		};

		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const items = await prisma.todo.findMany(queryOptions);

		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		let total;
		if (cursorNumber === null) {
			total = await prisma.todo.count({ where: baseWhere });
		}

		return res.status(200).json({
			success: true,
			items,
			nextCursor,
			hasMore,
			...(total !== undefined ? { total } : {}),
		});
	} catch (error) {
		console.error("GET /todos error:", error);
		return res.status(500).json({
			success: false,
			message: "Ошибка сервера при получении задач",
		});
	}
});

// ============================================
// GET /todos/:id
// ============================================
router.get("/todos/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		const whereClause = isNumeric ? { id: numId } : { uuid: param };

		const item = await prisma.todo.findUnique({
			where: whereClause,
			include: INCLUDE,
		});

		if (!item) {
			return res
				.status(404)
				.json({ success: false, message: "Задача не найдена" });
		}

		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error("GET /todos/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// POST /todos
// ============================================
router.post("/todos", async (req, res) => {
	try {
		const {
			shortName,
			description,
			status,
			organizationUuid,
			counterpartyUuid,
			curatorUuid,
			executorUuid,
			deadline,
			deadlineDays,
			ownerName,
		} = req.body;

		const item = await prisma.todo.create({
			data: {
				shortName: shortName?.trim() ?? null,
				description: description?.trim() ?? null,
				status: status || "new",
				organizationUuid: organizationUuid || null,
				counterpartyUuid: counterpartyUuid || null,
				curatorUuid: curatorUuid || null,
				executorUuid: executorUuid || null,
				deadline: deadline ? new Date(deadline) : null,
				deadlineDays: deadlineDays ? parseInt(deadlineDays) : null,
				ownerName: ownerName?.trim() ?? null,
			},
			include: INCLUDE,
		});

		// Уведомление исполнителю
		if (executorUuid) {
			await prisma.notification.create({
				data: {
					userUuid: executorUuid,
					todoUuid: item.uuid,
					title: "Новая задача",
					message: `Вам назначена задача: ${shortName || "Без названия"}`,
				},
			});
		}

		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error("POST /todos error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// PUT /todos/:id
// ============================================
router.put("/todos/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		const whereClause = isNumeric ? { id: numId } : { uuid: param };

		const existing = await prisma.todo.findUnique({ where: whereClause });
		if (!existing) {
			return res
				.status(404)
				.json({ success: false, message: "Задача не найдена" });
		}

		const {
			shortName,
			description,
			status,
			organizationUuid,
			counterpartyUuid,
			curatorUuid,
			executorUuid,
			deadline,
			deadlineDays,
			ownerName,
		} = req.body;

		const data = {};
		if (shortName !== undefined) data.shortName = shortName?.trim() ?? null;
		if (description !== undefined)
			data.description = description?.trim() ?? null;
		if (status !== undefined) data.status = status;
		if (organizationUuid !== undefined)
			data.organizationUuid = organizationUuid || null;
		if (counterpartyUuid !== undefined)
			data.counterpartyUuid = counterpartyUuid || null;
		if (curatorUuid !== undefined) data.curatorUuid = curatorUuid || null;
		if (executorUuid !== undefined) data.executorUuid = executorUuid || null;
		if (deadline !== undefined)
			data.deadline = deadline ? new Date(deadline) : null;
		if (deadlineDays !== undefined)
			data.deadlineDays = deadlineDays ? parseInt(deadlineDays) : null;
		if (ownerName !== undefined) data.ownerName = ownerName?.trim() ?? null;

		const item = await prisma.todo.update({
			where: whereClause,
			data,
			include: INCLUDE,
		});

		// Уведомление при смене исполнителя
		if (executorUuid && executorUuid !== existing.executorUuid) {
			await prisma.notification.create({
				data: {
					userUuid: executorUuid,
					todoUuid: item.uuid,
					title: "Назначена задача",
					message: `Вам назначена задача: ${item.shortName || "Без названия"}`,
				},
			});
		}

		// Уведомление куратору при смене статуса
		if (status && status !== existing.status && existing.curatorUuid) {
			await prisma.notification.create({
				data: {
					userUuid: existing.curatorUuid,
					todoUuid: item.uuid,
					title: "Статус задачи изменён",
					message: `Задача «${item.shortName || "Без названия"}» — ${status}`,
				},
			});
		}

		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025") {
			return res
				.status(404)
				.json({ success: false, message: "Задача не найдена" });
		}
		console.error("PUT /todos/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// DELETE /todos/:id
// ============================================
router.delete("/todos/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		const whereClause = isNumeric ? { id: numId } : { uuid: param };

		await prisma.todo.delete({ where: whereClause });

		return res.status(200).json({ success: true, message: "Удалено" });
	} catch (error) {
		if (error.code === "P2025") {
			return res
				.status(404)
				.json({ success: false, message: "Задача не найдена" });
		}
		console.error("DELETE /todos/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
