/**
 * «Технические сообщения» — ЕДИНЫЙ механизм сообщений приложения.
 *
 * ЧТО СЮДА СВЕДЕНО. Раньше об одном и том же рассказывали четыре независимые поверхности:
 * колокольчик уведомлений панелей в шапке со своим всплывающим списком, второй колокольчик
 * со своим журналом в localStorage, отдельный пейн «Центр уведомлений» и `<Notice />`
 * внутри каждой формы. Четыре места, которые обязаны совпадать, — это четыре места,
 * которые расходятся: уведомление пропадало из одного и оставалось в другом, а человек
 * искал, где смотреть. Теперь запись одна, и её показывают одни и те же данные — в правой
 * области и в её полноэкранном виде.
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
	/**
	 * Объект, о котором речь: по нему запись группируется и по нему же открывается форма.
	 * «Назначение объекта» — это и есть `endpoint`: реализации к реализациям, базы к базам.
	 */
	ref?: { endpoint: string; uuid: string; label?: string };
	/**
	 * Кнопки прямо в сообщении («Повторить», «Открыть»). Не переживают перезагрузку —
	 * обработчик не сериализуется, — поэтому в журнал сохраняется всё, кроме них.
	 */
	actions?: { label: string; onClick: () => void | Promise<void> }[];
	/** Повод исчерпан (форму сохранили): запись видна, но действия уже ничего не сделают. */
	resolved?: boolean;
};

/**
 * Сколько записей держим. Прежний журнал уведомлений хранил 200 — столько же и здесь:
 * теперь это один и тот же список, и урезать его вдвое значило бы потерять историю,
 * которая у людей уже накоплена.
 */
const LIMIT = 200;

/** Ключ хранения. Прежний журнал уведомлений лежал под `notification-journal`. */
const STORE_KEY = "tech-messages";
const LEGACY_KEY = "notification-journal";

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

/**
 * ХРАНЕНИЕ. Записи переживают перезагрузку — так вёл себя прежний журнал уведомлений, и
 * терять это при слиянии нельзя: «что было, пока меня не было» — половина смысла журнала.
 * Действия (`actions`) не сериализуются: обработчик — функция. Поэтому из хранилища
 * запись возвращается без кнопок, но с текстом и ссылкой на объект.
 */
function load(): TechMessage[] {
	const parse = (raw: string | null): TechMessage[] => {
		if (!raw) return [];
		try {
			const v: unknown = JSON.parse(raw);
			return Array.isArray(v) ? (v as TechMessage[]) : [];
		} catch { return []; }
	};
	try {
		const own = parse(localStorage.getItem(STORE_KEY));
		if (own.length) return own;
		// Переезд со старого журнала — один раз: записи те же, форма другая.
		const legacy = parse(localStorage.getItem(LEGACY_KEY)) as unknown as {
			id: number; type: NoticeType; text: string; timestamp: number;
			paneLabel?: string; ref?: { endpoint: string; uuid: string; label?: string };
		}[];
		if (!legacy.length) return [];
		const moved: TechMessage[] = legacy.map((e, i) => ({
			id: `legacy${i}`, scope: APP_SCOPE, key: `legacy${i}`,
			type: e.type, text: e.text, source: e.paneLabel ?? "",
			firstAt: e.timestamp, lastAt: e.timestamp, active: false, ref: e.ref,
		})).reverse();
		localStorage.removeItem(LEGACY_KEY);
		return moved.slice(0, LIMIT);
	} catch {
		return [];
	}
}

let notices: TechMessage[] = load();
let seq = 0;
const listeners = new Set<() => void>();

/** Сохраняем только то, что имеет смысл после перезагрузки: без функций-обработчиков. */
function persist(): void {
	try {
		localStorage.setItem(STORE_KEY, JSON.stringify(
			notices.map(({ actions: _actions, ...rest }) => rest),
		));
	} catch { /* приватный режим или переполнение — не повод ломать экран */ }
}

const emit = () => { persist(); for (const l of listeners) l(); };

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

/**
 * ИМПЕРАТИВНОЕ уведомление — то, что раньше заводила подсистема уведомлений панелей:
 * «сохранено локально», «нет связи с сервером», отказ бэкенда с кнопкой «Повторить».
 *
 * Отличие от `<Notice />` одно: у того есть источник, который может ЗАМОЛЧАТЬ (ошибка
 * ушла — запись перешла в историю), а это — событие: оно случилось и остаётся, пока его
 * не уберут. Поэтому запись активна и снимается явно (`dismissMessage`).
 */
