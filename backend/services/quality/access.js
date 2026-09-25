// Кто что видит и решает в E17 «Стандарт качества» (СК0.2, СК5.3).
//
// ОРГАНИЗАЦИЯ-ФИРМА. Учёт качества ведётся в организации, где работают сотрудники (БухПроф),
// а не в клиентах, куда они переключаются по работе. Поэтому фирма определяется не активной
// организацией, а так: настройка `quality.firmOrganizationUuid` → доступная пользователю
// организация вида «service» → активная организация.
// Назначение фирмы в «Качество → Настройки качества» отмечает её видом «service» (подсказка кандидатов —
// GET /quality/firm-candidates). Пока фирма не назначена, экраны работают в активной организации, а
// правила стандарта молчат (jobs.js, violations.js).
//
// РОЛИ — по группам сотрудников, а не по правам на модели:
//   сотрудник  — видит своё;
//   главбух    (StaffGroup.headUuid)    — участников своих групп, решает по их нарушениям;
//   руководитель (StaffGroup.managerUuid) — участников и главбухов своих групп;
//   админ      — суперадмин или администратор организации-фирмы: видит и решает всё.
// Никто не решает о СЕБЕ (кроме суперадмина): подтверждение — всегда уровнем выше.
import { prisma } from "../../prisma/prisma-client.js";
import { getFirmOrgSetting } from "./settings.js";

async function accessibleOrgUuids(req) {
	if (req.user?.isSuperAdmin) return null; // все
	return [req.user?.organizationUuid, ...(req.user?.allowedOrgUuids || [])].filter(Boolean);
}

/** Организация-фирма для запроса пользователя. */
export async function resolveFirmOrg(req) {
	const allowed = await accessibleOrgUuids(req);
	const can = (org) => !!org && (allowed === null || allowed.includes(org));
	const explicit = await getFirmOrgSetting();
	if (can(explicit)) return explicit;
	const service = await prisma.organization.findFirst({
		where: { kind: "service", deletedAt: null, ...(allowed === null ? {} : { uuid: { in: allowed } }) },
		select: { uuid: true },
		orderBy: { id: "asc" },
	});
	if (service) return service.uuid;
	return req.user?.organizationUuid || (allowed?.[0] ?? null);
}

/** Группы фирмы с участниками и клиентами — данных мало, берём целиком. */
export async function loadGroups(firmOrgUuid) {
	return prisma.staffGroup.findMany({
		where: { deletedAt: null, ...(firmOrgUuid ? { organizationUuid: firmOrgUuid } : {}) },
		include: { members: true, clients: true },
		orderBy: { name: "asc" },
	});
}

/** Администратор фирмы: суперадмин или роль admin в организации-фирме. */
export async function isFirmAdmin(userUuid, firmOrgUuid, { isSuperAdmin = false } = {}) {
	if (isSuperAdmin) return true;
	if (!userUuid || !firmOrgUuid) return false;
	const right = await prisma.accessRight.findUnique({
		where: { userUuid_organizationUuid: { userUuid, organizationUuid: firmOrgUuid } },
		select: { role: true },
	});
	return right?.role === "admin";
}

/**
 * Контекст качества для пользователя: фирма, роль, кого видит и по кому решает.
 * visible/decidable = null — без ограничений (админ).
 */
export async function qualityContext(req) {
	const firmOrgUuid = await resolveFirmOrg(req);
	const userUuid = req.user?.uuid ?? null;
	const isSuperAdmin = !!req.user?.isSuperAdmin;
	const [groups, isAdmin] = await Promise.all([
		loadGroups(firmOrgUuid),
		isFirmAdmin(userUuid, firmOrgUuid, { isSuperAdmin }),
	]);
	return buildContext({ firmOrgUuid, userUuid, isAdmin, isSuperAdmin, groups });
}

