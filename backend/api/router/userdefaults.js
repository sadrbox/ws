import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { orgIsAccessible, isAdminOfOrg, checkOwnership } from "../../utils/auth.js";
import { clampLimit } from "../../utils/listQuery.js";

const router = express.Router();

const MODEL = "userDefault";
const ROUTE = "user-defaults";

/*
 * УМОЛЧАНИЯ ПОЛЬЗОВАТЕЛЯ: ЧЬИ И КТО ПРАВИТ (Б12 аудита 26.09).
 *
 * Сегмент не был описан ни в карте прав, ни в реестре предметов, а изоляции не было вовсе:
 * GET отдавал умолчания всех пользователей всех организаций (имена складов, касс, контрагентов),
 * PUT/DELETE/batch правили чужие. Теперь запись умолчания трогает:
 *   - сам пользователь — свои умолчания в доступной ему организации;
 *   - администратор организации — умолчания её участников (вкладка в форме «Организации
 *     пользователя»);
 *   - суперадмин — всё.
 * Значение (склад, касса, счёт, договор, контакт, тип цены) должно принадлежать доступной
 * организации — иначе через подпись `valueName` читались бы чужие справочники.
 */
export function canTouchDefault(req, { userUuid, organizationUuid }) {
	if (req.user?.isSuperAdmin) return true;
	if (!organizationUuid) return false;
	if (userUuid && userUuid === req.user?.uuid && orgIsAccessible(req, organizationUuid)) return true;
	return isAdminOfOrg(req, organizationUuid);
}

const VALUE_MODELS = {
	bankAccount: "bankAccount", contract: "contract", warehouse: "warehouse", cashbox: "cashbox",
	contact: "contact", salePriceType: "priceType", purchasePriceType: "priceType",
};

/** Значение умолчания — запись доступной организации. null — можно, строка — отказ. */
async function valueDenied(req, valueType, valueUuid) {
	const model = VALUE_MODELS[valueType];
	if (!model) return "Неизвестный вид умолчания";
	if (!valueUuid) return null;
	const row = await prisma[model].findUnique({ where: { uuid: String(valueUuid) }, select: { organizationUuid: true } }).catch(() => null);
	if (!row || !checkOwnership(row, req)) return "Значение умолчания недоступно";
	return null;
}

/** Условие списка: свои умолчания + умолчания участников организаций, где вызывающий админ. */
function visibleWhere(req) {
	if (req.user?.isSuperAdmin) return {};
	const own = [req.user?.organizationUuid, ...(req.user?.allowedOrgUuids ?? [])].filter(Boolean);
	const admin = (req.user?.adminOrgUuids ?? []).length ? req.user.adminOrgUuids : (req.user?.isOrgAdmin && req.user?.organizationUuid ? [req.user.organizationUuid] : []);
	return { OR: [{ userUuid: req.user?.uuid ?? "__none__", organizationUuid: { in: own } }, { organizationUuid: { in: admin } }] };
}

/** Найти запись по id/uuid, если вызывающему её можно трогать. */
async function findTouchable(req, param) {
	const n = Number(param);
	const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: String(param) };
	const item = await prisma[MODEL].findUnique({ where: w });
	return item && canTouchDefault(req, item) ? item : null;
}

