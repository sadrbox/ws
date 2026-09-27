import express from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { idSearchCondition } from "../../utils/searchId.js";
import { prisma } from "../../prisma/prisma-client.js";
import { getQuotas, exceeds } from "../../services/quotas.js";
import { isAdminOfOrg } from "../../utils/auth.js";
import { clampLimit } from "../../utils/listQuery.js";
import { grantMembership, normalizeRole } from "../../services/orgMembership.js";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = express.Router();

// ── Avatar upload setup ─────────────────────────────────────────────────
const AVATAR_DIR = path.resolve("uploads/avatars");
if (!fs.existsSync(AVATAR_DIR)) {
	fs.mkdirSync(AVATAR_DIR, { recursive: true });
}
// Имя файла — только сервера: расширение из белого списка, а не из `originalname` клиента;
// SVG не принимаем вовсе (это документ со скриптами, а не картинка).
const AVATAR_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };
const avatarStorage = multer.diskStorage({
	destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
	filename: (_req, file, cb) => cb(null, `user_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${AVATAR_EXT[file.mimetype] ?? ".img"}`),
});
const avatarUpload = multer({
	storage: avatarStorage,
	limits: { fileSize: 5 * 1024 * 1024 },
	fileFilter: (_req, file, cb) => {
		if (AVATAR_EXT[file.mimetype]) cb(null, true);
		else cb(new Error("Только изображения PNG, JPEG, GIF или WebP"));
	},
});

/*
 * ПОЛЬЗОВАТЕЛИ: ЧТО ВИДНО И ЧТО МОЖНО (Б3 аудита 26.09).
 *
 * Раньше список отдавал всех пользователей установки с карточкой сотрудника (ИИН), карточка —
 * хэш пароля и секрет 2FA, а PUT/DELETE работали по любому id: админ своей фирмы менял пароль
 * суперадмину. Теперь:
 *   - видно — себя и тех, кто состоит в доступных организациях; суперадмин — всех;
 *   - секреты (пароль, секрет 2FA) не выбираются из базы для ответа никогда: только явный select;
 *   - filter и sort — по белому списку полей (раньше по `password` можно было подбирать хэш:
 *     `total` в ответе работал как оракул);
 *   - править и удалять — администратор организации, где состоит пользователь (удалять —
 *     только если все его организации под рукой этого администратора), суперадмина — только
 *     суперадмин; чужой пароль задаёт только суперадмин (свой — /auth/change-password);
 *   - пароль пишется только хэшем bcrypt.
 */
// ИИН остаётся: колонка списка пользователей его показывает, а видны только свои пользователи.
const SAFE_EMPLOYEE_SELECT = {
	uuid: true, fullName: true, firstName: true, lastName: true, middleName: true, iin: true,
	organizationUuid: true, avatarPath: true,
};
const EMPLOYEE_SORT_FIELDS = ["fullName", "lastName", "firstName", "middleName", "iin"];
const SAFE_USER_SELECT = {
	id: true,
	uuid: true,
	username: true,
	email: true,
	employeeUuid: true,
	avatarPath: true,
	organizationUuid: true,
	twoFactorEnabled: true,
	createdAt: true,
	updatedAt: true,
	employee: { select: SAFE_EMPLOYEE_SELECT },
};
/** Поля, по которым разрешены filter и sort. Секретов здесь нет и быть не должно. */
export const USER_QUERY_FIELDS = ["id", "uuid", "username", "email", "employeeUuid", "createdAt", "updatedAt"];

/**
 * Условие «пользователь виден вызывающему». null — видны все (суперадмин, если ему открыты данные).
 *
 * Видны участники ВСЕХ доступных организаций (членство и обслуживание), а не только активной:
 * сотрудник фирмы, работающий в клиенте, назначает исполнителем коллегу по фирме — тот в клиенте
 * не состоит. Посторонние организации установки при этом не видны.
 */
export function userVisibilityWhere(req) {
	if (req.user?.isSuperAdmin && req.user?.operatorDataAccess !== false) return null;
	const orgs = [...new Set([req.user?.organizationUuid, ...(req.user?.allowedOrgUuids ?? [])].filter(Boolean))];
	return { OR: [{ accessRights: { some: { organizationUuid: { in: orgs } } } }, { uuid: req.user?.uuid ?? "__none__" }] };
}

