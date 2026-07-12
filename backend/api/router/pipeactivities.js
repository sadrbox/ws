// ─────────────────────────────────────────────────────────────────────────────
// Входящие события интеграции (1С → /pipe). ТОЛЬКО ЧТЕНИЕ.
//
// Записи создаёт НЕ пользователь, а внешняя система: 1С шлёт события на POST /pipe
// (см. router/activityhistories.js), они падают в таблицу pipe_activity вместе с
// оригинальным payload. Здесь — просмотр этого «входящего ящика»: что пришло, когда,
// от кого и по какому объекту. Создание/редактирование из UI не предусмотрено.
//
// Изоляция по организации НЕ применяется: у PipeActivity нет organizationUuid —
// 1С присылает только БИН/краткое имя (organizationShortName, bin), FK на нашу
// организацию отсутствует. Доступ ограничен правом ActivityHistory (см. ROUTE_TO_MODEL).
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
		const items = await prisma[MODEL].findMany({ where, take: limitNumber, orderBy });
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
		const item = await prisma[MODEL].findUnique({ where: { uuid: req.params.uuid } });
		if (!item) return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:uuid error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
