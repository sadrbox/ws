// ПРАВИЛА членства и входа — без обращения к базе (О1, О6 плана PLAN_INSTALL_MODES_2026-09-24.md).
//
// Отделены от `orgMembership.js` (там Prisma) по той же причине, что и режимы установки: эти
// решения проверяются тестом в гейте `verify`, без поднятой БД, и переиспользуются панелью.

/**
 * Роли в организации. `admin` — распоряжается организацией (пользователи, права, настройки),
 * `member` — работает в ней по выданным правам.
 *
 * ВЛАДЕЛЕЦ ПОКА РАВЕН `admin`: третья роль без профилей прав ничего не добавит, а миграцию
 * потребует. Когда появятся профили (О2), владелец станет отдельным значением ЗДЕСЬ, и
 * остальной код об этом не узнает.
 */
export const ORG_ROLES = ["admin", "member"];
export const OWNER_ROLE = "admin";
export const DEFAULT_ROLE = "member";

export function normalizeRole(raw) {
	const v = String(raw ?? "").trim().toLowerCase();
	return ORG_ROLES.includes(v) ? v : DEFAULT_ROLE;
}

/**
 * ОПЕРАТОР УСТАНОВКИ — тот, кто её обслуживает: обновления, бэкапы, модули, агенты 1С.
 *
 * Сегодня это суперадмин, и он же видит все учётные данные всех организаций. Разделить их —
 * задача О5; здесь заведено ИМЯ для понятия, чтобы правило входа писалось про оператора, а не
 * про суперадмина. Когда роль разделится, поменяется только эта функция.
 */
export function isInstallationOperator(user) {
	return !!user?.isSuperAdmin;
}

/**
 * Пускать ли в систему (О6).
 *
 * ПРАВИЛО: вход — тому, у кого есть хотя бы одна организация. Человек без организаций не видит
 * ни одной строки данных: пустить его внутрь значит показать пустую систему и оставить гадать,
 * что сломалось.
 *
 * ИСКЛЮЧЕНИЕ — ОПЕРАТОР УСТАНОВКИ. Организаций у него нет и не должно быть, а войти обязан:
 * иначе после сбоя, в котором пропали связи, запертым снаружи окажется единственный, кто умеет
 * это починить.
 *
 * @returns {{allowed: boolean, reason: string|null}} reason — КОД для интерфейса, не текст:
 *          сообщение подбирает панель, у неё есть перевод и место для кнопки «ввести код».
 */
export function canSignIn({ isOperator = false, membershipCount = 0 } = {}) {
	if (isOperator) return { allowed: true, reason: null };
	if (membershipCount > 0) return { allowed: true, reason: null };
	return { allowed: false, reason: "NO_ORGANIZATIONS" };
}

export default { ORG_ROLES, OWNER_ROLE, DEFAULT_ROLE, normalizeRole, isInstallationOperator, canSignIn };
