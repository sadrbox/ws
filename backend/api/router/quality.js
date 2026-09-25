// ─────────────────────────────────────────────────────────────────────────────
// E17 «Стандарт качества БухПроф» — общий роутер (docs/PLAN_QUALITY_STANDARD_2026-09-25.md).
//
//   GET  /quality/me                         мой контекст: фирма, роль, группы, уведомления
//   GET  /quality/settings                   настройки (правила, SLA, сроки) + фирма
//   PUT  /quality/settings                   изменить (админ/руководитель)
//   GET  /quality/firm-candidates            какую организацию назначить фирмой — подсказка
//   GET  /quality/notifications              мои уведомления (?unread=1)
//   POST /quality/notifications/read        отметить прочитанными ({uuids} | {all:true})
//   GET  /quality/telegram                   состояние привязки Telegram
//   POST /quality/telegram/link              ссылка на бота с кодом
//   DELETE /quality/telegram                 отвязать
//   GET  /quality/bonus?month=YYYY-MM        итог месяца по сотрудникам
//   POST /quality/bonus/close                закрыть месяц (снимок итогов)
//   POST /quality/bonus/reopen               вновь открыть (только админ)
//   GET  /quality/dashboard/chief            панель главбуха (клиенты × участки)
//   GET  /quality/dashboard/manager          панель руководителя
//   POST /quality/consultation-review        подсказка по ответу клиенту (эвристики)
//   GET  /quality/primary-docs               динамика ввода первички клиента за месяц
//
// ПРАВА — внутри (сегмент `quality` описан в utils/routeSubjects.js как guarded): роль в
// учёте качества задают группы сотрудников, а не права на модели (services/quality/access.js).
// Организация-фирма проверяется orgIsAccessible, клиент — orgIsAccessible/контекст групп.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { orgIsAccessible } from "../../utils/auth.js";
import { recordAudit } from "../../services/auditLog.js";
import { qualityContext, canManage, userNames, orgNames } from "../../services/quality/access.js";
import { getQualitySettings, saveQualitySettings, setFirmOrgSetting, getFirmOrgSetting } from "../../services/quality/settings.js";
import { DEFAULT_SETTINGS, settingsPatchError, mergedWorkHoursError } from "../../services/quality/settingsRules.js";
import { computeBonusResults, windowMonths } from "../../services/quality/bonusRules.js";
import { reviewConsultation } from "../../services/quality/consultationRules.js";
import { chiefDashboard, managerDashboard, primaryDocsDynamics } from "../../services/quality/dashboards.js";
import { telegramStatus, createLinkCode, unlinkTelegram } from "../../services/quality/telegram.js";
import { ensureStandardItems } from "../../services/quality/violations.js";
import { isMonth, monthOf, localParts } from "../../services/quality/time.js";
import { handler, fail } from "../../services/quality/http.js";

const router = express.Router();

const audit = (req, actionType, objectId, objectName, organizationUuid, props = null) =>
	void recordAudit({ actionType, objectType: "Quality", objectId, objectName, organizationUuid, user: { uuid: req.user?.uuid, username: req.user?.username }, props, host: req.hostname, ip: req.ip });