/** Найти пользователя по id/uuid С УЧЁТОМ видимости; null — нет или не виден (404). */
async function findVisibleUser(req, param, select = { uuid: true, isSuperAdmin: true, accessRights: { select: { organizationUuid: true } } }) {
	const n = Number(param);
	const key = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: String(param) };
	const vis = userVisibilityWhere(req);
	return prisma.user.findFirst({ where: vis ? { AND: [key, vis] } : key, select });
}

/**
 * Кого администратор может ДОБАВИТЬ в свою организацию: видимого ему пользователя или ещё ни
 * в одной организации не состоящего (только что заведённого). Раньше годился любой id — и
 * перебором числовых id посторонние пользователи втягивались в чужую фирму.
 */
async function findAddableUser(req, param) {
	const visible = await findVisibleUser(req, param, { uuid: true });
	if (visible) return visible;
	const n = Number(param);
	const key = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: String(param) };
	return prisma.user.findFirst({ where: { AND: [key, { accessRights: { none: {} } }, { isSuperAdmin: false }] }, select: { uuid: true } });
}

/**
 * Распоряжается ли вызывающий этим пользователем: суперадмин — всеми; админ организации —
 * пользователями, состоящими в его организации; суперадмина трогает только суперадмин.
 * @param {"edit"|"delete"} mode — удалять можно, только если ВСЕ организации пользователя
 *   под рукой вызывающего: иначе админ одной фирмы стёр бы сотрудника другой.
 */
export function canManageUser(req, target, mode = "edit") {
	if (req.user?.isSuperAdmin) return true;
	if (!target || target.isSuperAdmin) return false;
	const orgs = (target.accessRights ?? []).map((r) => r.organizationUuid);
	if (!orgs.length) return false;
	return mode === "delete"
		? orgs.every((o) => isAdminOfOrg(req, o))
		: orgs.some((o) => isAdminOfOrg(req, o));
}

async function hashPassword(raw) {
	return bcrypt.hash(raw, 12);
}

