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
 * СОСТОЯНИЕ И СОБЫТИЕ — ДВЕ РАЗНЫЕ ВЕЩИ, и путать их нельзя.
 *
 * СОСТОЯНИЕ сообщает живой источник (`<Notice />` формы, экран): «не заполнен склад», «не
 * применено правок: 6». У него есть `key` — тот, кто его шлёт, — и пока источник говорит,
 * запись одна: сто повторов одной ошибки опроса не превращаются в сто строк, а
 * изменившийся текст правит ту же запись, а не заводит новую. Замолчал источник — записи
 * больше нет: «правок: 6» после того, как их применили, — не история, а враньё.
 *
 * СОБЫТИЕ случилось: отказ команды, потеря связи, итог операции. Его заводят `addMessage`
 * и `noteNotice`, и оно остаётся, пока его не уберут, — потому что «было и прошло» это
 * тоже ответ на вопрос «что вообще происходило».
 *
 * ПОЧЕМУ МОДУЛЬ, А НЕ КОНТЕКСТ — по той же причине, что и у реестра операций
 * (progress.ts): сообщения переживают размонтирование экрана, который их послал.
 */
import { createContext, useContext, useEffect, useId, useRef, useSyncExternalStore } from "react";
import type { NoticeItem, NoticeType } from "src/components/Notice";
import { showToast, type UIToastType } from "src/components/UIToast";

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
	/**
	 * Запись СООБЩЕНА ЖИВЫМ ИСТОЧНИКОМ (`<Notice />` формы, состояние экрана), а не
	 * случилась как событие. Разница в том, кто решает её судьбу: такую запись снимает сам
	 * источник, когда перестаёт её сообщать, и убирать её руками бессмысленно — на
	 * следующем же рендере она вернётся тем же текстом.
	 */
	fromSource?: boolean;
	/** Сколько раз событие повторилось в окне склейки (см. notify, `key`). Нет — один раз. */
	repeat?: number;
	/** Когда о записи последний раз сказал тост. Нет — тоста не было: объявлять некому, кроме области. */
	toastAt?: number;
	/** Итог какой операции эта запись (M14): по нему из итога переходят к самой операции. */
	opId?: string;
};

/**
 * Сколько записей держим. Прежний журнал уведомлений хранил 200 — столько же и здесь:
 * теперь это один и тот же список, и урезать его вдвое значило бы потерять историю,
 * которая у людей уже накоплена.
 */
const LIMIT = 200;

/**
 * Сколько дней держим события. Журнал отвечает на вопрос «что происходило», и вопрос этот
 * всегда о недавнем: через две недели запись «нет связи» не объясняет ничего, а место и
 * внимание занимает. Количественный предел (LIMIT) от этого не спасал — редкие сообщения
 * жили в нём годами.
 */
const RETENTION_DAYS = 14;

/**
 * Ключ хранения — СВОЙ У КАЖДОГО ПОЛЬЗОВАТЕЛЯ. Раньше ключ был один на браузер, и после входа другим пользователем в
 * той же вкладке или на том же компьютере показывалась чужая история: чьи базы, чьи ошибки, чьи операции. Прежние
 * общие ключи (`tech-messages`, `notification-journal`) не переносим — чья в них история, не узнать, — а удаляем.
 */
const STORE_KEY = "tech-messages";
const LEGACY_KEYS = ["tech-messages", "notification-journal"];
const AUTH_USER_KEY = "auth_user";

/** Чья история сейчас на экране: uuid вошедшего пользователя, без входа — «никто». */
const currentOwner = (): string => {
	try {
		const raw = localStorage.getItem(AUTH_USER_KEY);
		const uuid = raw ? (JSON.parse(raw) as { uuid?: unknown }).uuid : null;
		return typeof uuid === "string" && uuid ? uuid : "anon";
	} catch { return "anon"; }
};
let owner = currentOwner();

/**
 * СТРАНИЦА ВЫГРУЖАЕТСЯ. Перезагрузка обрывает запросы, и операции закрывались «Не выполнено: Нет связи с сервером»,
 * а итог оседал в истории и показывался после загрузки рядом с той же работой, восстановленной как выполняющаяся.
 * `pagehide` — выгрузка действительно идёт (в отличие от `beforeunload`, который можно отменить); `pageshow` —
 * страница вернулась (кэш истории браузера), пишем снова.
 */
