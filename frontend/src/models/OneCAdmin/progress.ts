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
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelBatch, fetchBatches, type BatchProgress } from "src/services/onec/api";
import { translate } from "src/i18";

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

/** Затрагивает ли выполняющаяся операция пару «человек + база». */
export const opBlocks = (op: Op, user: string, baseKey: string): boolean => {
	if (op.state !== "running") return false;
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
 * Слежение за командами: опрос заданий, пока есть незавершённые.
 *
 * Живёт в ХУКЕ, а не на одном экране: команду ставят и со списка, и из карточки, а
 * карточка — отдельный пейн и может остаться единственным открытым. Ключ запроса общий,
 * поэтому два наблюдателя не удваивают трафик.
 *
 * ПОСЛЕ ЗАВЕРШЕНИЯ перечитываем реестр — и делаем это ДВАЖДЫ. Сервис обновляет свой кэш
 * содержимого базы отдельной командой (IB_LIST_USERS ставится следом за изменяющей), и в
 * момент, когда наша команда уже «выполнена», свежие данные ещё едут. Один запоздалый
 * повтор дешевле, чем показывать старое значение как новое.
 */
export function useBatchWatch(): { isFetching: boolean; refresh: () => void; running: number } {
	const ops = useOnecOps();
	const watching = hasRunningBatches(ops);
	const qc = useQueryClient();

	const q = useQuery({
		queryKey: ["onec", "batches"],
		queryFn: fetchBatches,
		refetchInterval: watching ? 3000 : false,
		staleTime: 0,
	});

	useEffect(() => {
		for (const b of q.data?.items ?? []) mergeBatch(b);
	}, [q.data]);

	const was = useRef(false);
	useEffect(() => {
		const prev = was.current;
		was.current = watching;
		if (!prev || watching) return;
		// Перечитываем ВСЁ, что команда могла изменить, а не только пользователей.
		// Раньше здесь были три ключа про пользователей — и состояние публикации после
		// «Опубликовать» не менялось в списке баз до перезагрузки страницы: команда
		// отрабатывала, реестр обновлялся, а панель об этом не спрашивала.
		// Живое состояние кластера (сеансы, соединения, процессы) сюда НЕ входит: каждый
		// такой запрос — команда в 1С, и дёргать их после любой чужой команды незачем.
		const refresh = () => {
			for (const key of [
				"bases",              // состояние баз, включая публикацию
				"base-ext",           // расширения в карточке базы
				"ext-summary",        // сводка «в каких базах какое расширение»
				"user-summary",
				"base-users-cached",
				"user-where",
			]) void qc.invalidateQueries({ queryKey: ["onec", key] });
			// Список баз ERP-прокси (ModelList) живёт под своим ключом.
			void qc.invalidateQueries({ queryKey: ["onec-bases"] });
		};
		refresh();
		const t = window.setTimeout(refresh, 5000);
		return () => window.clearTimeout(t);
	}, [watching, qc]);

	return {
		isFetching: q.isFetching,
		refresh: () => void q.refetch(),
		running: ops.filter((o) => o.state === "running").length,
	};
}
