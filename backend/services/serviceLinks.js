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
import { findProfile, expandProfile } from "./permissionProfiles.js";
import { MODULE_ROUTES, moduleOfRoute } from "./moduleRoutes.js";
import { ROUTE_TO_MODEL } from "../utils/routeModels.js";

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

/**
 * Профили, которые можно просить для обслуживания. `owner` — власть над доступом клиента
 * (пользователи, права): фирма ведёт учёт, но доступом клиента не распоряжается (К2).
 */
export const SERVICE_PROFILES_FORBIDDEN = ["owner"];

/*
 * ПРАВА ПО ОБСЛУЖИВАНИЮ — ИЗ ПРОФИЛЯ СВЯЗИ, А НЕ КОПИЯМИ (КР-18 аудита 27.09).
 *
 * Профиль связи (`service_accountant` и т. п.) нигде не участвовал в проверке прав: сотрудник фирмы
 * попадал в данные клиента только сводкой, а право бралось из строк прав САМОЙ ФИРМЫ — работало
 * случайно и переносило в клиента власть, которой клиент не давал. Штатно выдать права в клиенте
 * было нечем: назначение профиля требует членства, а членство противоречит К2.
 *
 * Выбрано вычисление, а не материализация строк access_permissions при подтверждении связи и
 * назначении сотрудника: копии пришлось бы снимать при отзыве, приостановке, переподтверждении,
 * снятии назначения и — без всякого события — по истечении срока договора; один пропуск — утечка
 * чужого учёта (та же причина, по которой доступ идёт через назначение, а не копией членства).
 * Здесь уровень считается на лету из связи, которую tenantMiddleware уже прочитал (serviceContext):
 * погасла связь — погасли и права, у всех назначенных сразу.
 *
 * Модули: связь может открывать фирме не все модули клиента — модели закрытых модулей получают
 * `none` (модуль модели — по карте маршрутов модулей; ядро учёта модулю не принадлежит).
 */
const LEVEL_RANK = { none: 0, readonly: 1, full: 2 };

/** Наибольший из уровней доступа; неизвестное и пустое — как «нет доступа». */
export function maxLevel(...levels) {
	let best = "none";
	for (const l of levels) if ((LEVEL_RANK[l] ?? 0) > LEVEL_RANK[best]) best = l;
	return best;
}

let modelModules = null;
/**
 * Модуль, которому принадлежит модель прав (по маршрутам модулей); null — ядро. Пути карты модулей
 * совпадают с сегментами маршрутов и карты прав — это держит __tests__/moduleRoutes.test.js.
 */
export function moduleOfModel(modelName) {
	if (!modelModules) {
		modelModules = new Map();
		for (const [segment, mod] of Object.entries(MODULE_ROUTES)) {
			const model = ROUTE_TO_MODEL[segment];
			if (model && !modelModules.has(model)) modelModules.set(model, mod);
		}
	}
	return modelModules.get(modelName) ?? null;
}

// Профили — часть поставки и в работе не меняются: разворот по моделям — один раз на профиль.
const expandedProfiles = new Map();
function levelsOf(profile) {
	if (!expandedProfiles.has(profile)) {
		// Запрещённый для обслуживания профиль (owner) в связи оказаться не должен; оказался — не даёт ничего.
		const ok = !!profile && !SERVICE_PROFILES_FORBIDDEN.includes(profile) && !!findProfile(profile);
		expandedProfiles.set(profile, ok ? expandProfile(profile) : null);
	}
	return expandedProfiles.get(profile);
}

/**
 * Уровень доступа к модели по обслуживанию.
 * @param {{profile:string, modules:string[]|null}|null} ctx — элемент req.user.serviceContext (servicedOrgsFor)
 * @param {string} modelName
 * @param {{segment?:string|null}} [opts] — сегмент маршрута, если известен (точнее модуль)
 */
export function serviceAccessLevel(ctx, modelName, { segment = null } = {}) {
	if (!ctx || !modelName) return "none";
	const levels = levelsOf(ctx.profile);
	if (!levels) return "none";
	const level = levels[modelName] ?? "none";
	if (Array.isArray(ctx.modules)) {
		const mod = (segment && moduleOfRoute(segment)) || moduleOfModel(modelName);
		if (mod && !ctx.modules.includes(mod)) return "none";
	}
	return level;
}

/** Права по обслуживанию строками, как access_permissions, — для меню панели. */
export function servicePermissionRows(ctx, organizationUuid = null) {
	const levels = ctx ? levelsOf(ctx.profile) : null;
	if (!levels) return [];
	return Object.keys(levels).sort().map((modelName) => ({
		modelName, accessLevel: serviceAccessLevel(ctx, modelName), organizationUuid, viaService: true,
	}));
}

/**
 * Нужно ли новое согласие клиента после правки связи (Б2 аудита 26.09).
 *
 * Раньше повторный POST менял профиль, модули и срок у УЖЕ подтверждённой связи, не трогая
 * состояние: клиент согласился на «бухгалтера до конца года», а фирма молча расширяла доступ.
 * Теперь любое изменение условий (профиль, модули, срок) и любое «возобновление» неактивной
 * связи возвращает её в `requested` — доступ снова открывает только клиент. Правка одной
 * заметки согласия не требует.
 */
export function linkNeedsReconfirm(existing, next) {
	if (!existing) return false;
	if (existing.state !== "active") return true;
	const norm = (v) => (v == null || v === "" ? null : v);
	const time = (v) => (v ? new Date(v).getTime() : null);
	return norm(existing.profile) !== norm(next.profile)
		|| norm(existing.modules) !== norm(next.modules)
		|| time(existing.validUntil) !== time(next.validUntil);
}

/** Завести или обновить связь. Клиент подтверждает отдельно — см. confirmLink. */
export async function upsertLink({ serviceOrgUuid, clientOrgUuid, profile = "service_accountant", modules = null, validUntil = null, note = null }) {
	if (serviceOrgUuid === clientOrgUuid) throw new Error("Организация не может обслуживать сама себя");
	if (!findProfile(profile)) throw new Error(`Неизвестный профиль прав: ${profile}`);
	if (SERVICE_PROFILES_FORBIDDEN.includes(profile)) throw new Error(`Профиль «${profile}» нельзя выдать обслуживающей фирме`);
	const existing = await prisma.serviceLink.findUnique({
		where: { serviceOrgUuid_clientOrgUuid: { serviceOrgUuid, clientOrgUuid } },
	});
	const reconfirm = linkNeedsReconfirm(existing, { profile, modules, validUntil });
	return prisma.serviceLink.upsert({
		where: { serviceOrgUuid_clientOrgUuid: { serviceOrgUuid, clientOrgUuid } },
		create: { serviceOrgUuid, clientOrgUuid, profile, modules, validUntil, note, state: "requested" },
		update: {
			profile, modules, validUntil, note,
			...(reconfirm ? { state: "requested", confirmedAt: null, confirmedByUuid: null } : {}),
		},
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
	LINK_STATES, STAFF_ROLES, SERVICE_PROFILES_FORBIDDEN, linkIsLive, allowedModules, linkNeedsReconfirm, servicedOrgsFor,
	maxLevel, moduleOfModel, serviceAccessLevel, servicePermissionRows,
	upsertLink, confirmLink, setLinkState, assignStaff, unassignStaff, clientsOf, providersOf,
};