let pageUnloading = false;
let unloadReset: ReturnType<typeof setTimeout> | null = null;
if (typeof window !== "undefined") {
	/*
	 * С НАЧАЛА ПЕРЕХОДА, А НЕ С ВЫГРУЗКИ. Одних `pagehide` мало: браузер может оборвать запросы уже в начале перехода
	 * (так делает Firefox), и отказ «Нет связи с сервером» обрабатывался раньше выгрузки — запись оседала в истории
	 * (живой случай 17.09, «Проверить пользователей»). `beforeunload` — начало перехода; если переход отменили (человек
	 * остался на странице), через 5 с запись снова включается.
	 */
	window.addEventListener("beforeunload", () => {
		pageUnloading = true;
		if (unloadReset) clearTimeout(unloadReset);
		unloadReset = setTimeout(() => { pageUnloading = false; unloadReset = null; }, 5000);
	});
	window.addEventListener("pagehide", () => {
		pageUnloading = true;
		if (unloadReset) { clearTimeout(unloadReset); unloadReset = null; }
	});
	window.addEventListener("pageshow", () => { pageUnloading = false; });
}
const ownerKey = (o: string): string => `${STORE_KEY}:${o}`;

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
 * ОБЪЕКТ ОБЛАСТИ — то, о чём сообщения этой формы: документ, справочник, база 1С, агент.
 *
 * Сообщение называло объект только подписью («Реализация № 3», «almaz67»), и открыть его из
 * списка было нельзя: ссылку передавало одно место из сорока. Проставлять её в каждом вызове —
 * значит однажды забыть. Поэтому объект знает ОБЛАСТЬ: форма записи — по своему рецепту
 * восстановления (UI/PaneItem), карточки без записи (база, пользователь базы, агент) —
 * сами (`useScopeObject`). Любое сообщение области без своей ссылки получает эту.
 */
const scopeObjects = new Map<string, NonNullable<TechMessage["ref"]>>();

/**
 * Назначить (или снять — `null`) объект области. Сообщения, пришедшие РАНЬШЕ назначения
 * (дочерние формы сообщают о себе до того, как пейн успел назвать объект), получают ссылку
 * задним числом; у записей того же объекта обновляется подпись («→ загрузка…» → «№ 3»).
 */
export function setScopeObject(scope: string, ref: TechMessage["ref"] | null): void {
	if (!ref) { scopeObjects.delete(scope); return; }
	scopeObjects.set(scope, ref);
	let changed = false;
	notices = notices.map((n) => {
		if (n.scope !== scope) return n;
		const same = !!n.ref && n.ref.endpoint === ref.endpoint && n.ref.uuid === ref.uuid;
		if (n.ref && (!same || n.ref.label === ref.label)) return n;
		changed = true;
		return { ...n, ref };
	});
	if (changed) emit();
}

