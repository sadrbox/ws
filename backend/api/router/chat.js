// ─────────────────────────────────────────────────────────────────────────────
// Чат между пользователями в пределах организации (E4, collaboration).
//
//   GET  /chat/messages?organizationUuid  — история (tenant-изоляция)
//   POST /chat/messages                   — отправка (пишет в БД + публикует в шину)
//
// SSE-поток вынесен в chatStream.js: EventSource не умеет слать заголовок
// Authorization, поэтому там своя авторизация по query-токену, и монтируется он ДО
// authMiddleware. Здесь — обычные защищённые маршруты.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { publish } from "../../services/chatBus.js";

const router = express.Router();

/** Организации, доступные пользователю (для изоляции чата). null = суперадмин. */
function allowedOrgs(req) {
	if (req.user?.isSuperAdmin) return null;
	if (req.user?.allowedOrgUuids?.length) return req.user.allowedOrgUuids;
	if (req.user?.organizationUuid) return [req.user.organizationUuid];
	return [];
}

/** Проверка, что пользователь имеет доступ к организации канала. */
function canAccessOrg(req, organizationUuid) {
	const orgs = allowedOrgs(req);
	return orgs === null || orgs.includes(organizationUuid);
}

// ── История сообщений организации ────────────────────────────────────────────
router.get("/chat/messages", async (req, res) => {
	try {
		const organizationUuid = String(req.query.organizationUuid || "");
		if (!organizationUuid) return res.status(400).json({ success: false, message: "Не указана организация" });
		if (!canAccessOrg(req, organizationUuid)) return res.status(403).json({ success: false, message: "Нет доступа к чату этой организации" });

		const limit = Math.min(Number(req.query.limit) || 100, 300);
		const before = req.query.before ? new Date(String(req.query.before)) : null;

		const items = await prisma.chatMessage.findMany({
			where: {
				organizationUuid,
				deletedAt: null,
				...(before ? { createdAt: { lt: before } } : {}),
			},
			orderBy: { createdAt: "desc" },
			take: limit,
			select: { uuid: true, organizationUuid: true, authorUuid: true, authorName: true, body: true, createdAt: true },
		});
		// Отдаём в хронологическом порядке (от старых к новым) — как в чате.
		return res.json({ success: true, items: items.reverse() });
	} catch (err) {
		console.error("GET /chat/messages error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Отправка сообщения ───────────────────────────────────────────────────────
router.post("/chat/messages", async (req, res) => {
	try {
		const organizationUuid = String(req.body.organizationUuid || "");
		const body = String(req.body.body ?? "").trim();
		if (!organizationUuid) return res.status(400).json({ success: false, message: "Не указана организация" });
		if (!body) return res.status(400).json({ success: false, message: "Пустое сообщение" });
		if (body.length > 4000) return res.status(400).json({ success: false, message: "Сообщение слишком длинное" });
		if (!canAccessOrg(req, organizationUuid)) return res.status(403).json({ success: false, message: "Нет доступа к чату этой организации" });

		// Имя автора денормализуем на момент отправки — чтобы история читалась и
		// после переименования/удаления пользователя.
		const author = await prisma.user.findUnique({
			where: { uuid: req.user.uuid },
			select: { username: true, employee: { select: { fullName: true } } },
		});
		const authorName = author?.employee?.fullName || author?.username || "—";

		const msg = await prisma.chatMessage.create({
			data: { organizationUuid, authorUuid: req.user.uuid, authorName, body },
			select: { uuid: true, organizationUuid: true, authorUuid: true, authorName: true, body: true, createdAt: true },
		});

		// Доставляем подписчикам организации в реальном времени.
		publish(organizationUuid, { type: "chat", message: msg });
		return res.status(201).json({ success: true, item: msg });
	} catch (err) {
		console.error("POST /chat/messages error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Непрочитанное по доступным организациям (E4.1) ───────────────────────────
// Считаем сообщения ПОЗЖЕ отметки прочтения и НЕ свои. Организации без отметки
// считаются непрочитанными целиком (пользователь ещё не открывал канал).
router.get("/chat/unread", async (req, res) => {
	try {
		const orgs = allowedOrgs(req);
		const marks = await prisma.chatRead.findMany({
			where: { userUuid: req.user.uuid },
			select: { organizationUuid: true, lastReadAt: true },
		});
		const readAt = new Map(marks.map((m) => [m.organizationUuid, m.lastReadAt]));

		// Сначала одним groupBy находим организации, где вообще есть чужие сообщения
		// (обычно их единицы) — чтобы не гонять счётчик по всем доступным орг.
		const rows = await prisma.chatMessage.groupBy({
			by: ["organizationUuid"],
			where: {
				deletedAt: null,
				authorUuid: { not: req.user.uuid },
				...(orgs === null ? {} : { organizationUuid: { in: orgs } }),
			},
			_count: { _all: true },
		});

		// Точный счёт непрочитанного по каждой организации (учитывая её отметку).
		// Отдельный count нужен только там, где отметка есть; без отметки канал
		// не открывался — непрочитано всё, и число уже посчитано в groupBy.
		const byOrg = {};
		let total = 0;
		for (const r of rows) {
			const since = readAt.get(r.organizationUuid);
			const count = since
				? await prisma.chatMessage.count({
					where: {
						organizationUuid: r.organizationUuid, deletedAt: null,
						authorUuid: { not: req.user.uuid }, createdAt: { gt: since },
					},
				})
				: r._count._all;
			if (count > 0) { byOrg[r.organizationUuid] = count; total += count; }
		}
		return res.status(200).json({ success: true, total, byOrg });
	} catch (err) {
		console.error("GET /chat/unread error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// Отметить канал организации прочитанным (до текущего момента).
router.post("/chat/read", async (req, res) => {
	try {
		const organizationUuid = String(req.body?.organizationUuid || "").trim();
		if (!organizationUuid) return res.status(400).json({ success: false, message: "organizationUuid обязателен" });
		if (!canAccessOrg(req, organizationUuid)) {
			return res.status(403).json({ success: false, message: "Нет доступа к организации" });
		}
		const now = new Date();
		await prisma.chatRead.upsert({
			where: { userUuid_organizationUuid: { userUuid: req.user.uuid, organizationUuid } },
			create: { userUuid: req.user.uuid, organizationUuid, lastReadAt: now },
			update: { lastReadAt: now },
		});
		return res.status(200).json({ success: true });
	} catch (err) {
		console.error("POST /chat/read error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
