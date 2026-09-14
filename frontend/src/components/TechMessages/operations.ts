/**
 * РЕЕСТР ДЛИТЕЛЬНОЙ РАБОТЫ — общий для приложения (M13, docs/TASKS_MESSAGING_2026-09-13.md).
 *
 * ОТКУДА. Реестр вырос в панели 1С: проверка сотни баз и запись прав идут минутами, и
 * спиннер в тулбаре отвечал только «идёт». Но вопрос «что сейчас выполняется и чем
 * кончилось» — не про 1С: импорт выписки, резервная копия и пересчёт себестоимости задают
 * его так же. Пока реестр жил в модели 1С, область сообщений склеивала два списка вручную
 * (поиск, отбор и срез формы к операциям не применялись), а долгая работа вне 1С была
 * невидима вовсе.
 *
 * ЧТО ЗДЕСЬ, А ЧТО В АДАПТЕРЕ. Здесь — то, что верно для любой работы: запись, её ход, итог
 * событием в журнал, подписи и доля. Специфика 1С — задания сервиса и их опрос,
 * перечитывание кэша после команды, блокировка карточки — живёт в адаптере панели 1С и
 * подключается к записи двумя крючками: `onFinish` (что сделать по окончании) и
 * `setOpCanceler` (как отменить). Этот модуль про 1С не знает ничего.
 *
 * ПОЧЕМУ МОДУЛЬ, А НЕ КОНТЕКСТ. Операции переживают размонтирование: закрыли экран — работа
 * идёт, и её ход должен остаться видимым.
 *
 * ЧЕГО ЗДЕСЬ НЕТ — хранения. После перезагрузки «идёт» было бы неправдой; след работы после
 * перезагрузки даёт её итог-событие в журнале.
 */
import { useSyncExternalStore } from "react";
import { translate } from "src/i18";
import { humanErrorText } from "src/utils/errorText";
import { APP_SCOPE, notify, type TechMessage } from "./store";

/** Вид операции: у чтения и у записи разная цена ошибки, и смешивать их в списке нельзя. */
export type OpKind = "read" | "create" | "update" | "delete";
export type OpState = "running" | "done" | "failed";

export type Op = {
	id: string;
	kind: OpKind;
	/** Что делаем — словами человека, а не типом команды. */
	title: string;
	/** По чему: база, пользователь, файл или «базы: 12». */
	target: string;
	total: number;
	done: number;
	failed: number;
	state: OpState;
	startedAt: number;
	finishedAt: number | null;
	/** Задание сервиса, если операция — команда агенту. */
	batchId: string | null;
	/**
	 * Сколько частей операции ещё можно отменить: их никто не начинал. Ноль значит, что
	 * отменять нечего — работа уже идёт, и остановить её отсюда нельзя.
	 */
	cancelable: number;
	/** Короткий итог или причина отказа. */
	note: string;
	/**
	 * Выполнено С ОГОВОРКОЙ (П12): агент записал, но признак не перечитал или платформа не приняла
	 * часть свойств. Итог тогда — предупреждение, а не «Выполнено».
	 */
	warning?: string;
	/**
	 * НАД ЧЕМ идёт работа. Пока операция выполняется, эти объекты правке не подлежат:
	 * значения меняются прямо сейчас, и форма, позволяющая писать поверх, отправила бы
	 * команду по данным, которых уже нет.
	 */
	scope: { user?: string; bases: string[] };
	/**
	 * Пейн, из которого работу запустили: по нему операция попадает в срез «Текущая форма».
	 * Нет — происхождение неизвестно, и операция видна в любом срезе.
	 */
	pane?: string;
	/**
	 * Какая это работа — ключ, по которому экран узнаёт, что она УЖЕ идёт («bank-statement-
	 * import»). Нужен, чтобы вновь открытое окно не дало запустить ту же работу второй раз:
	 * локальный флаг «занято» умирает вместе с окном, а работа — нет.
	 */
	workKey?: string;
	/** Объект работы (одна база, пользователь базы, запись): по нему открывают из строки и из итога. */
	ref?: TechMessage["ref"];
};

