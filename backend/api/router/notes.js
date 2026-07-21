// ─────────────────────────────────────────────────────────────────────────────
// Заметки к записи (документ/справочник). Привязка по (entityType, entityUuid).
//   GET    /notes?entityType&entityUuid — заметки записи (новые сверху)
//   POST   /notes                        — создать (автор = текущий пользователь)
//   PUT    /notes/:id                     — изменить тело (автор/суперадмин)
//   DELETE /notes/:id                     — мягко удалить (автор/суперадмин)
// Заметка может стать основанием задачи (Todo) — предзаполнение делает фронт.
// Org-изоляция — по доступным пользователю организациям (как в chat), а сам
// список и так сужен конкретной записью, которую пользователь уже открыл.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";

const router = express.Router();

/** Организации, доступные пользователю. null = суперадмин (видит всё). */
function allowedOrgs(req) {
	if (req.user?.isSuperAdmin) return null;
	if (req.user?.allowedOrgUuids?.length) return req.user.allowedOrgUuids;
	if (req.user?.organizationUuid) return [req.user.organizationUuid];
	return [];
}

/** Автор заметки или суперадмин — только они правят/удаляют. */
function canModify(req, note) {
	return req.user?.isSuperAdmin || (note.authorUuid && note.authorUuid === req.user?.uuid);
}

// ── Заметки записи ───────────────────────────────────────────────────────────
router.get("/notes", async (req, res) => {
	try {
		const entityType = String(req.query.entityType || "").trim();
		const entityUuid = String(req.query.entityUuid || "").trim();
		if (!entityType || !entityUuid) return res.status(400).json({ success: false, message: "entityType и entityUuid обязательны" });
		const orgs = allowedOrgs(req);
		const where = { entityType, entityUuid, deletedAt: null };
		// Скрываем заметки чужих организаций (заметки без организации видны всем).
		if (orgs !== null) where.OR = [{ organizationUuid: null }, { organizationUuid: { in: orgs } }];
		const items = await prisma.note.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 });
		return res.status(200).json({ success: true, items });
	} catch (error) {
		console.error("GET /notes error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Создать заметку ──────────────────────────────────────────────────────────
router.post("/notes", async (req, res) => {
	try {
		if (!req.user?.uuid) return res.status(401).json({ success: false, message: "Требуется авторизация" });
		const { entityType, entityUuid, body, organizationUuid } = req.body;
		const text = String(body ?? "").trim();
		if (!entityType || !entityUuid) return res.status(400).json({ success: false, message: "entityType и entityUuid обязательны" });
		if (!text) return res.status(400).json({ success: false, message: "Текст заметки обязателен" });
		const authorName = req.user.username || req.user.email || null;
		const item = await prisma.note.create({
			data: {
				entityType: String(entityType), entityUuid: String(entityUuid), body: text,
				organizationUuid: organizationUuid || null,
				authorUuid: req.user.uuid, authorName,
			},
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error("POST /notes error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Изменить тело заметки ────────────────────────────────────────────────────
router.put("/notes/:id", async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const existing = await prisma.note.findUnique({ where: w });
		if (!existing || existing.deletedAt) return res.status(404).json({ success: false, message: "Заметка не найдена" });
		if (!canModify(req, existing)) return res.status(403).json({ success: false, message: "Изменять может только автор" });
		const text = String(req.body?.body ?? "").trim();
		if (!text) return res.status(400).json({ success: false, message: "Текст заметки обязателен" });
		const item = await prisma.note.update({ where: { uuid: existing.uuid }, data: { body: text } });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error("PUT /notes/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Удалить заметку (мягко) ──────────────────────────────────────────────────
router.delete("/notes/:id", async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const existing = await prisma.note.findUnique({ where: w });
		if (!existing || existing.deletedAt) return res.status(404).json({ success: false, message: "Заметка не найдена" });
		if (!canModify(req, existing)) return res.status(403).json({ success: false, message: "Удалять может только автор" });
		await prisma.note.update({ where: { uuid: existing.uuid }, data: { deletedAt: new Date() } });
		return res.status(200).json({ success: true });
	} catch (error) {
		console.error("DELETE /notes/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