/** Сообщить объект формы — для карточек, у которых нет рецепта записи (1С: база, пользователь, агент). */
export function useScopeObject(ref: TechMessage["ref"] | undefined): void {
	const scope = useNoticeScope();
	const endpoint = ref?.endpoint;
	const uuid = ref?.uuid;
	const label = ref?.label;
	useEffect(() => {
		if (!endpoint || !uuid || scope === APP_SCOPE) return;
		setScopeObject(scope, { endpoint, uuid, ...(label ? { label } : {}) });
		return () => setScopeObject(scope, null);
	}, [scope, endpoint, uuid, label]);
}

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
		/*
		 * ПОСЛЕ ПЕРЕЗАГРУЗКИ АКТУАЛЬНЫХ ЗАПИСЕЙ НЕ БЫВАЕТ.
		 *
		 * «Актуально» означает «источник говорит это ПРЯМО СЕЙЧАС», а после перезагрузки не
		 * говорит никто: экранов ещё нет. Раньше записи возвращались из хранилища со своим
		 * прежним признаком и оставались «актуальными» навсегда — их не снимал источник
		 * (его больше нет) и не убирала «Очистить историю» (она щадит актуальные). Список
		 * копил вечные строки, и кнопка очистки выглядела сломанной.
		 *
		 * Поэтому: сказанное живым источником при загрузке отбрасываем — если это всё ещё
		 * так, экран сообщит это снова через мгновение; остальное (события, итоги операций)
		 * остаётся, но уже историей.
		 */
		/*
		 * СРОК ЖИЗНИ СОБЫТИЙ. Ограничение было одно — количество (LIMIT), и годовалая запись
		 * «нет связи» лежала в журнале наравне со вчерашней, отвечая на вопрос, которого
		 * никто уже не задаёт. Записи старше RETENTION_DAYS при загрузке не поднимаем.
		 */
		const oldest = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
		// Общие ключи прежних версий — чужая или ничья история: удаляем, не показывая.
		for (const k of LEGACY_KEYS) localStorage.removeItem(k);
		if (owner === "anon") return [];
		const own = parse(localStorage.getItem(ownerKey(owner)))
			.filter((n) => !n.fromSource)
			.filter((n) => (n.lastAt ?? n.firstAt ?? 0) >= oldest)
			.map((n) => (n.active ? { ...n, active: false } : n));
		return uniqueIds(own);
	} catch {
		return [];
	}
}

/**
 * ИДЕНТИФИКАТОР ЗАПИСИ — УНИКАЛЕН И МЕЖДУ ПЕРЕЗАГРУЗКАМИ (17.09).
 *
 * История живёт в localStorage вместе с идентификаторами, а счётчик — в памяти: после перезагрузки он снова
 * начинался с нуля, и первое же новое сообщение получало `m1`, который уже лежал в поднятой истории. React
 * предупреждал о повторяющемся ключе, а `dismissMessage("m1")` убирал обе записи. Отметка времени в
 * идентификаторе разводит сеансы, счётчик — записи внутри одной миллисекунды.
 */
let seq = 0;
const newId = (prefix: "m" | "n"): string => `${prefix}${Date.now().toString(36)}-${(++seq).toString(36)}`;

/** Повторы идентификаторов в истории прежних версий — развести, сохранив первую запись с этим id как есть. */
function uniqueIds(list: TechMessage[]): TechMessage[] {
	const seen = new Set<string>();
	return list.map((n, i) => {
		if (!seen.has(n.id)) { seen.add(n.id); return n; }
		const id = `${n.id}~${i}`;
		seen.add(id);
		return { ...n, id };
	});
}

let notices: TechMessage[] = load();

/**
 * УБРАННОЕ ЧЕЛОВЕКОМ СОСТОЯНИЕ: ключ источника → подписи строк, которые он просил не показывать.
 *
 * ЖИВОЙ СЛУЧАЙ (13.09, третий раз). «Очистить историю» оставляла сообщения открытых форм —
 * «Документ заполнен корректно», «Не применено правок: 1», — и крестика у них не было. Довод
 * был «уберёшь — форма скажет снова через секунду». Но человек, нажавший «Очистить», сказал
 * ясно: это я видел. Кнопка, которая гаснет при непустом списке, со стороны сломана, как её ни
 * объясняй.
 *
 * Поэтому убранная строка ЗАПОМИНАЕТСЯ дословно и не показывается, пока источник говорит то же
 * самое. Изменился текст («правок: 1» → «правок: 2») или появилась новая строка — это уже
 * новое состояние, и оно видно. Источник замолчал о строке — память о ней стирается: когда
 * «не заполнен склад» вернётся завтра, его покажут. Закрыли форму — забыта вся её память.
 * На диск память не пишется: после перезагрузки сообщений форм нет вовсе (см. load).
 */
const hidden = new Map<string, Set<string>>();
const signature = (i: { type: NoticeType; text: string }): string => `${i.type}\u0000${i.text}`;
const hide = (m: TechMessage): void => {
	const set = hidden.get(m.key) ?? new Set<string>();
	set.add(signature(m));
	hidden.set(m.key, set);
};
const listeners = new Set<() => void>();

