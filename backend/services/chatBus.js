// ─────────────────────────────────────────────────────────────────────────────
// Шина событий реального времени (E4, collaboration).
//
// In-process EventEmitter: публикует событие в канал организации, доставляет всем
// SSE-подписчикам этой организации. Обслуживает и чат, и уведомления (назначение
// задачи и т.п.) — одна инфраструктура, не две.
//
// Масштаб: при нескольких инстансах Node in-process шины не хватит — тогда
// Postgres LISTEN/NOTIFY как транспорт между процессами (без Redis). Сейчас один
// инстанс (pm2 fork), поэтому EventEmitter достаточно.
// ─────────────────────────────────────────────────────────────────────────────
import { EventEmitter } from "node:events";

const emitter = new EventEmitter();
// Подписчиков на организацию может быть много (все открытые вкладки всех
// пользователей с доступом) — снимаем дефолтный лимит в 10, иначе Node сыплет
// предупреждениями о «возможной утечке».
emitter.setMaxListeners(0);

/** Имя канала организации. */
const channel = (organizationUuid) => `org:${organizationUuid}`;

/**
 * Опубликовать событие в канал организации.
 * @param {string} organizationUuid
 * @param {{ type: string, [k: string]: unknown }} event — { type: "chat" | "task" | … }
 */
export function publish(organizationUuid, event) {
	if (!organizationUuid) return;
	emitter.emit(channel(organizationUuid), event);
}

/**
 * Подписаться на события НЕСКОЛЬКИХ организаций (доступных пользователю).
 * @param {string[]} organizationUuids
 * @param {(event: object) => void} onEvent
 * @returns {() => void} отписка
 */
export function subscribe(organizationUuids, onEvent) {
	const orgs = [...new Set(organizationUuids.filter(Boolean))];
	for (const o of orgs) emitter.on(channel(o), onEvent);
	return () => {
		for (const o of orgs) emitter.off(channel(o), onEvent);
	};
}

export default { publish, subscribe };
