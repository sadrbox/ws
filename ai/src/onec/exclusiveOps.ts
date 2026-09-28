/**
 * МОНОПОЛЬНАЯ ОПЕРАЦИЯ ПО БАЗЕ — установка и удаление расширения (27.09).
 *
 * ЗАЧЕМ. Агент ставит расширение через `ibcmd extension create`, а тому нужен монопольный доступ к базе.
 * Пока в базе живёт хоть один сеанс — а фоновое задание кластера живёт в ней всегда, — `ibcmd` не получает
 * блокировку и висит до предела агента (180 с), после чего снимается: `IB_TIMEOUT` «занятый рабочий каталог
 * или блокировка в самой базе». На базе `_transition` так упали все шесть установок с 16.09, и «Установить
 * расширение» из панели не работало вовсе. Для выгрузки и восстановления агент сам закрывает вход и ждёт
 * выхода пользователей (`with_sessions_locked`), но фоновые задания это не останавливает, а у установки
 * расширения такого шага нет: по контракту кластера (ONEC_AGENT_CLUSTER_CONTRACT.md, «Запрет регламентных
 * заданий») последовательность обязан выполнять тот, кто ставит команду:
 *
 *   запретить регламентные задания → закрыть вход → снять оставшиеся сеансы → операция → вернуть как было.
 *
 * КАК. Команда операции ставится в задание сразу — удержанной (`hold`: сама агенту не уйдёт, пока её не выпустят)
 * и с пустым состоянием подготовки в payload (`exclusive: {}`), — а подготовка идёт кластерными командами того же
 * агента (они не занимают место базы). Подготовка удалась — операция выпускается (`queue.release`); нет — операция
 * завершается отказом с причиной (`queue.failQueued`), и задание показывает её у этой базы. Что бы ни случилось с
 * операцией, вход открывается и прежний запрет заданий возвращается по `was`.
 *
 * ЧЕГО НЕ ДЕЛАЕТ. Не ждёт «выхода пользователей» по-хорошему: расширение ставят в окно обслуживания или
 * руками прямо сейчас — и в обоих случаях сеансы снимаются. Агент без `cluster.admin` подготовки не
 * получает: операция выпускается сразу, как раньше, и об этом пишется в журнал.
 *
 * КР-12 (docs/AUDIT_CRITICAL_2026-09-27.md) — без чего механизм нельзя было включать:
 *  1. ОДНА ОПЕРАЦИЯ — ОДИН РАННЕР ДО КОНЦА, ВКЛЮЧАЯ ПОВТОРЫ. «База занята» (IB_BUSY, IB_TIMEOUT) повторяет сам
 *     раннер: копия ставится удержанной (`retryBusy` с `hold`), база остаётся закрытой, после паузы сеансы снимаются
 *     снова, копия выпускается, а база возвращается ОДИН раз — после последней попытки. Раньше обработчик результата
 *     тем же тиком, что первый раннер возвращал базу, запускал второй: тот читал запрет первого как «прежнее
 *     значение» (`was=true`), операция шла с разрешёнными заданиями, а в конце запрет «возвращался» навсегда.
 *  2. ЦЕПОЧКА НА АГЕНТА (ExclusiveLanes). Раньше пакет на сто баз закрывал вход и снимал сеансы во всех сразу
 *     (кластерные команды мест не занимают), а операции шли по одной — база №100 стояла закрытой часами. Теперь база
 *     готовится непосредственно перед своей операцией: одновременно идёт не больше AGENT_IB_PARALLEL операций агента
 *     и никогда две по одной базе.
 *  3. ВОССТАНОВЛЕНИЕ. Состояние — в payload с самой постановки; запрет заданий и закрытие входа ставятся с
 *     requestId, и итог шага, ответа на который не дождались, узнаётся по его команде. На старте ещё не выданная
 *     операция сразу завершается отказом EXCLUSIVE_INTERRUPTED (её раннер остался в прошлом запуске), и база
 *     возвращается сразу, а не через час ожидания.
 *  4. «Остановить задание» останавливает и подготовку: перед закрытием входа и перед снятием каждого сеанса раннер
 *     проверяет, что операция ещё ждёт.
 */
