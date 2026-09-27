import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { isAdminOfOrg } from "../../utils/auth.js";
import { normalizeRole } from "../../services/orgMembership.js";
import { clampLimit } from "../../utils/listQuery.js";

const router = express.Router();
const ROUTE = "access-rights";

/*
 * ЧЛЕНСТВА: КТО ЧЕМ РАСПОРЯЖАЕТСЯ (Б4 аудита 26.09).
 *
 * `/access-rights/batch` создавал, менял и удалял членства с любой ролью в любой организации
 * без единой проверки — любой вошедший назначал себе admin где угодно. Теперь все пути (одиночные
 * и пакетный) идут через ОДНО правило `membershipChangeDenied`:
 *   - суперадмин — всё;
 *   - администратор организации — только членства СВОЕЙ АКТИВНОЙ организации (как и раньше у
 *     одиночных маршрутов), роль admin не выдаёт и запись с ролью admin не трогает;
 *   - остальные — ничего.
 * Чтение: свои членства видны всем; чужие — только в организациях, где вызывающий админ.
 */
export function membershipChangeDenied(req, { organizationUuid, role = null, existing = null }) {
	if (req.user?.isSuperAdmin) return null;
	const callerOrg = req.user?.organizationUuid ?? null;
	if (!req.user?.isOrgAdmin || !organizationUuid || organizationUuid !== callerOrg) return "Нет доступа";
	if (existing && existing.organizationUuid !== callerOrg) return "Нет доступа";
	if (role === "admin" || existing?.role === "admin") return "Назначить или изменить роль admin может только суперадмин";
	return null;
}

/** Поля сортировки списка: только известные (неизвестное поле давало 500). */
const ACCESS_RIGHT_SORT = ["id", "uuid", "role", "createdAt", "updatedAt", "userUuid", "organizationUuid",
	"user.username", "organization.name", "organization.bin", "organization.legalName"];

/** Видна ли запись членства вызывающему. */
function membershipVisible(req, record) {
	if (!record) return false;
	if (req.user?.isSuperAdmin) return true;
	if (record.userUuid === req.user?.uuid) return true;
	return isAdminOfOrg(req, record.organizationUuid);
}

