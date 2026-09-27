// ─────────────────────────────────────────────────────────────────────────────
// Заметки к записи (документ/справочник). Привязка по (entityType, entityUuid).
//   GET    /notes?entityType&entityUuid — заметки записи (новые сверху)
//   POST   /notes                        — создать (автор = текущий пользователь)
//   PUT    /notes/:id                     — изменить тело (автор/суперадмин)
//   DELETE /notes/:id                     — мягко удалить (автор/суперадмин)
// Заметка может стать основанием задачи (Todo) — предзаполнение делает фронт.
// Org-изоляция — по доступным пользователю организациям (как в chat), а сам
// список и так сужен конкретной записью, которую пользователь уже открыл.
//
// ОРГАНИЗАЦИЮ ЗАМЕТКИ ОПРЕДЕЛЯЕТ СЕРВЕР (аудит 26.09, п. 15 отчёта инспекции маршрутов). Кнопка
// заметок в форме её не присылала — заметка получала null и попадала в журнал ВСЕХ организаций
// установки. Теперь организация — это организация записи (utils/entityOwner.js); у общей записи —
// организация автора. Заметки без организации (старые) видны: на открытой доступной записи — всем,
// кто её видит; в журнале — только автору; целиком — суперадмину.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { orgIsAccessible } from "../../utils/auth.js";
import { resolveEntity, entityAccessible, organizationForAttachment, allowedOrgList } from "../../utils/entityOwner.js";

const router = express.Router();

/** Организации, доступные пользователю. null = суперадмин с открытыми данными (видит всё). */
const allowedOrgs = allowedOrgList;

/** Автор заметки (пока у него есть доступ к её организации) или суперадмин — только они правят/удаляют. */
function canModify(req, note) {
	if (req.user?.isSuperAdmin) return true;
	if (!note.authorUuid || note.authorUuid !== req.user?.uuid) return false;
	return note.organizationUuid == null || orgIsAccessible(req, note.organizationUuid);
}

// ── Заметки записи ───────────────────────────────────────────────────────────
router.get("/notes", async (req, res) => {
	try {
		const entityType = String(req.query.entityType || "").trim();
		const entityUuid = String(req.query.entityUuid || "").trim();
		const orgs = allowedOrgs(req);
		const where = { deletedAt: null };

		/*
		 * ДВА РЕЖИМА ОДНОГО МАРШРУТА (25.09).
		 *
		 * С `entityType`+`entityUuid` — заметки ОДНОЙ записи: так их читает кнопка в форме и чат
		 * внутри 1С. Так было с самого начала, и это поведение не меняется.
		 *
		 * Без параметров — ЖУРНАЛ: все заметки доступных организаций. Его не было вовсе, и
		 * заметку, написанную неделю назад, найти было негде: нужно было вспомнить, к какой
		 * записи её привязали, и открыть именно её. Заметка тем и ценна, что пишется мимоходом,
		 * — значит и находиться должна без усилий.
		 *
		 * Частичный набор параметров (только тип, только uuid) — ошибка вызывающего, а не режим:
		 * отвечаем отказом, иначе он получит журнал вместо ожидаемой выборки и не заметит.
		 */
		let recordOpen = false;
		if (entityType || entityUuid) {
			if (!entityType || !entityUuid) {
				return res.status(400).json({ success: false, message: "entityType и entityUuid указываются вместе" });
			}
			where.entityType = entityType;
			where.entityUuid = entityUuid;
			// Заметки чужой записи не показываем вовсе — даже свои организации.
			const ent = await resolveEntity(entityType, entityUuid);
			if (ent.found && !entityAccessible(req, ent)) return res.status(200).json({ success: true, items: [] });
			recordOpen = ent.found;
		}

		// Скрываем заметки чужих организаций. Без организации (старые) — на открытой доступной
		// записи всем, кто её видит, в журнале — только автору.
		if (orgs !== null) {
			where.OR = [
				{ organizationUuid: { in: orgs } },
				recordOpen ? { organizationUuid: null } : { organizationUuid: null, authorUuid: req.user?.uuid ?? "__none__" },
			];
		}

		// Поиск по тексту и автору — журналу без него нечем пользоваться, когда заметок сотни.
		const search = String(req.query.search || "").trim();
		if (search) {
			where.AND = [{ OR: [
				{ body: { contains: search, mode: "insensitive" } },
				{ authorName: { contains: search, mode: "insensitive" } },
			] }];
		}

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
		// Организация заметки — организация записи (чужая запись — 404, чужая организация в теле — 403);
		// у общей записи — организация автора.
		const noteOrg = await organizationForAttachment(req, String(entityType), String(entityUuid), organizationUuid || null);
		const authorName = req.user.username || req.user.email || null;
		const item = await prisma.note.create({
			data: {
				entityType: String(entityType), entityUuid: String(entityUuid), body: text,
				organizationUuid: noteOrg,
				authorUuid: req.user.uuid, authorName,
			},
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
		if (error?.status === 403 || error?.status === 404) return res.status(error.status).json({ success: false, message: error.message });
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