/**
 * Сохраняем только то, что имеет смысл после перезагрузки: без функций-обработчиков и без
 * сообщений форм. Сообщение формы — текущее состояние, после перезагрузки его всё равно не
 * поднимают (см. load), а текст из полей формы («не заполнен ИИН …») незачем оставлять в
 * хранилище браузера. Журнал — не аудит (M18): он про события, а не про данные.
 */
function persist(): void {
	// Без входа не пишем: история «никого» оказалась бы видна следующему вошедшему.
	if (owner === "anon") return;
	// Страница выгружается: браузер обрывает идущие запросы, и их «Нет связи с сервером» — не итог работы (она идёт
	// на сервере дальше и поднимется после загрузки). В историю такое не пишем.
	if (pageUnloading) return;
	try {
		localStorage.setItem(ownerKey(owner), JSON.stringify(
			notices.filter((n) => !n.fromSource).map(({ actions: _actions, ...rest }) => rest),
		));
	} catch { /* приватный режим или переполнение — не повод ломать экран */ }
}

const emit = () => { persist(); for (const l of listeners) l(); };

/**
 * СМЕНИЛСЯ ПОЛЬЗОВАТЕЛЬ — СМЕНИЛАСЬ ИСТОРИЯ. Вызывает оболочка приложения при входе и выходе: в памяти вкладки не
 * должно остаться ни строки прежнего пользователя. Возвращает, сменился ли владелец.
 */
export function setTechMessagesOwner(uuid: string | null | undefined): boolean {
	const next = uuid || "anon";
	if (next === owner) return false;
	owner = next;
	notices = load();
	hidden.clear();
	for (const l of listeners) l();
	return true;
}

/**
 * Сообщить состояние источника. Пустой список — источник замолчал.
 *
 * СООБЩЕНИЕ ФОРМЫ — ЭТО СОСТОЯНИЕ, А НЕ СОБЫТИЕ, и отсюда всё остальное.
 *
 * «Не применено правок: 6» — не факт, случившийся в 14:02, а ответ формы на вопрос «что
 * сейчас». Пока форму правят, этот ответ меняется на каждое нажатие: 6, 7, 6, 5… Раньше
 * каждый такой ответ считался новым сообщением, а прежний уходил в историю — и человек,
 * сняв десяток отметок, получал десять записей об одном и том же, причём девять из них
 * заведомо неверных. Живой случай 12.09: лента из одиннадцати «Не применено правок: N».
 *
 * Поэтому сличаем построчно и ОБНОВЛЯЕМ НА МЕСТЕ:
 *   1) сказанное дословно так же — та же запись (и её `firstAt`: «висит с утра» — про утро);
 *   2) сказанное иначе, но на том же месте и того же рода, — та же запись с новым текстом;
 *   3) появившееся — новая запись;
 *   4) переставшее звучать — УДАЛЯЕТСЯ, а не остаётся историей.
 *
 * Четвёртое — то же правило, только с другого конца: состояние, которого больше нет, не
 * оставляет следа, потому что следом было бы враньё («не заполнен склад» после того, как
 * его заполнили). История — про события: отказ команды, потерю связи, итог операции; их
 * заводят `addMessage` и `noteNotice`, и они остаются, пока их не уберут. Это согласуется
 * и с загрузкой: сказанное живым источником никогда не поднимается из хранилища (см. load).
 */