// ── GET /access-rights?userUuid=xxx — список с курсорной пагинацией ──
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const { userUuid } = req.query;

		// Проверяем права: суперадмин или org-admin своей орг
		const isSuperAdmin = req.user?.isSuperAdmin;
		const isOrgAdmin = req.user?.isOrgAdmin;

		// userUuid обязателен для всех, кроме суперадмина (который видит все записи)
		if (!userUuid && !isSuperAdmin) {
			return res
				.status(400)
				.json({ success: false, message: "Параметр userUuid обязателен" });
		}

		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const limitNumber = clampLimit(rawLimit);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;

		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0)) {
			return res
				.status(400)
				.json({ success: false, message: "Некорректный параметр cursor" });
		}

		// Не суперадмин: свои членства — все; чужие — только в организациях, где он админ.
		// Раньше не-админ с userUuid видел членства любого пользователя во всех фирмах.
		const adminOrgs = [...new Set([...(req.user?.adminOrgUuids ?? []), ...(isOrgAdmin && req.user?.organizationUuid ? [req.user.organizationUuid] : [])])];
		const where = {
			...(userUuid ? { userUuid } : {}),
			...(!isSuperAdmin && userUuid !== req.user?.uuid
				? { organizationUuid: { in: adminOrgs } }
				: {}),
		};

		const orderBy = [];
		const sortParam =
			typeof req.query.sort === "string" ? req.query.sort : null;
		if (sortParam) {
			try {
				const sortObj = JSON.parse(sortParam);
				if (sortObj && typeof sortObj === "object") {
					for (const [field, dir] of Object.entries(sortObj)) {
						if (dir !== "asc" && dir !== "desc") continue;
						if (!ACCESS_RIGHT_SORT.includes(field)) continue;
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

		const items = await prisma.accessRight.findMany({
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

// ── GET /access-rights/:id — одна запись ─────────────────────────────
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

		const item = await prisma.accessRight.findUnique({
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
		if (!membershipVisible(req, item))
			return res
				.status(404)
				.json({ success: false, message: "Запись не найдена" });

		return res.json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST /access-rights — добавить организацию пользователю ──────────
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const { userUuid, organizationUuid } = req.body;
		const role = normalizeRole(req.body.role ?? "member");

		if (!userUuid)
			return res
				.status(400)
				.json({ success: false, message: "userUuid обязателен" });
		if (!organizationUuid)
			return res
				.status(400)
				.json({ success: false, message: "organizationUuid обязателен" });

		const existingPair = await prisma.accessRight.findUnique({
			where: { userUuid_organizationUuid: { userUuid, organizationUuid } },
		});
		const denied = membershipChangeDenied(req, { organizationUuid, role, existing: existingPair });
		if (denied) return res.status(403).json({ success: false, message: denied });

		const item = await prisma.accessRight.upsert({
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
			return res
				.status(409)
				.json({ success: false, message: "Такая запись уже существует" });
		}
		if (error.code === "P2003") {
			return res.status(400).json({ success: false, message: "Пользователь или организация не найдены" });
		}
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── PUT /access-rights/:id — изменить запись ────────────────────────
// Поддерживает: только role (простое обновление) ИЛИ смену organizationUuid/userUuid
// (составной уникальный ключ) — в этом случае выполняется транзакция delete+create.
router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

		const {
			role,
			organizationUuid: newOrgUuid,
			userUuid: newUserUuid,
		} = req.body;

		// Загружаем существующую запись
		const existing = await prisma.accessRight.findUnique({ where: w });
		if (!membershipVisible(req, existing))
			return res
				.status(404)
				.json({ success: false, message: "Запись не найдена" });

		const finalOrgUuid = newOrgUuid ?? existing.organizationUuid;
		const finalUserUuid = newUserUuid ?? existing.userUuid;
		const finalRole = role !== undefined ? normalizeRole(role) : existing.role;

		// Проверка прав: и ИСХОДНАЯ запись (раньше не проверялась — членство чужой организации
		// «переносилось» к себе), и итоговая.
		const denied = membershipChangeDenied(req, { organizationUuid: finalOrgUuid, role: finalRole, existing });
		if (denied) return res.status(403).json({ success: false, message: denied });

		const include = {
			organization: {
				select: { uuid: true, bin: true, name: true, legalName: true },
			},
			user: { select: { uuid: true, username: true } },
		};

		// Если изменилась организация или пользователь — нужна транзакция delete+create
		const keyChanged =
			finalOrgUuid !== existing.organizationUuid ||
			finalUserUuid !== existing.userUuid;

		if (keyChanged) {
			// Ищем конфликтующую запись (та же пара userUuid+organizationUuid)
			const conflict = await prisma.accessRight.findUnique({
				where: {
					userUuid_organizationUuid: {
						userUuid: finalUserUuid,
						organizationUuid: finalOrgUuid,
					},
				},
			});

			if (conflict && conflict.id !== existing.id) {
				// Конфликт с другой записью — обновляем её и удаляем текущую (merge)
				const [mergedItem] = await prisma.$transaction([
					prisma.accessRight.update({
						where: { id: conflict.id },
						data: { role: finalRole },
						include,
					}),
					prisma.accessRight.delete({ where: { id: existing.id } }),
				]);
				return res.json({ success: true, item: mergedItem });
			}

			// Нет конфликта — создаём новую запись, удаляем старую
			const [newItem] = await prisma.$transaction([
				prisma.accessRight.create({
					data: {
						userUuid: finalUserUuid,
						organizationUuid: finalOrgUuid,
						role: finalRole,
					},
					include,
				}),
				prisma.accessRight.delete({ where: { id: existing.id } }),
			]);

			return res.json({ success: true, item: newItem });
		}

		// Только роль изменилась — простое обновление
		const item = await prisma.accessRight.update({
			where: { id: existing.id },
			data: { role: finalRole },
			include,
		});

		return res.json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res
				.status(404)
				.json({ success: false, message: "Запись не найдена" });
		if (error.code === "P2002")
			return res
				.status(409)
				.json({ success: false, message: "Такая связь уже существует" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE /access-rights/:id ───────────────────────────────────────
router.delete(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

		// Находим запись для проверки доступа
		const record = await prisma.accessRight.findUnique({ where: w });
		if (!membershipVisible(req, record))
			return res
				.status(404)
				.json({ success: false, message: "Запись не найдена" });

		const denied = membershipChangeDenied(req, { organizationUuid: record.organizationUuid, existing: record });
		if (denied) return res.status(403).json({ success: false, message: denied });

		await prisma.accessRight.delete({ where: { id: record.id } });

		// Если удалили активную орг — сбрасываем
		const targetUser = await prisma.user.findUnique({
			where: { uuid: record.userUuid },
			select: { organizationUuid: true },
		});
		if (targetUser?.organizationUuid === record.organizationUuid) {
			await prisma.user.update({
				where: { uuid: record.userUuid },
				data: { organizationUuid: null },
			});
		}

		return res.json({ success: true });
	} catch (error) {
		if (error.code === "P2025")
			return res
				.status(404)
				.json({ success: false, message: "Запись не найдена" });
		console.error(`DELETE /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST /access-rights/batch ──────────────────────────────────────────
router.post(`/${ROUTE}/batch`, async (req, res) => {
	try {
		const { operations } = req.body;
		if (!Array.isArray(operations) || operations.length === 0)
			return res.status(400).json({ success: false, message: "operations обязателен" });
		if (operations.length > 500)
			return res.status(400).json({ success: false, message: "Слишком много операций за раз" });

		/*
		 * Сначала ПРОВЕРЯЕМ ВСЁ, потом пишем: пакет либо проходит целиком, либо отклоняется
		 * целиком с указанием строки — наполовину применённый пакет прав хуже любого отказа.
		 */
		const plan = [];
		for (const [i, op] of operations.entries()) {
			const { action, uuid, data } = op ?? {};
			if (action === "create" && data) {
				if (!data.userUuid || !data.organizationUuid) {
					return res.status(400).json({ success: false, message: `Операция ${i + 1}: нужны userUuid и organizationUuid` });
				}
				const role = normalizeRole(data.role ?? "member");
				const existing = await prisma.accessRight.findUnique({
					where: { userUuid_organizationUuid: { userUuid: data.userUuid, organizationUuid: data.organizationUuid } },
				});
				const denied = membershipChangeDenied(req, { organizationUuid: data.organizationUuid, role, existing });
				if (denied) return res.status(403).json({ success: false, message: `Операция ${i + 1}: ${denied}` });
				plan.push({ action, userUuid: data.userUuid, organizationUuid: data.organizationUuid, role });
			} else if ((action === "update" || action === "delete") && uuid) {
				const existing = await prisma.accessRight.findUnique({ where: { uuid } });
				if (!existing) {
					if (action === "delete") continue; // уже удалена — как и раньше, не ошибка
					return res.status(404).json({ success: false, message: `Операция ${i + 1}: запись не найдена` });
				}
				if (action === "update" && data?.role === undefined) continue;
				const role = action === "update" ? normalizeRole(data.role) : null;
				const denied = membershipChangeDenied(req, { organizationUuid: existing.organizationUuid, role, existing });
				if (denied) return res.status(403).json({ success: false, message: `Операция ${i + 1}: ${denied}` });
				plan.push({ action, uuid, role, existing });
			}
		}

		await prisma.$transaction(async (tx) => {
			for (const op of plan) {
				if (op.action === "create") {
					await tx.accessRight.upsert({
						where: { userUuid_organizationUuid: { userUuid: op.userUuid, organizationUuid: op.organizationUuid } },
						update: { role: op.role },
						create: { userUuid: op.userUuid, organizationUuid: op.organizationUuid, role: op.role },
					});
				} else if (op.action === "update") {
					await tx.accessRight.update({ where: { uuid: op.uuid }, data: { role: op.role } });
				} else if (op.action === "delete") {
					await tx.accessRight.deleteMany({ where: { uuid: op.uuid } });
				}
			}
		});
		return res.status(200).json({ success: true });
	} catch (error) {
		if (error.code === "P2003") {
			return res.status(400).json({ success: false, message: "Пользователь или организация не найдены" });
		}
		console.error(`POST /${ROUTE}/batch error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
