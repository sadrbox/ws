// ─────────────────────────────────────────────────────────────────────────────
// Сброс кэшей во ВСЕХ воркерах кластера (Н7 аудита 26.09).
//
// ЗАЧЕМ. Кэши процесса (план счетов и субконто — 5 мин, производственный календарь — 5 мин,
// настройки качества и модули организации — 30 с) сбрасывались на записи только в том воркере,
// куда пришёл запрос. В проде воркеров четыре: план счетов поправили — а проведение в соседнем
// воркере ещё пять минут берёт старые счета; модуль отключили — а три воркера из четырёх его
// пропускают.
//
// КАК. Через ту же шину, что чат и уведомления (services/chatBus.js, Postgres LISTEN/NOTIFY
// между воркерами): служебный канал, событие «сбрось кэш <имя>[, ключ]». Свои подписчики
// получают его сразу, чужие — через Postgres. Одиночный процесс (разработка) базы не касается.
//
// Кэш подключается так:
//   const broadcast = onCacheInvalidate("имя", (key) => локальныйСброс(key));
//   ...при записи: локальныйСброс(key); broadcast(key);
// Обработчик обязан сбрасывать ТОЛЬКО локально — иначе событие ходило бы по кругу.
// Событие, пришедшее в разрыв соединения шины, теряется — тогда кэш доживает свой TTL, как и раньше.
// ─────────────────────────────────────────────────────────────────────────────
import { publish as busPublish, subscribe as busSubscribe } from "./chatBus.js";
import { logger } from "./logger.js";

/** Служебный «канал организации» шины: настоящих организаций с таким uuid не бывает. */
export const CACHE_CHANNEL = "__cache__";
const EVENT_TYPE = "cache-invalidate";

/**
 * Реестр кэшей процесса. Фабрика — ради тестов (своя шина, свой реестр).
 * @param {{ publish?: Function, subscribe?: Function, log?: { warn?: Function } }} [deps]
 */
export function createCacheBus({ publish = busPublish, subscribe = busSubscribe, log = logger("cache-bus") } = {}) {
	/** имя кэша → обработчики локального сброса */
	const handlers = new Map();
	let subscribed = false;

	function onEvent(event) {
		if (event?.type !== EVENT_TYPE || !event.name) return;
		for (const fn of handlers.get(event.name) ?? []) {
			try {
				fn(event.key ?? null);
			} catch (e) {
				log.warn?.(`сброс кэша «${event.name}» упал: ${e?.message || e}`);
			}
		}
	}

	function ensureSubscribed() {
		if (subscribed) return;
		subscribed = true;
		subscribe([CACHE_CHANNEL], onEvent);
	}

	/**
	 * Зарегистрировать локальный сброс кэша; вернёт функцию рассылки сброса всем воркерам.
	 * @param {string} name — имя кэша (одинаковое во всех воркерах)
	 * @param {(key: string|null) => void} invalidateLocal
	 * @returns {(key?: string|null) => void}
	 */
	function onCacheInvalidate(name, invalidateLocal) {
		if (!handlers.has(name)) handlers.set(name, new Set());
		handlers.get(name).add(invalidateLocal);
		ensureSubscribed();
		return (key = null) => broadcastInvalidate(name, key);
	}

	/** Разослать сброс кэша `name` (и свой процесс получит его — сброс идемпотентен). */
	function broadcastInvalidate(name, key = null) {
		try {
			publish(CACHE_CHANNEL, { type: EVENT_TYPE, name, key: key ?? null });
		} catch (e) {
			log.warn?.(`сброс кэша «${name}» не разослан: ${e?.message || e}`);
		}
	}

	return { onCacheInvalidate, broadcastInvalidate, _handlers: handlers };
}

const shared = createCacheBus();

export const onCacheInvalidate = shared.onCacheInvalidate;
export const broadcastInvalidate = shared.broadcastInvalidate;

export default { onCacheInvalidate, broadcastInvalidate, CACHE_CHANNEL };
