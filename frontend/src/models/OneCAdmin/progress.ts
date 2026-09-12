/**
 * Реестр выполняющихся операций «Пользователей баз»: и запросов, и команд.
 *
 * ЗАЧЕМ ОН ЕСТЬ. Кнопка «Проверить пользователей» опрашивает 1С по каждой базе, а запись
 * прав ставит команду в очередь агенту. И то и другое длится дольше, чем человек готов
 * смотреть на крутящийся индикатор: спиннер в тулбаре отвечает только «идёт», но не «сколько
 * осталось» и «что уже не получилось». Реестр даёт вкладке «Прогресс запросов и команд»
 * ответы на оба вопроса, а операция при этом не привязана к экрану, с которого её запустили:
 * карточка пары живёт отдельным пейном и может быть закрыта раньше, чем команда доедет.
 *
 * ПОЧЕМУ МОДУЛЬ, А НЕ КОНТЕКСТ. Операции переживают размонтирование: закрыли карточку —
 * запись прав всё равно идёт, и её прогресс должен остаться видимым. Контекст пришлось бы
 * поднимать выше пейнов, то есть на всё приложение, ради одной вкладки.
 *
 * ЖИЗНЬ ЗАПИСИ. Запрос считает сам вызывающий (done/total по базам). Команда считается по
 * ответу сервиса: `batchId` связывает запись с заданием, и опрос заданий переносит в неё
 * done/failed/pending. Завершённые записи не исчезают сами — их убирает человек кнопкой,
 * иначе итог операции пропал бы ровно в тот момент, когда его собрались прочитать.
 */
import { useEffect, useSyncExternalStore } from "react";
import { queryClient } from "src/app/queryClient";
import { cancelBatch, fetchBatches, type BatchProgress } from "src/services/onec/api";
import { translate } from "src/i18";
import { noteNotice } from "src/components/TechMessages/store";

/** Вид операции: у чтения и у записи разная цена ошибки, и смешивать их в списке нельзя. */
export type OpKind = "read" | "create" | "update" | "delete";
export type OpState = "running" | "done" | "failed";

export type Op = {
	id: string;
	kind: OpKind;
	/** Что делаем — словами человека, а не типом команды. */
	title: string;
	/** По чему: база, пользователь или «базы: 12». */
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
	 * Сколько команд операции ещё можно отменить: их никто не начинал. Ноль значит, что
	 * отменять нечего — работа уже идёт на сервере 1С, и остановить её панель не может.
	 */
	cancelable: number;
	/** Короткий итог или причина отказа. */
	note: string;
	/**
	 * НАД ЧЕМ идёт работа. Пока операция выполняется, эти объекты правке не подлежат:
	 * значения в 1С меняются прямо сейчас, и форма, позволяющая писать поверх, отправила
	 * бы команду по данным, которых уже нет.
	 */
	scope: { user?: string; bases: string[] };
};

/**
 * КАК ОПЕРАЦИЯ ЧИТАЕТСЯ СЛОВАМИ И ЦИФРАМИ — здесь, а не на экране.
 *
 * Смотрят на одни и те же операции из двух мест: вкладка «Прогресс запросов и команд» на
 * экране «Пользователи баз» и область «Технических сообщений», которая видна откуда
 * угодно. Держать подписи и счёт процентов у каждого из них значило бы завести два ответа
 * на один вопрос — и однажды разойтись в них.
 */
export const opKindLabel = (k: OpKind): string => translate(
	k === "read" ? "onecOpRead" : k === "create" ? "onecOpCreate" : k === "delete" ? "onecOpDelete" : "onecOpUpdate",
);

export const opStateLabel = (o: Op): string => (
	o.state === "running" ? translate("onecOpRunning")
		: o.state === "failed" ? translate("onecOpFailed")
			: translate("onecOpDone")
);

/** Длительность словами: «сколько уже идёт» важнее точной секунды старта. */
export const opDuration = (o: Op, now = Date.now()): string => {
	const ms = (o.finishedAt ?? now) - o.startedAt;
	const s = Math.max(Math.round(ms / 1000), 0);
	return s < 60 ? `${s} ${translate("secShort")}` : `${Math.floor(s / 60)} ${translate("minShort")} ${s % 60} ${translate("secShort")}`;
};

