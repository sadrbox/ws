// ─────────────────────────────────────────────────────────────────────────────
// Входящие события интеграции (1С → /pipe). ТОЛЬКО ЧТЕНИЕ.
//
// Записи создаёт НЕ пользователь, а внешняя система: 1С шлёт события на POST /pipe
// (см. router/activityhistories.js), они падают в таблицу pipe_activity вместе с
// оригинальным payload. Здесь — просмотр этого «входящего ящика»: что пришло, когда,
// от кого и по какому объекту. Создавать, редактировать и УДАЛЯТЬ события из UI нельзя:
// «События 1С» — журнал интеграции, восстановить его неоткуда (правило владельца — не удалять
// никогда; удаление убрано по Б6 аудита 26.09).
//
// Событие ссылается на РЕАЛЬНЫЕ объекты системы (organizationUuid/userUuid,
// см. services/pipeActor.js) — их и отдаём вместе с записью, чтобы из журнала можно
// было открыть карточку. Текстовые organizationShortName/bin/userName остаются как
// «что именно прислала 1С» — на случай расхождений с нашими данными.
//
// ИЗОЛЯЦИЯ ПО ОРГАНИЗАЦИИ (Б6 аудита 26.09). Раньше её не было: список отдавал payload
// событий ВСЕХ организаций установки любому с правом ActivityHistory (оно есть даже у профиля
// «Только просмотр»). Теперь — tenantFilter, как у остальных данных организации. События, чью
// организацию сопоставить не удалось (organizationUuid = null), видит только суперадмин: это
// разбор интеграции, а не данные чьей-то фирмы.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { buildOrderBy } from "../../utils/sortOrder.js";
import { tenantFilter, checkOwnership, orgIsAccessible } from "../../utils/auth.js";
import { clampLimit, parseDateParam, BadRequestError } from "../../utils/listQuery.js";

const router = express.Router();
const ROUTE = "pipeactivities";
const MODEL = "pipeActivity";
// Полнотекстом ищем только по подписям; идентификаторы (objectId, БИН) — точным совпадением:
// `contains` по семи полям на миллионе событий с payload — полный просмотр таблицы на каждый
// символ (передача «backend-платформа», Н3/О аудита 26.09).
const TEXT_FIELDS = ["objectName", "userName"];
const EXACT_FIELDS = ["objectId", "bin"];

