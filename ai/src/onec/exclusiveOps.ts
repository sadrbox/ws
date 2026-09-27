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
 * КАК. Команда операции ставится в задание сразу — с отложенной выдачей (`availableAt`), чтобы в задании
 * она была видна как «в очереди», — а подготовка идёт рядом кластерными командами того же агента (они не
 * занимают место базы). Подготовка удалась — операция выпускается (`queue.release`); нет — операция
 * завершается отказом с причиной (`queue.failQueued`), и задание показывает её у этой базы. Что бы ни
 * случилось с операцией, вход открывается и прежний запрет заданий возвращается по `was`.
 *
 * ЧЕГО НЕ ДЕЛАЕТ. Не ждёт «выхода пользователей» по-хорошему: расширение ставят в окно обслуживания или
 * руками прямо сейчас — и в обоих случаях сеансы снимаются. Агент без `cluster.admin` подготовки не
 * получает: операция выпускается сразу, как раньше, и об этом пишется в журнал.
 *
 * Проверить потом: повтор команды задания (`queue.retryBusy`, «база занята») копирует команду без
 * подготовки; для расширений `IB_BUSY` не встречался, но при появлении повтор надо вести через эту же
 * последовательность.
 */
import { DEFAULT_COMMAND_TTL_SECS, agentCanRun, findAdminCommand, runsInsideBase, type AdminCommandSpec } from "../commands/admin.ts";
import type { CommandQueue, CommandRow, ExclusivePendingRow } from "../commands/queue.ts";
import type { AgentRole } from "../agents/service.ts";
import { unwrapData } from "./accountingChecks.ts";

/** Что идёт под этой последовательностью. */
export const EXCLUSIVE_TYPES: ReadonlySet<string> = new Set(["IB_INSTALL_EXTENSION", "IB_DELETE_EXTENSION"]);

/** Кластерные команды подготовки; агент без любой из них подготовки не получает. */
const PREP_TYPES = ["CLUSTER_SET_SCHEDULED_JOBS", "CLUSTER_SET_SESSIONS_LOCK", "CLUSTER_LIST_SESSIONS", "CLUSTER_TERMINATE_SESSION"] as const;

const LOCK_MESSAGE = "Идёт установка расширения BuhProf AI — вход временно закрыт";

export type ExclusiveQueue = Pick<CommandQueue, "enqueue" | "waitResult" | "release" | "failQueued" | "patchPayload">;

/**
 * Состояние шагов — в payload команды операции (`exclusive`), а не в памяти: сервис перезапустился посреди
 * ожидания — и база осталась бы закрытой навсегда (так и случилось 27.09 в 07:14). По этому состоянию
 * `recoverExclusive` на старте возвращает брошенные базы.
 */
export type ExclusiveState = { jobsWas?: boolean | null; locked?: boolean; restored?: boolean; problems?: string[] };

export type ExclusiveAgent = { id: string; organizationUuid: string; role: AgentRole; capabilities: string[] };

export type ExclusiveLog = { info: (o: object, msg: string) => void; warn: (o: object, msg: string) => void };

export type ExclusiveInput = {
	agent: ExclusiveAgent;
	baseKey: string;
	/** Отложенная команда операции, уже привязанная к заданию. */
	commandId: string;
	userUuid: string | null;
	/** Сколько подготовительная команда может ждать очереди агента, с. */
	queueWaitSeconds: number;
};

export type ExclusiveOutcome = {
	/** Подготовка делалась (у агента есть кластерные команды). */
	prepared: boolean;
	/** Операция выпущена агенту. */
	released: boolean;
	/** Сколько сеансов снято. */
	terminated: number;
	/** Итог самой операции: состояние команды или null, если её не выпускали. */
	operation: CommandRow["state"] | null;
	/** Что не удалось вернуть после операции — пусто, если всё вернулось. */
	restoreProblems: string[];
	note: string | null;
};

type StepResult = { ok: true; data: Record<string, unknown> } | { ok: false; message: string };

