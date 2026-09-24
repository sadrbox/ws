// ОБСЛУЖИВАНИЕ: фирма ведёт учёт клиента (К1–К5 плана PLAN_INSTALL_MODES_2026-09-24.md).
//
// МОДЕЛЬ — ОТНОШЕНИЕ, А НЕ ВЛОЖЕННОСТЬ. Соблазн сделать обслуживающую компанию «родителем»
// клиентов отвергнут: иерархия немедленно потребовала бы наследования прав, модулей и настроек
// учёта вниз, а клиент, ушедший к другому бухгалтеру, должен уходить без переноса данных.
//
// ДОСТУП ЧЕРЕЗ СВЯЗЬ, А НЕ КОПИЕЙ ЧЛЕНСТВА КАЖДОМУ. При 20 бухгалтерах и 200 клиентах копии
// дали бы 4000 записей, а отзыв доступа уволенному превратился бы в перебор двухсот
// организаций, где один пропуск — утечка чужого учёта. Здесь: расторгли договор — погасла одна
// запись, и доступа не стало у всех сразу.
//
// ЧТО ДОСТУП ОБЯЗАН УВАЖАТЬ: модули клиента (состав принадлежит организации, а не тому, кто в
// неё вошёл), профиль прав, срок договора и след в аудите.
import { prisma } from "../prisma/prisma-client.js";
import { findProfile } from "./permissionProfiles.js";

export const LINK_STATES = ["requested", "active", "suspended", "revoked"];
export const STAFF_ROLES = ["lead", "assistant"];

/** Связь действует: подтверждена клиентом и срок не вышел. */
export function linkIsLive(link, now = new Date()) {
	if (!link || link.state !== "active") return false;
	if (link.validUntil && new Date(link.validUntil) <= now) return false;
	return true;
}

/**
 * Какие модули клиента открыты фирме.
 * Пусто в связи — все, что установлены у клиента: перечислять их по одному значило бы
 * поддерживать список вручную при каждом изменении состава.
 */
export function allowedModules(link) {
	const raw = (link?.modules ?? "").trim();
	if (!raw) return null; // null — «все установленные у клиента»
	return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Организации, доступные пользователю ПО ОБСЛУЖИВАНИЮ (К2).
 *
 * Только там, где он назначен: сотрудник фирмы не видит всех её клиентов автоматически —
 * иначе увольняющийся бухгалтер уносит с собой знание обо всём клиентском портфеле.
 */
export async function servicedOrgsFor(userUuid, { now = new Date(), db = prisma } = {}) {
	if (!userUuid) return [];
	const rows = await db.serviceAssignment.findMany({
		where: { userUuid },
		select: { link: { select: { clientOrgUuid: true, state: true, validUntil: true, profile: true, modules: true, uuid: true } } },
	});
	return rows
		.map((r) => r.link)
		.filter((l) => linkIsLive(l, now))
		.map((l) => ({ organizationUuid: l.clientOrgUuid, linkUuid: l.uuid, profile: l.profile, modules: allowedModules(l) }));
}

/** Завести или обновить связь. Клиент подтверждает отдельно — см. confirmLink. */
export async function upsertLink({ serviceOrgUuid, clientOrgUuid, profile = "service_accountant", modules = null, validUntil = null, note = null }) {
	if (serviceOrgUuid === clientOrgUuid) throw new Error("Организация не может обслуживать сама себя");
	if (!findProfile(profile)) throw new Error(`Неизвестный профиль прав: ${profile}`);
	return prisma.serviceLink.upsert({
		where: { serviceOrgUuid_clientOrgUuid: { serviceOrgUuid, clientOrgUuid } },
		create: { serviceOrgUuid, clientOrgUuid, profile, modules, validUntil, note, state: "requested" },
		update: { profile, modules, validUntil, note },
	});
}

/**
 * Подтверждение СО СТОРОНЫ КЛИЕНТА.
 *
 * Доступ к чужому учёту без следа недопустим: фиксируем, кто и когда впустил фирму. Без этой
 * записи у клиента нет оснований доверять аутсорсеру, а у нас — ответа на вопрос «кто разрешил».
 */
export async function confirmLink({ uuid, confirmedByUuid }) {
	return prisma.serviceLink.update({
		where: { uuid },
		data: { state: "active", confirmedByUuid, confirmedAt: new Date() },
	});
}

/** Приостановить или прекратить. Запись НЕ удаляем: след «кто вёл учёт в таком-то году» нужен. */
export async function setLinkState({ uuid, state }) {
	if (!LINK_STATES.includes(state)) throw new Error(`Неизвестное состояние связи: ${state}`);
	return prisma.serviceLink.update({ where: { uuid }, data: { state } });
}

export async function assignStaff({ linkUuid, userUuid, role = "lead" }) {
	const r = STAFF_ROLES.includes(role) ? role : "lead";
	return prisma.serviceAssignment.upsert({
		where: { linkUuid_userUuid: { linkUuid, userUuid } },
		create: { linkUuid, userUuid, role: r },
		update: { role: r },
	});
}

export async function unassignStaff({ linkUuid, userUuid }) {
	const { count } = await prisma.serviceAssignment.deleteMany({ where: { linkUuid, userUuid } });
	return count > 0;
}

/** Клиенты фирмы для её кабинета (К3): состояние, срок, назначенные сотрудники. */
export async function clientsOf(serviceOrgUuid) {
	const links = await prisma.serviceLink.findMany({
		where: { serviceOrgUuid },
		include: {
			clientOrg: { select: { uuid: true, name: true, legalName: true, bin: true } },
			staff: { select: { userUuid: true, role: true, user: { select: { username: true } } } },
		},
		orderBy: { createdAt: "desc" },
	});
	return links.map((l) => ({
		uuid: l.uuid,
		state: l.state,
		live: linkIsLive(l),
		profile: l.profile,
		modules: allowedModules(l),
		validUntil: l.validUntil,
		confirmedAt: l.confirmedAt,
		client: l.clientOrg,
		staff: l.staff.map((s) => ({ userUuid: s.userUuid, username: s.user?.username ?? null, role: s.role })),
	}));
}

/** Фирмы, обслуживающие клиента: видит сам клиент, чтобы знать, кого он впустил. */
export async function providersOf(clientOrgUuid) {
	const links = await prisma.serviceLink.findMany({
		where: { clientOrgUuid },
		include: { serviceOrg: { select: { uuid: true, name: true, legalName: true, bin: true } } },
		orderBy: { createdAt: "desc" },
	});
	return links.map((l) => ({
		uuid: l.uuid, state: l.state, live: linkIsLive(l),
		validUntil: l.validUntil, confirmedAt: l.confirmedAt, provider: l.serviceOrg,
	}));
}

export default {
	LINK_STATES, STAFF_ROLES, linkIsLive, allowedModules, servicedOrgsFor,
	upsertLink, confirmLink, setLinkState, assignStaff, unassignStaff, clientsOf, providersOf,
};
