// ─────────────────────────────────────────────────────────────────────────────
// Входящие события интеграции (1С → /pipe). ТОЛЬКО ЧТЕНИЕ.
//
// Записи создаёт НЕ пользователь, а внешняя система: 1С шлёт события на POST /pipe
// (см. router/activityhistories.js), они падают в таблицу pipe_activity вместе с
// оригинальным payload. Здесь — просмотр этого «входящего ящика»: что пришло, когда,
// от кого и по какому объекту. Создавать/редактировать события из UI нельзя, а вот
// УДАЛЯТЬ можно: журнал растёт, разобранные и ошибочные записи нужно убирать.
//
// Событие ссылается на РЕАЛЬНЫЕ объекты системы (organizationUuid/userUuid,
// см. services/pipeActor.js) — их и отдаём вместе с записью, чтобы из журнала можно
// было открыть карточку. Текстовые organizationShortName/bin/userName остаются как
// «что именно прислала 1С» — на случай расхождений с нашими данными.
//
// Изоляция по организации НЕ применяется: журнал интеграции нужен целиком, включая
// события, чью организацию сопоставить не удалось. Доступ ограничен правом
// ActivityHistory (см. ROUTE_TO_MODEL).
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { buildOrderBy } from "../../utils/sortOrder.js";

const router = express.Router();
const ROUTE = "pipeactivities";
const MODEL = "pipeActivity";
const TEXT_FIELDS = ["userName", "objectType", "objectName", "objectId", "actionType", "bin", "organizationShortName"];

// ── Список ──────────────────────────────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const limitNumber = Math.min(Math.max(rawLimit !== undefined ? Number(rawLimit) : 500, 1), 999999);
		const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
		const filter = req.query.filter && typeof req.query.filter === "object" ? req.query.filter : {};

		const where = {};
		if (search) {
			where.OR = TEXT_FIELDS.map((f) => ({ [f]: { contains: search, mode: "insensitive" } }));
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
			if (dr.startDate) where.receivedAt.gte = new Date(dr.startDate);
			if (dr.endDate) where.receivedAt.lte = new Date(dr.endDate);
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
		console.error(`GET /${ROUTE} error:`, error);
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
		if (!item) return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:uuid error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Удаление ────────────────────────────────────────────────────────────────
// Журнал событий 1С со временем растёт, а разобранные/ошибочные записи нужно уметь
// убирать. Удаляется ТОЛЬКО запись журнала: объект справочника, который событие уже
// создало (applyUuid), не трогаем — он живёт своей жизнью и на него ссылаются
// документы. Удаление события — не «откат» его применения.
// Ключ — uuid: именно его шлёт клиент (useModelDelete: DELETE /{model}/{uuid}).
router.delete(`/${ROUTE}/:uuid`, async (req, res) => {
	try {
		await prisma[MODEL].delete({ where: { uuid: req.params.uuid } });
		return res.status(200).json({ success: true });
	} catch (error) {
		if (error?.code === "P2025") {
			return res.status(404).json({ success: false, message: "Не найдено" });
		}
		console.error(`DELETE /${ROUTE}/:uuid error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// Групповое удаление: клиент шлёт { uuids } и ждёт failed: [{ uuid, message }].
router.post(`/${ROUTE}/batch-delete`, async (req, res) => {
	try {
		const uuids = Array.isArray(req.body?.uuids)
			? req.body.uuids.filter((u) => typeof u === "string" && u)
			: [];
		if (!uuids.length) {
			return res.status(400).json({ success: false, message: "Не переданы uuids" });
		}
		const { count } = await prisma[MODEL].deleteMany({ where: { uuid: { in: uuids } } });
		return res.status(200).json({ success: true, deleted: count, failed: [] });
	} catch (error) {
		console.error(`POST /${ROUTE}/batch-delete error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
