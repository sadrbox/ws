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

// ════════════════════════════════════════════════════════════════════════
// USER ORGANIZATIONS — вложенная таблица орг пользователя
// Доступно: суперадмин или org-admin своей организации
// ════════════════════════════════════════════════════════════════════════

// GET /users/:id/organizations — список орг пользователя
router.get("/users/:id/organizations", async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

		// Проверяем права: суперадмин или org-admin видит пользователей своей орг
		const isSuperAdmin = req.user?.isSuperAdmin;
		const isOrgAdmin = req.user?.isOrgAdmin;

		const items = await prisma.userPermission.findMany({
			where: {
				user: w,
				// Org-admin видит только своих пользователей
				...(!isSuperAdmin && isOrgAdmin
					? { organizationUuid: req.user.organizationUuid }
					: {}),
			},
			include: {
				organization: {
					select: { uuid: true, bin: true, name: true, displayName: true },
				},
			},
			orderBy: { createdAt: "asc" },
		});

		return res.json({ success: true, items });
	} catch (error) {
		console.error("GET /users/:id/organizations error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// POST /users/:id/organizations — добавить организацию пользователю
router.post("/users/:id/organizations", async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const { organizationUuid, role = "member" } = req.body;

		if (!organizationUuid) {
			return res.status(400).json({ success: false, message: "organizationUuid обязателен" });
		}

		// Только суперадмин может назначать admin-роль в чужих орг
		const isSuperAdmin = req.user?.isSuperAdmin;
		const isOrgAdmin = req.user?.isOrgAdmin;
		const callerOrgUuid = req.user?.organizationUuid;

		if (!isSuperAdmin) {
			// Org-admin может добавлять пользователей только в свою орг
			if (!isOrgAdmin || organizationUuid !== callerOrgUuid) {
				return res.status(403).json({ success: false, message: "Нет доступа" });
			}
			// Org-admin не может назначить роль выше своей
			if (role === "admin" && !isSuperAdmin) {
				return res.status(403).json({
					success: false,
					message: "Назначить роль admin может только суперадмин",
				});
			}
		}

		const targetUser = await prisma.user.findUnique({ where: w, select: { uuid: true } });
		if (!targetUser) {
			return res.status(404).json({ success: false, message: "Пользователь не найден" });
		}

		const item = await prisma.userPermission.upsert({
			where: {
				userUuid_organizationUuid: {
					userUuid: targetUser.uuid,
					organizationUuid,
				},
			},
			update: { role },
			create: { userUuid: targetUser.uuid, organizationUuid, role },
			include: {
				organization: {
					select: { uuid: true, bin: true, name: true, displayName: true },
				},
			},
		});

		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error("POST /users/:id/organizations error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// PUT /users/:id/organizations/:orgUuid — изменить роль
router.put("/users/:id/organizations/:orgUuid", async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const { orgUuid } = req.params;
		const { role } = req.body;

		if (!role) {
			return res.status(400).json({ success: false, message: "role обязателен" });
		}

		const isSuperAdmin = req.user?.isSuperAdmin;
		if (!isSuperAdmin && role === "admin") {
			return res.status(403).json({
				success: false,
				message: "Назначить роль admin может только суперадмин",
			});
		}

		const targetUser = await prisma.user.findUnique({ where: w, select: { uuid: true } });
		if (!targetUser) {
			return res.status(404).json({ success: false, message: "Пользователь не найден" });
		}

		const item = await prisma.userPermission.update({
			where: {
				userUuid_organizationUuid: {
					userUuid: targetUser.uuid,
					organizationUuid: orgUuid,
				},
			},
			data: { role },
			include: {
				organization: {
					select: { uuid: true, bin: true, name: true, displayName: true },
				},
			},
		});

		return res.json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Запись не найдена" });
		console.error("PUT /users/:id/organizations/:orgUuid error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// DELETE /users/:id/organizations/:orgUuid — убрать организацию у пользователя
router.delete("/users/:id/organizations/:orgUuid", async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const { orgUuid } = req.params;

		const isSuperAdmin = req.user?.isSuperAdmin;
		const isOrgAdmin = req.user?.isOrgAdmin;
		const callerOrgUuid = req.user?.organizationUuid;

		if (!isSuperAdmin && (!isOrgAdmin || orgUuid !== callerOrgUuid)) {
			return res.status(403).json({ success: false, message: "Нет доступа" });
		}

		const targetUser = await prisma.user.findUnique({ where: w, select: { uuid: true } });
		if (!targetUser) {
			return res.status(404).json({ success: false, message: "Пользователь не найден" });
		}

		await prisma.userPermission.delete({
			where: {
				userUuid_organizationUuid: {
					userUuid: targetUser.uuid,
					organizationUuid: orgUuid,
				},
			},
		});

		// Если удалили активную орг — сбрасываем её у пользователя
		const currentUser = await prisma.user.findUnique({
			where: { uuid: targetUser.uuid },
			select: { organizationUuid: true },
		});
		if (currentUser?.organizationUuid === orgUuid) {
			await prisma.user.update({
				where: { uuid: targetUser.uuid },
				data: { organizationUuid: null },
			});
		}

		return res.json({ success: true });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Запись не найдена" });
		console.error("DELETE /users/:id/organizations/:orgUuid error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// POST /users/:id/switch-organization — переключить активную организацию
router.post("/users/:id/switch-organization", async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const { organizationUuid } = req.body;

		// Проверяем что пользователь переключает только себя (или суперадмин)
		const callerUuid = req.user?.uuid;
		const targetUser = await prisma.user.findUnique({
			where: w,
			select: { uuid: true, userPermissions: { select: { organizationUuid: true } } },
		});
		if (!targetUser) {
			return res.status(404).json({ success: false, message: "Пользователь не найден" });
		}

		if (!req.user?.isSuperAdmin && targetUser.uuid !== callerUuid) {
			return res.status(403).json({ success: false, message: "Нет доступа" });
		}

		// Проверяем что организация входит в список доступных
		if (organizationUuid) {
			const allowed = targetUser.userPermissions.some(
				(uo) => uo.organizationUuid === organizationUuid,
			);
			if (!allowed && !req.user?.isSuperAdmin) {
				return res.status(403).json({
					success: false,
					message: "Эта организация недоступна для данного пользователя",
				});
			}
		}

		const item = await prisma.user.update({
			where: { uuid: targetUser.uuid },
			data: { organizationUuid: organizationUuid || null },
			select: { uuid: true, organizationUuid: true },
		});

		return res.json({ success: true, item });
	} catch (error) {
		console.error("POST /users/:id/switch-organization error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