// ── Мой контекст ──────────────────────────────────────────────────────────────
router.get("/quality/me", handler("GET /quality/me", async (req, res) => {
	const ctx = await qualityContext(req);
	if (ctx.firmOrgUuid) await ensureStandardItems(ctx.firmOrgUuid);
	const [unread, tg, firmNames, explicitFirm] = await Promise.all([
		prisma.userNotification.count({ where: { userUuid: ctx.userUuid, readAt: null } }),
		telegramStatus(ctx.userUuid),
		orgNames([ctx.firmOrgUuid]),
		getFirmOrgSetting(),
	]);
	const visibleGroups = ctx.isAdmin ? ctx.groups : ctx.groups.filter((g) => ctx.headGroupUuids.includes(g.uuid) || ctx.managerGroupUuids.includes(g.uuid) || ctx.memberGroupUuids.includes(g.uuid));
	res.json({
		success: true,
		data: {
			firmOrganizationUuid: ctx.firmOrgUuid,
			firmOrganizationName: firmNames.get(ctx.firmOrgUuid) ?? null,
			// ПРОВЕРИТЬ ПОТОМ: фирма не назначена явно — работает запасное правило (access.js).
			firmExplicit: !!explicitFirm,
			isAdmin: ctx.isAdmin,
			isHead: ctx.isHead,
			isManager: ctx.isManager,
			canManage: canManage(ctx),
			canDecide: ctx.isAdmin || ctx.isHead || ctx.isManager,
			groups: visibleGroups.map((g) => ({ uuid: g.uuid, name: g.name, headUuid: g.headUuid, managerUuid: g.managerUuid })),
			unreadNotifications: unread,
			telegram: tg,
		},
	});
}));

// ── Настройки ─────────────────────────────────────────────────────────────────
router.get("/quality/settings", handler("GET /quality/settings", async (req, res) => {
	const ctx = await qualityContext(req);
	res.json({ success: true, data: { settings: await getQualitySettings(ctx.firmOrgUuid), defaults: DEFAULT_SETTINGS, firmOrganizationUuid: ctx.firmOrgUuid, firmExplicit: !!(await getFirmOrgSetting()) } });
}));

router.put("/quality/settings", handler("PUT /quality/settings", async (req, res) => {
	const ctx = await qualityContext(req);
	if (!canManage(ctx)) return fail(res, 403, "Настройки качества меняют администратор или руководитель");
	// Проверка правки — до любых изменений: иначе фирма назначилась бы, а настройки — нет.
	const patchError = settingsPatchError(req.body?.settings);
	if (patchError) return fail(res, 400, patchError);
	if (req.body?.firmOrganizationUuid !== undefined) {
		const org = req.body.firmOrganizationUuid || null;
		if (!ctx.isAdmin) return fail(res, 403, "Организацию-фирму назначает администратор");
		if (org && !orgIsAccessible(req, org)) return fail(res, 403, "Организация недоступна");
		await setFirmOrgSetting(org);
		// Фирма — это организация вида «service» (обслуживающая, PLAN_INSTALL_MODES К1): отмечаем, чтобы
		// с ней согласовались связи обслуживания и следующий поиск фирмы нашёл её сам.
		if (org) {
			const current = await prisma.organization.findUnique({ where: { uuid: org }, select: { kind: true } });
			if (current && current.kind !== "service") {
				await prisma.organization.update({ where: { uuid: org }, data: { kind: "service" } });
				audit(req, "update", org, "Организация отмечена фирмой (kind=service)", org, { kind: { from: current.kind, to: "service" } });
			}
		}
	}
	const firm = req.body?.firmOrganizationUuid !== undefined ? req.body.firmOrganizationUuid || ctx.firmOrgUuid : ctx.firmOrgUuid;
	let patch = req.body?.settings || null;
	// Фирма назначена впервые — с сегодняшнего дня начинает действовать стандарт (правила не
	// смотрят назад). Явно заданную дату не трогаем.
	const current = await getQualitySettings(firm);
	if (req.body?.firmOrganizationUuid && !current.effectiveFrom && !patch?.effectiveFrom) {
		patch = { ...(patch || {}), effectiveFrom: localParts(new Date(), current.tzOffsetMinutes).ymd };
	}
	if (patch?.workHours) {
		const hoursError = mergedWorkHoursError({ workHours: { ...current.workHours, ...patch.workHours } });
		if (hoursError) return fail(res, 400, hoursError);
	}
	const settings = patch ? await saveQualitySettings(firm, patch) : current;
	audit(req, "update", firm || "global", "Настройки качества", firm, { settings: req.body?.settings ?? null, firmOrganizationUuid: req.body?.firmOrganizationUuid });
	res.json({ success: true, data: { settings, firmOrganizationUuid: firm } });
}));

