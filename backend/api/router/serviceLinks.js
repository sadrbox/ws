// Кабинет обслуживающей фирмы и согласие клиента (К3–К4 плана PLAN_INSTALL_MODES_2026-09-24.md).
//
// ДВЕ СТОРОНЫ ОДНОЙ СВЯЗИ. Фирма заводит клиента и назначает на него сотрудников; клиент видит,
// кого он впустил, и может это прекратить. Оба вида доступа проверяются здесь по-разному, и
// путать их нельзя: «управлять связью» может фирма, «разрешить или отозвать» — только клиент.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import {
	upsertLink, confirmLink, setLinkState, assignStaff, unassignStaff,
	clientsOf, providersOf, LINK_STATES,
} from "../../services/serviceLinks.js";
import { hasUnconditionalAccess, orgIsAccessible } from "../../utils/auth.js";
import { recordAudit } from "../../services/auditLog.js";

const router = express.Router();

/** Распоряжаться связью может тот, кто распоряжается организацией-участником. */
function manages(req, organizationUuid) {
	return hasUnconditionalAccess(req) && orgIsAccessible(req, organizationUuid);
}

function audit(req, actionType, link, props = null) {
	void recordAudit({
		actionType,
		objectType: "ServiceLink",
		objectId: link?.uuid ?? null,
		objectName: "Обслуживание",
		organizationUuid: link?.clientOrgUuid ?? null,
		user: { uuid: req.user?.uuid ?? null, username: req.user?.username ?? null },
		props,
		host: req?.hostname ?? null,
		ip: req?.ip ?? null,
	});
}

