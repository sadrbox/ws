import express from "express";
import cors from "cors";
import { prisma } from "../../prisma/prisma-client.js";

const router = express.Router();
router.use(cors());

// ============================================
// GET /notifications — курсорная пагинация
// ============================================
router.get("/notifications", async (req, res) => {
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
			} catch {
				// Некорректный JSON
			}
		}

		if (orderBy.length === 0) {
			orderBy.push({ createdAt: "desc" });
		}

		// ── Поиск ─────────────────────────────────────────────────────────────
		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhereClause = {};

		if (searchWords.length > 0) {
			searchWhereClause = {
				AND: searchWords.map((word) => ({
					OR: [
						{ title: { contains: word, mode: "insensitive" } },
						{ message: { contains: word, mode: "insensitive" } },
					],
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
				} else if (field === "isRead" && operator === "equals") {
					filterWhereClause[field] = value === "true" || value === true;
				} else {
					filterWhereClause[field][operator] = value;
				}
			}
		}

		const baseWhere = {
			...searchWhereClause,
			...filterWhereClause,
		};

		const queryOptions = {
			take: limitNumber,
			where: baseWhere,
			include: {
				todo: true,
				user: true,
			},
			orderBy,
		};

		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const items = await prisma.notification.findMany(queryOptions);

		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		let total;
		if (cursorNumber === null) {
			total = await prisma.notification.count({ where: baseWhere });
		}

		return res.status(200).json({
			success: true,
			items,
			nextCursor,
			hasMore,
			...(total !== undefined ? { total } : {}),
		});
	} catch (error) {
		console.error("GET /notifications error:", error);
		return res.status(500).json({
			success: false,
			message: "Ошибка сервера при получении уведомлений",
		});
	}
});

// ============================================
// GET /notifications/unread-count?userUuid=xxx
// ============================================
router.get("/notifications/unread-count", async (req, res) => {
	try {
		const { userUuid } = req.query;
		if (!userUuid) return res.json({ success: true, count: 0 });

		const count = await prisma.notification.count({
			where: { userUuid: String(userUuid), isRead: false },
		});
		return res.json({ success: true, count });
	} catch (error) {
		console.error("GET /notifications/unread-count error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// PUT /notifications/:uuid/read
// ============================================
router.put("/notifications/:uuid/read", async (req, res) => {
	try {
		const item = await prisma.notification.update({
			where: { uuid: req.params.uuid },
			data: { isRead: true },
		});
		return res.json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025") {
			return res
				.status(404)
				.json({ success: false, message: "Уведомление не найдено" });
		}
		console.error("PUT /notifications/:uuid/read error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// PUT /notifications/read-all
// ============================================
router.put("/notifications/read-all", async (req, res) => {
	try {
		const { userUuid } = req.body;
		if (!userUuid) {
			return res
				.status(400)
				.json({ success: false, message: "userUuid обязателен" });
		}

		await prisma.notification.updateMany({
			where: { userUuid, isRead: false },
			data: { isRead: true },
		});
		return res.json({ success: true });
	} catch (error) {
		console.error("PUT /notifications/read-all error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// DELETE /notifications/:uuid
// ============================================
router.delete("/notifications/:uuid", async (req, res) => {
	try {
		await prisma.notification.delete({ where: { uuid: req.params.uuid } });
		return res.status(200).json({ success: true, message: "Удалено" });
	} catch (error) {
		if (error.code === "P2025") {
			return res
				.status(404)
				.json({ success: false, message: "Уведомление не найдено" });
		}
		console.error("DELETE /notifications error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