// ============================================
// GET /users — курсорная пагинация
// ============================================
router.get("/users", async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const search =
			typeof req.query.search === "string" ? req.query.search.trim() : "";

		const limitNumber = clampLimit(rawLimit);
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
						// Только белый список: сортировка по секретному полю — тот же оракул, что и фильтр.
						if (USER_QUERY_FIELDS.includes(field)) orderBy.push({ [field]: dir });
						else if (field.startsWith("employee.") && EMPLOYEE_SORT_FIELDS.includes(field.slice(9))) {
							orderBy.push({ employee: { [field.slice(9)]: dir } });
						}
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
					const idNum = idSearchCondition(word);
					if (idNum) orConditions.push(idNum);
					return { OR: orConditions };
				}),
			};
		}

		// ── Фильтр по дате ────────────────────────────────────────────────────
		const dateRangeFilter = {};

		// ── Произвольные фильтры ──────────────────────────────────────────────
		const ALLOWED_OPERATORS = ["contains", "equals", "gte", "lte", "gt", "lt"];
		const SKIP_KEYS = ["searchBy", "dateRange"];
		const filterWhereClause = {};

		for (const [field, conditions] of Object.entries(filter)) {
			if (SKIP_KEYS.includes(field)) continue;
			if (!conditions || typeof conditions !== "object") continue;
			// Белый список полей: раньше `filter[password][gte]=…` вместе с `total` позволял
			// подобрать хэш пароля и секрет 2FA посимвольно.
			if (!USER_QUERY_FIELDS.includes(field)) {
				return res.status(400).json({ success: false, message: `Неизвестное поле фильтра «${field}»` });
			}

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
		const visibility = userVisibilityWhere(req);
		const baseWhere = {
			...searchWhereClause,
			...dateRangeFilter,
			...filterWhereClause,
			...(visibility ? { AND: [...(searchWhereClause.AND ?? []), visibility] } : {}),
		};

		const queryOptions = {
			take: limitNumber,
			where: baseWhere,
			orderBy,
			select: {
				...SAFE_USER_SELECT,
				// Пароль читаем, но НАРУЖУ НЕ ОТДАЁМ (см. ниже): из него нужен один бит —
				// «под этой учётной записью вообще можно войти».
				password: true,
			},
		};

		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const rows = await prisma.user.findMany(queryOptions);
		/*
		 * УЧЁТНАЯ ЗАПИСЬ, ЗАВЕДЁННАЯ ИНТЕГРАЦИЕЙ (ПН3). Автор задачи или события из 1С — реальный
		 * пользователь ERP, созданный по имени с пустым паролем: войти под ним нельзя, он
		 * существует, чтобы у записи был автор. В списке такие выглядели как брошенные учётки, и
		 * их порывались удалять — вместе с авторством всего, что они успели создать.
		 *
		 * Наружу уходит признак, а не пароль: хеш из списка не показывают никому и никогда.
		 */
		const items = rows.map(({ password, ...user }) => ({ ...user, isIntegration: !password }));

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
		// Видимость — как у списка; наружу — только безопасные поля (без хэша и секрета 2FA).
		const item = await findVisibleUser(req, req.params.id, SAFE_USER_SELECT);

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

		/*
		 * КВОТА ПОЛЬЗОВАТЕЛЕЙ (И3 плана INSTALL_MODES).
		 *
		 * На общем сервере арендаторы делят один процесс и одну базу, и число учётных записей —
		 * самый простой способ съесть чужое. Предел назначается осознанно (0 или пусто — без
		 * предела), поэтому на своей установке клиента ничего не меняется.
		 *
		 * Считаем по ЧЛЕНСТВАМ в организации, а не по всем пользователям базы: в режиме группы
		 * один человек состоит в нескольких организациях, и общий счётчик врал бы каждой.
		 */
		const quotaOrg = req.user?.organizationUuid ?? null;
		if (quotaOrg) {
			const { users: limit } = await getQuotas(quotaOrg);
			if (limit) {
				const current = await prisma.accessRight.count({ where: { organizationUuid: quotaOrg } });
				if (exceeds(current, limit, 1)) {
					return res.status(409).json({
						success: false,
						code: "QUOTA_EXCEEDED",
						message: `Достигнут предел числа пользователей организации (${limit})`,
					});
				}
			}
		}

		/*
		 * НОВЫЙ ПОЛЬЗОВАТЕЛЬ СРАЗУ В ОРГАНИЗАЦИИ ТОГО, КТО ЕГО ЗАВЁЛ (Б3 аудита 26.09).
		 *
		 * Список пользователей теперь показывает только состоящих в доступных организациях, и
		 * заведённый без связи пропал бы из виду у собственного создателя. Администратор может
		 * добавлять людей только в активную организацию (как и в /access-rights), поэтому связь
		 * с ней — единственно возможный итог; права не выдаём (profile: null) — как и раньше,
		 * их проставляет администратор. Суперадмин заводит пользователей без организации.
		 */
		const ownerOrg = req.user?.isSuperAdmin ? null : (req.user?.organizationUuid ?? null);
		if (!req.user?.isSuperAdmin && !isAdminOfOrg(req, ownerOrg)) {
			return res.status(403).json({ success: false, message: "Заводить пользователей может администратор организации" });
		}

		// Пароль — только хэшем: открытый текст в базе раньше лежал до первого входа.
		const rawPassword = typeof password === "string" ? password.trim() : "";
		const hashed = rawPassword ? await hashPassword(rawPassword) : "";
		const item = await prisma.$transaction(async (tx) => {
			const created = await tx.user.create({
				data: {
					username: username.trim(),
					password: hashed,
					employeeUuid: employeeUuid || null,
				},
				select: SAFE_USER_SELECT,
			});
			if (ownerOrg) await grantMembership(tx, { userUuid: created.uuid, organizationUuid: ownerOrg, role: "member", profile: null });
			return created;
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
		const target = await findVisibleUser(req, req.params.id);
		if (!target) {
			return res.status(404).json({ success: false, message: "Пользователь не найден" });
		}
		if (!canManageUser(req, target, "edit")) {
			return res.status(403).json({ success: false, message: "Править этого пользователя может администратор его организации" });
		}

		const { username, password, employeeUuid } = req.body;
		const data = {};
		if (username !== undefined) data.username = username?.trim() ?? null;
		if (typeof password === "string" && password.trim()) {
			// Чужой пароль задаёт только суперадмин; свой меняют через /auth/change-password
			// (со старым паролем) — иначе украденная сессия меняла бы пароль без него.
			if (!req.user?.isSuperAdmin) {
				return res.status(403).json({
					success: false,
					code: "PASSWORD_CHANGE_FORBIDDEN",
					message: "Задать пароль другому пользователю может только суперадминистратор; свой пароль меняется в настройках",
				});
			}
			data.password = await hashPassword(password.trim());
		}
		if (employeeUuid !== undefined) data.employeeUuid = employeeUuid || null;

		const item = await prisma.user.update({
			where: { uuid: target.uuid },
			data,
			select: SAFE_USER_SELECT,
		});

		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025") {
			return res
				.status(404)
				.json({ success: false, message: "Пользователь не найден" });
		}
		if (error.code === "P2002") {
			return res.status(409).json({ success: false, message: "Пользователь с таким логином уже существует" });
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
		const target = await findVisibleUser(req, req.params.id);
		if (!target) {
			return res.status(404).json({ success: false, message: "Пользователь не найден" });
		}
		if (target.uuid === req.user?.uuid) {
			return res.status(409).json({ success: false, message: "Нельзя удалить собственную учётную запись" });
		}
		if (!canManageUser(req, target, "delete")) {
			return res.status(403).json({
				success: false,
				message: "Пользователь состоит и в других организациях — уберите его из своей организации на вкладке «Организации»",
			});
		}

		await prisma.user.delete({ where: { uuid: target.uuid } });

		return res.status(200).json({ success: true, message: "Удалено" });
	} catch (error) {
		if (error.code === "P2025") {
			return res
				.status(404)
				.json({ success: false, message: "Пользователь не найден" });
		}
		if (error.code === "P2003") {
			return res.status(409).json({ success: false, message: "Невозможно удалить — пользователь указан в документах" });
		}
		console.error("DELETE /users/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST avatar ─────────────────────────────────────────────────────────
router.post("/users/:id/avatar", avatarUpload.single("avatar"), async (req, res) => {
	try {
		if (!req.file) return res.status(400).json({ success: false, message: "Файл не передан" });
		// Аватар — свой или того, кем распоряжаешься; иначе загруженный файл убираем с диска.
		const existing = await findVisibleUser(req, req.params.id, { uuid: true, isSuperAdmin: true, avatarPath: true, accessRights: { select: { organizationUuid: true } } });
		if (!existing || (existing.uuid !== req.user?.uuid && !canManageUser(req, existing, "edit"))) {
			fs.unlink(req.file.path, () => {});
			return res.status(existing ? 403 : 404).json({ success: false, message: existing ? "Нет доступа" : "Не найдено" });
		}
		const w = { uuid: existing.uuid };
		if (existing.avatarPath) {
			const oldPath = path.resolve(AVATAR_DIR, existing.avatarPath);
			if (oldPath.startsWith(AVATAR_DIR) && fs.existsSync(oldPath)) {
				fs.unlinkSync(oldPath);
			}
		}

		const item = await prisma.user.update({
			where: w,
			data: { avatarPath: req.file.filename },
			select: SAFE_USER_SELECT,
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
		const user = await findVisibleUser(req, req.params.id, { avatarPath: true });
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
		const existing = await findVisibleUser(req, req.params.id, { uuid: true, isSuperAdmin: true, avatarPath: true, accessRights: { select: { organizationUuid: true } } });
		if (!existing) return res.status(404).json({ success: false, message: "Не найдено" });
		if (existing.uuid !== req.user?.uuid && !canManageUser(req, existing, "edit")) {
			return res.status(403).json({ success: false, message: "Нет доступа" });
		}
		const w = { uuid: existing.uuid };
		if (existing.avatarPath) {
			const filePath = path.resolve(AVATAR_DIR, existing.avatarPath);
			if (filePath.startsWith(AVATAR_DIR) && fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
			}
		}
		const item = await prisma.user.update({
			where: w,
			data: { avatarPath: null },
			select: SAFE_USER_SELECT,
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
		const target = await findVisibleUser(req, req.params.id, { uuid: true });
		if (!target) return res.status(404).json({ success: false, message: "Пользователь не найден" });

		// Суперадмин видит все членства; остальные — только в доступных им организациях:
		// в каких ещё фирмах состоит человек, постороннему знать незачем.
		const isSuperAdmin = req.user?.isSuperAdmin;
		const items = await prisma.accessRight.findMany({
			where: {
				userUuid: target.uuid,
				...(!isSuperAdmin
					? { organizationUuid: { in: [req.user?.organizationUuid, ...(req.user?.allowedOrgUuids ?? [])].filter(Boolean) } }
					: {}),
			},
			include: {
				organization: {
					select: { uuid: true, bin: true, name: true, legalName: true },
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
		const { organizationUuid } = req.body;
		const role = normalizeRole(req.body.role ?? "member");

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

		const targetUser = await findAddableUser(req, req.params.id);
		if (!targetUser) {
			return res.status(404).json({ success: false, message: "Пользователь не найден" });
		}

		const item = await prisma.accessRight.upsert({
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
					select: { uuid: true, bin: true, name: true, legalName: true },
				},
			},
		});

		return res.status(201).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2003") return res.status(404).json({ success: false, message: "Организация не найдена" });
		console.error("POST /users/:id/organizations error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// PUT /users/:id/organizations/:orgUuid — изменить роль
router.put("/users/:id/organizations/:orgUuid", async (req, res) => {
	try {
		const { orgUuid } = req.params;
		if (!req.body.role) {
			return res.status(400).json({ success: false, message: "role обязателен" });
		}
		const role = normalizeRole(req.body.role);

		// Менять роль в организации может только её администратор (раньше — кто угодно с правом
		// User: понизить админов чужой фирмы или записать произвольную роль).
		const isSuperAdmin = req.user?.isSuperAdmin;
		if (!isSuperAdmin && !isAdminOfOrg(req, orgUuid)) {
			return res.status(403).json({ success: false, message: "Нет доступа" });
		}
		if (!isSuperAdmin && role === "admin") {
			return res.status(403).json({
				success: false,
				message: "Назначить роль admin может только суперадмин",
			});
		}

		const targetUser = await findVisibleUser(req, req.params.id, { uuid: true });
		if (!targetUser) {
			return res.status(404).json({ success: false, message: "Пользователь не найден" });
		}

		const item = await prisma.accessRight.update({
			where: {
				userUuid_organizationUuid: {
					userUuid: targetUser.uuid,
					organizationUuid: orgUuid,
				},
			},
			data: { role },
			include: {
				organization: {
					select: { uuid: true, bin: true, name: true, legalName: true },
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
		const { orgUuid } = req.params;

		const isSuperAdmin = req.user?.isSuperAdmin;
		const isOrgAdmin = req.user?.isOrgAdmin;
		const callerOrgUuid = req.user?.organizationUuid;

		if (!isSuperAdmin && (!isOrgAdmin || orgUuid !== callerOrgUuid)) {
			return res.status(403).json({ success: false, message: "Нет доступа" });
		}

		const targetUser = await findVisibleUser(req, req.params.id, { uuid: true });
		if (!targetUser) {
			return res.status(404).json({ success: false, message: "Пользователь не найден" });
		}

		await prisma.accessRight.delete({
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
			select: { uuid: true, accessRights: { select: { organizationUuid: true } } },
		});
		if (!targetUser) {
			return res.status(404).json({ success: false, message: "Пользователь не найден" });
		}

		if (!req.user?.isSuperAdmin && targetUser.uuid !== callerUuid) {
			return res.status(403).json({ success: false, message: "Нет доступа" });
		}

		// Проверяем что организация входит в список доступных
		if (organizationUuid) {
			const allowed = targetUser.accessRights.some(
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