export function reportNotices(scope: string, rawKey: string, source: string, reported: NoticeItem[]): void {
	const now = Date.now();
	// Ключ уникален В ПРЕДЕЛАХ ОБЛАСТИ: две открытые карточки баз шлют «base-ext» обе, и
	// без области вторая затирала бы сообщение первой.
	const key = `${scope}::${rawKey}`;
	// Убранное человеком не показываем, пока источник говорит то же самое (см. hidden); о чём
	// источник замолчал, то забываем — вернётся, значит, случилось снова.
	let items = reported;
	const off = hidden.get(key);
	if (off) {
		const present = new Set(reported.map(signature));
		for (const sig of off) if (!present.has(sig)) off.delete(sig);
		if (!off.size) hidden.delete(key);
		else items = reported.filter((i) => !off.has(signature(i)));
	}
	const mine = notices.filter((n) => n.key === key && n.active);

	if (!items.length) {
		if (!mine.length) return;
		const said = new Set(mine.map((n) => n.text));
		notices = retireEchoes(notices.filter((n) => !(n.key === key && n.active)), scope, said);
		emit();
		return;
	}

	/*
	 * КАКАЯ ПРЕЖНЯЯ ЗАПИСЬ СООТВЕТСТВУЕТ КАКОЙ НОВОЙ СТРОКЕ. Три захода, от точного к
	 * приблизительному: дословное совпадение; то же место в списке при том же роде
	 * сообщения (форма шлёт сводку в постоянном порядке, и «правок: 6» → «правок: 7»
	 * приходит туда же, где было); наконец, любая свободная запись того же рода.
	 * Род (`type`) не перескакиваем никогда: подсказка не превращается в ошибку, и
	 * наследовать её время появления она не должна.
	 */
	const used = new Set<string>();
	const take = (m: TechMessage | undefined): TechMessage | undefined => {
		if (!m || used.has(m.id)) return undefined;
		used.add(m.id);
		return m;
	};
	const matched = new Map<number, TechMessage>();
	items.forEach((it, i) => {
		const hit = take(mine.find((n) => !used.has(n.id) && n.type === it.type && n.text === it.text));
		if (hit) matched.set(i, hit);
	});
	items.forEach((it, i) => {
		if (matched.has(i)) return;
		const sameSpot = mine[i];
		const hit = take(sameSpot && sameSpot.type === it.type ? sameSpot : undefined)
			?? take(mine.find((n) => !used.has(n.id) && n.type === it.type));
		if (hit) matched.set(i, hit);
	});

	// Что стало с прежними записями и что добавилось.
	const updates = new Map<string, TechMessage>();
	const fresh: TechMessage[] = [];
	items.forEach((it, i) => {
		const prev = matched.get(i);
		if (!prev) {
			fresh.push({
				id: newId("n"), scope, key, type: it.type, text: it.text, source,
				firstAt: now, lastAt: now, active: true,
				...(scopeObjects.has(scope) ? { ref: scopeObjects.get(scope) } : {}),
				// За этой записью стоит ЖИВОЙ ИСТОЧНИК: экран сообщает её заново, пока она
				// верна. Её нельзя ни убрать историей, ни удалить насовсем — источник скажет
				// то же самое снова, и «очистить» превращалось бы в мигание списка.
				fromSource: true,
			});
			return;
		}
		if (prev.text === it.text) {
			// То же самое: только отмечаем, что оно всё ещё так, и не чаще раза в пять
			// секунд — иначе опрос раз в три секунды перерисовывал бы доску вечно.
			if (now - prev.lastAt >= 5000) updates.set(prev.id, { ...prev, lastAt: now });
			return;
		}
		updates.set(prev.id, { ...prev, text: it.text, source, lastAt: now });
	});

	const gone = new Set(mine.filter((n) => !used.has(n.id)).map((n) => n.id));
	if (!fresh.length && !updates.size && !gone.size) return;

	// Что форма перестала говорить (ушло или сменило текст), — то и у её событий уже неправда.
	const unsaid = new Set([
		...mine.filter((n) => gone.has(n.id)).map((n) => n.text),
		...[...updates.values()].map((u) => mine.find((n) => n.id === u.id)?.text).filter((t): t is string => !!t && ![...updates.values()].some((x) => x.text === t)),
	]);
	notices = retireEchoes([
		...fresh,
		...notices.filter((n) => !gone.has(n.id)).map((n) => updates.get(n.id) ?? n),
	].slice(0, LIMIT), scope, unsaid);
	emit();
}

/**
 * СОБЫТИЕ, ПОВТОРЯВШЕЕ СОСТОЯНИЕ ФОРМЫ, ПЕРЕСТАЁТ БЫТЬ АКТУАЛЬНЫМ ВМЕСТЕ С НИМ.
 *
 * Отказ записи приходит двумя путями: форма показывает его своим сообщением, а хранилище формы
 * пишет уведомление панели — активное, «ждёт человека». Форма перестала это говорить (ошибку
 * исправили, форму закрыли) — уведомление оставалось актуальным навсегда (живой случай 14.09:
 * «Недостаточно остатка…» дважды у закрытой реализации). Теперь оно уходит в историю.
 */
