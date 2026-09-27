import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { idSearchCondition } from "../../utils/searchId.js";
import { isAdminOfOrg, checkOwnership } from "../../utils/auth.js";
import { clampLimit } from "../../utils/listQuery.js";

const router = express.Router();

const MODEL = "accessPermission";
const ROUTE = "access-permissions";

/*
 * ПРАВА ДОСТУПА: КТО ИХ ВИДИТ И РАЗДАЁТ (Б2/Б4 аудита 26.09, п. 20 отчёта).
 *
 * Держатель `AccessPermission:full` выдавал себе и другим права в ЛЮБОЙ организации и
 * ГЛОБАЛЬНЫЕ права (`organizationUuid = null`, действуют во всех организациях), а GET с userUuid
 * показывал права любого пользователя по всем фирмам. Теперь:
 *   - свои права видны всегда; чужие — только в организациях, где вызывающий администратор;
 *   - раздавать и менять права организации — только её администратор (право на модель для этого
 *     недостаточно: иначе «полный доступ к правам» присваивал бы всё остальное);
 *   - глобальные права (без организации) видит у других и раздаёт только суперадмин.
 */
export function permissionVisible(req, row) {
	if (!row) return false;
	if (req.user?.isSuperAdmin) return true;
	if (row.userUuid === req.user?.uuid) return row.organizationUuid == null || checkOwnership(row, req);
	return !!row.organizationUuid && isAdminOfOrg(req, row.organizationUuid);
}

/** Можно ли выдать/изменить/удалить право в этой организации (null — глобальное). */
export function permissionWritable(req, organizationUuid) {
	if (req.user?.isSuperAdmin) return true;
	return !!organizationUuid && isAdminOfOrg(req, organizationUuid);
}

/** Условие списка по тем же правилам. */
function visibleWhere(req) {
	if (req.user?.isSuperAdmin) return {};
	const adminOrgs = (req.user?.adminOrgUuids ?? []).length
		? req.user.adminOrgUuids
		: (req.user?.isOrgAdmin && req.user?.organizationUuid ? [req.user.organizationUuid] : []);
	const ownOrgs = [req.user?.organizationUuid, ...(req.user?.allowedOrgUuids ?? [])].filter(Boolean);
	return {
		OR: [
			{ userUuid: req.user?.uuid ?? "__none__", OR: [{ organizationUuid: null }, { organizationUuid: { in: ownOrgs } }] },
			{ organizationUuid: { in: adminOrgs } },
		],
	};
}

/** Поля сортировки и фильтра: только известные (неизвестное давало 500). */
const PERM_FIELDS = ["id", "uuid", "modelName", "accessLevel", "userUuid", "organizationUuid", "updatedAt"];

async function findWritable(req, param) {
	const n = Number(param);
	const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: String(param) };
	const row = await prisma[MODEL].findUnique({ where: w });
	if (!row || !permissionVisible(req, row)) return { row: null, status: 404 };
	if (!permissionWritable(req, row.organizationUuid)) return { row: null, status: 403 };
	return { row, status: 200 };
}

// Текстовые поля для полнотекстового поиска
const TEXT_FIELDS = ["modelName", "accessLevel"];

