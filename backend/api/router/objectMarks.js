// ─────────────────────────────────────────────────────────────────────────────
// Метки — ссылки на объекты, прикреплённые к записи. Привязка по паре
// (ownerType, ownerUuid); цель — (targetType, targetUuid, targetLabel).
//   GET    /object-marks?ownerType&ownerUuid   — метки записи
//   GET    /object-marks?targetType&targetUuid — ОБРАТНЫЕ: кто ссылается на объект
//   POST   /object-marks                       — поставить метку (идемпотентно)
//   DELETE /object-marks/:id                   — снять метку (мягко)
//
// Org-изоляция — как в notes/chat: метки чужих организаций не видны (метки без
// организации видны всем), а сам список и так сужен конкретной записью.
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

/** Автор метки или суперадмин — только они её снимают. */
function canModify(req, mark) {
	return req.user?.isSuperAdmin || (mark.authorUuid && mark.authorUuid === req.user?.uuid);
}

// ── Список меток ─────────────────────────────────────────────────────────────
router.get("/object-marks", async (req, res) => {
	try {
		const ownerType = String(req.query.ownerType || "").trim();
		const ownerUuid = String(req.query.ownerUuid || "").trim();
		const targetType = String(req.query.targetType || "").trim();
		const targetUuid = String(req.query.targetUuid || "").trim();

		const where = { deletedAt: null };
		if (ownerType && ownerUuid) {
			// Метки конкретной записи.
			where.ownerType = ownerType;
			where.ownerUuid = ownerUuid;
		} else if (targetType && targetUuid) {
			// Обратный поиск: какие записи ссылаются на этот объект.
			where.targetType = targetType;
			where.targetUuid = targetUuid;
		} else {
			return res.status(400).json({
				success: false,
				message: "Нужна пара ownerType+ownerUuid либо targetType+targetUuid",
			});
		}

		const orgs = allowedOrgs(req);
		if (orgs !== null) {
			where.OR = [{ organizationUuid: null }, { organizationUuid: { in: orgs } }];
		}

		const items = await prisma.objectMark.findMany({
			where,
			orderBy: { createdAt: "desc" },
			take: 200,
		});
		return res.status(200).json({ success: true, items });
	} catch (error) {
		console.error("GET /object-marks error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Поставить метку ──────────────────────────────────────────────────────────
router.post("/object-marks", async (req, res) => {
	try {
		const { ownerType, ownerUuid, targetType, targetUuid, targetLabel, organizationUuid } = req.body;
		if (!ownerType || !ownerUuid || !targetType || !targetUuid) {
			return res.status(400).json({
				success: false,
				message: "ownerType, ownerUuid, targetType и targetUuid обязательны",
			});
		}
		// Не даём пометить запись самой собой — метка была бы бессмысленной.
		if (ownerType === targetType && ownerUuid === targetUuid) {
			return res.status(400).json({ success: false, message: "Нельзя пометить запись самой собой" });
		}

		const key = { ownerType, ownerUuid, targetType, targetUuid };
		const existing = await prisma.objectMark.findFirst({ where: key });

		// Идемпотентность: повторная отметка того же объекта обновляет подпись и
		// оживляет ранее снятую метку, а не падает на unique-ограничении.
		const item = existing
			? await prisma.objectMark.update({
				where: { id: existing.id },
				data: { targetLabel: targetLabel || existing.targetLabel, deletedAt: null },
			})
			: await prisma.objectMark.create({
				data: {
					...key,
					targetLabel: targetLabel || null,
					organizationUuid: organizationUuid || null,
					authorUuid: req.user?.uuid || null,
					authorName: req.user?.username || req.user?.email || null,
				},
			});

		return res.status(existing ? 200 : 201).json({ success: true, item });
	} catch (error) {
		console.error("POST /object-marks error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Снять метку ──────────────────────────────────────────────────────────────
router.delete("/object-marks/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		const where = isNumeric ? { id: numId } : { uuid: param };

		const mark = await prisma.objectMark.findUnique({ where });
		if (!mark) return res.status(404).json({ success: false, message: "Метка не найдена" });
		if (!canModify(req, mark)) {
			return res.status(403).json({ success: false, message: "Снять метку может только её автор" });
		}

		await prisma.objectMark.update({ where, data: { deletedAt: new Date() } });
		return res.status(200).json({ success: true });
	} catch (error) {
		console.error("DELETE /object-marks error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
