import express from "express";
import { prisma } from "../../prisma/prisma-client.js";

const router = express.Router();
const ROUTE = "user-organizations";

// ── GET /user-organizations?userUuid=xxx — список с курсорной пагинацией ──
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const { userUuid } = req.query;

		// Проверяем права: суперадмин или org-admin своей орг
		const isSuperAdmin = req.user?.isSuperAdmin;
		const isOrgAdmin = req.user?.isOrgAdmin;

		// userUuid обязателен для всех, кроме суперадмина (который видит все записи)
		if (!userUuid && !isSuperAdmin) {
			return res.status(400).json({ success: false, message: "Параметр userUuid обязателен" });
		}

		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : 500;
		const limitNumber = Math.min(Math.max(parsedLimit, 1), 999999);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;

		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0)) {
			return res.status(400).json({ success: false, message: "Некорректный параметр cursor" });
		}

		const where = {
			...(userUuid ? { userUuid } : {}),
			...(!isSuperAdmin && isOrgAdmin
				? { organizationUuid: req.user.organizationUuid }
				: {}),
		};

		const orderBy = [];
		const sortParam = typeof req.query.sort === "string" ? req.query.sort : null;
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

		const items = await prisma.userOrganization.findMany({
			where: {
				...where,
				...(cursorNumber ? { id: { gt: cursorNumber } } : {}),
			},
			include: {
				organization: {
					select: { uuid: true, bin: true, name: true, legalName: true },
				},
				user: {
					select: { uuid: true, username: true },
				},
			},
			orderBy,
			take: limitNumber + 1,
		});

		const hasMore = items.length > limitNumber;
		const result = hasMore ? items.slice(0, limitNumber) : items;
		const nextCursor = hasMore ? result[result.length - 1].id : null;

		return res.json({ success: true, items: result, nextCursor });
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET /user-organizations/:id — одна запись ─────────────────────────────
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

		const item = await prisma.userOrganization.findUnique({
			where: w,
			include: {
				organization: {
					select: { uuid: true, bin: true, name: true, legalName: true },
				},
				user: {
					select: { uuid: true, username: true },
				},
			},
		});
		if (!item) return res.status(404).json({ success: false, message: "Запись не найдена" });

		return res.json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST /user-organizations — добавить организацию пользователю ──────────
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const { userUuid, organizationUuid, role = "member" } = req.body;

		if (!userUuid) return res.status(400).json({ success: false, message: "userUuid обязателен" });
		if (!organizationUuid) return res.status(400).json({ success: false, message: "organizationUuid обязателен" });

		const isSuperAdmin = req.user?.isSuperAdmin;
		const isOrgAdmin = req.user?.isOrgAdmin;
		const callerOrgUuid = req.user?.organizationUuid;

		if (!isSuperAdmin) {
			if (!isOrgAdmin || organizationUuid !== callerOrgUuid) {
				return res.status(403).json({ success: false, message: "Нет доступа" });
			}
			if (role === "admin") {
				return res.status(403).json({ success: false, message: "Назначить роль admin может только суперадмин" });
			}
		}

		const item = await prisma.userOrganization.upsert({
			where: { userUuid_organizationUuid: { userUuid, organizationUuid } },
			update: { role },
			create: { userUuid, organizationUuid, role },
			include: {
				organization: {
					select: { uuid: true, bin: true, name: true, legalName: true },
				},
				user: {
					select: { uuid: true, username: true },
				},
			},
		});

		return res.status(201).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2002") {
			return res.status(409).json({ success: false, message: "Такая запись уже существует" });
		}
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── PUT /user-organizations/:id — изменить запись ────────────────────────
// Поддерживает: только role (простое обновление) ИЛИ смену organizationUuid/userUuid
// (составной уникальный ключ) — в этом случае выполняется транзакция delete+create.
router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

		const { role, organizationUuid: newOrgUuid, userUuid: newUserUuid } = req.body;

		const isSuperAdmin = req.user?.isSuperAdmin;
		const isOrgAdmin = req.user?.isOrgAdmin;
		const callerOrgUuid = req.user?.organizationUuid;

		// Загружаем существующую запись
		const existing = await prisma.userOrganization.findUnique({ where: w });
		if (!existing) return res.status(404).json({ success: false, message: "Запись не найдена" });

		const finalOrgUuid  = newOrgUuid  ?? existing.organizationUuid;
		const finalUserUuid = newUserUuid ?? existing.userUuid;
		const finalRole     = role        ?? existing.role;

		// Проверка прав
		if (!isSuperAdmin) {
			if (!isOrgAdmin || finalOrgUuid !== callerOrgUuid) {
				return res.status(403).json({ success: false, message: "Нет доступа" });
			}
			if (finalRole === "admin") {
				return res.status(403).json({ success: false, message: "Назначить роль admin может только суперадмин" });
			}
		}

		const include = {
			organization: { select: { uuid: true, bin: true, name: true, legalName: true } },
			user: { select: { uuid: true, username: true } },
		};

		// Если изменилась организация или пользователь — нужна транзакция delete+create
		const keyChanged =
			finalOrgUuid !== existing.organizationUuid ||
			finalUserUuid !== existing.userUuid;

		if (keyChanged) {
			// Проверяем нет ли уже такой пары
			const conflict = await prisma.userOrganization.findUnique({
				where: { userUuid_organizationUuid: { userUuid: finalUserUuid, organizationUuid: finalOrgUuid } },
			});
			if (conflict) {
				return res.status(409).json({ success: false, message: "Такая связь пользователь-организация уже существует" });
			}

			const [newItem] = await prisma.$transaction([
				prisma.userOrganization.create({
					data: { userUuid: finalUserUuid, organizationUuid: finalOrgUuid, role: finalRole },
					include,
				}),
				prisma.userOrganization.delete({ where: { id: existing.id } }),
			]);

			return res.json({ success: true, item: newItem });
		}

		// Только роль изменилась — простое обновление
		const item = await prisma.userOrganization.update({
			where: { id: existing.id },
			data: { role: finalRole },
			include,
		});

		return res.json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025") return res.status(404).json({ success: false, message: "Запись не найдена" });
		if (error.code === "P2002") return res.status(409).json({ success: false, message: "Такая связь уже существует" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE /user-organizations/:id ───────────────────────────────────────
router.delete(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

		const isSuperAdmin = req.user?.isSuperAdmin;
		const isOrgAdmin = req.user?.isOrgAdmin;

		// Находим запись для проверки доступа
		const record = await prisma.userOrganization.findUnique({ where: w });
		if (!record) return res.status(404).json({ success: false, message: "Запись не найдена" });

		if (!isSuperAdmin && (!isOrgAdmin || record.organizationUuid !== req.user?.organizationUuid)) {
			return res.status(403).json({ success: false, message: "Нет доступа" });
		}

		await prisma.userOrganization.delete({ where: { id: record.id } });

		// Если удалили активную орг — сбрасываем
		const targetUser = await prisma.user.findUnique({
			where: { uuid: record.userUuid },
			select: { organizationUuid: true },
		});
		if (targetUser?.organizationUuid === record.organizationUuid) {
			await prisma.user.update({ where: { uuid: record.userUuid }, data: { organizationUuid: null } });
		}

		return res.json({ success: true });
	} catch (error) {
		if (error.code === "P2025") return res.status(404).json({ success: false, message: "Запись не найдена" });
		console.error(`DELETE /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