import { DEFAULT_COMMAND_TTL_SECS, agentCanRun, findAdminCommand, runsInsideBase, type AdminCommandSpec } from "../commands/admin.ts";
import {
	BUSY_RETRY_DELAYS_SECS, isBusyFailure,
	type CommandQueue, type CommandRow, type ExclusivePendingRow, type ExclusiveStateRow,
} from "../commands/queue.ts";
import type { AgentRole } from "../agents/service.ts";
import { unwrapData } from "./accountingChecks.ts";

/**
 * Что СЕЙЧАС идёт под этой последовательностью. Пусто с 27.09 (КР-1 docs/AUDIT_CRITICAL_2026-09-27.md): агент с
 * сборки 21:54 ставит и удаляет расширение через COM, которому монопольный доступ не нужен, а закрытый нами вход
 * отказывал и его собственному соединению («Начало сеанса с информационной базой запрещено»). Механизм остаётся для
 * операций, которым монополия нужна на самом деле (загрузка .dt и т. п.). Дефекты КР-12 исправлены — включать тип
 * сюда можно, убедившись, что закрытый вход не мешает самому агенту выполнить эту операцию.
 */
export const EXCLUSIVE_TYPES: ReadonlySet<string> = new Set<string>();

/**
 * У каких типов в payload может остаться состояние подготовки (`exclusive`) от прежних запусков — по ним
 * восстановление на старте возвращает брошенные закрытыми базы, даже если тип больше не идёт под подготовкой.
 */
export const EXCLUSIVE_STATE_TYPES: ReadonlySet<string> = new Set(["IB_INSTALL_EXTENSION", "IB_DELETE_EXTENSION"]);

/** Кластерные команды подготовки; агент без любой из них подготовки не получает. */
const PREP_TYPES = ["CLUSTER_SET_SCHEDULED_JOBS", "CLUSTER_SET_SESSIONS_LOCK", "CLUSTER_LIST_SESSIONS", "CLUSTER_TERMINATE_SESSION"] as const;

const LOCK_MESSAGE = "Идёт установка расширения BuhProf AI — вход временно закрыт";

/** Операция больше не ждёт выдачи: задание остановлено, срок ожидания вышел или команда уже завершена. */
const NOT_WAITING = "команда операции уже не ждёт выдачи (задание остановлено или срок ожидания истёк) — подготовка прервана";

/**
 * Отказ операции, чей раннер остался в прошлом запуске сервиса (КР-12 п. 3): выпустить её некому, а выдать без
 * подготовки нельзя. Раньше такая команда висела «в очереди» до 12 ч и кончалась «агент был занят» — неправдой.
 */
export const EXCLUSIVE_INTERRUPTED = {
	code: "EXCLUSIVE_INTERRUPTED",
	message: "Сервис перезапустился, пока операция ждала своей очереди или подготовки базы: команда агенту не выдавалась, "
		+ "база возвращается в прежнее состояние. Повторите операцию («Повторить неуспешные»).",
} as const;

export type ExclusiveQueue = Pick<CommandQueue,
	"enqueue" | "waitResult" | "release" | "failQueued" | "patchPayload" | "get" | "retryBusy" | "cancel" | "getByRequestId">;

/**
 * Состояние шагов — в payload команды операции (`exclusive`), а не в памяти: сервис перезапустился посреди
 * ожидания — и база осталась бы закрытой навсегда (так и случилось 27.09 в 07:14). По этому состоянию
 * `recoverExclusive` на старте возвращает брошенные базы.
 */
export type ExclusiveState = ExclusiveStateRow;

export type ExclusiveAgent = { id: string; organizationUuid: string; role: AgentRole; capabilities: string[] };

export type ExclusiveLog = { info: (o: object, msg: string) => void; warn: (o: object, msg: string) => void };