const asRecord = (v: unknown): Record<string, unknown> =>
	v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export class ExclusiveRunner {
	private readonly queue: ExclusiveQueue;
	private readonly log?: ExclusiveLog;
	constructor(queue: ExclusiveQueue, log?: ExclusiveLog) { this.queue = queue; this.log = log; }

	/** Есть ли у агента всё для подготовки. */
	static canPrepare(agent: ExclusiveAgent): boolean {
		return PREP_TYPES.every((t) => { const s = findAdminCommand(t); return !!s && agentCanRun(agent, s); });
	}

	private async step(input: ExclusiveInput, type: (typeof PREP_TYPES)[number], payload: Record<string, unknown>): Promise<StepResult> {
		const spec = findAdminCommand(type) as AdminCommandSpec;
		const ttl = spec.ttlSeconds ?? DEFAULT_COMMAND_TTL_SECS;
		let id: string;
		try {
			const cmd = await this.queue.enqueue({
				agentId: input.agent.id, organizationUuid: input.agent.organizationUuid, baseKey: input.baseKey,
				type, payload: { ...payload, baseKey: input.baseKey }, userUuid: input.userUuid,
				ttlSeconds: ttl, queueWaitSeconds: input.queueWaitSeconds, inBase: runsInsideBase(spec), priority: 10,
			});
			id = cmd.id;
		} catch (e) {
			return { ok: false, message: `${spec.title}: команда не поставлена в очередь — ${e instanceof Error ? e.message : String(e)}` };
		}
		const done = await awaitCommand(this.queue, id, ttl, input.queueWaitSeconds);
		if (!done || done.state === "queued" || done.state === "dispatched") {
			return { ok: false, message: `${spec.title}: агент не ответил за отведённое время` };
		}
		if (done.state !== "done") {
			return { ok: false, message: `${spec.title}: ${done.error?.message || done.error?.code || done.state}` };
		}
		return { ok: true, data: asRecord(unwrapData(done.result)) };
	}

	/**
	 * Провести операцию `input.commandId` под монопольным доступом. Не бросает: любой исход — в журнале и в
	 * самой команде задания.
	 */
	async run(input: ExclusiveInput, opSpec: Pick<AdminCommandSpec, "ttlSeconds">): Promise<ExclusiveOutcome> {
		const out: ExclusiveOutcome = { prepared: false, released: false, terminated: 0, operation: null, restoreProblems: [], note: null };
		const ctx = { baseKey: input.baseKey, commandId: input.commandId, agentId: input.agent.id };

		if (!ExclusiveRunner.canPrepare(input.agent)) {
			out.note = "у агента нет кластерных команд — операция выпущена без закрытия базы";
			out.released = await this.queue.release(input.commandId);
			this.log?.warn({ ...ctx }, `монопольная операция: ${out.note}`);
			return out;
		}
		out.prepared = true;

		let jobsWas: boolean | null | undefined; // undefined — запрет не ставился; null — ставился, прежнее неизвестно
		let locked = false;
		const fail = async (message: string) => {
			out.note = message;
			await this.queue.failQueued(input.commandId, {
				code: "EXCLUSIVE_PREP_FAILED",
				message: `Базу не удалось закрыть для монопольной операции: ${message}. Команда агенту не выдавалась.`,
			});
			this.log?.warn({ ...ctx, reason: message }, "монопольная операция: подготовка не удалась");
		};

		try {
			// 1. Регламентные задания — иначе следующее по расписанию откроет новый сеанс посреди установки.
			const jobs = await this.step(input, "CLUSTER_SET_SCHEDULED_JOBS", { denied: true });
			if (!jobs.ok) { await fail(jobs.message); return out; }
			jobsWas = typeof jobs.data.was === "boolean" ? jobs.data.was : null;
			await this.remember(input.commandId, { jobsWas, locked: false });

			// 2. Вход закрыт — новые пользователи не зайдут, пока идёт операция.
			const lock = await this.step(input, "CLUSTER_SET_SESSIONS_LOCK", { enabled: true, message: LOCK_MESSAGE });
			if (!lock.ok) { await fail(lock.message); return out; }
			locked = true;
			await this.remember(input.commandId, { jobsWas, locked: true });

			// 3. Оставшиеся сеансы (пользователи, фоновые задания) — снять. Строки — словари `rac`; сеанс адресуется
			// UUID из поля `session`; строку без него пропускаем и говорим об этом.
			const list = await this.step(input, "CLUSTER_LIST_SESSIONS", {});
			if (!list.ok) { await fail(list.message); return out; }
			const items = Array.isArray(list.data.items) ? list.data.items.map(asRecord) : [];
			const problems: string[] = [];
			for (const it of items) {
				const sessionId = typeof it.session === "string" ? it.session.trim() : "";
				if (!UUID.test(sessionId)) { problems.push(`сеанс без идентификатора кластера (${String(it["session-id"] ?? it.session ?? "?")})`); continue; }
				const t = await this.step(input, "CLUSTER_TERMINATE_SESSION", { sessionId });
				if (t.ok) out.terminated += 1; else problems.push(t.message);
			}
			if (problems.length) { await fail(`не сняты сеансы: ${problems.join("; ")}`); return out; }

			// 4. Операция.
			out.released = await this.queue.release(input.commandId);
			if (!out.released) { out.note = "команда операции уже не в очереди (отменена или истекла)"; return out; }
			this.log?.info({ ...ctx, terminated: out.terminated }, "монопольная операция: база закрыта, команда выпущена");
			const done = await awaitCommand(this.queue, input.commandId, opSpec.ttlSeconds ?? DEFAULT_COMMAND_TTL_SECS, input.queueWaitSeconds);
			out.operation = done?.state ?? null;
			return out;
		} finally {
			// 5. Вернуть как было — при любом исходе.
			out.restoreProblems = await this.restore(input, { jobsWas, locked }, out.operation);
		}
	}

	/** Запомнить состояние шагов в команде; сбой записи — не повод бросать операцию (в журнал). */
	private async remember(commandId: string, st: ExclusiveState): Promise<void> {
		try { await this.queue.patchPayload(commandId, { exclusive: st }); } catch (e) {
			this.log?.warn({ commandId, err: e instanceof Error ? e.message : String(e) }, "монопольная операция: состояние не записано");
		}
	}

	/**
	 * Вернуть базу: открыть вход (если закрывали), вернуть запрет заданий по `was` (если ставили). Порядок
	 * обратный подготовке. Итог — в команде (`exclusive.restored`), чтобы восстановление на старте не повторяло.
	 */
	async restore(input: ExclusiveInput, st: { jobsWas: boolean | null | undefined; locked: boolean }, operation: CommandRow["state"] | null = null): Promise<string[]> {
		const ctx = { baseKey: input.baseKey, commandId: input.commandId, agentId: input.agent.id };
		const problems: string[] = [];
		if (st.locked) {
			const unlock = await this.step(input, "CLUSTER_SET_SESSIONS_LOCK", { enabled: false });
			if (!unlock.ok) problems.push(unlock.message);
		}
		if (st.jobsWas !== undefined) {
			const back = await this.step(input, "CLUSTER_SET_SCHEDULED_JOBS", { denied: st.jobsWas ?? false });
			if (!back.ok) problems.push(back.message);
		}
		await this.remember(input.commandId, { jobsWas: st.jobsWas ?? null, locked: st.locked, restored: true, ...(problems.length ? { problems } : {}) });
		if (problems.length) {
			this.log?.warn({ ...ctx, problems }, "монопольная операция: база не возвращена в прежнее состояние — проверьте вход и регламентные задания");
		} else {
			this.log?.info({ ...ctx, operation }, "монопольная операция: вход открыт, регламентные задания как прежде");
		}
		return problems;
	}
}