function retireEchoes(list: TechMessage[], scope: string, texts: Set<string>): TechMessage[] {
	if (!texts.size) return list;
	return list.map((n) => (!n.fromSource && n.active && n.scope === scope && texts.has(n.text)
		? { ...n, active: false, resolved: true }
		: n));
}

/**
 * ОБЛАСТЬ ЗАКРЫТА (пейн закрыли): её события больше ни о чём не просят — уходят в историю.
 * Не удаляются: «что было с этим документом» — законный вопрос, и ответ на него в истории.
 */
export function retireScope(scope: string): void {
	let changed = false;
	notices = notices.map((n) => {
		if (n.scope !== scope || n.fromSource || !n.active) return n;
		changed = true;
		return { ...n, active: false, resolved: true };
	});
	if (changed) emit();
}

/** У тоста палитра уже: «attention» (не заполнено обязательное) показывается предупреждением. */
const TOAST_TYPE: Record<NoticeType, UIToastType> = {
	error: "error", attention: "warning", warning: "warning", success: "success", info: "info",
};

export type NotifyOptions = {
	severity: NoticeType;
	/** Полный текст — он и остаётся в журнале. */
	text: string;
	/** Где это возникло — словами человека («Реализация № 12», «Базы 1С»). */
	source: string;
	/** Область (пейн); по умолчанию всё приложение. */
	scope?: string;
	ref?: TechMessage["ref"];
	actions?: TechMessage["actions"];
	/**
	 * Событие ЖДЁТ человека: кнопка «Повторить», «нет связи», пока связь не вернулась. Такое
	 * считается актуальным (счётчик на полосе области) до явного снятия. Обычный факт —
	 * «импорт выполнен» — сразу история.
	 */
	active?: boolean;
	/**
	 * Текст тоста. По умолчанию — тот же `text`; строка — короткий вариант, когда подробности
	 * за четыре секунды не прочитать; `false` — без тоста (итог фоновой работы, на который
	 * человек не смотрит в эту секунду).
	 */
	toast?: string | false;
	/** Заголовок тоста — обычно заголовок панели. */
	toastTitle?: string;
	/** Сколько держать тост, мс; по умолчанию решает UIToast. */
	toastDuration?: number;
	/** Только тост, без следа в журнале: простое «сохранено». Склейки (`key`) у него нет — нечего склеивать. */
	ephemeral?: boolean;
	/**
	 * Ключ склейки повторов в пределах области: «нет связи» при опросе раз в три секунды —
	 * одна запись «×N», а не журнал, забитый одинаковыми строками. Без ключа каждое событие
	 * отдельное.
	 */
	key?: string;
	/** Запись — итог этой операции реестра. */
	opId?: string;
};

/**
 * Окно склейки: повтор внутри него правит прежнюю запись и не показывает тост снова.
 * Минута — дольше любого опроса в приложении и короче, чем «это уже другой случай».
 */
const REPEAT_WINDOW_MS = 60_000;

/** Ключ события отделён от ключей живых источников (`scope::raw` в reportNotices). */
const eventKey = (scope: string, key: string): string => `evt::${scope}::${key}`;

/**
 * ЕДИНСТВЕННЫЙ ВХОД ДЛЯ СОБЫТИЙ (M10, docs/TASKS_MESSAGING_2026-09-13.md).
 *
 * Тост и журнал — не два канала, а два ПОКАЗА одного события: тост отвечает «что сейчас
 * произошло», журнал — «что происходило». Пока показ выбирал автор, звавший `showToast`
 * или `noteNotice` по отдельности, одно и то же событие то терялось через четыре секунды,
 * то появлялось тостом дважды (форма и уведомление панели звали тост каждый сам).
 * Теперь автор говорит, ЧТО случилось и нужен ли след, а показы выбирает эта функция.
 *
 * Состояние формы (`<Notice />`, `useReportNotice`) сюда не идёт: у него другой жизненный
 * цикл — его снимает источник, а не человек.
 *
 * Возвращает идентификатор записи; у `ephemeral` записи нет — пустая строка.
 */
