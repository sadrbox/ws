// Профили прав: список и назначение (О2 плана PLAN_INSTALL_MODES_2026-09-24.md).
//
// Определения профилей — в `services/permissionProfiles.js` (они часть поставки и живут в коде),
// разворот в права — в `services/orgMembership.js`. Здесь только маршруты и проверка права
// назначать: раздача доступа — это власть, и распоряжаться ею может не всякий, кому доступ дан.
import express from "express";
import { listProfiles, findProfile, expandProfile } from "../../services/permissionProfiles.js";
import { applyProfile, grantMembership, normalizeRole } from "../../services/orgMembership.js";
import { isAdminOfOrg } from "../../utils/auth.js";
import { recordAudit } from "../../services/auditLog.js";
import { prisma } from "../../prisma/prisma-client.js";
import { servicedOrgsFor } from "../../services/serviceLinks.js";

const router = express.Router();

/**
 * Назначать профиль может тот, кто и так распоряжается доступом: суперадмин или администратор
 * организации. Проверяем ИМЕННО это, а не право на модель `AccessPermission`: выдав себе
 * «полный доступ к правам», обычный пользователь иначе присвоил бы себе что угодно.
 *
 * Администратор — ИМЕННО ЭТОЙ организации, по членству (Б2 аудита 26.09): раньше хватало быть
 * админом любой, и профиль owner с ролью admin выдавался себе в чужой фирме.
 */
function canAssign(req, organizationUuid) {
	return isAdminOfOrg(req, organizationUuid);
}

// GET /permission-profiles → список профилей; ?code=... → ещё и разворот по моделям.
router.get("/permission-profiles", async (req, res) => {
	try {
		const code = typeof req.query.code === "string" ? req.query.code : null;
		if (code) {
			const p = findProfile(code);
			if (!p) return res.status(404).json({ success: false, message: "Профиль не найден" });
			return res.json({
				success: true,
				data: { code: p.code, name: p.name, description: p.description, levels: expandProfile(code) },
			});
		}
		return res.json({ success: true, data: { items: listProfiles() } });
	} catch (err) {
		console.error("GET /permission-profiles error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

/**
 * POST /permission-profiles/apply { userUuid, organizationUuid, profile, role? }
 *
 * Назначение профиля ПЕРЕЗАПИСЫВАЕТ права пользователя по этой организации целиком — иначе
 * результат был бы смесью нового профиля с остатками прежнего, и понять, что у человека на руках,
 * стало бы невозможно. `role` передаётся, когда заодно меняется и членство.
 */
router.post("/permission-profiles/apply", async (req, res) => {
	try {
		const { userUuid, organizationUuid, profile, role } = req.body ?? {};
		if (!userUuid || !organizationUuid || !profile) {
			return res.status(400).json({ success: false, message: "userUuid, organizationUuid и profile обязательны" });
		}
		if (!canAssign(req, organizationUuid)) {
			return res.status(403).json({ success: false, message: "Недостаточно прав для назначения профиля" });
		}
		if (!findProfile(profile)) {
			return res.status(400).json({ success: false, message: "Неизвестный профиль прав" });
		}
		// Роль admin раздаёт только суперадмин — как в /users и /access-rights.
		if (role && normalizeRole(role) === "admin" && !req.user?.isSuperAdmin) {
			return res.status(403).json({ success: false, message: "Назначить роль admin может только суперадмин" });
		}
		// Без смены роли профиль ставится только СУЩЕСТВУЮЩЕМУ участнику: иначе права
		// появились бы у человека, который в организации не состоит.
		if (!role) {
			const member = await prisma.accessRight.findUnique({
				where: { userUuid_organizationUuid: { userUuid, organizationUuid } },
				select: { role: true },
			});
			if (!member) {
				// Сотрудник обслуживающей фирмы работает у клиента по профилю СВЯЗИ (КР-18 аудита 27.09):
				// его права меняются профилем связи — с согласия клиента, — а не назначением профиля, и
				// участником клиента он от этого не становится (К2).
				const serviced = await servicedOrgsFor(userUuid);
				if (serviced.some((sv) => sv.organizationUuid === organizationUuid)) {
					return res.status(409).json({
						success: false,
						code: "SERVICE_LINK_PROFILE",
						message: "Сотрудник обслуживающей фирмы работает здесь по профилю связи обслуживания — права меняются в связи (с подтверждением клиента)",
					});
				}
				return res.status(404).json({ success: false, message: "Пользователь не состоит в этой организации" });
			}
		}

		// Роль передали — значит меняется и членство: тогда одно действие, а не два запроса,
		// между которыми пользователь может остаться с правами, но без организации.
		const count = role
			? (await grantMembership(null, { userUuid, organizationUuid, role: normalizeRole(role), profile }), null)
			: await applyProfile(null, { userUuid, organizationUuid, profile });

		void recordAudit({
			actionType: "permission_profile_applied",
			objectType: "User",
			objectId: userUuid,
			objectName: userUuid,
			organizationUuid,
			user: { uuid: req.user?.uuid ?? null, username: req.user?.username ?? null },
			props: { profile, role: role ? normalizeRole(role) : null },
			host: req?.hostname ?? null,
			ip: req?.ip ?? null,
		});

		return res.json({ success: true, data: { profile, applied: count } });
	} catch (err) {
		console.error("POST /permission-profiles/apply error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
