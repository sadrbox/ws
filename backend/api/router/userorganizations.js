import express from "express";
import { prisma } from "../../prisma/prisma-client.js";

const router = express.Router();
const ROUTE = "user-organizations";

// ── GET /user-organizations?userUuid=xxx — список с курсорной пагинацией ──
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const { userUuid } = req.query;
		if (!userUuid) {
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

		// Проверяем права: суперадмин или org-admin своей орг
		const isSuperAdmin = req.user?.isSuperAdmin;
		const isOrgAdmin = req.user?.isOrgAdmin;

		const where = {
			userUuid,
			...(!isSuperAdmin && isOrgAdmin
				? { organizationUuid: req.user.organizationUuid }
				: {}),
		};

		const items = await prisma.userOrganization.findMany({
			where: {
				...where,
				...(cursorNumber ? { id: { gt: cursorNumber } } : {}),
			},
			include: {
				organization: {
					select: { uuid: true, bin: true, shortName: true, displayName: true },
				},
			},
			orderBy: { id: "asc" },
			take: limitNumber + 1,
		});

		const hasMore = items.length > limitNumber;
		const result = hasMore ? items.slice(0, limitNumber) : items;
		const nextCursor = hasMore ? result[result.length - 1].id : null;

		// Добавляем синтетическое uuid = String(id) — нужно для SubTable/commitPendingRows
		const mapped = result.map(item => ({ ...item, uuid: String(item.id) }));

		return res.json({ success: true, items: mapped, nextCursor });
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
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
					select: { uuid: true, bin: true, shortName: true, displayName: true },
				},
			},
		});

		return res.status(201).json({ success: true, item: { ...item, uuid: String(item.id) } });
	} catch (error) {
		if (error.code === "P2002") {
			return res.status(409).json({ success: false, message: "Такая запись уже существует" });
		}
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── PUT /user-organizations/:uuid — изменить роль ────────────────────────
// uuid здесь — это organizationUuid (уникальный ключ вместе с userUuid)
// Но SubTable использует item.uuid для идентификации строк.
// userOrganization не имеет собственного uuid — используем id.
router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const id = Number(req.params.id);
		if (!id) return res.status(400).json({ success: false, message: "Некорректный id" });

		const { role } = req.body;
		if (!role) return res.status(400).json({ success: false, message: "role обязателен" });

		const isSuperAdmin = req.user?.isSuperAdmin;
		if (!isSuperAdmin && role === "admin") {
			return res.status(403).json({ success: false, message: "Назначить роль admin может только суперадмин" });
		}

		const item = await prisma.userOrganization.update({
			where: { id },
			data: { role },
			include: {
				organization: {
					select: { uuid: true, bin: true, shortName: true, displayName: true },
				},
			},
		});

		return res.json({ success: true, item: { ...item, uuid: String(item.id) } });
	} catch (error) {
		if (error.code === "P2025") return res.status(404).json({ success: false, message: "Запись не найдена" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE /user-organizations/:id ───────────────────────────────────────
router.delete(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const id = Number(req.params.id);
		if (!id) return res.status(400).json({ success: false, message: "Некорректный id" });

		const isSuperAdmin = req.user?.isSuperAdmin;
		const isOrgAdmin = req.user?.isOrgAdmin;

		// Находим запись для проверки доступа
		const record = await prisma.userOrganization.findUnique({ where: { id } });
		if (!record) return res.status(404).json({ success: false, message: "Запись не найдена" });

		if (!isSuperAdmin && (!isOrgAdmin || record.organizationUuid !== req.user?.organizationUuid)) {
			return res.status(403).json({ success: false, message: "Нет доступа" });
		}

		await prisma.userOrganization.delete({ where: { id } });

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