export type ExclusiveInput = {
	agent: ExclusiveAgent;
	baseKey: string;
	/** Удержанная команда операции, уже привязанная к заданию. */
	commandId: string;
	userUuid: string | null;
	/** Сколько подготовительная команда может ждать очереди агента, с. */
	queueWaitSeconds: number;
};

export type ExclusiveOutcome = {
	/** Подготовка делалась (у агента есть кластерные команды). */
	prepared: boolean;
	/** Операция (последняя попытка) выпущена агенту. */
	released: boolean;
	/** Сколько сеансов снято (за все попытки). */
	terminated: number;
	/** Итог самой операции (последней попытки): состояние команды или null, если её не выпускали. */
	operation: CommandRow["state"] | null;
	/** Что не удалось вернуть после операции — пусто, если всё вернулось. */
	restoreProblems: string[];
	note: string | null;
	/** Сколько попыток сделано: повторы «база занята» ведёт тот же раннер (КР-12 п. 1). */
	attempts: number;
	/** Команда последней попытки. */
	commandId: string;
};

type StepResult = { ok: true; data: Record<string, unknown> } | { ok: false; message: string };

const asRecord = (v: unknown): Record<string, unknown> =>
	v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Повторяет ли «база занята» РАННЕР этой операции (КР-12 п. 1) — тогда обработчик результата (agentRouter) копию
 * не ставит: копия без подготовки ушла бы в открытую базу, а вторая подготовка поверх первой прочитала бы её запрет
 * как «прежнее значение». Команда под подготовкой несёт `exclusive` в payload с самой постановки. Без подготовки
 * (у агента нет кластерных команд — `prepared: false`) повтор обычный, как у любой команды задания.
 */
export function retriedByRunner(payload: Record<string, unknown> | null | undefined): boolean {
	const st = payload?.exclusive;
	return !!st && typeof st === "object" && !Array.isArray(st) && (st as ExclusiveState).prepared !== false;
}

/**
 * Дождаться конца команды: срок ожидания очереди плюс выполнение и запас на ответ; выданную и продлённую
 * агентом (heartbeat) ждём дальше по `expires_at` — как ночной прогон проверок.
 */
export async function awaitCommand(queue: Pick<CommandQueue, "waitResult">, id: string, ttlSecs: number, queueWaitSecs: number): Promise<CommandRow | null> {
	let deadline = Date.now() + (queueWaitSecs + ttlSecs + 30) * 1000;
	let done = await queue.waitResult(id, deadline - Date.now());
	while (done && done.state === "dispatched" && done.expires_at) {
		const until = new Date(done.expires_at).getTime() + 30_000;
		if (until <= deadline || until <= Date.now()) break;
		deadline = until;
		done = await queue.waitResult(id, Math.max(1_000, deadline - Date.now()));
	}
	return done;
}

/**
 * Команды монопольных операций, которые ведёт ЭТОТ процесс (ждут своей очереди или идут, с копиями-повторами):
 * восстановление на старте их не трогает — они не брошены.
 */
const managedHere = new Set<string>();

type LaneWaiter = { baseKey: string; start: () => void };
type Lane = { active: number; bases: Set<string>; waiting: LaneWaiter[]; limit: number };

/**
 * ЦЕПОЧКА МОНОПОЛЬНЫХ ОПЕРАЦИЙ АГЕНТА (КР-12 п. 2). Подготовка — кластерные команды: мест не занимают и уходят агенту
 * разом, а операции идут внутрь баз по одной (AGENT_IB_PARALLEL). Запущенные все сразу, раннеры закрывали вход и
 * снимали сеансы во ВСЕХ базах задания в первую же минуту. Здесь раннер ждёт своей очереди у агента: одновременно
 * готовится и идёт не больше `limit` операций и никогда две по одной базе (вторая прочитала бы запрет первой как
 * «прежнее значение»). Очередь — в памяти процесса: брошенное перезапуском подбирает `recoverExclusive`.
 */
export class ExclusiveLanes {
	private readonly lanes = new Map<string, Lane>();

