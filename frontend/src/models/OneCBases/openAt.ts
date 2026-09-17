/**
 * ОТКРЫТЬ КАРТОЧКУ БАЗЫ НА НУЖНОЙ ВКЛАДКЕ (П25) — просьба, переданная мимо данных панели.
 *
 * ПОЧЕМУ НЕ ПОЛЕМ В `data`. Идентичность панели карточки строится по ВСЕМ полям строки
 * (см. buildPaneUniqId: у базы нет uuid), поэтому «та же база, но с вкладкой» открыла бы
 * ВТОРУЮ карточку той же базы. Просьба живёт здесь и живёт ровно до открытия: карточка
 * забирает её при монтировании.
 *
 * КАРТОЧКА МОГЛА БЫТЬ УЖЕ ОТКРЫТА — тогда монтирования не будет, и о просьбе она узнаёт
 * событием: `addPane` такую панель просто делает активной.
 */
export type BaseOpenAt = { tab: string; session?: string | null };

const wanted = new Map<string, BaseOpenAt>();
const EVENT = "onecBaseOpenAt";

const norm = (baseKey: string): string => baseKey.trim().toLowerCase();

/** Попросить карточку базы открыться на вкладке (и подсветить сеанс по номеру). */
export function requestBaseTab(baseKey: string, at: BaseOpenAt): void {
	if (!baseKey) return;
	wanted.set(norm(baseKey), at);
	window.dispatchEvent(new CustomEvent(EVENT, { detail: { baseKey: norm(baseKey), ...at } }));
}

/** Забрать просьбу (одноразово): её выполняет тот, кто открылся. */
export function takeBaseTab(baseKey: string): BaseOpenAt | null {
	const key = norm(baseKey);
	const v = wanted.get(key) ?? null;
	wanted.delete(key);
	return v;
}

/** Подписка для УЖЕ открытой карточки: панель только активируется, и монтирования нет. */
export function onBaseTabRequest(baseKey: string, fn: (at: BaseOpenAt) => void): () => void {
	const key = norm(baseKey);
	const h = (e: Event) => {
		const d = (e as CustomEvent<{ baseKey?: string } & BaseOpenAt>).detail;
		if (!d || d.baseKey !== key || !d.tab) return;
		wanted.delete(key);
		fn({ tab: d.tab, session: d.session ?? null });
	};
	window.addEventListener(EVENT, h);
	return () => window.removeEventListener(EVENT, h);
}
