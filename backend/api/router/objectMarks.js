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
//
// АУДИТ 26.09 (п. 29 и 15 отчёта инспекции маршрутов): повторная отметка «оживляла» и
// переименовывала метку чужого автора и чужой организации, а организацию метки присылал клиент
// (null — видна всем). Теперь организация метки — организация записи-владельца (utils/entityOwner.js),
// чужую метку повтор не трогает, метки без организации на чужой записи не видны.
//
// ПРАВА: маршрут намеренно НЕ добавлен в ROUTE_TO_MODEL (utils/auth.js) — метка
// это пользовательская пометка поверх записи, того же класса, что заметка (notes
// тоже без модельного права). Бизнес-данные она не меняет, а изоляция по
// организациям и проверка автора при снятии уже есть. В отличие от справочника
// статусов задач (todo-statuses), который является КОНФИГУРАЦИЕЙ и право требует.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { orgIsAccessible } from "../../utils/auth.js";
import { resolveEntity, entityAccessible, organizationForAttachment, allowedOrgList } from "../../utils/entityOwner.js";

const router = express.Router();

/** Организации, доступные пользователю. null = суперадмин с открытыми данными (видит всё). */
const allowedOrgs = allowedOrgList;

/** Автор метки (пока у него есть доступ к её организации) или суперадмин — только они её снимают. */
function canModify(req, mark) {
	if (req.user?.isSuperAdmin) return true;
	if (!mark.authorUuid || mark.authorUuid !== req.user?.uuid) return false;
	return mark.organizationUuid == null || orgIsAccessible(req, mark.organizationUuid);
}

/** Видна ли метка пользователю (организация доступна; без организации — только автору). */
function markVisible(req, mark) {
	const orgs = allowedOrgs(req);
	if (orgs === null) return true;
	if (mark.organizationUuid) return orgs.includes(mark.organizationUuid);
	return !!mark.authorUuid && mark.authorUuid === req.user?.uuid;
}

// ── Список меток ─────────────────────────────────────────────────────────────
router.get("/object-marks", async (req, res) => {
	try {
		const ownerType = String(req.query.ownerType || "").trim();
		const ownerUuid = String(req.query.ownerUuid || "").trim();
		const targetType = String(req.query.targetType || "").trim();
		const targetUuid = String(req.query.targetUuid || "").trim();

		const where = { deletedAt: null };
		let recordOpen = false;
		if (ownerType && ownerUuid) {
			// Метки конкретной записи — если сама запись доступна.
			where.ownerType = ownerType;
			where.ownerUuid = ownerUuid;
			const ent = await resolveEntity(ownerType, ownerUuid);
			if (ent.found && !entityAccessible(req, ent)) return res.status(200).json({ success: true, items: [] });
			recordOpen = ent.found;
		} else if (targetType && targetUuid) {
			// Обратный поиск: какие записи ссылаются на этот объект.
			where.targetType = targetType;
			where.targetUuid = targetUuid;
			const ent = await resolveEntity(targetType, targetUuid);
			if (ent.found && !entityAccessible(req, ent)) return res.status(200).json({ success: true, items: [] });
		} else {
			return res.status(400).json({
				success: false,
				message: "Нужна пара ownerType+ownerUuid либо targetType+targetUuid",
			});
		}

		// Метки чужих организаций скрыты. Без организации (старые) — на открытой доступной записи
		// всем, кто её видит; в обратном поиске — только автору: иначе через общую цель было бы
		// видно, какие записи ЧУЖИХ организаций на неё ссылаются.
		const orgs = allowedOrgs(req);
		if (orgs !== null) {
			where.OR = [
				{ organizationUuid: { in: orgs } },
				recordOpen ? { organizationUuid: null } : { organizationUuid: null, authorUuid: req.user?.uuid ?? "__none__" },
			];
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
		// Tenant-изоляция на ЗАПИСИ: организация метки — организация записи-владельца (чужая
		// запись — 404, чужая организация в теле — 403); у общей записи — организация автора.
		const markOrg = await organizationForAttachment(req, String(ownerType), String(ownerUuid), organizationUuid || null);

		const key = { ownerType, ownerUuid, targetType, targetUuid };
		const existing = await prisma.objectMark.findFirst({ where: key });

		// Чужую метку повтор не трогает: живую — показываем как есть (если видна), снятую — пере-
		// ставляем уже от своего имени и в своей организации. Раньше повтор оживлял и
		// переименовывал метку чужого автора и чужой организации.
		if (existing && !canModify(req, existing)) {
			if (!existing.deletedAt) {
				if (!markVisible(req, existing)) return res.status(409).json({ success: false, message: "Такая метка уже поставлена в другой организации" });
				return res.status(200).json({ success: true, item: existing });
			}
		}

		// Идемпотентность: повторная отметка того же объекта обновляет подпись и
		// оживляет ранее снятую метку, а не падает на unique-ограничении.
		const author = { authorUuid: req.user?.uuid || null, authorName: req.user?.username || req.user?.email || null };
		const item = existing
			? await prisma.objectMark.update({
				where: { id: existing.id },
				data: {
					targetLabel: targetLabel || existing.targetLabel,
					deletedAt: null,
					// Своя метка остаётся своей; старая без организации получает организацию записи.
					...(canModify(req, existing)
						? (existing.organizationUuid == null ? { organizationUuid: markOrg } : {})
						: { ...author, organizationUuid: markOrg }),
				},
			})
			: await prisma.objectMark.create({
				data: {
					...key,
					targetLabel: targetLabel || null,
					organizationUuid: markOrg,
					...author,
				},
			});

		return res.status(existing ? 200 : 201).json({ success: true, item });
	} catch (error) {
		if (error?.status === 403 || error?.status === 404) return res.status(error.status).json({ success: false, message: error.message });
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
		if (!mark || !markVisible(req, mark)) return res.status(404).json({ success: false, message: "Метка не найдена" });
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