/**
 * Доля выполненного, 0–100.
 *
 * ЧЕГО ЗДЕСЬ НЕТ — выдуманного прогресса. Пока неизвестно, из скольких частей состоит
 * работа (`total` = 0), процента не существует: показывать «0 %» у работы, которая идёт,
 * значит врать о ней, и такую операцию показывают неопределённым индикатором (спиннером),
 * а не полосой. Поэтому здесь `null`, а не ноль.
 */
export const opPercent = (o: Op): number | null => {
	if (o.total > 0) return Math.min(Math.round((o.done / o.total) * 100), 100);
	return o.state === "running" ? null : 100;
};

/**
 * Сколько операция может блокировать правку, прежде чем перестанет это делать.
 *
 * ЗАЧЕМ ПРЕДЕЛ. Блокировка держится на записи реестра, а запись живёт в браузере: если
 * задание перестало отвечать (команду не поставили вовсе, сервис перезапустили, вкладка
 * пережила и то и другое), операция остаётся «выполняющейся» НАВСЕГДА — и карточка
 * остаётся заблокированной навсегда. Живой случай 12.09: команда по базе давно выполнена,
 * а форма всё ещё писала «идёт операция, дождитесь окончания».
 *
 * Полчаса — с запасом больше любого чтения или записи в базу (самая долгая измеренная — 34 с
 * на расширения); выгрузка идёт часами, но она и не блокирует карточку пользователя.
 */
const BLOCK_MAX_MS = 30 * 60_000;

/** Затрагивает ли выполняющаяся операция пару «человек + база». */
export const opBlocks = (op: Op, user: string, baseKey: string): boolean => {
	if (op.state !== "running") return false;
	// Слишком давно «выполняется», чтобы этому верить: держать форму запертой из-за записи,
	// которая уже ничем не управляет, — худшее из двух зол.
	if (Date.now() - op.startedAt > BLOCK_MAX_MS) return false;
	const u = op.scope.user;
	if (u && user && u.toLowerCase() !== user.toLowerCase()) return false;
	if (!op.scope.bases.length) return true;
	if (!baseKey) return true;
	return op.scope.bases.some((b) => b.toLowerCase() === baseKey.toLowerCase());
};

/** Тип команды → вид операции: список ведём один, а читается он по-разному. */
export const kindOfBatch = (type: string): OpKind => {
	if (type.includes("CREATE")) return "create";
	if (type.includes("DELETE")) return "delete";
	if (type.includes("LIST")) return "read";
	return "update";
};

/**
 * ЧТО ПЕРЕЧИТАТЬ, КОГДА РАБОТА ЗАКОНЧИЛАСЬ.
 *
 * Команда меняет 1С, а панель этого не видит: у неё в руках кэш ответов. Поэтому после
 * каждой завершившейся операции — и команды агенту, и обычного запроса — перечитываем всё,
 * на что она могла повлиять. Ключи перечислены явно: живое состояние кластера (сеансы,
 * соединения, процессы) сюда НЕ входит — каждый такой запрос стоит команды в 1С, и дёргать
 * их после любой чужой работы незачем.
 */
const REFRESH_KEYS = [
	"bases",              // состояние баз, включая публикацию
	"base-ext",           // расширения в карточке базы
	"ext-summary",        // сводка «в каких базах какое расширение»
	"user-summary",
	"base-users-cached",
	"user-where",
	"agents",             // состояние агента после включения/отключения/переименования
	"servers",
];

/**
 * Перечитать данные во ВСЕХ открытых формах, а не только там, откуда запускали.
 *
 * Так и просили: «после выполнения команд, операций, запросов обновлять данные в открытых
 * формах элементов». Раньше это делал хук, живший на вкладке панели, — и работало только
 * пока вкладка открыта. Карточка базы, открытая отдельным пейном, после публикации
 * показывала прежнее состояние до перезагрузки страницы.
 *
 * ПЕРЕЧИТЫВАЕМ ДВАЖДЫ. Сервис обновляет свой кэш содержимого базы отдельной командой
 * (IB_LIST_USERS ставится следом за изменяющей), и в момент, когда наша команда уже
 * «выполнена», свежие данные ещё едут. Один запоздалый повтор дешевле, чем показать старое
 * значение как новое.
 */