// ── GET list (курсорная пагинация, фильтр по userUuid) ──────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const { userUuid, organizationUuid } = req.query;
		const isSuperAdmin = req.user?.isSuperAdmin;
		if (!userUuid && !isSuperAdmin)
			return res.status(400).json({
				success: false,
				message: "Параметр userUuid обязателен",
			});

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

		// ── Сортировка ────────────────────────────────────────────────────
		const orderBy = [];
		const sortParam =
			typeof req.query.sort === "string" ? req.query.sort : null;

		if (sortParam) {
			try {
				const sortObj = JSON.parse(sortParam);
				if (sortObj && typeof sortObj === "object") {
					for (const [field, dir] of Object.entries(sortObj)) {
						if (dir !== "asc" && dir !== "desc") continue;
						if (!PERM_FIELDS.includes(field)) continue;
						orderBy.push({ [field]: dir });
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

		// ── Удаляем сортировки по relation-полям (dot-notation) —
		// они не поддерживаются в AccessPermission без include (вызывают 500)
		const safeOrderBy = orderBy.filter((o) => {
			const field = Object.keys(o)[0];
			return !field.includes(".");
		});
		const finalOrderBy = safeOrderBy.length > 0 ? safeOrderBy : [{ id: "asc" }];

		// ── Поиск ─────────────────────────────────────────────────────────
		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhereClause = {};

		if (searchWords.length > 0) {
			searchWhereClause = {
				AND: searchWords.map((word) => {
					const orConditions = TEXT_FIELDS.map((field) => ({
						[field]: { contains: word, mode: "insensitive" },
					}));
					const idNum = idSearchCondition(word);
					if (idNum) orConditions.push(idNum);

					return { OR: orConditions };
				}),
			};
		}

		// ── Произвольные фильтры ──────────────────────────────────────────
		const ALLOWED_OPERATORS = ["contains", "equals", "gte", "lte", "gt", "lt"];
		const SKIP_KEYS = ["searchBy", "dateRange"];
		const filterWhereClause = {};

		for (const [field, conditions] of Object.entries(filter)) {
			if (SKIP_KEYS.includes(field)) continue;
			if (!conditions || typeof conditions !== "object") continue;
			if (!PERM_FIELDS.includes(field)) {
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

		// ── Итоговый where ────────────────────────────────────────────────
		const baseWhere = {
			...(userUuid ? { userUuid } : {}),
			// Фильтр по организации: "null" → NULL, uuid → конкретная орг, undefined → без фильтра
			...(organizationUuid !== undefined
				? {
						organizationUuid:
							organizationUuid === "null" ? null : organizationUuid,
					}
				: {}),
			...searchWhereClause,
			...filterWhereClause,
		};
		const vis = visibleWhere(req);
		if (Object.keys(vis).length) baseWhere.AND = [...(baseWhere.AND ?? []), vis];

		// ── Курсорная пагинация ───────────────────────────────────────────
		const queryOptions = {
			take: limitNumber,
			where: baseWhere,
			orderBy: finalOrderBy,
			include: {
				user: { select: { uuid: true, username: true } },
				organization: { select: { uuid: true, name: true } },
			},
		};

		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const items = await prisma[MODEL].findMany(queryOptions);

		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		let total;
		if (cursorNumber === null) {
			total = await prisma[MODEL].count({ where: baseWhere });
		}

		return res.status(200).json({
			success: true,
			items,
			nextCursor,
			hasMore,
			...(total !== undefined ? { total } : {}),
		});
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET by id ───────────────────────────────────────────────────────────
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({
			where: w,
			include: {
				user: { select: { uuid: true, username: true } },
				organization: { select: { uuid: true, name: true } },
			},
		});
		if (!permissionVisible(req, item))
			return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST /access-permissions/batch ───────────────────────────────────────────
router.post(`/${ROUTE}/batch`, async (req, res) => {
	try {
		const { operations } = req.body;
		if (!Array.isArray(operations) || operations.length === 0)
			return res.status(400).json({ success: false, message: "operations обязателен" });

		// Сначала проверяем всё, потом пишем: пакет проходит целиком или не проходит вовсе.
		for (const [i, op] of operations.entries()) {
			const { action, uuid, data } = op ?? {};
			if (action === "create" && data) {
				if (!permissionWritable(req, data.organizationUuid ?? null)) {
					return res.status(403).json({ success: false, message: `Операция ${i + 1}: права в этой организации раздаёт её администратор` });
				}
			} else if ((action === "update" || action === "delete") && uuid) {
				const { row, status } = await findWritable(req, uuid);
				if (!row && !(action === "delete" && status === 404)) {
					return res.status(status).json({ success: false, message: `Операция ${i + 1}: ${status === 404 ? "запись не найдена" : "нет доступа"}` });
				}
			}
		}

		await prisma.$transaction(async (tx) => {
			for (const op of operations) {
				const { action, uuid, data } = op;
				if (action === "create" && data) {
					await tx[MODEL].upsert({
						where: {
							userUuid_organizationUuid_modelName: {
								userUuid: data.userUuid,
								organizationUuid: data.organizationUuid ?? null,
								modelName: data.modelName?.trim() ?? "",
							},
						},
						update: { accessLevel: data.accessLevel?.trim() || "none" },
						create: {
							modelName: data.modelName?.trim() ?? "",
							accessLevel: data.accessLevel?.trim() || "none",
							userUuid: data.userUuid,
							organizationUuid: data.organizationUuid ?? null,
						},
					});
				} else if (action === "update" && uuid && data) {
					await tx[MODEL].update({
						where: { uuid },
						data: { accessLevel: data.accessLevel?.trim() || "none" },
					});
				} else if (action === "delete" && uuid) {
					await tx[MODEL].deleteMany({ where: { uuid } });
				}
			}
		});

		return res.status(200).json({ success: true });
	} catch (error) {
		console.error(`POST /${ROUTE}/batch error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST ────────────────────────────────────────────────────────────────
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const { modelName, accessLevel, userUuid, organizationUuid } = req.body;
		if (!userUuid)
			return res.status(400).json({
				success: false,
				message: "userUuid обязателен",
			});
		if (!modelName)
			return res.status(400).json({
				success: false,
				message: "modelName обязателен",
			});
		if (!permissionWritable(req, organizationUuid ?? null))
			return res.status(403).json({ success: false, message: "Права в этой организации раздаёт её администратор; глобальные — суперадминистратор" });
		const item = await prisma[MODEL].upsert({
			where: {
				userUuid_organizationUuid_modelName: {
					userUuid,
					organizationUuid: organizationUuid ?? null,
					modelName: modelName.trim(),
				},
			},
			update: {
				accessLevel: accessLevel?.trim() || "none",
			},
			create: {
				modelName: modelName.trim(),
				accessLevel: accessLevel?.trim() || "none",
				userUuid,
				organizationUuid: organizationUuid ?? null,
			},
			include: {
				user: { select: { uuid: true, username: true } },
				organization: { select: { uuid: true, name: true } },
			},
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── PUT ─────────────────────────────────────────────────────────────────
router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const { row, status } = await findWritable(req, req.params.id);
		if (!row) return res.status(status).json({ success: false, message: status === 404 ? "Не найдено" : "Нет доступа" });
		const w = { uuid: row.uuid };
		const data = {};
		if (req.body.modelName !== undefined)
			data.modelName = req.body.modelName?.trim() ?? null;
		if (req.body.accessLevel !== undefined)
			data.accessLevel = req.body.accessLevel?.trim() || "none";

		const item = await prisma[MODEL].update({ where: w, data });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		if (error.code === "P2002")
			return res.status(409).json({
				success: false,
				message: "Право доступа для этой модели уже существует",
			});
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE ──────────────────────────────────────────────────────────────
// Удаление — по тем же правилам, до общего обработчика (он считал право без организации «общим»).
router.delete(`/${ROUTE}/:id`, async (req, res, next) => {
	try {
		const { row, status } = await findWritable(req, req.params.id);
		if (!row) return res.status(status).json({ success: false, message: status === 404 ? "Не найдено" : "Нет доступа" });
		return next();
	} catch (error) {
		console.error(`DELETE /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
}, (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL }),
);

router.post(`/${ROUTE}/batch-delete`, async (req, res, next) => {
	try {
		for (const u of Array.isArray(req.body?.uuids) ? req.body.uuids : []) {
			const { row } = await findWritable(req, u);
			if (!row) return res.status(404).json({ success: false, message: "Часть записей не найдена — удаление не выполнено" });
		}
		return next();
	} catch (error) {
		console.error(`POST /${ROUTE}/batch-delete error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
}, (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: MODEL }),
);

export default router;
