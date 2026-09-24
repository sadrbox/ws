// ─────────────────────────────────────────────────────────────────────────────
// moduleAccess — включение/отключение функциональных модулей на организацию.
//
// Хранилище — ключ-значение AppSetting (без миграции): ключ
// `modules.disabled.<organizationUuid>` = JSON-массив ключей ОТКЛЮЧЁННЫХ модулей.
// Пусто / нет записи = все модули включены (поведение по умолчанию не меняется).
//
// Серверный гард (moduleGuardMiddleware) блокирует СОЗДАНИЕ (POST коллекции)
// документов отключённого модуля с 403 MODULE_DISABLED. Читать/править/удалять
// существующие документы отключённого модуля не запрещаем — отключение убирает
// раздел из UI и запрещает заводить новое, но не прячет и не ломает историю.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";
import { moduleOfRoute, guardMode } from "./moduleRoutes.js";

/** Канонический список модулей (тот же на фронте — src/config/modules.ts). */
export const MODULE_KEYS = ["sales", "purchase", "warehouse", "cash", "hr", "govdocs", "edo"];

const keyFor = (orgUuid) => `modules.disabled.${orgUuid}`;

// Кэш прочитанных наборов на организацию: гард дёргается на каждом POST-е.
const cache = new Map(); // orgUuid -> { at:number, set:Set<string> }
const TTL_MS = 30_000;

export function invalidateModuleCache(orgUuid) {
	if (orgUuid) cache.delete(orgUuid);
	else cache.clear();
}

/** Набор ОТКЛЮЧЁННЫХ модулей организации (валидированный по MODULE_KEYS). */
export async function getDisabledModules(orgUuid) {
	if (!orgUuid) return new Set();
	const hit = cache.get(orgUuid);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.set;
	const row = await prisma.appSetting.findUnique({ where: { key: keyFor(orgUuid) } });
	let arr = [];
	try {
		arr = row?.value ? JSON.parse(row.value) : [];
	} catch {
		arr = [];
	}
	const set = new Set(Array.isArray(arr) ? arr.filter((k) => MODULE_KEYS.includes(k)) : []);
	cache.set(orgUuid, { at: Date.now(), set });
	return set;
}

/** Сохранить список отключённых модулей организации (чистит на валидные ключи). */
export async function setDisabledModules(orgUuid, list) {
	const clean = [...new Set((Array.isArray(list) ? list : []).filter((k) => MODULE_KEYS.includes(k)))];
	await prisma.appSetting.upsert({
		where: { key: keyFor(orgUuid) },
		update: { value: JSON.stringify(clean) },
		create: { key: keyFor(orgUuid), value: JSON.stringify(clean) },
	});
	invalidateModuleCache(orgUuid);
	return clean;
}

// Путь коллекции (POST на создание) → модуль. Точное совпадение req.path — чтобы
// под-действия (`/sales/batch-delete`, item-роуты) и PUT/DELETE не блокировались.
/*
 * ГАРД МОДУЛЯ — НА ВЕСЬ МОДУЛЬ, А НЕ НА КНОПКУ «СОЗДАТЬ» (О7).
 *
 * Было: только POST у одиннадцати точных путей и лишь при `organizationUuid` в теле. У
 * организации с отключёнными «Продажами» читались списки, правились и удалялись документы,
 * печатались формы — отключение значило «скрыли меню». Стало: путь принадлежит модулю → модуль
 * отключён → закрыт на всех методах.
 *
 * ОРГАНИЗАЦИЮ ИЩЕМ В ТРЁХ МЕСТАХ по убыванию точности: тело (создание документа прямо называет
 * организацию), строка запроса (списки и отчёты фильтруют по ней), активная организация
 * пользователя. Не нашли ни одной — пропускаем: гадать, чей это запрос, хуже, чем не проверить.
 *
 * Карта путей — в `services/moduleRoutes.js` (без БД, проверяется тестом). Рубильник
 * `MODULE_GUARD=create-only` возвращает прежнее поведение.
 */
export function moduleGuardMiddleware(req, res, next) {
	const segment = req.path.replace(/^\/+/, "").split("/")[0];
	const moduleKey = moduleOfRoute(segment);
	if (!moduleKey) return next();

	// Прежний режим: закрываем только создание документа.
	if (guardMode() === "create-only" && req.method !== "POST") return next();
	// Чтение метаданных самим приложением — не работа с модулем.
	if (req.method === "OPTIONS") return next();

	const orgUuid = req.body?.organizationUuid
		|| (typeof req.query?.organizationUuid === "string" ? req.query.organizationUuid : null)
		|| req.user?.organizationUuid;
	if (!orgUuid) return next();

	getDisabledModules(orgUuid)
		.then((disabled) => {
			if (disabled.has(moduleKey)) {
				return res.status(403).json({
					success: false,
					code: "MODULE_DISABLED",
					message: "Модуль не установлен для организации",
					module: moduleKey,
				});
			}
			next();
		})
		.catch(next);
}