export type OpInit = {
	kind: OpKind;
	title: string;
	target: string;
	total: number;
	batchId?: string | null;
	note?: string;
	scope?: { user?: string; bases?: string[] };
	pane?: string;
	workKey?: string;
	/** Объект работы — ссылка в строке «Прогресса» и в итоге. */
	ref?: TechMessage["ref"];
	/** Что сделать, когда работа закончена (адаптер 1С перечитывает кэш). */
	onFinish?: () => void;
	/**
	 * Итог сообщает сам вызывающий — содержательнее, чем реестр («загружено 88 из 100»). Без
	 * этого в журнале стояли бы две записи об одном: его итог и безликое «Выполнено».
	 */
	reportsOwnOutcome?: boolean;
};

/**
 * КАК ОПЕРАЦИЯ ЧИТАЕТСЯ СЛОВАМИ И ЦИФРАМИ — здесь, а не на экране.
 *
 * Смотрят на одни и те же операции из двух мест: вкладка «Прогресс запросов и команд» панели
 * 1С и область сообщений, которая видна откуда угодно. Держать подписи и счёт процентов у
 * каждого из них значило бы завести два ответа на один вопрос — и однажды разойтись в них.
 */
export const opKindLabel = (k: OpKind): string => translate(
	k === "read" ? "onecOpRead" : k === "create" ? "onecOpCreate" : k === "delete" ? "onecOpDelete" : "onecOpUpdate",
);

export const opStateLabel = (o: Op): string => (
	o.state === "running" ? translate("onecOpRunning")
		: o.state === "failed" ? translate("onecOpFailed")
			: translate("onecOpDone")
);

/**
 * Длительность словами: «сколько уже идёт» важнее точной секунды старта.
 *
 * «0 с» не говорит ничего — ни что работа была мгновенной, ни что счёт вообще идёт;
 * выглядело это как несчитанное поле. Про меньшее секунды так и сказано.
 */
export const opDuration = (o: Op, now = Date.now()): string => {
	const ms = (o.finishedAt ?? now) - o.startedAt;
	const s = Math.max(Math.round(ms / 1000), 0);
	if (s < 1) return translate("onecOpUnderSec");
	return s < 60 ? `${s} ${translate("secShort")}` : `${Math.floor(s / 60)} ${translate("minShort")} ${s % 60} ${translate("secShort")}`;
};

/**
 * Сколько частей работы ВЫШЛО. `done` считает обработанные — и удавшиеся, и отказавшие;
 * само по себе это число обманывает: у команды по одной базе, которая не прошла, оно
 * равно единице, и полоса показывала «1 из 1 · 100%» рядом с «Не удалось: 1».
 */
export const opSucceeded = (o: Op): number => Math.max(o.done - o.failed, 0);

/**
 * Доля выполненного, 0–100.
 *
 * ЧЕГО ЗДЕСЬ НЕТ — выдуманного прогресса. Пока неизвестно, из скольких частей состоит
 * работа (`total` = 0), процента не существует: показывать «0 %» у работы, которая идёт,
 * значит врать о ней, и такую операцию показывают неопределённым индикатором (спиннером),
 * а не полосой. Поэтому здесь `null`, а не ноль.
 */
export const opPercent = (o: Op): number | null => {
	// Доля — от УДАВШЕГОСЯ: полоса отвечает на вопрос «сколько получилось», а не «сколько
	// перебрали». Иначе провалившаяся работа выглядела заполненной до конца.
	if (o.total > 0) return Math.min(Math.round((opSucceeded(o) / o.total) * 100), 100);
	return o.state === "running" ? null : (o.failed > 0 ? 0 : 100);
};

let ops: Op[] = [];
const listeners = new Set<() => void>();
let seq = 0;

/**
 * Крючки записи — ВНЕ записи: это функции, а запись — данные, которые показывают, сравнивают
 * и перебирают. Живут до окончания работы (`settleOp`). «Скрыть» их не снимает: работа,
 * которую перестали наблюдать, всё равно идёт, и по её окончании кэш должен обновиться.
 */
const finishHooks = new Map<string, () => void>();
const cancelers = new Map<string, () => Promise<number>>();
const ownOutcome = new Set<string>();

const emit = () => { for (const l of listeners) l(); };

/** Изменить запись. Нет такой (убрали) — ничего не делаем. */
export function updateOp(id: string, patch: (op: Op) => Op): void {
	let hit = false;
	const next = ops.map((o) => (o.id === id ? (hit = true, patch(o)) : o));
	if (!hit) return;
	ops = next;
	emit();
}