export function notify(o: NotifyOptions): string {
	const now = Date.now();
	const scope = o.scope ?? APP_SCOPE;
	const key = o.key && !o.ephemeral ? eventKey(scope, o.key) : undefined;
	/*
	 * ПОВТОР — ТА ЖЕ ЗАПИСЬ (M16). Сличаем по ключу и по свежести: повтор через час — уже
	 * другой случай, и сливать его с утренним значило бы врать о ходе событий.
	 */
	const prev = key ? notices.find((n) => n.key === key && now - n.lastAt < REPEAT_WINDOW_MS) : undefined;

	const toast = o.toast === undefined ? o.text : o.toast;
	// Тост о повторе молчит, пока не прошло окно: десять одинаковых тостов не скажут больше одного.
	const toastDue = !!toast && !(prev?.toastAt && now - prev.toastAt < REPEAT_WINDOW_MS);
	if (toastDue && toast) showToast(toast, TOAST_TYPE[o.severity], o.toastDuration, o.toastTitle);
	if (o.ephemeral) return "";

	if (prev) {
		const next: TechMessage = {
			...prev,
			type: o.severity, text: o.text, source: o.source, lastAt: now,
			repeat: (prev.repeat ?? 1) + 1,
			active: prev.active || o.active === true,
			ref: o.ref ?? prev.ref,
			actions: o.actions ?? prev.actions,
			// Повторилось — значит, повод не исчерпан: действия снова в силе.
			resolved: undefined,
			...(toastDue ? { toastAt: now } : {}),
		};
		notices = notices.map((n) => (n.id === prev.id ? next : n));
		emit();
		return prev.id;
	}

	const id = newId("m");
	notices = [{
		id, scope, key: key ?? id, type: o.severity, text: o.text, source: o.source,
		// Своей ссылки нет — объект области (форма, в которой это случилось).
		firstAt: now, lastAt: now, active: o.active === true, ref: o.ref ?? scopeObjects.get(scope), actions: o.actions,
		...(toastDue ? { toastAt: now } : {}),
		...(o.opId ? { opId: o.opId } : {}),
	}, ...notices].slice(0, LIMIT);
	emit();
	return id;
}

/**
 * Разовое сообщение без тоста: итог операции, отказ команды, результат проверки.
 * Активным не становится — это уже случившийся факт, ему место сразу в истории.
 */
export function noteNotice(source: string, item: NoticeItem, scope = APP_SCOPE): void {
	notify({ severity: item.type, text: item.text, source, scope, toast: false });
}

/**
 * ИМПЕРАТИВНОЕ уведомление без тоста — то, что раньше заводила подсистема уведомлений
 * панелей: «сохранено локально», «нет связи с сервером», отказ бэкенда с кнопкой «Повторить».
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
	return notify({
		severity: m.type, text: m.text, source: m.source, scope: m.scope,
		ref: m.ref, actions: m.actions, active: true, toast: false,
	});
}

/**
 * Убрать запись совсем (крестик на сообщении). Запись открытой формы уходит до тех пор, пока
 * форма сообщает её дословно так же (см. hidden).
 */