// Подсказка, какую организацию назначить фирмой: из доступных пользователю — сначала вида «service»,
// затем те, где он администратор, затем по числу сотрудников (членов организации). Фирма — та, где
// работают сотрудники, а не клиенты: у неё обычно больше всего членов.
router.get("/quality/firm-candidates", handler("GET /quality/firm-candidates", async (req, res) => {
	const allowed = req.user?.isSuperAdmin ? null : [req.user?.organizationUuid, ...(req.user?.allowedOrgUuids || [])].filter(Boolean);
	const orgs = await prisma.organization.findMany({
		where: { deletedAt: null, ...(allowed ? { uuid: { in: allowed } } : {}) },
		select: { uuid: true, name: true, legalName: true, bin: true, kind: true },
		take: 500,
	});
	const ids = orgs.map((o) => o.uuid);
	const [members, adminOf] = await Promise.all([
		prisma.accessRight.groupBy({ by: ["organizationUuid"], where: { organizationUuid: { in: ids } }, _count: { _all: true } }),
		prisma.accessRight.findMany({ where: { userUuid: req.user.uuid, role: "admin", organizationUuid: { in: ids } }, select: { organizationUuid: true } }),
	]);
	const count = new Map(members.map((m) => [m.organizationUuid, m._count._all]));
	const admin = new Set(adminOf.map((a) => a.organizationUuid));
	const items = orgs
		.map((o) => ({
			uuid: o.uuid, name: o.name || o.legalName || o.bin, bin: o.bin, kind: o.kind,
			members: count.get(o.uuid) ?? 0, isAdmin: admin.has(o.uuid) || !!req.user?.isSuperAdmin,
			reasons: [o.kind === "service" ? "service" : null, admin.has(o.uuid) ? "admin" : null].filter(Boolean),
		}))
		.sort((a, b) => Number(b.kind === "service") - Number(a.kind === "service") || Number(b.isAdmin) - Number(a.isAdmin) || b.members - a.members)
		.slice(0, 5);
	res.json({ success: true, items, current: await getFirmOrgSetting() });
}));

// ── Уведомления ───────────────────────────────────────────────────────────────
router.get("/quality/notifications", handler("GET /quality/notifications", async (req, res) => {
	const unread = req.query.unread === "1" || req.query.unread === "true";
	const take = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
	const since = req.query.since ? new Date(String(req.query.since)) : null;
	const where = { userUuid: req.user.uuid, ...(unread ? { readAt: null } : {}), ...(since && !Number.isNaN(since.getTime()) ? { createdAt: { gt: since } } : {}) };
	const [items, unreadCount] = await Promise.all([
		prisma.userNotification.findMany({ where, orderBy: { createdAt: "desc" }, take }),
		prisma.userNotification.count({ where: { userUuid: req.user.uuid, readAt: null } }),
	]);
	res.json({ success: true, items, unreadCount });
}));

router.post("/quality/notifications/read", handler("POST /quality/notifications/read", async (req, res) => {
	const where = { userUuid: req.user.uuid, readAt: null };
	if (!req.body?.all) {
		const uuids = Array.isArray(req.body?.uuids) ? req.body.uuids.map(String) : [];
		if (!uuids.length) return fail(res, 400, "Нужны uuids или all:true");
		where.uuid = { in: uuids };
	}
	const r = await prisma.userNotification.updateMany({ where, data: { readAt: new Date() } });
	res.json({ success: true, data: { updated: r.count } });
}));

// ── Telegram ──────────────────────────────────────────────────────────────────
router.get("/quality/telegram", handler("GET /quality/telegram", async (req, res) => {
	res.json({ success: true, data: await telegramStatus(req.user.uuid) });
}));
router.post("/quality/telegram/link", handler("POST /quality/telegram/link", async (req, res) => {
	res.json({ success: true, data: await createLinkCode(req.user.uuid) });
}));
router.delete("/quality/telegram", handler("DELETE /quality/telegram", async (req, res) => {
	await unlinkTelegram(req.user.uuid);
	res.json({ success: true });
}));