// GET /service-links?as=provider|client — кабинет фирмы либо список тех, кто обслуживает меня.
router.get("/service-links", async (req, res) => {
	try {
		const org = req.user?.organizationUuid;
		if (!org) return res.status(400).json({ success: false, message: "Не выбрана организация" });
		const as = req.query.as === "client" ? "client" : "provider";
		const items = as === "provider" ? await clientsOf(org) : await providersOf(org);
		return res.json({ success: true, data: { as, items } });
	} catch (err) {
		console.error("GET /service-links error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

/**
 * POST /service-links — фирма предлагает обслуживание клиенту (К4).
 *
 * Связь рождается в состоянии `requested`: доступа она пока не даёт. Впустить фирму может
 * только клиент — иначе завести себе доступ к чужому учёту мог бы кто угодно, знающий uuid.
 */
router.post("/service-links", async (req, res) => {
	try {
		const { clientOrgUuid, profile, modules, validUntil, note } = req.body ?? {};
		const serviceOrgUuid = req.user?.organizationUuid;
		if (!serviceOrgUuid || !clientOrgUuid) {
			return res.status(400).json({ success: false, message: "Нужны организация фирмы и клиент" });
		}
		if (!manages(req, serviceOrgUuid)) {
			return res.status(403).json({ success: false, message: "Недостаточно прав" });
		}
		const link = await upsertLink({
			serviceOrgUuid, clientOrgUuid, note,
			...(profile ? { profile } : {}),
			...(modules !== undefined ? { modules } : {}),
			...(validUntil ? { validUntil: new Date(validUntil) } : {}),
		});
		audit(req, "service_link_requested", link, { serviceOrgUuid });
		return res.status(201).json({ success: true, data: link });
	} catch (err) {
		console.error("POST /service-links error:", err);
		return res.status(400).json({ success: false, message: err.message || "Ошибка сервера" });
	}
});

/**
 * POST /service-links/:uuid/confirm — КЛИЕНТ впускает фирму.
 *
 * Проверяем права именно у клиентской стороны: подтверждение самой фирмой сделало бы согласие
 * формальностью, а весь смысл записи — в том, что доступ открыл владелец данных.
 */
router.post("/service-links/:uuid/confirm", async (req, res) => {
	try {
		const link = await prisma.serviceLink.findUnique({ where: { uuid: req.params.uuid } });
		if (!link) return res.status(404).json({ success: false, message: "Связь не найдена" });
		if (!manages(req, link.clientOrgUuid)) {
			return res.status(403).json({ success: false, message: "Подтвердить может только администратор организации-клиента" });
		}
		const updated = await confirmLink({ uuid: link.uuid, confirmedByUuid: req.user?.uuid ?? null });
		audit(req, "service_link_confirmed", updated, { serviceOrgUuid: link.serviceOrgUuid });
		return res.json({ success: true, data: updated });
	} catch (err) {
		console.error("POST /service-links/:uuid/confirm error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

/**
 * PATCH /service-links/:uuid/state — приостановить, возобновить, прекратить.
 *
 * Прекратить вправе ОБЕ стороны: клиент — потому что это его данные, фирма — потому что договор
 * может закончиться и с её стороны. Запись остаётся: след «кто вёл учёт в таком-то году» нужен.
 */
router.patch("/service-links/:uuid/state", async (req, res) => {
	try {
		const { state } = req.body ?? {};
		if (!LINK_STATES.includes(state)) {
			return res.status(400).json({ success: false, message: "Неизвестное состояние связи" });
		}
		const link = await prisma.serviceLink.findUnique({ where: { uuid: req.params.uuid } });
		if (!link) return res.status(404).json({ success: false, message: "Связь не найдена" });
		if (!manages(req, link.clientOrgUuid) && !manages(req, link.serviceOrgUuid)) {
			return res.status(403).json({ success: false, message: "Недостаточно прав" });
		}
		// Возобновление после отзыва — это новое согласие клиента, а не смена состояния.
		if (state === "active" && link.state === "revoked") {
			return res.status(409).json({
				success: false,
				code: "NEEDS_CONFIRMATION",
				message: "Отозванное обслуживание возобновляется новым подтверждением клиента",
			});
		}
		const updated = await setLinkState({ uuid: link.uuid, state });
		audit(req, "service_link_state", updated, { state });
		return res.json({ success: true, data: updated });
	} catch (err) {
		console.error("PATCH /service-links/:uuid/state error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

/** POST/DELETE /service-links/:uuid/staff — назначение сотрудника фирмы на клиента (К2). */
router.post("/service-links/:uuid/staff", async (req, res) => {
	try {
		const { userUuid, role } = req.body ?? {};
		if (!userUuid) return res.status(400).json({ success: false, message: "Нужен userUuid" });
		const link = await prisma.serviceLink.findUnique({ where: { uuid: req.params.uuid } });
		if (!link) return res.status(404).json({ success: false, message: "Связь не найдена" });
		// Назначает ФИРМА: это её сотрудники и её распределение работы.
		if (!manages(req, link.serviceOrgUuid)) {
			return res.status(403).json({ success: false, message: "Недостаточно прав" });
		}
		const a = await assignStaff({ linkUuid: link.uuid, userUuid, role });
		audit(req, "service_staff_assigned", link, { userUuid, role: a.role });
		return res.status(201).json({ success: true, data: a });
	} catch (err) {
		console.error("POST /service-links/:uuid/staff error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.delete("/service-links/:uuid/staff/:userUuid", async (req, res) => {
	try {
		const link = await prisma.serviceLink.findUnique({ where: { uuid: req.params.uuid } });
		if (!link) return res.status(404).json({ success: false, message: "Связь не найдена" });
		if (!manages(req, link.serviceOrgUuid)) {
			return res.status(403).json({ success: false, message: "Недостаточно прав" });
		}
		const removed = await unassignStaff({ linkUuid: link.uuid, userUuid: req.params.userUuid });
		audit(req, "service_staff_unassigned", link, { userUuid: req.params.userUuid });
		return res.json({ success: true, data: { removed } });
	} catch (err) {
		console.error("DELETE /service-links/:uuid/staff error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