/**
 * ВОССТАНОВЛЕНИЕ НА СТАРТЕ: команды монопольных операций, у которых база не возвращена (`exclusive` без
 * `restored`). Ещё идущие — дождаться и вернуть; завершённые — вернуть сразу. Идёт в фоне, старт не держит.
 */
export async function recoverExclusive(
	queue: ExclusiveQueue & Pick<CommandQueue, "listExclusivePending">,
	log?: ExclusiveLog,
): Promise<number> {
	const rows: ExclusivePendingRow[] = await queue.listExclusivePending([...EXCLUSIVE_TYPES]);
	if (!rows.length) return 0;
	log?.info({ commands: rows.map((r) => r.id) }, "монопольные операции: возвращаю базы, брошенные прошлым запуском");
	const runner = new ExclusiveRunner(queue, log);
	for (const row of rows) {
		if (!row.base_key) continue;
		const input: ExclusiveInput = {
			agent: { id: row.agent_id, organizationUuid: row.organization_uuid, role: "admin", capabilities: [] },
			baseKey: row.base_key, commandId: row.id, userUuid: null, queueWaitSeconds: 3600,
		};
		const st = { jobsWas: row.exclusive?.jobsWas, locked: row.exclusive?.locked === true };
		void (async () => {
			let operation: CommandRow["state"] | null = row.state;
			if (row.state === "queued" || row.state === "dispatched") {
				const done = await awaitCommand(queue, row.id, row.ttl_seconds ?? DEFAULT_COMMAND_TTL_SECS, 3600);
				operation = done?.state ?? null;
			}
			await runner.restore(input, st, operation);
		})().catch((e: unknown) => log?.warn({ commandId: row.id, err: e instanceof Error ? e.message : String(e) }, "монопольная операция: восстановление не удалось"));
	}
	return rows.length;
}