// ── Бонус ─────────────────────────────────────────────────────────────────────
async function bonusResults(ctx, month) {
	const settings = await getQualitySettings(ctx.firmOrgUuid);
	// Сотрудники: все участники, главбухи и руководители групп фирмы (админ) либо видимые.
	const staffMap = new Map();
	for (const g of ctx.groups) {
		const add = (uid, role) => { if (uid && !staffMap.has(uid)) staffMap.set(uid, { userUuid: uid, groupName: g.name, role }); };
		if (g.managerUuid) add(g.managerUuid, "manager");
		if (g.headUuid) add(g.headUuid, "chief");
		for (const m of g.members) add(m.userUuid, "member");
	}
	let staff = [...staffMap.values()];
	if (ctx.visible) staff = staff.filter((s) => ctx.visible.has(s.userUuid));
	const months = windowMonths(month, settings.violations.systematicMonths);
	const vWhere = { organizationUuid: ctx.firmOrgUuid, deletedAt: null, bonusMonth: { in: months } };
	if (ctx.visible) vWhere.userUuid = { in: [...ctx.visible] };
	const [violations, measures] = await Promise.all([
		prisma.standardViolation.findMany({ where: vWhere }),
		prisma.violationMeasure.findMany({ where: { organizationUuid: ctx.firmOrgUuid, deletedAt: null, ...(ctx.visible ? { userUuid: { in: [...ctx.visible] } } : {}) } }),
	]);
	const names = await userNames([...staff.map((s) => s.userUuid), ...violations.map((v) => v.userUuid)]);
	return computeBonusResults({ month, staff: staff.map((s) => ({ ...s, userName: names.get(s.userUuid) })), violations, measures, settings })
		.map((r) => ({ ...r, userName: names.get(r.userUuid) ?? r.userName }));
}

router.get("/quality/bonus", handler("GET /quality/bonus", async (req, res) => {
	const ctx = await qualityContext(req);
	const settings = await getQualitySettings(ctx.firmOrgUuid);
	const month = isMonth(req.query.month) ? String(req.query.month) : monthOf(new Date(), settings.tzOffsetMinutes);
	const closed = ctx.firmOrgUuid ? await prisma.bonusMonth.findUnique({ where: { organizationUuid_month: { organizationUuid: ctx.firmOrgUuid, month } } }) : null;
	let items;
	if (closed) {
		items = Array.isArray(closed.results) ? closed.results : [];
		if (ctx.visible) items = items.filter((r) => ctx.visible.has(r.userUuid));
	} else {
		items = await bonusResults(ctx, month);
	}
	const closedByName = closed?.closedByUuid ? (await userNames([closed.closedByUuid])).get(closed.closedByUuid) : null;
	res.json({ success: true, data: { month, closed: closed ? { closedAt: closed.closedAt, closedByName } : null, items, systematicMonths: settings.violations.systematicMonths, systematicThreshold: settings.violations.systematicThreshold } });
}));

router.post("/quality/bonus/close", handler("POST /quality/bonus/close", async (req, res) => {
	const ctx = await qualityContext(req);
	if (!canManage(ctx)) return fail(res, 403, "Закрывает месяц администратор или руководитель");
	const month = String(req.body?.month || "");
	if (!isMonth(month)) return fail(res, 400, "Месяц — в формате ГГГГ-ММ");
	if (!ctx.firmOrgUuid) return fail(res, 400, "Не определена организация-фирма");
	const pending = await prisma.standardViolation.count({ where: { organizationUuid: ctx.firmOrgUuid, bonusMonth: month, deletedAt: null, status: { in: ["candidate", "disputed"] } } });
	if (pending && !req.body?.force) {
		return fail(res, 409, `В месяце есть нерешённые кандидаты и возражения: ${pending}. Решите их или закройте с подтверждением`, { code: "NEEDS_CONFIRMATION", pending });
	}
	// Снимок — по ВСЕМ сотрудникам фирмы, а не по тем, кого видит закрывающий.
	const full = { ...ctx, visible: null };
	const results = await bonusResults(full, month);
	const row = await prisma.bonusMonth.upsert({
		where: { organizationUuid_month: { organizationUuid: ctx.firmOrgUuid, month } },
		create: { organizationUuid: ctx.firmOrgUuid, month, closedByUuid: ctx.userUuid, results },
		update: { closedAt: new Date(), closedByUuid: ctx.userUuid, results },
	});
	audit(req, "close", row.uuid, `Бонусы ${month}`, ctx.firmOrgUuid, { withoutBonus: results.filter((r) => !r.bonus).length, pending });
	res.json({ success: true, data: { month, closedAt: row.closedAt, items: results } });
}));

