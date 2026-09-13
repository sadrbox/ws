/**
 * Операции «Пользователей баз» — АДАПТЕР панели 1С к общему реестру длительной работы.
 *
 * ЗАЧЕМ ОН ЕСТЬ. Кнопка «Проверить пользователей» опрашивает 1С по каждой базе, а запись
 * прав ставит команду в очередь агенту. И то и другое длится дольше, чем человек готов
 * смотреть на крутящийся индикатор. Сам реестр — запись, ход, итог в журнал — теперь общий
 * (`components/TechMessages/operations.ts`, M13): тот же вопрос задаёт и работа вне 1С.
 * Здесь осталось то, что знает только панель 1С:
 *
 *   - задания сервиса: `attachBatch` связывает запись с заданием, опрос переносит в неё
 *     done/failed/pending, отмена снимает с очереди то, что агент ещё не забрал;
 *   - перечитывание кэша 1С после любой законченной работы (`refreshAfterWork`);
 *   - блокировка карточки, пока над парой «человек + база» идёт работа (`opBlocks`).
 *
 * ПРЕЖНИЕ ИМЕНА СОХРАНЕНЫ. Панель зовёт `startOp`/`finishOp`/`useOnecOps` из двух десятков
 * мест; реэкспорт позволяет перенести реестр, не трогая ни одно из них.
 */
import { useEffect, useSyncExternalStore } from "react";
import { queryClient } from "src/app/queryClient";
import {
	cancelBatch, fetchBatches, hasCapability, type BatchProgress, type OnecAgent,
} from "src/services/onec/api";
import { translate } from "src/i18";
import {
	abandonOp, cancelOp, clearFinished, finishOp, getOps, opDuration, opKindLabel, opPercent,
	opStateLabel, opSucceeded, progressOp, setOpCanceler, settleOp, startOp as startCoreOp,
	updateOp, useOps, withOp as withCoreOp, type Op, type OpInit, type OpKind, type OpState,
} from "src/components/TechMessages/operations";

export {
	abandonOp, cancelOp, clearFinished, finishOp, getOps, opDuration, opKindLabel, opPercent,
	opStateLabel, opSucceeded, progressOp,
};
export type { Op, OpKind, OpState };

/** Прежнее имя подписки на реестр — им пользуется вся панель. */
export const useOnecOps = useOps;

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
 * Приносит ли агент состояние базы своим ответом (способность `ib.echo`).
 *
 * Читаем ИЗ КЭША, а не запросом: перечитывание случается после каждой операции, и новое
 * обращение к сервису ради него заменило бы одно лишнее обращение другим. Список агентов в
 * кэше уже есть — панель обновляет его каждые 15 с (см. useAgents).
 *
 * Кэша ещё нет (первая операция в свежей вкладке) — считаем, что эха нет: запоздалый повтор
 * дешевле, чем показать старое значение как новое.
 */
const echoReady = (): boolean => {
	const agents = queryClient.getQueryData<{ items?: OnecAgent[] }>(["onec", "agents"]);
	return hasCapability(agents?.items, "ib.echo");
};

/**
 * Перечитать данные во ВСЕХ открытых формах, а не только там, откуда запускали.
 *
 * Так и просили: «после выполнения команд, операций, запросов обновлять данные в открытых
 * формах элементов». Раньше это делал хук, живший на вкладке панели, — и работало только
 * пока вкладка открыта. Карточка базы, открытая отдельным пейном, после публикации
 * показывала прежнее состояние до перезагрузки страницы.
 *
 * ПОВТОР — ТОЛЬКО ДЛЯ СТАРОГО АГЕНТА. Агент со способностью `ib.echo` приносит новое
 * содержимое базы своим же ответом, и сервис кладёт его в реестр ДО того, как команда
 * станет «выполнена» (см. docs/TASK_FRESH_STATE_AFTER_COMMAND.md): к моменту перечитывания
 * свежее уже лежит, ждать нечего. Агент без этой способности по-прежнему обновляет реестр
 * второй командой, и в момент «выполнено» данные ещё едут — там один запоздалый повтор
 * дешевле, чем показать старое значение как новое.
 */