	async run<T>(agentId: string, baseKey: string, limit: number, job: () => Promise<T>): Promise<T> {
		let lane = this.lanes.get(agentId);
		if (!lane) {
			lane = { active: 0, bases: new Set(), waiting: [], limit: 1 };
			this.lanes.set(agentId, lane);
		}
		const l = lane;
		l.limit = Math.max(1, Math.floor(limit) || 1);
		const key = baseKey.toLowerCase();
		await new Promise<void>((start) => {
			l.waiting.push({ baseKey: key, start });
			this.pump(l);
		});
		try {
			return await job();
		} finally {
			l.active -= 1;
			l.bases.delete(key);
			this.pump(l);
			if (!l.active && !l.waiting.length && this.lanes.get(agentId) === l) this.lanes.delete(agentId);
		}
	}

	/** Сколько операций агента идёт и сколько ждёт своей очереди. */
	size(agentId: string): { active: number; waiting: number } {
		const l = this.lanes.get(agentId);
		return { active: l?.active ?? 0, waiting: l?.waiting.length ?? 0 };
	}

	private pump(lane: Lane): void {
		for (let i = 0; i < lane.waiting.length && lane.active < lane.limit;) {
			const w = lane.waiting[i]!;
			if (lane.bases.has(w.baseKey)) { i += 1; continue; }
			lane.waiting.splice(i, 1);
			lane.active += 1;
			lane.bases.add(w.baseKey);
			w.start();
		}
	}
}

/** Цепочки процесса: одна на все задания, расписания и восстановление. */
export const exclusiveLanes = new ExclusiveLanes();

/**
 * Поставить монопольную операцию в цепочку её агента (КР-12 п. 2): подготовка начнётся, когда до операции дойдёт
 * очередь. Не бросает — любой исход в журнале и в самой команде задания; `null` — сбой сервиса.
 */
export function superviseExclusive(
	deps: { queue: ExclusiveQueue; log?: ExclusiveLog; parallel?: number; lanes?: ExclusiveLanes },
	input: ExclusiveInput, opSpec: Pick<AdminCommandSpec, "ttlSeconds">,
): Promise<ExclusiveOutcome | null> {
	managedHere.add(input.commandId);
	return (deps.lanes ?? exclusiveLanes)
		.run(input.agent.id, input.baseKey, deps.parallel ?? 1, () => new ExclusiveRunner(deps.queue, deps.log).run(input, opSpec))
		.catch((e: unknown) => {
			deps.log?.warn({ baseKey: input.baseKey, commandId: input.commandId, err: e instanceof Error ? e.message : String(e) }, "монопольная операция: сбой сервиса");
			return null;
		})
		.finally(() => { managedHere.delete(input.commandId); });
}

export class ExclusiveRunner {
	private readonly queue: ExclusiveQueue;
	private readonly log?: ExclusiveLog;
	constructor(queue: ExclusiveQueue, log?: ExclusiveLog) { this.queue = queue; this.log = log; }

	/** Есть ли у агента всё для подготовки. */
	static canPrepare(agent: ExclusiveAgent): boolean {
		return PREP_TYPES.every((t) => { const s = findAdminCommand(t); return !!s && agentCanRun(agent, s); });
	}

	private async step(input: ExclusiveInput, type: (typeof PREP_TYPES)[number], payload: Record<string, unknown>, requestId?: string): Promise<StepResult> {
		const spec = findAdminCommand(type) as AdminCommandSpec;
		const ttl = spec.ttlSeconds ?? DEFAULT_COMMAND_TTL_SECS;
		let id: string;
		try {
			const cmd = await this.queue.enqueue({
				agentId: input.agent.id, organizationUuid: input.agent.organizationUuid, baseKey: input.baseKey,
				type, payload: { ...payload, baseKey: input.baseKey }, userUuid: input.userUuid,
				ttlSeconds: ttl, queueWaitSeconds: input.queueWaitSeconds, inBase: runsInsideBase(spec), priority: 10,
				...(requestId ? { requestId } : {}),
			});
			id = cmd.id;
		} catch (e) {
			return { ok: false, message: `${spec.title}: команда не поставлена в очередь — ${e instanceof Error ? e.message : String(e)}` };
		}
		const done = await awaitCommand(this.queue, id, ttl, input.queueWaitSeconds);
		if (!done || done.state === "queued" || done.state === "dispatched") {
			// Не выданную — снять: запоздалое снятие сеанса или запрет заданий после отказа хуже самого отказа.
			if (done?.state === "queued") await this.queue.cancel([id], "exclusive-timeout");
			return { ok: false, message: `${spec.title}: агент не ответил за отведённое время` };
		}
		if (done.state !== "done") {
			return { ok: false, message: `${spec.title}: ${done.error?.message || done.error?.code || done.state}` };
		}
		return { ok: true, data: asRecord(unwrapData(done.result)) };
	}