// ── Список ──────────────────────────────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const limitNumber = clampLimit(req.query.limit);
		const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
		const filter = req.query.filter && typeof req.query.filter === "object" ? req.query.filter : {};

		const where = { ...tenantFilter(req) };
		if (search) {
			where.OR = [
				...TEXT_FIELDS.map((f) => ({ [f]: { contains: search, mode: "insensitive" } })),
				...EXACT_FIELDS.map((f) => ({ [f]: search })),
			];
		}
		// Точные фильтры по колонкам списка.
		for (const f of ["actionType", "objectType", "objectId", "userName", "bin"]) {
			const v = filter?.[f]?.equals ?? filter?.[f];
			if (typeof v === "string" && v) where[f] = v;
		}
		// Период по дате получения (enableDateRange в ModelList).
		const dr = filter?.dateRange;
		if (dr?.startDate || dr?.endDate) {
			where.receivedAt = {};
			if (dr.startDate) where.receivedAt.gte = parseDateParam(dr.startDate, "startDate");
			if (dr.endDate) where.receivedAt.lte = parseDateParam(dr.endDate, "endDate");
		}

		const orderBy = buildOrderBy(MODEL, req.query.sort, { fallback: { id: "desc" } });
		const items = await prisma[MODEL].findMany({
			where, take: limitNumber, orderBy,
			// Ссылки на реальные объекты (а не только имена из 1С) — чтобы из журнала
			// можно было открыть карточку организации/пользователя.
			include: {
				organization: { select: { uuid: true, name: true, bin: true } },
				user: { select: { uuid: true, username: true } },
			},
		});
		const total = await prisma[MODEL].count({ where });
		return res.status(200).json({
			success: true, items, total,
			hasMore: items.length === limitNumber, nextCursor: null,
		});
	} catch (error) {
		if (error instanceof BadRequestError) return res.status(400).json({ success: false, message: error.message });
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Показатели для дашборда (read-only агрегаты) ─────────────────────────────
// ВАЖНО: объявлено ДО `/:uuid`, иначе "stats" распознаётся как uuid.
router.get(`/${ROUTE}/stats`, async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid } = req.query;
		const where = {};
		if (dateFrom || dateTo) {
			where.receivedAt = {};
			if (dateFrom) where.receivedAt.gte = parseDateParam(String(dateFrom), "dateFrom");
			if (dateTo) where.receivedAt.lte = parseDateParam(String(dateTo) + "T23:59:59.999Z", "dateTo");
		}
		// Организация из запроса — только доступная; без неё — те же организации, что в списке.
		// Сырой SQL ниже понимает лишь одну организацию или их перечень, поэтому фильтр строим сами.
		let orgList = null; // null — без ограничения (суперадмин)
		if (typeof organizationUuid === "string" && organizationUuid) {
			if (!orgIsAccessible(req, organizationUuid)) return res.status(404).json({ success: false, message: "Организация не найдена" });
			orgList = [organizationUuid];
		} else {
			const tf = tenantFilter(req);
			if ("organizationUuid" in tf) {
				const v = tf.organizationUuid;
				orgList = v === null ? [] : typeof v === "string" ? [v] : (v?.in ?? []);
			}
		}
		if (orgList) where.organizationUuid = { in: orgList };

		const cat = (rows, key) =>
			rows.map((r) => ({ key: r[key], count: r._count._all })).sort((a, b) => b.count - a.count);

		const [total, byStatus, byObject, byUser] = await Promise.all([
			prisma[MODEL].count({ where }),
			prisma[MODEL].groupBy({ by: ["applyStatus"], where, _count: { _all: true } }),
			// objectName (Номенклатура/Контрагенты/…) информативнее objectType (всегда «Справочник»).
			prisma[MODEL].groupBy({ by: ["objectName"], where, _count: { _all: true } }),
			prisma[MODEL].groupBy({ by: ["userName"], where, _count: { _all: true } }),
		]);

		// Динамика по дням (receivedAt) — raw SQL с теми же границами.
		const params = [];
		let cond = "TRUE";
		if (where.receivedAt?.gte) { params.push(where.receivedAt.gte); cond += ` AND "receivedAt" >= $${params.length}`; }
		if (where.receivedAt?.lte) { params.push(where.receivedAt.lte); cond += ` AND "receivedAt" <= $${params.length}`; }
		if (orgList) { params.push(orgList); cond += ` AND "organizationUuid" = ANY($${params.length}::text[])`; }
		const byDayRaw = await prisma.$queryRawUnsafe(
			`SELECT to_char(date_trunc('day', "receivedAt"), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
			 FROM pipe_activity WHERE ${cond} GROUP BY 1 ORDER BY 1`,
			...params,
		);

		return res.json({
			success: true,
			total,
			byStatus: cat(byStatus, "applyStatus"),
			byObjectName: cat(byObject, "objectName").slice(0, 12),
			byUser: cat(byUser, "userName").slice(0, 10),
			byDay: byDayRaw.map((r) => ({ day: r.day, count: Number(r.count) })),
		});
	} catch (error) {
		if (error instanceof BadRequestError) return res.status(400).json({ success: false, message: error.message });
		console.error(`GET /${ROUTE}/stats error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Одна запись ─────────────────────────────────────────────────────────────
router.get(`/${ROUTE}/:uuid`, async (req, res) => {
	try {
		const item = await prisma[MODEL].findUnique({
			where: { uuid: req.params.uuid },
			include: {
				organization: { select: { uuid: true, name: true, bin: true } },
				user: { select: { uuid: true, username: true } },
			},
		});
		// Событие чужой организации — «не найдено»; несопоставленное (без организации) — только суперадмину.
		if (!item || !checkOwnership(item, req, "organizationUuid", { allowShared: false })) return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:uuid error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Удаление — ЗАПРЕЩЕНО ─────────────────────────────────────────────────────
// «События 1С» не удаляются никогда и никем (правило владельца; Б6 аудита 26.09): это журнал
// интеграции, восстановить его неоткуда. Маршруты оставлены, чтобы интерфейс получил понятный
// отказ, а не «Endpoint не найден».
const DELETE_FORBIDDEN = { success: false, code: "PIPE_EVENTS_IMMUTABLE", message: "События 1С не удаляются — это журнал интеграции" };
router.delete(`/${ROUTE}/:uuid`, (_req, res) => res.status(405).json(DELETE_FORBIDDEN));
router.post(`/${ROUTE}/batch-delete`, (_req, res) => res.status(405).json(DELETE_FORBIDDEN));

export default router;
