/**
 * Разворачивание ответов API к единому виду.
 *
 * Бэкенд возвращает коллекции по-разному: голым массивом, либо обёрнутыми
 * в `{ data: [...] }` / `{ items: [...] }`; одиночные сущности — голым объектом
 * либо `{ item: {...} }`. Хелперы приводят оба случая к предсказуемому виду,
 * чтобы вызывающий код не дублировал эту логику.
 */

/** Вернуть массив элементов из ответа API (массив | {data} | {items}). */
export function unwrapList<T = any>(resp: unknown): T[] {
	if (Array.isArray(resp)) return resp as T[];
	const r = resp as { data?: unknown; items?: unknown } | null | undefined;
	if (Array.isArray(r?.data)) return r.data as T[];
	if (Array.isArray(r?.items)) return r.items as T[];
	return [];
}

/** Вернуть одиночную сущность из ответа API ({item} | сам объект). */
export function unwrapItem<T = any>(resp: unknown): T {
	const r = resp as { item?: unknown } | null | undefined;
	return (r && typeof r === "object" && "item" in r ? r.item : resp) as T;
}