export function refreshAfterWork(): void {
	const once = () => {
		for (const key of REFRESH_KEYS) void queryClient.invalidateQueries({ queryKey: ["onec", key] });
		// Список баз ERP-прокси (ModelList) живёт под своим ключом.
		void queryClient.invalidateQueries({ queryKey: ["onec-bases"] });
	};
	once();
	window.setTimeout(once, 5000);
}

let ops: Op[] = [];
const listeners = new Set<() => void>();
let seq = 0;

const emit = () => { for (const l of listeners) l(); };
const replace = (id: string, patch: (op: Op) => Op) => {
	let hit = false;
	const next = ops.map((o) => (o.id === id ? (hit = true, patch(o)) : o));
	if (!hit) return;
	ops = next;
	emit();
};

/**
 * ИТОГ ОПЕРАЦИИ — СОБЫТИЕМ В ЖУРНАЛ, а не только строкой в «Прогрессе».
 *
 * ЗАЧЕМ. Пока операция шла, форма сообщала состояние: «идёт операция, дождитесь». Оно
 * исчезает вместе с операцией — и правильно делает: состояние, которого больше нет, не
 * оставляет следа. Но тогда от всей работы не остаётся НИЧЕГО: «Прогресс» — отдельный
 * экран с отдельным списком, а человек смотрит в «Технические сообщения» и видит, что
 * сообщение о работе пропало, будто её и не было. Отсюда и ощущение противоречия: строка
 * «Выполнено» в одном месте и молчание в другом.
 *
 * Поэтому окончание операции пишется событием: что делали, над чем, чем кончилось и
 * сколько заняло. Событие остаётся, пока его не уберут, — это и есть ответ на вопрос
 * «что вообще происходило».
 */
function noteOutcome(op: Op): void {
	const secs = Math.max(0, Math.round(((op.finishedAt ?? Date.now()) - op.startedAt) / 1000));
	const head = `${op.title}${op.target ? ` — ${op.target}` : ""}`;
	const failed = op.failed > 0;
	const tail = [
		op.total > 1 ? `${op.done - op.failed} / ${op.total}` : "",
		failed ? `${translate("onecOpFailed")}: ${op.failed}` : "",
		op.note,
		secs ? `${secs} ${translate("secShort")}` : "",
	].filter(Boolean).join(" · ");
	noteNotice(head, {
		type: failed ? "error" : "success",
		text: `${translate(failed ? "onecOpFinishedFailed" : "onecOpFinishedOk")}${tail ? `. ${tail}` : ""}`,
	});
}

/** Начать операцию. Возвращает идентификатор — по нему её потом двигают. */
export function startOp(init: {
	kind: OpKind; title: string; target: string; total: number;
	batchId?: string | null; note?: string; scope?: { user?: string; bases?: string[] };
}): string {
	const id = `op_${++seq}_${Date.now()}`;
	ops = [{
		id, kind: init.kind, title: init.title, target: init.target,
		total: Math.max(init.total, 0), done: 0, failed: 0,
		state: "running", startedAt: Date.now(), finishedAt: null,
		batchId: init.batchId ?? null, note: init.note ?? "", cancelable: 0,
		scope: { ...(init.scope?.user ? { user: init.scope.user } : {}), bases: init.scope?.bases ?? [] },
	}, ...ops];
	emit();
	return id;
}

/** Продвинуть счётчик запроса: столько баз уже обработано. */
export function progressOp(id: string, done: number, failed = 0): void {
	replace(id, (o) => ({ ...o, done, failed }));
}

