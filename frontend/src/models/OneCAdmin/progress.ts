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
import { useSyncExternalStore } from "react";
import type { BatchProgress } from "src/services/onec/api";

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
	/** Короткий итог или причина отказа. */
	note: string;
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
	kind: OpKind; title: string; target: string; total: number; batchId?: string | null; note?: string;
}): string {
	const id = `op_${++seq}_${Date.now()}`;
	ops = [{
		id, kind: init.kind, title: init.title, target: init.target,
		total: Math.max(init.total, 0), done: 0, failed: 0,
		state: "running", startedAt: Date.now(), finishedAt: null,
		batchId: init.batchId ?? null, note: init.note ?? "",
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
		done: p.done + p.failed,
		failed: p.failed,
		state: running ? "running" : (p.failed > 0 ? "failed" : "done"),
		finishedAt: running ? null : (o.finishedAt ?? Date.now()),
		note: p.failed > 0 && failedItem?.error
			? `${failedItem.baseKey ?? ""}: ${failedItem.error.message}`.trim()
			: o.note,
	}));
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
