import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = express.Router();

// ── Avatar upload setup ─────────────────────────────────────────────────
const AVATAR_DIR = path.resolve("uploads/avatars");
if (!fs.existsSync(AVATAR_DIR)) {
	fs.mkdirSync(AVATAR_DIR, { recursive: true });
}
const avatarStorage = multer.diskStorage({
	destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
	filename: (_req, file, cb) => cb(null, `user_${Date.now()}_${file.originalname}`),
});
const avatarUpload = multer({
	storage: avatarStorage,
	limits: { fileSize: 5 * 1024 * 1024 },
	fileFilter: (_req, file, cb) => {
		if (file.mimetype.startsWith("image/")) cb(null, true);
		else cb(new Error("Только изображения"));
	},
});

// ============================================
// GET /users — курсорная пагинация
// ============================================
router.get("/users", async (req, res) => {
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
		const TEXT_FIELDS = ["username"];
		const EMPLOYEE_TEXT_FIELDS = [
			"fullName",
			"lastName",
			"firstName",
			"middleName",
			"iin",
		];
		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhereClause = {};

		if (searchWords.length > 0) {
			searchWhereClause = {
				AND: searchWords.map((word) => {
					const orConditions = [
						...TEXT_FIELDS.map((f) => ({
							[f]: { contains: word, mode: "insensitive" },
						})),
						...EMPLOYEE_TEXT_FIELDS.map((f) => ({
							employee: { [f]: { contains: word, mode: "insensitive" } },
						})),
					];
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

		// ── Итоговый where ────────────────────────────────────────────────────
		const baseWhere = {
			...searchWhereClause,
			...dateRangeFilter,
			...filterWhereClause,
		};

		const queryOptions = {
			take: limitNumber,
			where: baseWhere,
			orderBy,
			select: {
				id: true,
				uuid: true,
				username: true,
				employeeUuid: true,
				employee: true,
				// password excluded from list queries
			},
		};

		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const items = await prisma.user.findMany(queryOptions);

		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		let total;
		if (cursorNumber === null) {
			total = await prisma.user.count({ where: baseWhere });
		}

		return res.status(200).json({
			success: true,
			items,
			nextCursor,
			hasMore,
			...(total !== undefined ? { total } : {}),
		});
	} catch (error) {
		console.error("GET /users error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// GET /users/:id — поиск по ID или UUID
// ============================================
router.get("/users/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;

		const item = isNumeric
			? await prisma.user.findUnique({
					where: { id: numId },
					include: { employee: true },
				})
			: await prisma.user.findUnique({
					where: { uuid: param },
					include: { employee: true },
				});

		if (!item) {
			return res
				.status(404)
				.json({ success: false, message: "Пользователь не найден" });
		}

		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error("GET /users/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// POST /users
// ============================================
router.post("/users", async (req, res) => {
	try {
		const { username, password, employeeUuid } = req.body;

		if (!username || typeof username !== "string" || !username.trim()) {
			return res
				.status(400)
				.json({ success: false, message: "Логин обязателен" });
		}

		const item = await prisma.user.create({
			data: {
				username: username.trim(),
				password: password?.trim() || "",
				employeeUuid: employeeUuid || null,
			},
			select: {
				id: true,
				uuid: true,
				username: true,
				employeeUuid: true,
				employee: true,
			},
		});

		return res.status(201).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2002") {
			return res.status(409).json({
				success: false,
				message: "Пользователь с таким логином уже существует",
			});
		}
		console.error("POST /users error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// PUT /users/:id
// ============================================
router.put("/users/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;

		const { username, password, employeeUuid } = req.body;
		const data = {};
		if (username !== undefined) data.username = username?.trim() ?? null;
		if (password !== undefined && password.trim())
			data.password = password.trim();
		if (employeeUuid !== undefined) data.employeeUuid = employeeUuid || null;

		const item = await prisma.user.update({
			where: isNumeric ? { id: numId } : { uuid: param },
			data,
			select: {
				id: true,
				uuid: true,
				username: true,
				employeeUuid: true,
				employee: true,
			},
		});

		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025") {
			return res
				.status(404)
				.json({ success: false, message: "Пользователь не найден" });
		}
		console.error("PUT /users/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// DELETE /users/:id
// ============================================
router.delete("/users/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;

		await prisma.user.delete({
			where: isNumeric ? { id: numId } : { uuid: param },
		});

		return res.status(200).json({ success: true, message: "Удалено" });
	} catch (error) {
		if (error.code === "P2025") {
			return res
				.status(404)
				.json({ success: false, message: "Пользователь не найден" });
		}
		console.error("DELETE /users/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST avatar ─────────────────────────────────────────────────────────
router.post("/users/:id/avatar", avatarUpload.single("avatar"), async (req, res) => {
	try {
		if (!req.file) return res.status(400).json({ success: false, message: "Файл не передан" });
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

		const existing = await prisma.user.findUnique({ where: w });
		if (existing?.avatarPath) {
			const oldPath = path.resolve(AVATAR_DIR, existing.avatarPath);
			if (oldPath.startsWith(AVATAR_DIR) && fs.existsSync(oldPath)) {
				fs.unlinkSync(oldPath);
			}
		}

		const item = await prisma.user.update({
			where: w,
			data: { avatarPath: req.file.filename },
			include: { employee: true },
		});
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
		console.error("POST /users/:id/avatar error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET avatar ──────────────────────────────────────────────────────────
router.get("/users/:id/avatar", async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const user = await prisma.user.findUnique({ where: w });
		if (!user?.avatarPath) return res.status(404).json({ success: false, message: "Аватар не найден" });
		const filePath = path.resolve(AVATAR_DIR, user.avatarPath);
		if (!filePath.startsWith(AVATAR_DIR) || !fs.existsSync(filePath)) {
			return res.status(404).json({ success: false, message: "Файл не найден" });
		}
		return res.sendFile(filePath);
	} catch (error) {
		console.error("GET /users/:id/avatar error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE avatar ───────────────────────────────────────────────────────
router.delete("/users/:id/avatar", async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const existing = await prisma.user.findUnique({ where: w });
		if (existing?.avatarPath) {
			const filePath = path.resolve(AVATAR_DIR, existing.avatarPath);
			if (filePath.startsWith(AVATAR_DIR) && fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
			}
		}
		const item = await prisma.user.update({
			where: w,
			data: { avatarPath: null },
			include: { employee: true },
		});
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
		console.error("DELETE /users/:id/avatar error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
