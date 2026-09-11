/**
 * Доска сообщений панели: все `<Notice />` «Администрирования 1С» в одном месте.
 *
 * ЗАЧЕМ. Сообщение экрана — это `<Notice />`, и раньше каждая вкладка вставляла его НАД
 * своей таблицей. Появилось сообщение — таблица уехала вниз под курсором, потеряв
 * прокрутку; исчезло — уехала обратно. Там, где таблица занимает почти всю площадь, любое
 * такое сообщение ломает разметку ровно в тот момент, когда человек работает.
 *
 * РЕШЕНИЕ. Сообщения не рисуются на месте, а СООБЩАЮТСЯ сюда, и панель показывает их в
 * своей правой области — в слоте, который занимает место всегда. Разметка не двигается,
 * а сообщения не теряются: у доски есть история.
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
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import type { NoticeItem, NoticeType } from "src/components/Notice";

export type PanelNotice = {
	id: string;
	/**
	 * ОБЛАСТЬ, которой принадлежит сообщение: "panel" — сама панель, иначе идентификатор
	 * пейна карточки. Карточка открывается отдельным пейном и может быть единственным,
	 * что человек видит, — её сообщения обязаны быть видны в ней самой, а не только на
	 * доске панели, до которой ещё надо добраться.
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

/** Область самой панели: её доска видит всё, включая сообщения открытых карточек. */
export const PANEL_SCOPE = "panel";

/**
 * Чья это область — знает окружение, а не каждый экран по отдельности.
 *
 * Панель ничего не оборачивает (значение по умолчанию), карточка оборачивает себя своим
 * идентификатором пейна. Иначе `QueryError` в общем компоненте пришлось бы каждый раз
 * снабжать областью вручную — и однажды забыть.
 */
export const NoticeScope = createContext<string>(PANEL_SCOPE);
export const useNoticeScope = (): string => useContext(NoticeScope);

let notices: PanelNotice[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

const sameItems = (a: PanelNotice[], b: NoticeItem[]): boolean =>
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
	const fresh: PanelNotice[] = items.map((it) => ({
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
export function noteNotice(source: string, item: NoticeItem, scope = PANEL_SCOPE): void {
	const now = Date.now();
	notices = [{
		id: `n${++seq}`, scope, key: `once_${seq}`, type: item.type, text: item.text,
		source, firstAt: now, lastAt: now, active: false,
	}, ...notices].slice(0, LIMIT);
	emit();
}

/** Убрать историю. Актуальные записи остаются: они описывают то, что не так СЕЙЧАС. */
export function clearNoticeHistory(scope = PANEL_SCOPE): void {
	const next = notices.filter((n) => n.active || (scope !== PANEL_SCOPE && n.scope !== scope));
	if (next.length === notices.length) return;
	notices = next;
	emit();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => notices;

const useAllNotices = (): PanelNotice[] => useSyncExternalStore(subscribe, snapshot, snapshot);

/**
 * Сообщения одной области.
 *
 * Доска ПАНЕЛИ показывает и сообщения карточек: карточку открыли из панели, её операция
 * идёт по тем же базам, и прятать её отказ от общего обзора значило бы делить правду на
 * части. Доска КАРТОЧКИ — только свои: чужие ошибки в чужой форме сбивают с толку.
 */
export const useScopedNotices = (scope: string): PanelNotice[] => {
	const all = useAllNotices();
	return scope === PANEL_SCOPE ? all : all.filter((n) => n.scope === scope);
};

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