/**
 * ИТОГ ОПЕРАЦИИ — СОБЫТИЕМ В ЖУРНАЛ, а не только строкой в «Прогрессе».
 *
 * Пока операция шла, форма сообщала состояние: «идёт операция, дождитесь». Оно исчезает
 * вместе с операцией — и правильно делает. Но тогда от всей работы не остаётся НИЧЕГО.
 * Поэтому окончание пишется событием: что делали, над чем, чем кончилось и сколько заняло.
 */
function noteOutcome(op: Op): void {
	const secs = Math.max(0, Math.round(((op.finishedAt ?? Date.now()) - op.startedAt) / 1000));
	const failed = op.failed > 0;
	const ok = op.done - op.failed;
	const why = humanErrorText(op.note);
	const warned = !(failed && ok === 0) && !!op.warning;

	/*
	 * ЧИТАЕТСЯ КАК ФРАЗА, А НЕ КАК СТРОКА ЖУРНАЛА: ЧТО делали, ЧЕМ кончилось, ПОЧЕМУ (если не
	 * вышло) и СКОЛЬКО заняло. Над чем работали — подписью записи: по этому же объекту она
	 * встаёт в свою группу.
	 */
	const result = failed && ok === 0
		? `${translate("onecOpFinishedFailed")}${why ? `: ${why}` : ""}`
		: op.total > 1
			? [
				`${translate("onecOpFinishedOk")}: ${ok} ${translate("onecOpOutOf")} ${op.total}`,
				failed ? `${translate("onecOpFailedCount")}: ${op.failed}${why ? ` — ${why}` : ""}` : "",
			].filter(Boolean).join(". ")
			: translate("onecOpFinishedOk");

	// Итог знает свою операцию (M14): по `opId` область не показывает его, пока строка операции
	// ещё на экране, — строка уже говорит то же самое (MessagesView).
	notify({
		severity: failed ? "error" : warned ? "warning" : "success",
		text: `${op.title}. ${result}${warned ? `. ${op.warning}` : ""}. ${translate("onecOpElapsed")}: ${secs} ${translate("secShort")}`,
		source: op.target || op.title,
		scope: op.pane,
		ref: op.ref,
		toast: false,
		opId: op.id,
	});
}

/**
 * Работа окончена: итог — событием в журнал, крючки больше не нужны.
 * Адаптер, сам доведший запись до конца (задание сервиса), зовёт это напрямую.
 */
export function settleOp(id: string): void {
	finishHooks.delete(id);
	cancelers.delete(id);
	const own = ownOutcome.delete(id);
	const op = ops.find((o) => o.id === id);
	if (op && !own) noteOutcome(op);
}

/** Начать операцию. Возвращает идентификатор — по нему её потом двигают. */
export function startOp(init: OpInit): string {
	const id = `op_${++seq}_${Date.now()}`;
	ops = [{
		id, kind: init.kind, title: init.title, target: init.target,
		total: Math.max(init.total, 0), done: 0, failed: 0,
		state: "running", startedAt: Date.now(), finishedAt: null,
		batchId: init.batchId ?? null, note: init.note ?? "", cancelable: 0,
		scope: { ...(init.scope?.user ? { user: init.scope.user } : {}), bases: init.scope?.bases ?? [] },
		// «Всё приложение» — это не пейн: такая операция видна в любом срезе.
		...(init.pane && init.pane !== APP_SCOPE ? { pane: init.pane } : {}),
		...(init.workKey ? { workKey: init.workKey } : {}),
		...(init.ref ? { ref: init.ref } : {}),
	}, ...ops];
	if (init.onFinish) finishHooks.set(id, init.onFinish);
	if (init.reportsOwnOutcome) ownOutcome.add(id);
	emit();
	return id;
}

/** Продвинуть счётчик: столько частей уже обработано. */
export function progressOp(id: string, done: number, failed = 0): void {
	updateOp(id, (o) => ({ ...o, done, failed }));
}