/** Связать запись с заданием сервиса: дальше её двигает опрос заданий. */
export function attachBatch(id: string, batchId: string, total: number, note = ""): void {
	replace(id, (o) => ({ ...o, batchId, total, note: note || o.note }));
	// Задание появилось — значит, есть за чем следить. Наблюдение не ждёт, пока кто-нибудь
	// откроет нужную вкладку: команду ставят из карточки, а смотрят потом куда угодно.
	ensureBatchWatch();
}

/** Закрыть операцию, считаемую на клиенте. */
export function finishOp(id: string, r: { failed?: number; note?: string } = {}): void {
	replace(id, (o) => ({
		...o,
		done: o.total,
		failed: r.failed ?? o.failed,
		note: r.note ?? o.note,
		state: (r.failed ?? o.failed) > 0 ? "failed" : "done",
		finishedAt: Date.now(),
	}));
	// Операция закончилась — данные в открытых формах устарели. Даже чтение: ответ 1С
	// оседает в реестре сервиса, и карточка обязана показать то, что только что прочитали.
	refreshAfterWork();
	const done = ops.find((o) => o.id === id);
	if (done) noteOutcome(done);
}

/**
 * Перенести в запись состояние задания.
 *
 * Задание — источник истины по команде: сервис знает, сколько баз ответило и сколько
 * отказало, а клиент — нет. Пока `pending` не ноль, операция остаётся выполняющейся, даже
 * если HTTP-запрос давно завершился: «отправлено» и «сделано» — разные события.
 */
export function mergeBatch(p: BatchProgress): void {
	const target = ops.find((o) => o.batchId === p.id);
	if (!target) return;
	const running = p.pending > 0;
	// Переход «шла → закончилась» — единственный момент, когда есть что перечитывать.
	// На каждом опросе этого делать нельзя: опрос идёт раз в три секунды.
	const justFinished = !running && target.state === "running";
	if (justFinished) refreshAfterWork();
	const failedItem = p.items.find((i) => i.error);
	replace(target.id, (o) => ({
		...o,
		total: p.total,
		cancelable: p.cancelable ?? 0,
		done: p.done + p.failed,
		failed: p.failed,
		state: running ? "running" : (p.failed > 0 ? "failed" : "done"),
		finishedAt: running ? null : (o.finishedAt ?? Date.now()),
		note: p.failed > 0 && failedItem?.error
			? `${failedItem.baseKey ?? ""}: ${failedItem.error.message}`.trim()
			: o.note,
	}));
	// Итог командной операции — тем же событием, что и у считаемой на клиенте: два пути к
	// одному концу не должны оставлять разный след.
	if (justFinished) {
		const done = ops.find((o) => o.id === target.id);
		if (done) noteOutcome(done);
	}
}

/**
 * Обернуть одиночную операцию записью реестра.
 *
 * Правило панели: ВСЯ работа, которую она поручает сервису или агенту, видна в «Прогрессе».
 * Без этого экран отвечал «команда отправлена» и замолкал — а команда идёт минутами, и
 * узнать, чем она кончилась, было неоткуда.
 */
export async function withOp<T>(
	init: { kind: OpKind; title: string; target: string; total?: number; scope?: { user?: string; bases?: string[] } },
	run: () => Promise<T>,
): Promise<T> {
	const id = startOp({ ...init, total: init.total ?? 1 });
	try {
		const r = await run();
		finishOp(id);
		return r;
	} catch (e) {
		finishOp(id, { failed: 1, note: e instanceof Error ? e.message : "" });
		throw e;
	}
}

/**
 * ОТМЕНИТЬ операцию — то, что в ней ещё не начато.
 *
 * Панель может остановить только команды в очереди: ту, что агент забрал, выполняет он, и
 * «отмена» означала бы лишь, что мы перестали ждать ответа. Поэтому возвращаем ЧЕСТНОЕ
 * число отменённого: ноль — значит не успели, и это ответ, а не ошибка.
 */
export async function cancelOp(id: string): Promise<number> {
	const op = ops.find((o) => o.id === id);
	if (!op?.batchId) return 0;
	const r = await cancelBatch(op.batchId);
	if (r.canceled > 0) {
		replace(id, (o) => ({
			...o,
			cancelable: 0,
			note: `${translate("onecOpCanceled")}: ${r.canceled}`,
		}));
	}
	return r.canceled;
}