export function addMessage(m: {
	scope: string;
	type: NoticeType;
	text: string;
	source: string;
	ref?: TechMessage["ref"];
	actions?: TechMessage["actions"];
}): string {
	const now = Date.now();
	const id = `m${++seq}`;
	notices = [{
		id, scope: m.scope, key: id, type: m.type, text: m.text, source: m.source,
		firstAt: now, lastAt: now, active: true, ref: m.ref, actions: m.actions,
	}, ...notices].slice(0, LIMIT);
	emit();
	return id;
}

/** Убрать запись совсем (крестик на сообщении). */
export function dismissMessage(id: string): void {
	const next = notices.filter((n) => n.id !== id);
	if (next.length === notices.length) return;
	notices = next;
	emit();
}

/** Убрать записи области по признаку — например «сетевые» после удачного обращения. */
export function dismissMessagesWhere(scope: string, match: (m: TechMessage) => boolean): void {
	const next = notices.filter((n) => !(n.scope === scope && match(n)));
	if (next.length === notices.length) return;
	notices = next;
	emit();
}

/**
 * Повод исчерпан: форму сохранили, и действия в её сообщениях уже ничего не сделают.
 * Сами сообщения остаются — человек должен видеть, что было, а не гадать, куда делось.
 */
export function resolveMessages(scope: string): void {
	let changed = false;
	notices = notices.map((n) => {
		if (n.scope !== scope || n.resolved || !n.active) return n;
		changed = true;
		return { ...n, resolved: true };
	});
	if (changed) emit();
}

/** Убрать все записи области (закрыли форму и её сообщения больше ни о чём). */
export function clearScope(scope: string): void {
	const next = notices.filter((n) => n.scope !== scope);
	if (next.length === notices.length) return;
	notices = next;
	emit();
}

/** Убрать историю. Актуальные записи остаются: они описывают то, что не так СЕЙЧАС. */
export function clearNoticeHistory(scope = APP_SCOPE): void {
	const next = notices.filter((n) => n.active || (scope !== APP_SCOPE && n.scope !== scope));
	if (next.length === notices.length) return;
	notices = next;
	emit();
}

/**
 * РАСКРЫТА ЛИ ОБЛАСТЬ — состояние общее, потому что переключателей два: кнопка в самой
 * области и колокольчик в шапке. Держать его в компоненте значило бы, что колокольчик не
 * знает, открыта ли область, и «показать сообщения» иногда её закрывало бы.
 */
const OPEN_KEY = "tech_messages_open";
let open = (() => {
	try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; }
})();
const openListeners = new Set<() => void>();

export function setTechMessagesOpen(v: boolean): void {
	if (open === v) return;
	open = v;
	try { localStorage.setItem(OPEN_KEY, v ? "1" : "0"); } catch { /* не беда */ }
	for (const l of openListeners) l();
}

export const useTechMessagesOpen = (): boolean => useSyncExternalStore(
	(l) => { openListeners.add(l); return () => { openListeners.delete(l); }; },
	() => open,
	() => false,
);

/**
 * ГДЕ СТОИТ ОБЛАСТЬ — справа от пейнов или под ними.
 *
 * ЗАЧЕМ ВЫБОР. Сообщения бывают разной формы. Ошибка проверки базы — это абзац текста, и
 * ему нужна ширина: в узкой колонке справа он превращается в лесенку из двух слов. А вот
 * широкой форме документа отдавать четверть экрана вбок жалко — там дороже ширина самой
 * формы, и область уместнее внизу, полосой. Что дороже в конкретной работе, знает только
 * тот, кто работает, — поэтому это настройка, а не наше решение.
 *
 * Выбор общий для приложения и переживает перезагрузку: место области — привычка рабочего
 * места, а не свойство текущего экрана.
 */
export type TechPlacement = "right" | "bottom";

const PLACE_KEY = "tech_messages_placement";
let placement: TechPlacement = (() => {
	try { return localStorage.getItem(PLACE_KEY) === "bottom" ? "bottom" : "right"; } catch { return "right"; }
})();
const placeListeners = new Set<() => void>();

export function setTechMessagesPlacement(v: TechPlacement): void {
	if (placement === v) return;
	placement = v;
	try { localStorage.setItem(PLACE_KEY, v); } catch { /* не беда */ }
	for (const l of placeListeners) l();
}

export const useTechMessagesPlacement = (): TechPlacement => useSyncExternalStore(
	(l) => { placeListeners.add(l); return () => { placeListeners.delete(l); }; },
	() => placement,
	() => "right" as TechPlacement,
);

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => notices;

const useAllNotices = (): TechMessage[] => useSyncExternalStore(subscribe, snapshot, snapshot);

/**
 * Прочитать записи вне React — для чистых функций (группировка) и для проверок: городить
 * рендер ради разбора списка значило бы проверять заодно и разметку.
 */
export const getMessages = (): TechMessage[] => notices;

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
