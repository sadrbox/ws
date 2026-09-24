// Членство в организации: кто и на каком основании с ней работает (О1, О6 плана
// PLAN_INSTALL_MODES_2026-09-24.md).
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ МОДУЛЬ. Связь «пользователь ↔ организация» (`access_rights`) заводилась в
// трёх местах по-разному — в администрировании пользователей, в правах доступа и нигде при
// регистрации, — а читается она в ОДНОМ: `tenantMiddleware` строит по ней `allowedOrgUuids`,
// то есть всю изоляцию арендатора. Место создания связи должно быть одно, иначе повторяется
// история 24.09: регистрация организации заводила пользователя БЕЗ связи, и её создатель
// оставался без организации и без прав на первом же запросе (страховка в `tenantMiddleware`
// обнуляет активную организацию, если её нет в списке разрешённых).
//
// ТОЧКА РАСШИРЕНИЯ. Сюда придут профили прав (О2): выдача членства и выдача профиля — одно
// действие, и разносить их по разным местам нельзя. Пока профилей нет, `grantMembership`
// создаёт только связь, но подпись уже принимает `profile`, чтобы вызывающий код не менялся.
import { prisma } from "../prisma/prisma-client.js";
import { ORG_ROLES, OWNER_ROLE, DEFAULT_ROLE, normalizeRole, isInstallationOperator, canSignIn } from "./orgMembershipRules.js";
import { expandProfile, defaultProfileFor, findProfile } from "./permissionProfiles.js";

// Правила (роли, оператор установки, допуск ко входу) живут в `orgMembershipRules.js` — без
// БД, чтобы проверяться тестом в гейте. Здесь — работа с хранилищем.
export { ORG_ROLES, OWNER_ROLE, DEFAULT_ROLE, normalizeRole, isInstallationOperator, canSignIn };

/**
 * Выдать членство. Идемпотентно: повторный вызов меняет роль, а не падает на уникальном
 * ключе (пользователя могут пригласить в организацию, где он уже состоит).
 *
 * @param {object} tx   — клиент Prisma или транзакция: связь обязана создаваться В ТОЙ ЖЕ
 *                        транзакции, что и пользователь, иначе при сбое останется пользователь
 *                        без организации — ровно тот случай, который и чинится.
 * @param {string} p.userUuid
 * @param {string} p.organizationUuid
 * @param {string} [p.role]     — из ORG_ROLES
 * @param {string} [p.profile]  — ЗАДЕЛ под профили прав (О2); сейчас не используется
 */
export async function grantMembership(tx, { userUuid, organizationUuid, role = DEFAULT_ROLE, profile = undefined }) {
	const db = tx ?? prisma;
	const r = normalizeRole(role);
	const membership = await db.accessRight.upsert({
		where: { userUuid_organizationUuid: { userUuid, organizationUuid } },
		create: { userUuid, organizationUuid, role: r },
		update: { role: r },
	});

	/*
	 * ПРАВА ВЫДАЮТСЯ ВМЕСТЕ С ЧЛЕНСТВОМ (О2).
	 *
	 * Иначе приглашённый по коду входил и не видел НИЧЕГО, притом что ошибки не было: связь
	 * есть, прав нет, система пустая. Профиль по умолчанию зависит от роли — владельцу полный,
	 * приглашённому просмотр (безопасно и сразу показывает, что всё работает).
	 *
	 * `profile: null` — явный отказ выдавать права (администратор проставит сам).
	 */
	const code = profile === undefined ? defaultProfileFor(r) : profile;
	if (code) await applyProfile(db, { userUuid, organizationUuid, profile: code });
	return membership;
}

/**
 * Развернуть профиль в права пользователя по организации.
 *
 * ПЕРЕЗАПИСЫВАЕМ ВСЕ модели профиля, а не только «новые»: назначение профиля должно давать
 * предсказуемый результат, а не смесь с остатками прежнего. Уровень `none` пишем строкой, а не
 * удаляем запись, — так в интерфейсе видно «доступ закрыт намеренно», а не «право забыли выдать».
 *
 * @returns {Promise<number>} сколько прав записано
 */
export async function applyProfile(tx, { userUuid, organizationUuid, profile }) {
	const db = tx ?? prisma;
	if (!findProfile(profile)) throw new Error(`Неизвестный профиль прав: ${profile}`);
	const levels = expandProfile(profile);
	const rows = Object.entries(levels).map(([modelName, accessLevel]) => ({
		userUuid, organizationUuid, modelName, accessLevel,
	}));
	/*
	 * ДВЕ ОПЕРАЦИИ ВМЕСТО ШЕСТИДЕСЯТИ ДВУХ. Профиль покрывает все модели карты, поэтому проще
	 * снести права пользователя по ЭТОЙ организации и записать набор заново. Шестьдесят два
	 * upsert-а внутри транзакции регистрации — верный способ упереться в её таймаут.
	 *
	 * Глобальные права (`organizationUuid = null`, они у суперадминов и legacy-записей) не
	 * трогаем: они не про эту организацию, и снести их профилем было бы неожиданно.
	 */
	await db.accessPermission.deleteMany({ where: { userUuid, organizationUuid } });
	await db.accessPermission.createMany({ data: rows });
	return rows.length;
}

/** Снять членство. Возвращает true, если связь была. */
export async function revokeMembership(tx, { userUuid, organizationUuid }) {
	const db = tx ?? prisma;
	const { count } = await db.accessRight.deleteMany({ where: { userUuid, organizationUuid } });
	return count > 0;
}

export default {
	ORG_ROLES, OWNER_ROLE, DEFAULT_ROLE, normalizeRole,
	grantMembership, applyProfile, revokeMembership, isInstallationOperator, canSignIn,
};