/** Чистая часть контекста — отдельно, чтобы её можно было собрать и в фоновых правилах. */
export function buildContext({ firmOrgUuid, userUuid, isAdmin, isSuperAdmin = false, groups }) {
	const headOf = groups.filter((g) => g.headUuid === userUuid);
	const managerOf = groups.filter((g) => g.managerUuid === userUuid);
	const memberOf = groups.filter((g) => g.members.some((m) => m.userUuid === userUuid));
	let visible = null;
	let decidable = null;
	if (!isAdmin) {
		visible = new Set(userUuid ? [userUuid] : []);
		decidable = new Set();
		for (const g of headOf) for (const m of g.members) { visible.add(m.userUuid); decidable.add(m.userUuid); }
		for (const g of managerOf) {
			for (const m of g.members) { visible.add(m.userUuid); decidable.add(m.userUuid); }
			if (g.headUuid) { visible.add(g.headUuid); decidable.add(g.headUuid); }
		}
		decidable.delete(userUuid); // о себе не решает никто, кроме админа
	}
	const clientOrgs = new Set();
	for (const g of isAdmin ? groups : [...headOf, ...managerOf]) for (const c of g.clients) clientOrgs.add(c.clientOrganizationUuid);
	for (const g of memberOf) for (const c of g.clients) if (c.responsibleUuid === userUuid) clientOrgs.add(c.clientOrganizationUuid);
	return {
		firmOrgUuid,
		userUuid,
		isAdmin,
		isSuperAdmin,
		isHead: headOf.length > 0,
		isManager: managerOf.length > 0,
		groups,
		headGroupUuids: headOf.map((g) => g.uuid),
		managerGroupUuids: managerOf.map((g) => g.uuid),
		memberGroupUuids: memberOf.map((g) => g.uuid),
		visible,
		decidable,
		/** Клиенты групп, которые пользователь ведёт или контролирует (панель главбуха). */
		clientOrgUuids: clientOrgs,
	};
}

export const canSee = (ctx, userUuid) => ctx.visible === null || ctx.visible.has(userUuid);

/** Может ли решать по нарушению этого сотрудника (подтвердить, отклонить, завести вручную). */
export function canDecide(ctx, violatorUuid) {
	if (!violatorUuid) return false;
	if (ctx.isAdmin) return ctx.isSuperAdmin || violatorUuid !== ctx.userUuid;
	return ctx.decidable.has(violatorUuid);
}

/** Может ли настраивать справочники E17 (группы, пункты, настройки): админ или руководитель. */
export const canManage = (ctx) => ctx.isAdmin || ctx.isManager;

/**
 * Кто решает по нарушениям сотрудника — ему уходят уведомления о кандидатах:
 * главбухи его групп, руководители групп; для главбуха — руководители; нет никого — админы фирмы.
 */
export async function decidersOf(firmOrgUuid, violatorUuid, groups = null) {
	const gs = groups ?? (await loadGroups(firmOrgUuid));
	const out = new Set();
	for (const g of gs) {
		const isMember = g.members.some((m) => m.userUuid === violatorUuid);
		if (isMember && g.headUuid && g.headUuid !== violatorUuid) out.add(g.headUuid);
		if ((isMember || g.headUuid === violatorUuid) && g.managerUuid && g.managerUuid !== violatorUuid) out.add(g.managerUuid);
	}
	if (!out.size && firmOrgUuid) {
		const admins = await prisma.accessRight.findMany({ where: { organizationUuid: firmOrgUuid, role: "admin" }, select: { userUuid: true } });
		for (const a of admins) if (a.userUuid !== violatorUuid) out.add(a.userUuid);
	}
	return [...out];
}

/** Главбух(и) сотрудника; для главбуха — руководитель. Для эскалации задач. */
export async function chiefsOf(userUuid, groups = null) {
	const gs = groups ?? (await loadGroups(null));
	const out = new Set();
	for (const g of gs) {
		if (g.members.some((m) => m.userUuid === userUuid) && g.headUuid && g.headUuid !== userUuid) out.add(g.headUuid);
		else if (g.headUuid === userUuid && g.managerUuid) out.add(g.managerUuid);
	}
	return [...out];
}

/** Руководители групп сотрудника (второй уровень эскалации). */
export async function managersOf(userUuid, groups = null) {
	const gs = groups ?? (await loadGroups(null));
	const out = new Set();
	for (const g of gs) {
		const inGroup = g.headUuid === userUuid || g.members.some((m) => m.userUuid === userUuid);
		if (inGroup && g.managerUuid && g.managerUuid !== userUuid) out.add(g.managerUuid);
	}
	return [...out];
}