	/**
	 * Провести операцию `input.commandId` под монопольным доступом — с повторами «база занята» до последней попытки.
	 * Не бросает: любой исход — в журнале и в самой команде задания.
	 */
	async run(input: ExclusiveInput, opSpec: Pick<AdminCommandSpec, "ttlSeconds">): Promise<ExclusiveOutcome> {
		const out: ExclusiveOutcome = {
			prepared: false, released: false, terminated: 0, operation: null, restoreProblems: [], note: null,
			attempts: 1, commandId: input.commandId,
		};
		const ctx = { baseKey: input.baseKey, commandId: input.commandId, agentId: input.agent.id };
		const copies: string[] = [];
		managedHere.add(input.commandId);
		try {
			// Операция ещё ждёт? В цепочке агента она могла простоять часы: задание остановили, срок ожидания вышел.
			if (!(await this.waiting(input.commandId))) {
				out.note = NOT_WAITING;
				out.operation = (await this.queue.get(input.commandId))?.state ?? null;
				await this.remember(input.commandId, { restored: true });
				this.log?.info({ ...ctx, operation: out.operation }, "монопольная операция: операция уже не ждёт — подготовка не начиналась");
				return out;
			}
			if (!ExclusiveRunner.canPrepare(input.agent)) {
				out.note = "у агента нет кластерных команд — операция выпущена без закрытия базы";
				// Подготовки нет и не будет — повтор «база занята» у такой операции обычный (retriedByRunner).
				await this.remember(input.commandId, { prepared: false, restored: true });
				out.released = await this.queue.release(input.commandId);
				this.log?.warn({ ...ctx }, `монопольная операция: ${out.note}`);
				return out;
			}
			out.prepared = true;
			return await this.prepareAndRun(input, opSpec, out, copies);
		} finally {
			managedHere.delete(input.commandId);
			for (const id of copies) managedHere.delete(id);
		}
	}