export function refreshAfterWork(): void {
	const once = () => {
		for (const key of REFRESH_KEYS) void queryClient.invalidateQueries({ queryKey: ["onec", key] });
		// Список баз ERP-прокси (ModelList) живёт под своим ключом.
		void queryClient.invalidateQueries({ queryKey: ["onec-bases"] });
	};
	once();
	if (!echoReady()) window.setTimeout(once, 5000);
}

/**
 * Отмена записи, связанной с заданием: сервис снимает с очереди то, что агент ещё не
 * забрал. Ту, что забрал, выполняет он, и «отмена» означала бы лишь, что мы перестали ждать.
 */
const batchCanceler = (id: string, batchId: string) => async (): Promise<number> => {
	const r = await cancelBatch(batchId);
	if (r.canceled > 0) {
		updateOp(id, (o) => ({
			...o,
			cancelable: 0,
			note: `${translate("onecOpCanceled")}: ${r.canceled}`,
		}));
	}
	return r.canceled;
};

/**
 * Начать операцию панели. Любая законченная работа панели перечитывает кэш 1С — это и
 * отличает её от общей операции.
 */
export function startOp(init: OpInit): string {
	const id = startCoreOp({ ...init, onFinish: refreshAfterWork });
	if (init.batchId) setOpCanceler(id, batchCanceler(id, init.batchId));
	return id;
}

/** Обернуть одиночную операцию панели записью реестра (с перечитыванием кэша 1С). */
export function withOp<T>(
	init: Omit<OpInit, "total"> & { total?: number },
	run: () => Promise<T>,
): Promise<T> {
	return withCoreOp({ ...init, onFinish: refreshAfterWork }, run);
}

/** Связать запись с заданием сервиса: дальше её двигает опрос заданий. */
export function attachBatch(id: string, batchId: string, total: number, note = ""): void {
	updateOp(id, (o) => ({ ...o, batchId, total, note: note || o.note }));
	setOpCanceler(id, batchCanceler(id, batchId));
	// Задание появилось — значит, есть за чем следить. Наблюдение не ждёт, пока кто-нибудь
	// откроет нужную вкладку: команду ставят из карточки, а смотрят потом куда угодно.
	ensureBatchWatch();
}

/**
 * Перенести в запись состояние задания.
 *
 * Задание — источник истины по команде: сервис знает, сколько баз ответило и сколько
 * отказало, а клиент — нет. Пока `pending` не ноль, операция остаётся выполняющейся, даже
 * если HTTP-запрос давно завершился: «отправлено» и «сделано» — разные события.
 */
export function mergeBatch(p: BatchProgress): void {
	const target = getOps().find((o) => o.batchId === p.id);
	if (!target) return;
	const running = p.pending > 0;
	// Переход «шла → закончилась» — единственный момент, когда есть что перечитывать.
	// На каждом опросе этого делать нельзя: опрос идёт раз в три секунды.
	const justFinished = !running && target.state === "running";
	if (justFinished) refreshAfterWork();
	const failedItem = p.items.find((i) => i.error);
	updateOp(target.id, (o) => ({
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
	if (justFinished) settleOp(target.id);
}

/** Есть ли незавершённые команды — по этому признаку включается опрос заданий. */
export const hasRunningBatches = (list: Op[]): boolean =>
	list.some((o) => o.state === "running" && !!o.batchId);

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
		if (poll !== null && !hasRunningBatches(getOps())) {
			window.clearInterval(poll);
			poll = null;
		}
	}
}

/** Начать наблюдение, если есть за чем. Идемпотентно: второй вызов ничего не удваивает. */
export function ensureBatchWatch(): void {
	if (poll !== null || !hasRunningBatches(getOps())) return;
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