/**
 * Ответственный за клиента: участок группы (StaffGroupClient) → назначение обслуживания
 * (ServiceAssignment lead по живой связи). Решено 25.09: участок группы главнее — так работу делят
 * главбухи, а связь обслуживания отвечает на другой вопрос (кто вправе вести учёт клиента).
 */
export async function responsibleForClient(clientOrgUuid) {
	if (!clientOrgUuid) return null;
	const own = await prisma.staffGroupClient.findFirst({
		where: { clientOrganizationUuid: clientOrgUuid, responsibleUuid: { not: null }, group: { deletedAt: null } },
		select: { responsibleUuid: true },
		orderBy: { id: "asc" },
	});
	if (own?.responsibleUuid) return own.responsibleUuid;
	const lead = await prisma.serviceAssignment.findFirst({
		where: { role: "lead", link: { clientOrgUuid, state: "active" } },
		select: { userUuid: true },
		orderBy: { id: "asc" },
	});
	return lead?.userUuid ?? null;
}

/** Группа, в которой ведётся клиент (для главбуха и фирмы). */
export async function groupOfClient(clientOrgUuid) {
	if (!clientOrgUuid) return null;
	const row = await prisma.staffGroupClient.findFirst({
		where: { clientOrganizationUuid: clientOrgUuid, group: { deletedAt: null } },
		include: { group: true },
		orderBy: { id: "asc" },
	});
	return row?.group ?? null;
}

/**
 * Фирма сотрудника для фоновых правил (запроса пользователя там нет): группа сотрудника →
 * назначенная фирма установки → null.
 */
export async function firmOrgForUser(userUuid) {
	if (userUuid) {
		const g = await prisma.staffGroup.findFirst({
			where: {
				deletedAt: null,
				OR: [{ headUuid: userUuid }, { managerUuid: userUuid }, { members: { some: { userUuid } } }],
			},
			select: { organizationUuid: true },
			orderBy: { id: "asc" },
		});
		if (g?.organizationUuid) return g.organizationUuid;
	}
	return getFirmOrgSetting();
}

/**
 * Сотрудник фирмы: участник, главбух или руководитель любой группы либо член организации-фирмы.
 * Клиент (пользователь 1С клиента, заведённый каналом чата) сюда не попадает — у него нет ни группы,
 * ни членства в фирме.
 */
export async function isStaffUser(userUuid, firmOrgUuid) {
	if (!userUuid) return false;
	const inGroup = await prisma.staffGroup.findFirst({
		where: { deletedAt: null, OR: [{ headUuid: userUuid }, { managerUuid: userUuid }, { members: { some: { userUuid } } }] },
		select: { id: true },
	});
	if (inGroup) return true;
	if (!firmOrgUuid) return false;
	const member = await prisma.accessRight.findUnique({ where: { userUuid_organizationUuid: { userUuid, organizationUuid: firmOrgUuid } }, select: { id: true } });
	return !!member;
}

/** Имена пользователей: сотрудник (ФИО) или логин. */
export async function userNames(uuids) {
	const ids = [...new Set((uuids || []).filter(Boolean))];
	if (!ids.length) return new Map();
	const rows = await prisma.user.findMany({
		where: { uuid: { in: ids } },
		select: { uuid: true, username: true, employee: { select: { fullName: true } } },
	});
	return new Map(rows.map((u) => [u.uuid, u.employee?.fullName || u.username || u.uuid]));
}

/** Названия организаций. */
export async function orgNames(uuids) {
	const ids = [...new Set((uuids || []).filter(Boolean))];
	if (!ids.length) return new Map();
	const rows = await prisma.organization.findMany({ where: { uuid: { in: ids } }, select: { uuid: true, name: true, legalName: true, bin: true } });
	return new Map(rows.map((o) => [o.uuid, o.name || o.legalName || o.bin || o.uuid]));
}

export default {
	resolveFirmOrg, loadGroups, isFirmAdmin, qualityContext, buildContext, canSee, canDecide, canManage,
	decidersOf, chiefsOf, managersOf, responsibleForClient, groupOfClient, firmOrgForUser, userNames, orgNames, isStaffUser,
};