	private async prepareAndRun(input: ExclusiveInput, opSpec: Pick<AdminCommandSpec, "ttlSeconds">, out: ExclusiveOutcome, copies: string[]): Promise<ExclusiveOutcome> {
		const ctx = { baseKey: input.baseKey, commandId: input.commandId, agentId: input.agent.id };
		const st: ExclusiveState = {};
		/** Команда текущей попытки; состояние подготовки живёт в ней (копия-повтор получает его от исходной). */
		let current = input.commandId;
		const fail = async (message: string) => {
			out.note = message;
			await this.queue.failQueued(current, {
				code: "EXCLUSIVE_PREP_FAILED",
				message: `Базу не удалось закрыть для монопольной операции: ${message}. Команда агенту не выдавалась.`,
			});
			this.log?.warn({ ...ctx, commandId: current, reason: message }, "монопольная операция: подготовка не удалась");
		};
		const stop = async () => {
			out.note = NOT_WAITING;
			out.operation = (await this.queue.get(current))?.state ?? null;
			this.log?.info({ ...ctx, commandId: current, operation: out.operation }, "монопольная операция: операция больше не ждёт — подготовка прервана, база возвращается");
		};

		try {
			// 1. Регламентные задания — иначе следующее по расписанию откроет новый сеанс посреди операции. Намерение —
			//    в команду ДО постановки шага (КР-12 п. 3): перезапуск посреди шага не теряет запрет.
			st.jobsReq = `exclusive:${current}:jobs`;
			await this.remember(current, st);
			const jobs = await this.step(input, "CLUSTER_SET_SCHEDULED_JOBS", { denied: true }, st.jobsReq);
			if (!jobs.ok) { await fail(jobs.message); return out; }
			st.jobsWas = typeof jobs.data.was === "boolean" ? jobs.data.was : null;
			await this.remember(current, st);

			// 2. Вход закрыт — новые пользователи не зайдут, пока идёт операция. Задание остановили, пока ставился
			//    запрет, — вход не закрываем (КР-12 п. 4).
			if (!(await this.waiting(current))) { await stop(); return out; }
			st.lockReq = `exclusive:${current}:lock`;
			await this.remember(current, st);
			const lock = await this.step(input, "CLUSTER_SET_SESSIONS_LOCK", { enabled: true, message: LOCK_MESSAGE }, st.lockReq);
			if (!lock.ok) { await fail(lock.message); return out; }
			st.locked = true;
			await this.remember(current, st);

			for (;;) {
				out.released = false;
				out.operation = null;
				// 3. Оставшиеся сеансы (пользователи, фоновые задания) — снять; перед повтором — снова.
				const cleared = await this.clearSessions(input, current, out);
				if (cleared === "stopped") { await stop(); return out; }
				if (!cleared.ok) { await fail(cleared.message); return out; }

				// 4. Операция.
				out.released = await this.queue.release(current);
				if (!out.released) { await stop(); return out; }
				this.log?.info({ ...ctx, commandId: current, attempt: out.attempts, terminated: out.terminated }, "монопольная операция: база закрыта, команда выпущена");
				const done = await awaitCommand(this.queue, current, opSpec.ttlSeconds ?? DEFAULT_COMMAND_TTL_SECS, input.queueWaitSeconds);
				out.operation = done?.state ?? null;

				// 5. «База занята» — повтор ведёт этот же раннер (КР-12 п. 1): база остаётся закрытой, копия удержана до
				//    нового снятия сеансов, а запрет заданий и вход возвращаются один раз — после последней попытки.
				if (!done || done.state !== "failed" || !done.batch_id || !isBusyFailure(done.error?.code, done.error?.message)) return out;
				const next = await this.queue.retryBusy(current, input.queueWaitSeconds, { hold: true });
				if (!next) return out; // попытки кончились или задание остановлено
				copies.push(next);
				managedHere.add(next);
				const pauseSecs = BUSY_RETRY_DELAYS_SECS[Math.min(done.attempt ?? 1, BUSY_RETRY_DELAYS_SECS.length) - 1] ?? 0;
				current = next;
				out.commandId = next;
				out.attempts += 1;
				await this.remember(current, { ...st, releaseAt: new Date(Date.now() + pauseSecs * 1000).toISOString() });
				this.log?.info({ ...ctx, retry: next, attempt: out.attempts, pauseSecs, code: done.error?.code },
					"монопольная операция: база занята — повтор после паузы, база остаётся закрытой");
				// Пауза — как у обычного повтора (С19): за секунды после отказа в базе ничего не меняется. Остановка
				// задания снимает удержанную копию — ожидание кончается сразу.
				const paused = await this.queue.waitResult(current, pauseSecs * 1000);
				if (paused && paused.state !== "queued") { await stop(); return out; }
			}
		} finally {
			// 6. Вернуть как было — при любом исходе и один раз за всю операцию.
			out.restoreProblems = await this.restore({ ...input, commandId: current }, st, out.operation);
		}
	}

