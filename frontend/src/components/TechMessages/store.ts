/**
 * «Технические сообщения» — ВСЕ `<Notice />` приложения в одном месте.
 *
 * ЗАЧЕМ. Сообщение формы — это `<Notice />`, и раньше каждая форма вставляла его прямо в
 * свою разметку. Появилось сообщение — содержимое уехало вниз под курсором, потеряв
 * прокрутку; исчезло — уехало обратно. Там, где основную площадь занимает таблица, любое
 * такое сообщение ломает разметку ровно в тот момент, когда человек работает. А ещё его
 * приходилось искать: в одной форме оно справа внизу, в другой над таблицей, в третьей
 * между областями.
 *
 * РЕШЕНИЕ. Сообщения не рисуются на месте, а СООБЩАЮТСЯ сюда, и приложение показывает их
 * в одной области — правой, сворачиваемой. Разметка форм не двигается никогда, место для
 * сообщений всегда одно и то же, а сами они не теряются: у области есть история.
 *
 * АКТУАЛЬНОЕ И НАКОПЛЕННОЕ. У сообщения есть `key` — тот, кто его шлёт (запрос, экран,
 * операция). Пока источник сообщает одно и то же, запись одна: сто повторов одной ошибки
 * опроса не превращаются в сто строк. Как источник замолчал (ошибка ушла, запрос удался),
 * запись становится ИСТОРИЕЙ: её видно в свёрнутом разделе, потому что «было и прошло» —
 * это тоже ответ на вопрос «что вообще происходило».
 *
 * ПОЧЕМУ МОДУЛЬ, А НЕ КОНТЕКСТ — по той же причине, что и у реестра операций
 * (progress.ts): сообщения переживают размонтирование экрана, который их послал.
 */
import { createContext, useContext, useEffect, useId, useRef, useSyncExternalStore } from "react";
import type { NoticeItem, NoticeType } from "src/components/Notice";

export type TechMessage = {
	id: string;
	/**
	 * ОБЛАСТЬ, которой принадлежит сообщение, — идентификатор пейна. Нужна, чтобы
	 * показывать сообщения ТЕКУЩЕЙ формы отдельно от чужих: у человека открыто до десятка
	 * пейнов, и «не заполнено обязательное поле» из соседнего документа сбивает с толку.
	 */
	scope: string;
	/** Источник: повторы с тем же ключом обновляют запись, а не плодят новые. */
	key: string;
	type: NoticeType;
	text: string;
	/** Где это возникло — словами человека («Базы», «Расширения»). */
	source: string;
	/** Первое появление и последнее подтверждение: «висит уже минуту» — тоже факт. */
	firstAt: number;
	lastAt: number;
	/** Источник всё ещё сообщает это? Нет — запись ушла в историю. */
	active: boolean;
};

/** Сколько записей держим: доска — не журнал; журнал команд живёт в «Заданиях». */
const LIMIT = 50;

/**
 * Область «всё приложение»: сама область сообщений видит всё, что ей сообщили, а
 * сообщения без пейна (общие, не привязанные к форме) живут под этим ключом.
 */
export const APP_SCOPE = "app";

/**
 * Кто сообщает — знает окружение, а не каждая форма по отдельности.
 *
 * Пейн оборачивает своё содержимое собой: идентификатором (область) и заголовком
 * (источник — «Реализация № 12», «Базы 1С»). Поэтому любой `<Notice />` внутри любой формы
 * попадает в список подписанным, и не нужно ни одной правки на месте вызова: иначе
 * подпись пришлось бы проставлять руками в полусотне форм — и однажды забыть.
 */
export type NoticeOrigin = { scope: string; source: string };
export const NoticeScope = createContext<NoticeOrigin>({ scope: APP_SCOPE, source: "" });
export const useNoticeOrigin = (): NoticeOrigin => useContext(NoticeScope);
/** Только область — там, где источник подставляют сами (общие компоненты). */
export const useNoticeScope = (): string => useContext(NoticeScope).scope;