/**
 * ПРЕКРАТИТЬ НАБЛЮДЕНИЕ за операцией — не отменяя её.
 *
 * Разные вещи, и путать их нельзя: отмена останавливает команду на сервере, а это просто
 * убирает запись с экрана. Нужна она, когда запись зависла и держит форму запертой: задание
 * не отвечает, команда давно выполнена, а панель об этом не узнала. Кнопка так и называется,
 * и подпись честно говорит, что на сервере ничего не изменится.
 */
export function abandonOp(id: string): void {
	const next = ops.filter((o) => o.id !== id);
	if (next.length === ops.length) return;
	ops = next;
	emit();
}

/** Убрать завершённые: список нужен для наблюдения, а не как журнал (журнал — «Задания»). */
export function clearFinished(): void {
	const next = ops.filter((o) => o.state === "running");
	if (next.length === ops.length) return;
	ops = next;
	emit();
}

/** Есть ли незавершённые команды — по этому признаку включается опрос заданий. */
export const hasRunningBatches = (list: Op[]): boolean =>
	list.some((o) => o.state === "running" && !!o.batchId);

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => ops;

/** Подписка на реестр: список меняется целиком, поэтому сравнение по ссылке верно. */
export const useOnecOps = (): Op[] => useSyncExternalStore(subscribe, snapshot, snapshot);

/**
 * Прочитать реестр вне React — для чистых функций и для проверок: городить рендер ради
 * разбора списка значило бы проверять заодно и разметку (так же читается журнал
 * сообщений — `getMessages`).
 */
export const getOps = (): Op[] => ops;

/**
 * Слежение за командами — В МОДУЛЕ, а не на экране.
 *
 * Команду ставят из карточки, из списка, из помощника; выполняется она минутами, и её
 * результат нужен всем открытым формам сразу. Пока опрос жил в хуке вкладки, он работал,
 * только пока эта вкладка открыта: закрыли панель — и «Задания» доедут, а карточка базы
 * останется с прежним состоянием публикации до перезагрузки страницы.
 *
 * Теперь опрос начинается сам, как только у операции появилось задание, и прекращается
 * сам, когда незавершённых не осталось: лишнего трафика нет, а наблюдение не зависит от
 * того, на что человек сейчас смотрит.
 */
let poll: number | null = null;
let polling = false;
const watchListeners = new Set<() => void>();
const emitWatch = () => { for (const l of watchListeners) l(); };

async function pollBatches(): Promise<void> {
	if (polling) return;
	polling = true;
	emitWatch();
	try {
		const r = await fetchBatches();
		for (const b of r.items) mergeBatch(b);
	} catch {
		// Сеть отвалилась — следующий тик попробует снова. Ошибку наблюдения показывать
		// человеку незачем: он её не просил и сделать с ней ничего не может.
	} finally {
		polling = false;
		emitWatch();
		if (poll !== null && !hasRunningBatches(ops)) {
			window.clearInterval(poll);
			poll = null;
		}
	}
}

/** Начать наблюдение, если есть за чем. Идемпотентно: второй вызов ничего не удваивает. */
export function ensureBatchWatch(): void {
	if (poll !== null || !hasRunningBatches(ops)) return;
	poll = window.setInterval(() => void pollBatches(), 3000);
	void pollBatches();
}

const subscribeWatch = (l: () => void) => { watchListeners.add(l); return () => { watchListeners.delete(l); }; };

/**
 * Состояние наблюдения для экрана: идёт ли опрос и сколько операций в работе.
 *
 * Сам опрос хук больше не держит — он лишь показывает то, что делает модуль, и даёт
 * кнопку «обновить сейчас».
 */
export function useBatchWatch(): { isFetching: boolean; refresh: () => void; running: number } {
	const list = useOnecOps();
	const isFetching = useSyncExternalStore(subscribeWatch, () => polling, () => false);

	useEffect(() => { ensureBatchWatch(); }, [list]);

	return {
		isFetching,
		refresh: () => void pollBatches(),
		running: list.filter((o) => o.state === "running").length,
	};
}
