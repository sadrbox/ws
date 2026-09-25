/**
 * Отбор для панели-списка, которую открывают из другого экрана («Панель главбуха» → находки
 * клиента, пункт чек-листа → находки его проверки).
 *
 * ПОЧЕМУ НЕ ЧЕРЕЗ data ПАНЕЛИ. Списки — синглтоны: uniqId = имя компонента (app/paneUniqId), и
 * второй addPane только активирует уже открытую вкладку — новая data до неё не доходит. Поэтому
 * отбор кладётся сюда: открытый список получает его по подписке, ещё не открытый — забирает при
 * монтировании (consume). Отбор, отданный подписчику, в очереди не остаётся: иначе следующий
 * монтаж того же списка применил бы чужой, давно устаревший отбор.
 */
type Listener = (value: unknown) => void;

const pending = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener>>();

/** Попросить список `key` показать отбор `value`. */
export function requestPaneFilter<T>(key: string, value: T): void {
	const subs = listeners.get(key);
	if (subs && subs.size > 0) {
		pending.delete(key);
		for (const fn of subs) fn(value);
		return;
	}
	pending.set(key, value);
}

/** Забрать отложенный отбор (при монтировании списка). */
export function consumePaneFilter<T>(key: string): T | undefined {
	if (!pending.has(key)) return undefined;
	const v = pending.get(key) as T;
	pending.delete(key);
	return v;
}

/** Подписаться на отборы для `key`. Возвращает отписку. */
export function subscribePaneFilter<T>(key: string, fn: (value: T) => void): () => void {
	let subs = listeners.get(key);
	if (!subs) {
		subs = new Set();
		listeners.set(key, subs);
	}
	const l = fn as Listener;
	subs.add(l);
	return () => {
		subs?.delete(l);
	};
}