export function dismissMessage(id: string): void {
	const gone = notices.find((n) => n.id === id);
	if (!gone) return;
	if (gone.fromSource && gone.active) hide(gone);
	const next = notices.filter((n) => n.id !== id);
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

/** Убрать события области по ключу склейки — без разбора текста (см. notify, `key`). */
export function dismissByKey(scope: string, key: string): void {
	const k = eventKey(scope, key);
	dismissMessagesWhere(scope, (m) => m.key === k);
}

/**
 * Повод исчерпан: форму сохранили, и действия в её сообщениях уже ничего не сделают.
 * Сами сообщения остаются — в ИСТОРИИ: отказ записи после удачной записи уже не актуален.
 */
export function resolveMessages(scope: string): void {
	let changed = false;
	notices = notices.map((n) => {
		if (n.scope !== scope || n.fromSource || !n.active) return n;
		changed = true;
		return { ...n, resolved: true, active: false };
	});
	if (changed) emit();
}

/** Убрать все записи области (закрыли форму и её сообщения больше ни о чём). */
export function clearScope(scope: string): void {
	// Форма закрыта — её просьбы «не показывать» больше не о чем помнить.
	for (const k of [...hidden.keys()]) if (k.startsWith(`${scope}::`)) hidden.delete(k);
	const next = notices.filter((n) => n.scope !== scope);
	if (next.length === notices.length) return;
	notices = next;
	emit();
}

/**
 * Очистить список: убрать ВСЁ, что человек видит в этой области.
 *
 * СООБЩЕНИЯ ОТКРЫТЫХ ФОРМ ТОЖЕ УХОДЯТ — до изменения. Раньше они оставались («источник скажет
 * то же самое снова»), и кнопка гасла при непустом списке: со стороны — сломана. Теперь
 * убранная строка формы запоминается дословно и не возвращается, пока форма говорит то же
 * самое; новое или изменившееся состояние показывается сразу (см. hidden).
 *
 * ЧТО УХОДИТ ТЕПЕРЬ, А РАНЬШЕ ОСТАВАЛОСЬ НАВСЕГДА. События (`addMessage`: «нет связи»,
 * «сохранено локально», отказ команды) заводятся активными и ждут, что их уберут руками, —
 * а убирать их было некому: очистка щадила всё активное. Они копились, и кнопка выглядела
 * сломанной: «нажал — часть сообщений осталась». Событие — это случившийся факт, и место
 * ему в истории, которую эта кнопка и убирает.
 */
export function clearNoticeHistory(scope = APP_SCOPE): void {
	const next = notices.filter((n) => {
		// Чужую область не трогаем: чистят то, что видят.
		if (scope !== APP_SCOPE && n.scope !== scope) return true;
		if (n.active && n.fromSource) hide(n);
		return false;
	});
	if (next.length === notices.length) return;
	notices = next;
	emit();
}

/** Есть ли что чистить: любая запись — очистка убирает всё видимое. */
export const isClearable = (list: TechMessage[]): boolean => list.length > 0;

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

/**
 * ЧТО ПОКАЗЫВАЕТ ОБЛАСТЬ. Место у правой колонки (и у нижней полосы) одно, а рабочих
 * «спутников» основного экрана несколько: журнал сообщений, переписка, помощник, задачи,
 * заметки. Держать их отдельными окнами значило бы делить и без того небольшой экран, а
 * заводить по колонке на каждый — тем более.
 *
 * Поэтому область одна, а содержимое переключается. Выбор — настройка рабочего места и
 * переживает перезагрузку: человек возвращается туда, где работал.
 *
 * Сообщения остаются значением по умолчанию: они появляются сами, без спроса, и потерять
 * их за чужой вкладкой нельзя.
 */
export type TechDockView = "messages" | "communications" | "chat" | "assistant" | "tasks" | "notes";

export const TECH_DOCK_VIEWS: TechDockView[] = ["messages", "communications", "chat", "assistant", "tasks", "notes"];

/** Подпись вида — ключ перевода. Одна на шапку, свёрнутую полосу и подсказки. */
export const TECH_DOCK_TITLES: Record<TechDockView, string> = {
	messages: "techMessages",
	communications: "communicationsSection",
	chat: "techDockChat",
	assistant: "AiAssistant",
	tasks: "TodosList",
	notes: "notes",
};

const VIEW_KEY = "tech_dock_view";
let dockView: TechDockView = (() => {
	try {
		const v = localStorage.getItem(VIEW_KEY) as TechDockView | null;
		return v && TECH_DOCK_VIEWS.includes(v) ? v : "messages";
	} catch { return "messages"; }
})();
const viewListeners = new Set<() => void>();

export function setTechDockView(v: TechDockView): void {
	if (dockView === v) return;
	dockView = v;
	try { localStorage.setItem(VIEW_KEY, v); } catch { /* не беда */ }
	for (const l of viewListeners) l();
}

export const useTechDockView = (): TechDockView => useSyncExternalStore(
	(l) => { viewListeners.add(l); return () => { viewListeners.delete(l); }; },
	() => dockView,
	() => "messages" as TechDockView,
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