	/**
	 * Снять сеансы базы. Строки — словари `rac`; сеанс адресуется UUID из поля `session`; строку без него пропускаем
	 * и говорим об этом. Перед списком и перед каждым снятием — операция ещё ждёт? (КР-12 п. 4.)
	 */
	private async clearSessions(input: ExclusiveInput, commandId: string, out: ExclusiveOutcome): Promise<"stopped" | { ok: true } | { ok: false; message: string }> {
		if (!(await this.waiting(commandId))) return "stopped";
		const list = await this.step(input, "CLUSTER_LIST_SESSIONS", {});
		if (!list.ok) return { ok: false, message: list.message };
		const items = Array.isArray(list.data.items) ? list.data.items.map(asRecord) : [];
		const problems: string[] = [];
		for (const it of items) {
			const sessionId = typeof it.session === "string" ? it.session.trim() : "";
			if (!UUID.test(sessionId)) { problems.push(`сеанс без идентификатора кластера (${String(it["session-id"] ?? it.session ?? "?")})`); continue; }
			if (!(await this.waiting(commandId))) return "stopped";
			const t = await this.step(input, "CLUSTER_TERMINATE_SESSION", { sessionId });
			if (t.ok) out.terminated += 1; else problems.push(t.message);
		}
		return problems.length ? { ok: false, message: `не сняты сеансы: ${problems.join("; ")}` } : { ok: true };
	}

	/** Операция ещё ждёт выдачи: не отменена, не завершена и срок ожидания не вышел. */
	private async waiting(id: string): Promise<boolean> {
		const row = await this.queue.get(id);
		return !!row && row.state === "queued" && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now());
	}

	/** Запомнить состояние шагов в команде; сбой записи — не повод бросать операцию (в журнал). */
	private async remember(commandId: string, st: ExclusiveState): Promise<void> {
		try { await this.queue.patchPayload(commandId, { exclusive: { ...st } }); } catch (e) {
			this.log?.warn({ commandId, err: e instanceof Error ? e.message : String(e) }, "монопольная операция: состояние не записано");
		}
	}

	/**
	 * Итог шага подготовки по его команде (requestId), когда ответа не дождались: `true` — выполнен, `false` — не
	 * выполнялся (не выданную снимаем), `null` — выдан и без ответа, неизвестно.
	 */
	private async stepOutcome(input: ExclusiveInput, requestId: string): Promise<{ happened: boolean | null; data: Record<string, unknown> }> {
		let c = await this.queue.getByRequestId(input.agent.id, requestId);
		if (!c) return { happened: false, data: {} };
		if (c.state === "queued") {
			if ((await this.queue.cancel([c.id], "exclusive-restore")) > 0) return { happened: false, data: {} };
			c = (await this.queue.get(c.id)) ?? c;
		}
		if (c.state === "queued" || c.state === "dispatched") {
			c = (await awaitCommand(this.queue, c.id, c.ttl_seconds ?? DEFAULT_COMMAND_TTL_SECS, 0)) ?? c;
		}
		if (c.state === "done") return { happened: true, data: asRecord(unwrapData(c.result)) };
		if (c.state === "failed" || c.state === "canceled" || (c.state === "expired" && !c.dispatched_at)) return { happened: false, data: {} };
		return { happened: null, data: {} };
	}

	/**
	 * Вернуть базу: открыть вход (если закрывали), вернуть запрет заданий по `was` (если ставили). Порядок
	 * обратный подготовке. Шаг, ответа на который не дождались (перезапуск, молчание агента), узнаётся по его
	 * команде (КР-12 п. 3). Итог — в команде: `restored` — только когда возврат прошёл; иначе восстановление на
	 * старте попробует ещё раз.
	 */
	async restore(input: ExclusiveInput, stIn: ExclusiveState, operation: CommandRow["state"] | null = null): Promise<string[]> {
		const ctx = { baseKey: input.baseKey, commandId: input.commandId, agentId: input.agent.id };
		const { releaseAt: _releaseAt, problems: _before, ...st } = stIn;
		const problems: string[] = [];
		const unknown: string[] = [];
		if (st.jobsWas === undefined && st.jobsReq) {
			const j = await this.stepOutcome(input, st.jobsReq);
			if (j.happened === true) st.jobsWas = typeof j.data.was === "boolean" ? j.data.was : null;
			// Не трогаем: вслепую разрешить задания базе, где их запретили намеренно (копия с обменами), хуже.
			else if (j.happened === null) unknown.push("Запрет регламентных заданий: агент не ответил — неизвестно, ставился ли запрет; проверьте задания базы");
		}
		// Закрылся или неизвестно — открыть: лишнее открытие не вредит, забытое закрытие держит базу.
		if (!st.locked && st.lockReq && (await this.stepOutcome(input, st.lockReq)).happened !== false) st.locked = true;
		if (st.locked) {
			const unlock = await this.step(input, "CLUSTER_SET_SESSIONS_LOCK", { enabled: false });
			if (!unlock.ok) problems.push(unlock.message);
		}
		if (st.jobsWas !== undefined) {
			const back = await this.step(input, "CLUSTER_SET_SCHEDULED_JOBS", { denied: st.jobsWas ?? false });
			if (!back.ok) problems.push(back.message);
		}
		const all = [...problems, ...unknown];
		await this.remember(input.commandId, { ...st, ...(problems.length ? {} : { restored: true }), ...(all.length ? { problems: all } : {}) });
		if (all.length) {
			this.log?.warn({ ...ctx, problems: all }, "монопольная операция: база не возвращена в прежнее состояние — проверьте вход и регламентные задания");
		} else {
			this.log?.info({ ...ctx, operation }, "монопольная операция: вход открыт, регламентные задания как прежде");
		}
		return all;
	}
}