// ── GET list ───────────────────────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const { userUuid, organizationUuid } = req.query;

		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const limitNumber = clampLimit(rawLimit);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;

		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0)) {
			return res.status(400).json({ success: false, message: "Некорректный параметр cursor" });
		}

		const where = {
			AND: [
				{
					...(typeof userUuid === "string" && userUuid ? { userUuid } : {}),
					...(typeof organizationUuid === "string" && organizationUuid ? { organizationUuid } : {}),
				},
				visibleWhere(req),
			],
		};

		const queryOptions = {
			take: limitNumber,
			where,
			orderBy: [{ id: "asc" }],
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
			total = await prisma[MODEL].count({ where });
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
		const item = await findTouchable(req, req.params.id);
		if (!item) return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST /batch ─────────────────────────────────────────────────────────
router.post(`/${ROUTE}/batch`, async (req, res) => {
	try {
		const { operations } = req.body;
		if (!Array.isArray(operations) || operations.length === 0)
			return res.status(400).json({ success: false, message: "operations обязателен" });

		// Сначала проверяем ВСЕ операции, потом пишем — пакет проходит целиком или никак.
		for (const [i, op] of operations.entries()) {
			const { action, uuid, data } = op ?? {};
			if (action === "create" && data) {
				if (!canTouchDefault(req, data)) return res.status(403).json({ success: false, message: `Операция ${i + 1}: нет доступа` });
				const denied = await valueDenied(req, data.valueType, data.valueUuid);
				if (denied) return res.status(403).json({ success: false, message: `Операция ${i + 1}: ${denied}` });
			} else if ((action === "update" || action === "delete") && uuid) {
				const existing = await findTouchable(req, uuid);
				if (!existing) return res.status(404).json({ success: false, message: `Операция ${i + 1}: запись не найдена` });
				if (action === "update" && data) {
					const denied = await valueDenied(req, data.valueType ?? existing.valueType, data.valueUuid ?? existing.valueUuid);
					if (denied) return res.status(403).json({ success: false, message: `Операция ${i + 1}: ${denied}` });
				}
			}
		}

		await prisma.$transaction(async (tx) => {
			for (const op of operations) {
				const { action, uuid, data } = op;
				if (action === "create" && data) {
					await tx[MODEL].upsert({
						where: {
							userUuid_organizationUuid_valueType: {
								userUuid: data.userUuid,
								organizationUuid: data.organizationUuid,
								valueType: data.valueType,
							},
						},
						update: {
							valueUuid: data.valueUuid,
							valueName: data.valueName ?? "",
						},
						create: {
							userUuid: data.userUuid,
							organizationUuid: data.organizationUuid,
							valueType: data.valueType,
							valueUuid: data.valueUuid,
							valueName: data.valueName ?? "",
						},
					});
				} else if (action === "update" && uuid && data) {
					await tx[MODEL].update({
						where: { uuid },
						data: {
							...(data.valueType !== undefined ? { valueType: data.valueType } : {}),
							...(data.valueUuid !== undefined ? { valueUuid: data.valueUuid } : {}),
							...(data.valueName !== undefined ? { valueName: data.valueName } : {}),
						},
					});
				} else if (action === "delete" && uuid) {
					await tx[MODEL].delete({ where: { uuid } });
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
		const { userUuid, organizationUuid, valueType, valueUuid, valueName } = req.body;
		if (!userUuid) return res.status(400).json({ success: false, message: "userUuid обязателен" });
		if (!organizationUuid) return res.status(400).json({ success: false, message: "organizationUuid обязателен" });
		if (!valueType) return res.status(400).json({ success: false, message: "valueType обязателен" });
		if (!valueUuid) return res.status(400).json({ success: false, message: "valueUuid обязателен" });
		if (!canTouchDefault(req, { userUuid, organizationUuid })) return res.status(403).json({ success: false, message: "Нет доступа" });
		const denied = await valueDenied(req, valueType, valueUuid);
		if (denied) return res.status(403).json({ success: false, message: denied });

		const item = await prisma[MODEL].upsert({
			where: {
				userUuid_organizationUuid_valueType: { userUuid, organizationUuid, valueType },
			},
			update: { valueUuid, valueName: valueName ?? "" },
			create: { userUuid, organizationUuid, valueType, valueUuid, valueName: valueName ?? "" },
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
		const existing = await findTouchable(req, req.params.id);
		if (!existing) return res.status(404).json({ success: false, message: "Не найдено" });
		const data = {};
		if (req.body.valueType !== undefined) data.valueType = req.body.valueType;
		if (req.body.valueUuid !== undefined) data.valueUuid = req.body.valueUuid;
		if (req.body.valueName !== undefined) data.valueName = req.body.valueName ?? "";
		const denied = await valueDenied(req, data.valueType ?? existing.valueType, data.valueUuid ?? existing.valueUuid);
		if (denied) return res.status(403).json({ success: false, message: denied });

		const item = await prisma[MODEL].update({ where: { uuid: existing.uuid }, data });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		if (error.code === "P2002")
			return res.status(409).json({ success: false, message: "Такой тип значения уже задан" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE ──────────────────────────────────────────────────────────────
// Удаление — только своих/подвластных записей: общий обработчик проверяет лишь организацию.
router.delete(`/${ROUTE}/:id`, async (req, res, next) => {
	try {
		if (!(await findTouchable(req, req.params.id))) return res.status(404).json({ success: false, message: "Не найдено" });
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
		const uuids = Array.isArray(req.body?.uuids) ? req.body.uuids : [];
		for (const u of uuids) {
			if (!(await findTouchable(req, u))) return res.status(404).json({ success: false, message: "Часть записей не найдена — удаление не выполнено" });
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