router.post("/quality/bonus/reopen", handler("POST /quality/bonus/reopen", async (req, res) => {
	const ctx = await qualityContext(req);
	if (!ctx.isAdmin) return fail(res, 403, "Открыть закрытый месяц может только администратор");
	const month = String(req.body?.month || "");
	if (!isMonth(month)) return fail(res, 400, "Месяц — в формате ГГГГ-ММ");
	const r = await prisma.bonusMonth.deleteMany({ where: { organizationUuid: ctx.firmOrgUuid, month } });
	audit(req, "reopen", `${ctx.firmOrgUuid}:${month}`, `Бонусы ${month}`, ctx.firmOrgUuid);
	res.json({ success: true, data: { reopened: r.count > 0 } });
}));

// ── Панели ────────────────────────────────────────────────────────────────────
router.get("/quality/dashboard/chief", handler("GET /quality/dashboard/chief", async (req, res) => {
	const ctx = await qualityContext(req);
	if (!(ctx.isAdmin || ctx.isHead || ctx.isManager)) return fail(res, 403, "Панель доступна главбуху, руководителю и администратору");
	res.json({ success: true, data: await chiefDashboard(ctx, { groupUuid: req.query.groupUuid || null }) });
}));

router.get("/quality/dashboard/manager", handler("GET /quality/dashboard/manager", async (req, res) => {
	const ctx = await qualityContext(req);
	if (!(ctx.isAdmin || ctx.isManager || ctx.isHead)) return fail(res, 403, "Панель доступна руководителю, главбуху и администратору");
	const settings = await getQualitySettings(ctx.firmOrgUuid);
	const month = isMonth(req.query.month) ? String(req.query.month) : monthOf(new Date(), settings.tzOffsetMinutes);
	res.json({ success: true, data: await managerDashboard(ctx, { month }) });
}));

// ── Консультация ──────────────────────────────────────────────────────────────
router.post("/quality/consultation-review", handler("POST /quality/consultation-review", async (req, res) => {
	const ctx = await qualityContext(req);
	const settings = await getQualitySettings(ctx.firmOrgUuid);
	res.json({ success: true, data: reviewConsultation(req.body?.text, { maxLength: settings.consultation.maxLength }) });
}));

// ── Первичка ──────────────────────────────────────────────────────────────────
router.get("/quality/primary-docs", handler("GET /quality/primary-docs", async (req, res) => {
	const org = String(req.query.organizationUuid || "");
	if (!org || !orgIsAccessible(req, org)) return fail(res, 404, "Организация не найдена");
	const ctx = await qualityContext(req);
	const settings = await getQualitySettings(ctx.firmOrgUuid);
	const month = isMonth(req.query.month) ? String(req.query.month) : monthOf(new Date(), settings.tzOffsetMinutes);
	const [dynamics, receipts] = await Promise.all([
		primaryDocsDynamics(org, month, settings),
		prisma.primaryDocsReceipt.findMany({ where: { organizationUuid: org, month, deletedAt: null }, orderBy: { receivedAt: "asc" } }),
	]);
	const names = await userNames(receipts.map((r) => r.userUuid));
	res.json({ success: true, data: { ...dynamics, receipts: receipts.map((r) => ({ ...r, userName: names.get(r.userUuid) ?? null })) } });
}));

export default router;