/**
 * ВОССТАНОВЛЕНИЕ НА СТАРТЕ: команды монопольных операций, у которых база не возвращена (`exclusive` без
 * `restored`). Ещё не выданная — сразу отказ EXCLUSIVE_INTERRUPTED (КР-12 п. 3); выданная — дождаться; затем
 * вернуть базу. Идёт в фоне, старт не держит; в цепочке агента — новая операция по той же базе ждёт возврата.
 */
export async function recoverExclusive(
	queue: ExclusiveQueue & Pick<CommandQueue, "listExclusivePending"> & Partial<Pick<CommandQueue, "ibParallel">>,
	log?: ExclusiveLog,
	lanes: ExclusiveLanes = exclusiveLanes,
): Promise<number> {
	const rows: ExclusivePendingRow[] = (await queue.listExclusivePending([...new Set([...EXCLUSIVE_TYPES, ...EXCLUSIVE_STATE_TYPES])]))
		// Операция, которую уже ведёт этот процесс (запущена после старта), — не брошенная.
		.filter((r) => !!r.base_key && !managedHere.has(r.id));
	if (!rows.length) return 0;
	log?.info({ commands: rows.map((r) => r.id) }, "монопольные операции: возвращаю базы, брошенные прошлым запуском");
	const runner = new ExclusiveRunner(queue, log);
	for (const row of rows) {
		const input: ExclusiveInput = {
			agent: { id: row.agent_id, organizationUuid: row.organization_uuid, role: "admin", capabilities: [] },
			baseKey: row.base_key!, commandId: row.id, userUuid: null, queueWaitSeconds: 3600,
		};
		void lanes.run(row.agent_id, row.base_key!, queue.ibParallel ?? 1, async () => {
			let operation: CommandRow["state"] | null = row.state;
			// Не выдана — и уже не будет: выпустить её некому, а выдать без подготовки нельзя.
			if (operation === "queued") {
				operation = (await queue.failQueued(row.id, { ...EXCLUSIVE_INTERRUPTED })) ? "failed" : (await queue.get(row.id))?.state ?? null;
			}
			if (operation === "dispatched") {
				operation = (await awaitCommand(queue, row.id, row.ttl_seconds ?? DEFAULT_COMMAND_TTL_SECS, 0))?.state ?? null;
			}
			await runner.restore(input, row.exclusive ?? {}, operation);
		}).catch((e: unknown) => log?.warn({ commandId: row.id, err: e instanceof Error ? e.message : String(e) }, "монопольная операция: восстановление не удалось"));
	}
	return rows.length;
}
