// ─────────────────────────────────────────────────────────────────────────────
// In-memory TTL-кэш редко меняющихся справочников (E3). Пере-запросный слой (L2)
// поверх пер-контекстных кэшей постинга: план счетов/субконто читаются из БД раз
// на TTL-окно, а не при каждом сохранении документа. Инвалидация — на запись
// (роутеры справочников вызывают invalidateRefCache). Без Redis: одному инстансу
// Node достаточно process-локального Map; при горизонтальном масштабировании
// заменить на Postgres LISTEN/NOTIFY (см. E4-шину).
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 5 * 60_000; // 5 минут

/** namespace → Map<key, { value, expires }> */
const store = new Map();

function nsMap(namespace) {
	let m = store.get(namespace);
	if (!m) { m = new Map(); store.set(namespace, m); }
	return m;
}

/**
 * Вернуть закэшированное значение или загрузить через loader и закэшировать.
 * Кэшируются в т.ч. null-результаты (частый «счёт не найден») — иначе отсутствие
 * счёта било бы в БД каждый раз.
 *
 * @param {string} namespace  — группа (напр. "chartOfAccount")
 * @param {string} key        — ключ внутри группы
 * @param {() => Promise<any>} loader — асинхронная загрузка при промахе
 * @param {number} [ttlMs]
 */
export async function getCached(namespace, key, loader, ttlMs = DEFAULT_TTL_MS) {
	const m = nsMap(namespace);
	const hit = m.get(key);
	const now = Date.now();
	if (hit && hit.expires > now) return hit.value;
	const value = await loader();
	m.set(key, { value, expires: now + ttlMs });
	return value;
}

/** Сбросить весь namespace (вызывается при записи в справочник). */
export function invalidateRefCache(namespace) {
	store.delete(namespace);
}

/** Полный сброс (для тестов). */
export function clearRefCache() {
	store.clear();
}

export default { getCached, invalidateRefCache, clearRefCache };