/**
 * ОШИБКИ, О КОТОРЫХ УЖЕ СКАЗАЛ ИТОГ ОПЕРАЦИИ.
 *
 * Отказ проходил двумя путями: `finishOp` записывал итог «Не выполнено: причина», а обработчик
 * ошибки на экране звал `reportError` с тем же исключением — вторая запись, а для отказа по
 * существу ещё и третья, состоянием формы. Помечаем САМ ОБЪЕКТ ошибки: текст сравнивать нельзя
 * (`e.message` и разобранный ответ сервиса расходятся), а объект — тот же самый.
 * Маршрутизатор ошибок по этой пометке показывает только тост «сейчас» (services/errors/route.ts).
 */
const settledErrors = new WeakSet<object>();

/** Об этой ошибке уже сказал итог операции — второй записи не нужно. */
export const isSettledError = (e: unknown): boolean =>
	!!e && typeof e === "object" && settledErrors.has(e);

/**
 * Закрыть операцию, считаемую на клиенте. `error` — исключение, из-за которого не вышло: итог
 * операции о нём скажет, и маршрутизатор ошибок не запишет его второй раз.
 */
export function finishOp(id: string, r: { failed?: number; note?: string; error?: unknown } = {}): void {
	// Итог пишет реестр (не вызывающий) — только тогда об ошибке уже сказано.
	if ((r.failed ?? 0) > 0 && r.error && typeof r.error === "object" && !ownOutcome.has(id)
		&& ops.some((o) => o.id === id)) {
		settledErrors.add(r.error);
	}
	updateOp(id, (o) => ({
		...o,
		done: o.total,
		failed: r.failed ?? o.failed,
		note: r.note ?? o.note,
		state: (r.failed ?? o.failed) > 0 ? "failed" : "done",
		finishedAt: Date.now(),
	}));
	// У того, кто запускал, могут быть свои дела по окончании: панель 1С перечитывает кэш.
	finishHooks.get(id)?.();
	settleOp(id);
}

/**
 * Обернуть одиночную работу записью реестра: начать, дождаться, закрыть — и при отказе тоже.
 * Правило: вся работа дольше мгновения видна в «Прогрессе», иначе экран отвечал
 * «отправлено» и замолкал, а узнать, чем кончилось, было неоткуда.
 */
export async function withOp<T>(
	init: Omit<OpInit, "total"> & { total?: number },
	run: () => Promise<T>,
): Promise<T> {
	const id = startOp({ ...init, total: init.total ?? 1 });
	try {
		const r = await run();
		finishOp(id);
		return r;
	} catch (e) {
		finishOp(id, { failed: 1, note: e instanceof Error ? e.message : "", error: e });
		throw e;
	}
}

/** Как отменить работу — знает тот, кто её поставил (адаптер 1С: отмена задания сервиса). */
export function setOpCanceler(id: string, cancel: () => Promise<number>): void {
	cancelers.set(id, cancel);
}

/**
 * ОТМЕНИТЬ операцию — то, что в ней ещё не начато. Возвращает ЧЕСТНОЕ число отменённого:
 * ноль — значит не успели или отменять нечем, и это ответ, а не ошибка.
 */
export async function cancelOp(id: string): Promise<number> {
	const cancel = cancelers.get(id);
	return cancel ? cancel() : 0;
}

/**
 * ПРЕКРАТИТЬ НАБЛЮДЕНИЕ за операцией — не отменяя её. Отмена останавливает работу, а это
 * просто убирает запись с экрана: нужна, когда запись зависла и держит форму запертой.
 */
export function abandonOp(id: string): void {
	const next = ops.filter((o) => o.id !== id);
	if (next.length === ops.length) return;
	ops = next;
	emit();
}

/** Убрать завершённые: список нужен для наблюдения, а журнал — это итоги-события. */
export function clearFinished(): void {
	const next = ops.filter((o) => o.state === "running");
	if (next.length === ops.length) return;
	ops = next;
	emit();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => ops;

/** Подписка на реестр: список меняется целиком, поэтому сравнение по ссылке верно. */
export const useOps = (): Op[] => useSyncExternalStore(subscribe, snapshot, snapshot);

/** Прочитать реестр вне React — для чистых функций и для проверок. */
export const getOps = (): Op[] => ops;

/**
 * Идёт ли уже работа с этим ключом. Кнопке запуска — вместо локального «занято»: окно
 * закрыли и открыли снова, а импорт всё ещё идёт — кнопка это знает.
 */
export const useRunningWork = (workKey: string): boolean =>
	useOps().some((o) => o.state === "running" && o.workKey === workKey);