let notices: TechMessage[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

const sameItems = (a: TechMessage[], b: NoticeItem[]): boolean =>
	a.length === b.length && a.every((n, i) => n.type === b[i].type && n.text === b[i].text);

/**
 * Сообщить состояние источника. Пустой список — источник замолчал: его активные записи
 * становятся историей.
 */
export function reportNotices(scope: string, rawKey: string, source: string, items: NoticeItem[]): void {
	const now = Date.now();
	// Ключ уникален В ПРЕДЕЛАХ ОБЛАСТИ: две открытые карточки баз шлют «base-ext» обе, и
	// без области вторая затирала бы сообщение первой.
	const key = `${scope}::${rawKey}`;
	const mine = notices.filter((n) => n.key === key && n.active);

	if (!items.length) {
		if (!mine.length) return;
		notices = notices.map((n) => (n.key === key && n.active ? { ...n, active: false } : n));
		emit();
		return;
	}

	// То же самое, что и было: только отмечаем, что оно всё ещё так, и не чаще раза
	// в пять секунд — иначе опрос раз в три секунды перерисовывал бы доску вечно.
	if (sameItems(mine, items)) {
		if (now - mine[0].lastAt < 5000) return;
		notices = notices.map((n) => (n.key === key && n.active ? { ...n, lastAt: now } : n));
		emit();
		return;
	}

	// Изменилось: прежние активные записи этого ключа — в историю, новые — активные.
	const aged = notices.map((n) => (n.key === key && n.active ? { ...n, active: false } : n));
	const fresh: TechMessage[] = items.map((it) => ({
		id: `n${++seq}`, scope, key, type: it.type, text: it.text, source,
		firstAt: now, lastAt: now, active: true,
	}));
	notices = [...fresh, ...aged].slice(0, LIMIT);
	emit();
}

/**
 * Разовое сообщение: итог операции, отказ команды, результат проверки.
 * Активным не становится — это уже случившийся факт, ему место сразу в истории.
 */
export function noteNotice(source: string, item: NoticeItem, scope = APP_SCOPE): void {
	const now = Date.now();
	notices = [{
		id: `n${++seq}`, scope, key: `once_${seq}`, type: item.type, text: item.text,
		source, firstAt: now, lastAt: now, active: false,
	}, ...notices].slice(0, LIMIT);
	emit();
}

/** Убрать историю. Актуальные записи остаются: они описывают то, что не так СЕЙЧАС. */
export function clearNoticeHistory(scope = APP_SCOPE): void {
	const next = notices.filter((n) => n.active || (scope !== APP_SCOPE && n.scope !== scope));
	if (next.length === notices.length) return;
	notices = next;
	emit();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => notices;

const useAllNotices = (): TechMessage[] => useSyncExternalStore(subscribe, snapshot, snapshot);

/**
 * Сообщения одной области.
 *
 * Доска ПАНЕЛИ показывает и сообщения карточек: карточку открыли из панели, её операция
 * идёт по тем же базам, и прятать её отказ от общего обзора значило бы делить правду на
 * части. Доска КАРТОЧКИ — только свои: чужие ошибки в чужой форме сбивают с толку.
 */
export const useScopedNotices = (scope: string): TechMessage[] => {
	const all = useAllNotices();
	return scope === APP_SCOPE ? all : all.filter((n) => n.scope === scope);
};

/** Сколько сообщений сейчас актуальны — для счётчика на свёрнутой области. */
export const useActiveNoticeCount = (): number =>
	useAllNotices().filter((n) => n.active).length;

/**
 * Сообщать доске состояние экрана — вместо того чтобы рисовать `<Notice />` над таблицей.
 *
 * Зовётся безусловно и на каждом рендере: `items` описывают «что сейчас не так», и пустой
 * список — полноценный ответ («всё в порядке»), переводящий прежнюю запись в историю.
 * При размонтировании экран замолкает: сообщение закрытой вкладки не притворяется текущим.
 */
export function useNoticeReport(scope: string, key: string, source: string, items: NoticeItem[]): void {
	// Массив создаётся заново на каждом рендере — сравниваем по содержимому, иначе
	// доска просыпалась бы на каждый рендер экрана.
	const fingerprint = items.map((i) => `${i.type} ${i.text}`).join("");
	const itemsRef = useRef(items);
	itemsRef.current = items;
	useEffect(() => {
		reportNotices(scope, key, source, itemsRef.current);
	}, [scope, key, source, fingerprint]);
	useEffect(() => () => reportNotices(scope, key, source, []), [scope, key, source]);
}

/**
 * Ошибка запроса как сообщение доски: текст ошибки сервиса написан для человека.
 * Не-Error не приводим к строке: получилось бы «[object Object]» в лицо пользователю.
 */
export const errorNotice = (error: unknown, unknownText = "?"): NoticeItem[] =>
	error ? [{ type: "error", text: error instanceof Error ? error.message : unknownText }] : [];

/**
 * Сообщить содержимое одного `<Notice />` — с автоматическим ключом и подписью.
 *
 * Ключ берётся из `useId()`: он уникален для экземпляра компонента и переживает
 * перерисовки, поэтому один и тот же `<Notice />` обновляет свою запись, а не плодит
 * новые. Область и источник — из окружения (пейн подставляет себя), поэтому ни одному из
 * полусотни мест вызова не пришлось ничего дописывать.
 */
export function useReportNotice(items: NoticeItem[] | undefined, sourceOverride?: string): void {
	const id = useId();
	const { scope, source } = useNoticeOrigin();
	useNoticeReport(scope, id, sourceOverride || source || APP_SCOPE, items ?? []);
}
