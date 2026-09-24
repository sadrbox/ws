// Идентичность и режим УСТАНОВКИ (О4 плана PLAN_INSTALL_MODES_2026-09-24.md).
//
// ЗАЧЕМ. Пока установка одна — наша, — понятия «установка» не требовалось. Как только их
// становится несколько (у клиента, у обслуживающей фирмы, на общем сервере), система обязана
// знать про себя две вещи: КТО ОНА (идентификатор, чтобы отличать себя в журналах, в заявках
// агентов 1С и в приглашениях) и КАК ЕЮ ПОЛЬЗУЮТСЯ (режим).
//
// РЕЖИМ — ОДНА НАСТРОЙКА, А НЕ ТРИ ПРОДУКТА. Три вида использования различаются ровно пятью
// правилами (см. раздел 0 плана); учёт, документы, модули и изоляция у них одинаковы. Поэтому
// «если режим X» допустимо только в этих правилах — всё остальное обязано работать одинаково,
// иначе код разойдётся на три ветки и чинить придётся трижды.
//
// ХРАНИЛИЩЕ — БЕЗ МИГРАЦИИ: ключи в app_settings, как у тогглов модулей (T11.1). Установка
// одна на базу, значений единицы — отдельная таблица тут ничего не добавила бы.
import { getSettings, setSetting } from "./appSettings.js";
import { INSTALL_MODES, DEFAULT_MODE, normalizeMode, selfRegistrationAllowed } from "./installationModes.js";
import crypto from "node:crypto";

// Правила режимов живут в `installationModes.js` (без БД — чтобы их можно было проверить
// тестом и переиспользовать в установщике). Здесь — только хранилище и кэш.
export { INSTALL_MODES, DEFAULT_MODE, normalizeMode, selfRegistrationAllowed };

export const KEYS = {
	id: "installation.id",
	name: "installation.name",
	mode: "installation.mode",
	/** Явный рубильник самостоятельной регистрации: перекрывает умолчание режима. */
	selfRegistration: "installation.selfRegistration",
};

// Кэш: настройки читаются на каждый вход и на каждую проверку правила, а меняются раз в жизнь.
let cache = null;
let cachedAt = 0;
const TTL_MS = 30_000;

export function invalidateInstallationCache() {
	cache = null;
	cachedAt = 0;
}

/**
 * Сведения об установке. `id` создаётся ЛЕНИВО при первом обращении: установщика у существующих
 * баз не было, а идентификатор нужен уже сейчас — и он должен быть одним и тем же после
 * перезапуска.
 *
 * ВНИМАНИЕ ПРИ КЛОНИРОВАНИИ (С4 разбора): копия базы унесёт с собой тот же `id`. Смену
 * идентификатора обязан выполнять перенос/клон установки — вместе с отзывом токенов агентов
 * и баз 1С, иначе два сервера будут представляться одним и тем же.
 */
export async function getInstallation() {
	if (cache && Date.now() - cachedAt < TTL_MS) return cache;
	const raw = await getSettings(Object.values(KEYS));
	let id = raw[KEYS.id];
	if (!id) {
		id = crypto.randomUUID();
		await setSetting(KEYS.id, id);
	}
	const mode = raw[KEYS.mode] ? normalizeMode(raw[KEYS.mode]) : null;
	cache = {
		id,
		name: raw[KEYS.name] || null,
		/** null — режим ещё не выбран (установка до появления этого понятия). */
		mode,
		modeEffective: mode ?? DEFAULT_MODE,
		selfRegistration: selfRegistrationAllowed({ mode, override: raw[KEYS.selfRegistration] }),
	};
	cachedAt = Date.now();
	return cache;
}

/** Запись настроек установки (установщик, мастер первого запуска, оператор). */
export async function setInstallation({ name, mode, selfRegistration }) {
	if (name !== undefined) await setSetting(KEYS.name, name);
	if (mode !== undefined) await setSetting(KEYS.mode, normalizeMode(mode));
	if (selfRegistration !== undefined) {
		await setSetting(KEYS.selfRegistration, selfRegistration === null ? null : String(!!selfRegistration));
	}
	invalidateInstallationCache();
	return getInstallation();
}

export default { KEYS, INSTALL_MODES, DEFAULT_MODE, normalizeMode, selfRegistrationAllowed, getInstallation, setInstallation, invalidateInstallationCache };
