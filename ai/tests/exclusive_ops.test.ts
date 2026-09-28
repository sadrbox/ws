// Монопольная операция по базе (exclusiveOps.ts, 27.09): операция выпускается агенту только после запрета
// регламентных заданий, закрытия входа и снятия сеансов, а после — вход открывается и запрет возвращается по `was`.
// КР-12 аудита 27.09: повторы «база занята» ведёт тот же раннер, база готовится в своей очереди цепочки агента,
// восстановление не держит базу закрытой и не выдаёт операцию без подготовки, остановка задания останавливает
// подготовку. Очередь подставная, но с состоянием: команды не выполняются, ответы задаёт тест.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	ExclusiveLanes, ExclusiveRunner, EXCLUSIVE_STATE_TYPES, EXCLUSIVE_TYPES, escalateBusyToExclusive, escalatesOnBusy, exclusiveLanes,
	recoverExclusive, retriedByRunner, superviseExclusive, type ExclusiveQueue, type ExclusiveState,
} from "../src/onec/exclusiveOps.ts";
import { BATCHABLE, startBatch, type BatchDeps } from "../src/onec/batchRunner.ts";
import { buildAdminPayload, findAdminCommand } from "../src/commands/admin.ts";
import type { CommandQueue, CommandRow, CommandState, EnqueueInput, ExclusivePendingRow } from "../src/commands/queue.ts";

const JOBS = "CLUSTER_SET_SCHEDULED_JOBS";
const LOCK = "CLUSTER_SET_SESSIONS_LOCK";
const LIST = "CLUSTER_LIST_SESSIONS";
const TERM = "CLUSTER_TERMINATE_SESSION";
const S1 = "11111111-2222-3333-4444-555555555555";
const S2 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const agent = { id: "adm", organizationUuid: "org-1", role: "admin" as const, disabled: false,
	capabilities: ["cluster.admin", "ib.admin", JOBS, LOCK, LIST, TERM, "IB_INSTALL_EXTENSION", "IB_BACKUP"] };

type Answer = { state: CommandState; result?: unknown; error?: { code: string; message: string } };
type Rec = { id: string; type: string; payload: Record<string, unknown>; inBase: boolean; availableAt: Date | null; hold: boolean; requestId: string | null; baseKey: string | null };
type Row = {
	id: string; type: string; state: CommandState; payload: Record<string, unknown>; batch_id: string | null; attempt: number;
	request_id: string | null; agent_id: string; retried_by: string | null; result: unknown; error: { code: string; message: string } | null;
	expires_at: Date; dispatched_at: Date | null; ttl_seconds: number;
	/** Команда операции: удержана до выпуска, ответ — по сценарию попыток (`opAnswer`). */
	op: boolean; released: boolean;
};

const DONE: Answer = { state: "done", result: {} };
const BUSY: Answer = { state: "failed", error: { code: "IB_BUSY", message: "База данных заблокирована: приложение Фоновое задание" } };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const sessions = (...ids: string[]): Answer => ({ state: "done", result: { items: ids.map((session) => ({ session, user: "Иванов", "app-id": "1CV8C" })) } });
const tick = () => new Promise((res) => setTimeout(res, 5));

/** Подставная очередь с состоянием команд: ответ шага — по типу (или по порядку), ответ операции — по попыткам. */
type StepAnswer = Answer | Answer[] | ((row: Row) => Answer);

function fakeQueue(answers: Record<string, StepAnswer> = {}, pending: ExclusivePendingRow[] = []) {
	const rows = new Map<string, Row>();
	const enqueued: Rec[] = [];
	const released: string[] = [];
	const failed: { id: string; code: string; message: string }[] = [];
	const patches: { id: string; patch: Record<string, unknown> }[] = [];
	const canceled: string[] = [];
	const retries: { id: string; hold: boolean }[] = [];
	const opAnswers = new Map<string, Answer[]>();
	const hooks: {
		afterStep?: (row: Row) => void; afterRetry?: (copyId: string) => void;
		/** Ответ агента по операции принят — как обработчик результата (agentRouter). */
		afterOp?: (row: Row) => Promise<void> | void;
		/** Операция выпущена агенту. */
		onRelease?: (id: string) => void;
	} = {};
	let n = 0;

	const make = (id: string, over: Partial<Row>): Row => {
		const row: Row = {
			id, type: "IB_BACKUP", state: "queued", payload: {}, batch_id: null, attempt: 1, request_id: null, agent_id: agent.id,
			retried_by: null, result: null, error: null, expires_at: new Date(Date.now() + 3600_000), dispatched_at: null, ttl_seconds: 900,
			op: false, released: false, ...over,
		};
		rows.set(id, row);
		return row;
	};
	const settle = (row: Row, a: Answer) => {
		row.state = a.state;
		row.result = a.result ?? null;
		row.error = a.error ?? null;
		if (a.state !== "queued") row.dispatched_at = new Date();
	};
	const view = (row: Row) => ({ ...row }) as unknown as CommandRow;

	const q: ExclusiveQueue & Pick<CommandQueue, "listExclusivePending"> = {
		enqueue: async (i: EnqueueInput) => {
			if (i.requestId) {
				const same = [...rows.values()].find((r) => r.request_id === i.requestId && (r.state === "queued" || r.state === "dispatched"));
				if (same) return view(same);
			}
			const id = `cmd-${++n}`;
			const row = make(id, { type: i.type, payload: clone(i.payload), request_id: i.requestId ?? null, op: i.hold === true });
			enqueued.push({ id, type: i.type, payload: clone(i.payload), inBase: !!i.inBase, availableAt: i.availableAt ?? null,
				hold: i.hold === true, requestId: i.requestId ?? null, baseKey: i.baseKey ?? null });
			return view(row);
		},
		waitResult: async (id: string) => {
			const row = rows.get(id);
			if (!row) return null;
			if (row.state === "queued" && !row.op) {
				const a = answers[row.type];
				settle(row, typeof a === "function" ? a(row) : Array.isArray(a) ? (a.shift() ?? DONE) : (a ?? DONE));
				hooks.afterStep?.(row);
			} else if (row.state === "queued" && row.released) {
				settle(row, opAnswers.get(id)?.shift() ?? { state: "done", result: { ok: true } });
				await hooks.afterOp?.(row);
			}
			return view(row);
		},
		get: async (id: string) => (rows.has(id) ? view(rows.get(id)!) : null),
		release: async (id: string) => {
			const r = rows.get(id);
			if (!r || r.state !== "queued") return false;
			r.released = true;
			released.push(id);
			hooks.onRelease?.(id);
			return true;
		},
		failQueued: async (id: string, e: { code: string; message: string }) => {
			const r = rows.get(id);
			if (!r || r.state !== "queued") return false;
			r.state = "failed";
			r.error = { code: e.code, message: e.message };
			failed.push({ id, code: e.code, message: e.message });
			return true;
		},
		patchPayload: async (id: string, patch: Record<string, unknown>) => {
			patches.push({ id, patch: clone(patch) });
			const r = rows.get(id);
			if (r) r.payload = { ...r.payload, ...clone(patch) };
		},
		retryBusy: async (id: string, _wait: number, opts: { hold?: boolean } = {}) => {
			const src = rows.get(id);
			if (!src || src.state !== "failed" || !src.batch_id || src.retried_by || src.attempt >= 3) return null;
			const next = `${id.replace(/-r\d+$/, "")}-r${src.attempt + 1}`;
			const payload = clone(src.payload);
			if (!opts.hold) delete payload.exclusive;
			make(next, { type: src.type, payload, batch_id: src.batch_id, attempt: src.attempt + 1, op: true });
			src.retried_by = next;
			if (opts.hold && src.payload.exclusive && typeof src.payload.exclusive === "object") {
				(src.payload.exclusive as Record<string, unknown>).movedTo = next;
			}
			retries.push({ id, hold: opts.hold === true });
			hooks.afterRetry?.(next);
			return next;
		},
		cancel: async (ids: string[]) => {
			let k = 0;
			for (const id of ids) {
				const r = rows.get(id);
				if (r && r.state === "queued") { r.state = "canceled"; canceled.push(id); k += 1; }
			}
			return k;
		},
		getByRequestId: async (_agentId: string, requestId: string) => {
			const list = [...rows.values()].filter((r) => r.request_id === requestId);
			return list.length ? view(list[list.length - 1]!) : null;
		},
		listExclusivePending: async () => pending,
	};
	return {
		q, rows, enqueued, released, failed, patches, canceled, retries, hooks,
		/** Команда операции в задании — удержанная, как её ставит задание. */
		op: (id: string, over: Partial<Row> = {}) => make(id, { op: true, batch_id: "batch-1", payload: { baseKey: "buh", exclusive: {} }, ...over }),
		/** Ответы агента на попытки операции по порядку выпуска. */
		opAnswer: (id: string, ...a: Answer[]) => { opAnswers.set(id, a); },
		/** Команда шага, поставленная прошлым запуском (для восстановления). */
		stepRow: (requestId: string, over: Partial<Row>) => make(`prev-${requestId}`, { type: JOBS, request_id: requestId, ...over }),
		row: (id: string) => rows.get(id)!,
		stop: (id: string) => { const r = rows.get(id); if (r && r.state === "queued") r.state = "canceled"; },
		attach: async (batchId: string, id: string) => { const r = rows.get(id); if (r) r.batch_id = batchId; },
	};
}

const input = (commandId: string) => ({ agent, baseKey: "buh", commandId, userUuid: "u1", queueWaitSeconds: 60 });
const OP = { ttlSeconds: 900 };
const typesOf = (f: { enqueued: Rec[] }) => f.enqueued.map((e) => e.type);
const stateOf = (p: { patch: Record<string, unknown> }) => p.patch.exclusive as ExclusiveState;

test("КР-1: расширения больше не идут под подготовкой (COM), но их прежнее состояние восстанавливается; агент без кластерных команд подготовки не получает", () => {
	assert.equal(EXCLUSIVE_TYPES.has("IB_INSTALL_EXTENSION"), false, "закрытый вход не пускал COM-соединение агента");
	assert.equal(EXCLUSIVE_TYPES.has("IB_DELETE_EXTENSION"), false);
	assert.ok(EXCLUSIVE_STATE_TYPES.has("IB_INSTALL_EXTENSION") && EXCLUSIVE_STATE_TYPES.has("IB_DELETE_EXTENSION"));
	assert.ok(ExclusiveRunner.canPrepare(agent));
	assert.equal(ExclusiveRunner.canPrepare({ ...agent, capabilities: ["ib.admin"] }), false);
});

test("порядок: запрет заданий → закрыть вход → сеансы сняты → выпуск операции → вход открыт → задания как были", async () => {
	const f = fakeQueue({
		[JOBS]: [{ state: "done", result: { ok: true, denied: true, was: false } }, DONE],
		[LIST]: { state: "done", result: { items: [
			{ session: S1, user: "Иванов", "app-id": "1CV8C" },
			{ session: S2, user: "", "app-id": "BackgroundJob" },
		] } },
	});
	f.op("op");
	const out = await new ExclusiveRunner(f.q).run(input("op"), OP);

	assert.deepEqual(typesOf(f), [JOBS, LOCK, LIST, TERM, TERM, LOCK, JOBS]);
	assert.equal(f.enqueued[0].payload.denied, true);
	assert.equal(f.enqueued[0].requestId, "exclusive:op:jobs", "запрет — с requestId: его итог узнаётся и после перезапуска");
	assert.equal(f.enqueued[1].payload.enabled, true);
	assert.equal(f.enqueued[1].requestId, "exclusive:op:lock");
	assert.equal(f.enqueued[3].payload.sessionId, S1);
	assert.equal(f.enqueued[5].payload.enabled, false, "вход открывается после операции");
	assert.equal(f.enqueued[6].payload.denied, false, "запрет заданий возвращается по was");
	assert.ok(f.enqueued.every((e) => e.inBase === false && e.payload.baseKey === "buh"), "подготовка не занимает место базы");
	assert.deepEqual(f.released, ["op"]);
	assert.equal(f.failed.length, 0);
	assert.equal(out.prepared, true);
	assert.equal(out.terminated, 2);
	assert.equal(out.operation, "done");
	assert.equal(out.attempts, 1);
	assert.deepEqual(out.restoreProblems, []);
	// Состояние шагов — в команде: намерение до каждого шага, итог после него, возврат в конце (КР-12 п. 3).
	const req = { jobsReq: "exclusive:op:jobs" };
	const lockReq = "exclusive:op:lock";
	assert.deepEqual(f.patches.map(stateOf), [
		req,
		{ ...req, jobsWas: false },
		{ ...req, jobsWas: false, lockReq },
		{ ...req, jobsWas: false, lockReq, locked: true },
		{ ...req, jobsWas: false, lockReq, locked: true, restored: true },
	]);
});

test("не закрылся вход — операция агенту не выдаётся, отказ с причиной у команды задания, задания возвращены", async () => {
	const f = fakeQueue({
		[JOBS]: [{ state: "done", result: { was: true } }, DONE],
		[LOCK]: { state: "failed", error: { code: "RAC_ERROR", message: "не удалось закрыть базу для входа" } },
	});
	f.op("op");
	const out = await new ExclusiveRunner(f.q).run(input("op"), OP);
	assert.deepEqual(f.released, []);
	assert.equal(f.failed.length, 1);
	assert.equal(f.failed[0].code, "EXCLUSIVE_PREP_FAILED");
	assert.match(f.failed[0].message, /не удалось закрыть базу для входа/);
	assert.match(f.failed[0].message, /агенту не выдавалась/);
	// Запрет ставился (was=true) — возвращается прежнее значение; вход не открываем: закрытие отказало.
	assert.deepEqual(typesOf(f), [JOBS, LOCK, JOBS]);
	assert.equal(f.enqueued[2].payload.denied, true);
	assert.equal(out.released, false);
	assert.equal(out.operation, null);
});

test("сеанс не снялся или без идентификатора — операция не выпускается, вход открывается обратно", async () => {
	const f = fakeQueue({
		[JOBS]: { state: "done", result: { was: false } },
		[LIST]: { state: "done", result: { items: [{ "session-id": "12", user: "Петров" }] } },
	});
	f.op("op");
	const out = await new ExclusiveRunner(f.q).run(input("op"), OP);
	assert.deepEqual(f.released, []);
	assert.match(f.failed[0].message, /сеанс без идентификатора кластера \(12\)/);
	assert.equal(f.enqueued[f.enqueued.length - 2].type, LOCK);
	assert.equal(f.enqueued[f.enqueued.length - 2].payload.enabled, false, "вход открыт обратно");
	assert.equal(out.terminated, 0);
});

test("операция упала у агента — база всё равно возвращается; сбой возврата попадает в итог", async () => {
	const f = fakeQueue({
		[JOBS]: [{ state: "done", result: { was: false } }, { state: "failed", error: { code: "RAC_ERROR", message: "rac не ответил" } }],
		[LIST]: { state: "done", result: { items: [] } },
	});
	f.op("op");
	f.opAnswer("op", { state: "failed", error: { code: "IB_ERROR", message: "Расширение с таким именем уже существует!" } });
	const out = await new ExclusiveRunner(f.q).run(input("op"), OP);
	assert.deepEqual(f.released, ["op"]);
	assert.equal(out.operation, "failed");
	assert.deepEqual(f.retries, [], "не «база занята» — не повторяется");
	assert.deepEqual(out.restoreProblems, ["Запрет регламентных заданий: rac не ответил"]);
	assert.equal(f.enqueued[f.enqueued.length - 2].payload.enabled, false, "вход открыт");
	// Возврат не прошёл — отметки restored нет: восстановление на старте попробует ещё раз.
	assert.equal(stateOf(f.patches[f.patches.length - 1]).restored, undefined);
});

test("агент без кластерных команд: операция выпускается сразу, подготовки нет, повтор у неё обычный", async () => {
	const f = fakeQueue({});
	f.op("op");
	const out = await new ExclusiveRunner(f.q).run({ ...input("op"), agent: { ...agent, capabilities: ["ib.admin", "IB_INSTALL_EXTENSION"] } }, OP);
	assert.deepEqual(f.enqueued, []);
	assert.deepEqual(f.released, ["op"]);
	assert.equal(out.prepared, false);
	assert.match(out.note ?? "", /без закрытия базы/);
	assert.deepEqual(stateOf(f.patches[0]), { prepared: false, restored: true });
	assert.equal(retriedByRunner(f.row("op").payload), false, "без подготовки «база занята» повторяет обработчик результата");
});

test("КР-1: задание «Установить расширение» ставится сразу, без закрытия базы — агенту уходит одна команда", async () => {
	assert.ok(BATCHABLE.has("IB_INSTALL_EXTENSION"));
	const f = fakeQueue({});
	const deps = {
		agents: { pickAdminAgent: async () => agent },
		queue: f.q,
		batches: { create: async () => "batch-1", attach: f.attach, noteSkipped: async () => {} },
		bases: { findByKeyGlobal: async (key: string) => ({ key, disabled: false, clusterStatus: "ONLINE" }) },
	} as unknown as BatchDeps;
	const r = await startBatch(deps, {
		type: "IB_INSTALL_EXTENSION", baseKeys: ["buh"], payload: { name: "buhprof_api", contentBase64: "AAAA", safeMode: true },
		organizationUuid: "org-1", userUuid: "u1",
	});
	assert.ok(!("error" in r));
	assert.equal(r.queued, 1);
	// Подготовке дать шанс начаться — её быть не должно.
	await new Promise((res) => setTimeout(res, 20));
	assert.deepEqual(typesOf(f), ["IB_INSTALL_EXTENSION"], "ни запрета заданий, ни закрытия входа");
	assert.equal(f.enqueued[0].availableAt, null, "выдаётся сразу");
	assert.equal(f.enqueued[0].hold, false);
	assert.equal(f.enqueued[0].payload.exclusive, undefined);
	assert.deepEqual(f.released, []);
});

// ── КР-12 п. 1: повтор «база занята» ведёт тот же раннер ─────────────────────────────────────────────────────────

test("КР-12 п. 1: «база занята» — копию ставит и выпускает тот же раннер; запрет и вход — один раз, возврат — один раз в конце", async () => {
	const f = fakeQueue({
		[JOBS]: [{ state: "done", result: { was: false } }, DONE],
		[LIST]: [sessions(S1), sessions(S2)],
	});
	f.op("op");
	f.opAnswer("op", BUSY);
	f.opAnswer("op-r2", { state: "done", result: { ok: true } });
	const out = await new ExclusiveRunner(f.q).run(input("op"), OP);

	assert.deepEqual(typesOf(f), [JOBS, LOCK, LIST, TERM, LIST, TERM, LOCK, JOBS],
		"сеансы снимаются перед каждой попыткой, а база закрывается и возвращается один раз");
	assert.deepEqual(f.enqueued.filter((e) => e.type === JOBS).map((e) => e.payload.denied), [true, false],
		"запрет возвращается к значению ДО операции, а не к запрету самой операции (прежде «was=true» и запрет навсегда)");
	assert.deepEqual(f.enqueued.filter((e) => e.type === LOCK).map((e) => e.payload.enabled), [true, false],
		"вход не открывается между попытками");
	assert.deepEqual(f.retries, [{ id: "op", hold: true }], "копия удержана до нового снятия сеансов");
	assert.deepEqual(f.released, ["op", "op-r2"]);
	assert.equal(out.attempts, 2);
	assert.equal(out.commandId, "op-r2");
	assert.equal(out.operation, "done");
	assert.equal(out.terminated, 2);
	// Состояние ушло в копию; исходная отмечена переданной — восстановление увидит одну команду операции.
	assert.equal((f.row("op").payload.exclusive as ExclusiveState).movedTo, "op-r2");
	assert.equal((f.row("op-r2").payload.exclusive as ExclusiveState).restored, true);
	assert.ok(f.patches.some((p) => p.id === "op-r2" && typeof stateOf(p).releaseAt === "string"), "время выпуска копии — строке задания");
	// Обработчик результата (agentRouter) копию не ставит и второго раннера не запускает.
	assert.equal(retriedByRunner(f.row("op").payload), true);
	assert.equal(retriedByRunner(f.row("op-r2").payload), true);
	assert.equal(retriedByRunner({ baseKey: "buh" }), false);
	assert.equal(retriedByRunner({ baseKey: "buh", exclusive: { prepared: false, restored: true } }), false);
});

test("КР-12 п. 1: три отказа подряд — две копии, попытки кончились, база возвращается один раз", async () => {
	const f = fakeQueue({ [JOBS]: [{ state: "done", result: { was: true } }, DONE], [LIST]: { state: "done", result: { items: [] } } });
	f.op("op");
	f.opAnswer("op", BUSY);
	f.opAnswer("op-r2", BUSY);
	f.opAnswer("op-r3", BUSY);
	const out = await new ExclusiveRunner(f.q).run(input("op"), OP);
	assert.deepEqual(f.released, ["op", "op-r2", "op-r3"]);
	assert.deepEqual(f.retries.map((r) => r.id), ["op", "op-r2"]);
	assert.deepEqual(typesOf(f), [JOBS, LOCK, LIST, LIST, LIST, LOCK, JOBS]);
	assert.equal(f.enqueued[f.enqueued.length - 1].payload.denied, true, "запрет был и до операции — он и возвращается");
	assert.equal(out.attempts, 3);
	assert.equal(out.operation, "failed");
});

test("КР-12 п. 1: кластер в миниатюре — база возвращается в исходное состояние, а каждая попытка идёт в закрытую базу", async () => {
	// Агент отвечает по текущему состоянию базы: `was` — запрет ДО этой команды. Прежде обработчик результата ставил
	// копию и второй раннер, пока первый возвращал базу: второй читал запрет первого как «прежнее значение», и в конце
	// задания оставались запрещёнными навсегда (на `_transition` — с 07:14 27.09).
	const base = { jobsDenied: false, locked: false };
	const f = fakeQueue({
		[JOBS]: (row) => { const was = base.jobsDenied; base.jobsDenied = row.payload.denied === true; return { state: "done", result: { ok: true, was } }; },
		[LOCK]: (row) => { base.locked = row.payload.enabled === true; return DONE; },
		[LIST]: { state: "done", result: { items: [] } },
	});
	f.op("op");
	f.opAnswer("op", BUSY);
	f.opAnswer("op-r2", { state: "failed", error: { code: "IB_TIMEOUT", message: "ibcmd не ответил за 180 с" } });
	f.opAnswer("op-r3", { state: "done", result: { ok: true } });
	const during: (typeof base)[] = [];
	f.hooks.onRelease = () => { during.push({ ...base }); };
	// Обработчик результата (agentRouter): «база занята» у команды задания повторяет сам, только если её не ведёт раннер.
	const plain: string[] = [];
	f.hooks.afterOp = async (row) => {
		if (row.state === "failed" && !retriedByRunner(row.payload)) plain.push((await f.q.retryBusy(row.id, 60)) ?? "-");
	};
	const out = await new ExclusiveRunner(f.q).run(input("op"), OP);
	assert.deepEqual(plain, [], "обработчик результата копию не ставил");
	assert.deepEqual(f.released, ["op", "op-r2", "op-r3"]);
	assert.deepEqual(during, [
		{ jobsDenied: true, locked: true }, { jobsDenied: true, locked: true }, { jobsDenied: true, locked: true },
	], "каждая попытка — в закрытую базу с запрещёнными заданиями");
	assert.deepEqual(base, { jobsDenied: false, locked: false }, "после операции база как была");
	assert.equal(out.operation, "done");
	assert.equal(out.attempts, 3);
});

// ── КР-12 п. 2: цепочка на агента ────────────────────────────────────────────────────────────────────────────

test("КР-12 п. 2: цепочка агента — не больше предела одновременно и никогда две по одной базе", async () => {
	const lanes = new ExclusiveLanes();
	const events: string[] = [];
	const gate = () => { let open!: () => void; const p = new Promise<void>((res) => { open = res; }); return { p, open }; };
	const job = (base: string, g: { p: Promise<void> }, limit: number) =>
		lanes.run("adm", base, limit, async () => { events.push(`+${base}`); await g.p; events.push(`-${base}`); });

	const [a, b, c] = [gate(), gate(), gate()];
	const all = [job("Б1", a, 1), job("Б2", b, 1), job("Б3", c, 1)];
	await tick();
	assert.deepEqual(events, ["+Б1"], "предел 1: следующая база ждёт возврата предыдущей");
	assert.deepEqual(lanes.size("adm"), { active: 1, waiting: 2 });
	a.open(); await tick();
	assert.deepEqual(events, ["+Б1", "-Б1", "+Б2"]);
	b.open(); c.open();
	await Promise.all(all);
	assert.deepEqual(lanes.size("adm"), { active: 0, waiting: 0 });

	events.length = 0;
	const [x1, x2, y] = [gate(), gate(), gate()];
	const two = [job("X", x1, 2), job("X", x2, 2), job("Y", y, 2)];
	await tick();
	assert.deepEqual(events, ["+X", "+Y"], "предел 2: вторая операция по той же базе ждёт, другая база идёт");
	x1.open(); await tick();
	assert.ok(events.includes("+X") && events.lastIndexOf("+X") > events.indexOf("-X"));
	x2.open(); y.open();
	await Promise.all(two);
});

test("КР-12 п. 2: задание на три базы — все операции видны сразу, база закрывается только после возврата предыдущей", async () => {
	const mutable = EXCLUSIVE_TYPES as Set<string>;
	mutable.add("IB_BACKUP");
	try {
		const f = fakeQueue({ [LIST]: { state: "done", result: { items: [] } } });
		const deps = {
			agents: { pickAdminAgent: async () => agent },
			queue: f.q,
			batches: { create: async () => "batch-1", attach: f.attach, noteSkipped: async () => {} },
			bases: { findByKeyGlobal: async (key: string) => ({ key, disabled: false, clusterStatus: "ONLINE" }) },
		} as unknown as BatchDeps;
		const r = await startBatch(deps, { type: "IB_BACKUP", baseKeys: ["Б1", "Б2", "Б3"], payload: {}, organizationUuid: "org-1", userUuid: "u1" });
		assert.ok(!("error" in r));
		assert.equal(r.queued, 3);
		const ops = f.enqueued.filter((e) => e.type === "IB_BACKUP");
		assert.equal(ops.length, 3, "все операции задания стоят в нём сразу");
		assert.ok(ops.every((o) => o.hold && JSON.stringify(o.payload.exclusive) === "{}"),
			"удержаны до подготовки, состояние подготовки — с самой постановки (КР-12 п. 3)");
		for (let i = 0; i < 400 && (exclusiveLanes.size(agent.id).active || exclusiveLanes.size(agent.id).waiting || f.released.length < 3); i++) await tick();
		assert.deepEqual(f.released, ops.map((o) => o.id));
		// Шаги по базам не перемешаны: база N+1 закрывается только после того, как база N открыта и задания возвращены.
		const steps = f.enqueued.filter((e) => e.type !== "IB_BACKUP").map((e) => e.baseKey);
		const last = (k: string) => steps.lastIndexOf(k);
		const first = (k: string) => steps.indexOf(k);
		assert.ok(last("Б1") < first("Б2") && last("Б2") < first("Б3"), `шаги: ${steps.join(",")}`);
		assert.deepEqual(f.enqueued.filter((e) => e.baseKey === "Б1" && e.type !== "IB_BACKUP").map((e) => e.type), [JOBS, LOCK, LIST, LOCK, JOBS]);
	} finally {
		mutable.delete("IB_BACKUP");
	}
});

// ── КР-12 п. 3: восстановление после перезапуска ─────────────────────────────────────────────────────────────

const pendingRow = (id: string, state: CommandState, exclusive: ExclusiveState): ExclusivePendingRow =>
	({ id, agent_id: "adm", organization_uuid: "org-1", base_key: "buh", state, ttl_seconds: 900, exclusive });

async function waitPatches(f: { patches: unknown[] }, n = 1) {
	for (let i = 0; i < 100 && f.patches.length < n; i++) await tick();
}

test("восстановление на старте: брошенная закрытой база открывается, запрет заданий возвращается, отметка restored", async () => {
	const f = fakeQueue({ [JOBS]: DONE }, [pendingRow("old-op", "failed", { jobsWas: false, locked: true })]);
	assert.equal(await recoverExclusive(f.q), 1);
	await waitPatches(f);
	assert.deepEqual(f.enqueued.map((e) => [e.type, e.payload.enabled ?? e.payload.denied]), [[LOCK, false], [JOBS, false]]);
	assert.deepEqual(f.patches[0], { id: "old-op", patch: { exclusive: { jobsWas: false, locked: true, restored: true } } });
});

test("восстановление: запрет ставился с was=true, вход не закрывался — только запрет возвращается", async () => {
	const f = fakeQueue({}, [pendingRow("old-2", "done", { jobsWas: true, locked: false })]);
	await recoverExclusive(f.q);
	await waitPatches(f);
	assert.deepEqual(f.enqueued.map((e) => [e.type, e.payload.denied]), [[JOBS, true]]);
});

test("КР-12 п. 3: операция в очереди на старте — сразу отказ EXCLUSIVE_INTERRUPTED и возврат базы, без часа ожидания", async () => {
	const f = fakeQueue({}, [pendingRow("op", "queued", { jobsWas: false, locked: true, jobsReq: "exclusive:op:jobs", lockReq: "exclusive:op:lock" })]);
	f.op("op", { payload: { baseKey: "buh", exclusive: { jobsWas: false, locked: true } } });
	await recoverExclusive(f.q);
	await waitPatches(f);
	assert.deepEqual(f.failed.map((x) => [x.id, x.code]), [["op", "EXCLUSIVE_INTERRUPTED"]]);
	assert.match(f.failed[0].message, /не выдавалась/);
	assert.deepEqual(f.released, [], "без раннера не выдаётся");
	assert.deepEqual(f.enqueued.map((e) => [e.type, e.payload.enabled ?? e.payload.denied]), [[LOCK, false], [JOBS, false]]);
	assert.equal(stateOf(f.patches[0]).restored, true);
});

test("КР-12 п. 3: операция ждала своей очереди (подготовки не было) — отказ, базу не трогаем", async () => {
	const f = fakeQueue({}, [pendingRow("op", "queued", {})]);
	f.op("op");
	await recoverExclusive(f.q);
	await waitPatches(f);
	assert.deepEqual(f.failed.map((x) => x.code), ["EXCLUSIVE_INTERRUPTED"]);
	assert.deepEqual(f.enqueued, []);
	assert.equal(stateOf(f.patches[0]).restored, true);
});

test("КР-12 п. 3: перезапуск посреди запрета заданий — итог узнаётся по команде шага, прежнее значение возвращается", async () => {
	const f = fakeQueue({}, [pendingRow("op", "queued", { jobsReq: "exclusive:op:jobs" })]);
	f.op("op");
	f.stepRow("exclusive:op:jobs", { state: "done", result: { ok: true, was: true } });
	await recoverExclusive(f.q);
	await waitPatches(f);
	assert.deepEqual(f.enqueued.map((e) => [e.type, e.payload.denied]), [[JOBS, true]], "запрет был и до операции — он и остаётся");
	assert.equal(stateOf(f.patches[0]).jobsWas, true);
});

test("КР-12 п. 3: шаг закрытия входа ещё в очереди — снимается, вход не трогаем; ответа нет вовсе — предупреждение", async () => {
	const f = fakeQueue({}, [pendingRow("op", "failed", { jobsReq: "exclusive:op:jobs", jobsWas: false, lockReq: "exclusive:op:lock" })]);
	f.stepRow("exclusive:op:lock", { type: LOCK, state: "queued" });
	await recoverExclusive(f.q);
	await waitPatches(f);
	assert.deepEqual(f.canceled, ["prev-exclusive:op:lock"]);
	assert.deepEqual(f.enqueued.map((e) => [e.type, e.payload.denied]), [[JOBS, false]]);

	// Запрет выдан агенту и без ответа (истёк после выдачи) — неизвестно, ставился ли: задания не трогаем, говорим.
	const g = fakeQueue({}, [pendingRow("op2", "failed", { jobsReq: "exclusive:op2:jobs" })]);
	g.stepRow("exclusive:op2:jobs", { state: "expired", dispatched_at: new Date() });
	await recoverExclusive(g.q);
	await waitPatches(g);
	assert.deepEqual(g.enqueued, []);
	assert.match((stateOf(g.patches[0]).problems ?? []).join(" "), /неизвестно, ставился ли запрет/);
});

test("КР-12 п. 3: операцию, которую ведёт этот процесс, восстановление не трогает", async () => {
	const lanes = new ExclusiveLanes();
	let open!: () => void;
	const blocker = lanes.run("adm", "другая", 1, () => new Promise<void>((res) => { open = res; }));
	const f = fakeQueue({ [LIST]: { state: "done", result: { items: [] } } }, [pendingRow("live", "queued", {})]);
	f.op("live");
	const live = superviseExclusive({ queue: f.q, lanes }, input("live"), OP);
	await tick();
	assert.equal(await recoverExclusive(f.q), 0, "ждёт своей очереди в цепочке — не брошена");
	assert.deepEqual(f.failed, []);
	open();
	await blocker;
	const out = await live;
	assert.equal(out?.operation, "done");
	assert.deepEqual(f.released, ["live"]);
});

// ── КР-12 п. 4: остановка задания останавливает подготовку ───────────────────────────────────────────────────

test("КР-12 п. 4: задание остановили, пока ставился запрет, — вход не закрывается, сеансы не снимаются, запрет возвращается", async () => {
	const f = fakeQueue({ [JOBS]: [{ state: "done", result: { was: false } }, DONE], [LIST]: sessions(S1) });
	f.op("op");
	f.hooks.afterStep = (row) => { if (row.type === JOBS && row.payload.denied === true) f.stop("op"); };
	const out = await new ExclusiveRunner(f.q).run(input("op"), OP);
	assert.deepEqual(typesOf(f), [JOBS, JOBS]);
	assert.equal(f.enqueued[1].payload.denied, false);
	assert.deepEqual(f.released, []);
	assert.deepEqual(f.failed, [], "отменённую не переписываем отказом");
	assert.equal(out.operation, "canceled");
	assert.match(out.note ?? "", /не ждёт/);
});

test("КР-12 п. 4: остановили после списка сеансов — ни один сеанс не снят, вход открыт обратно", async () => {
	const f = fakeQueue({ [JOBS]: [{ state: "done", result: { was: false } }, DONE], [LIST]: sessions(S1, S2) });
	f.op("op");
	f.hooks.afterStep = (row) => { if (row.type === LIST) f.stop("op"); };
	const out = await new ExclusiveRunner(f.q).run(input("op"), OP);
	assert.deepEqual(typesOf(f), [JOBS, LOCK, LIST, LOCK, JOBS]);
	assert.equal(out.terminated, 0);
	assert.deepEqual(f.released, []);
});

test("КР-12 п. 4: остановили, пока операция ждала очереди в цепочке, или во время паузы повтора", async () => {
	const f = fakeQueue({});
	f.op("op", { state: "canceled" });
	const out = await new ExclusiveRunner(f.q).run(input("op"), OP);
	assert.deepEqual(f.enqueued, [], "подготовка не начиналась");
	assert.equal(stateOf(f.patches[0]).restored, true);
	assert.equal(out.operation, "canceled");

	const g = fakeQueue({ [JOBS]: [{ state: "done", result: { was: false } }, DONE], [LIST]: { state: "done", result: { items: [] } } });
	g.op("op");
	g.opAnswer("op", BUSY);
	g.hooks.afterRetry = (copy) => g.stop(copy);
	const out2 = await new ExclusiveRunner(g.q).run(input("op"), OP);
	assert.deepEqual(g.released, ["op"], "остановленная копия не выпускается");
	assert.deepEqual(typesOf(g), [JOBS, LOCK, LIST, LOCK, JOBS]);
	assert.equal(out2.operation, "canceled");
});

test("имя расширения — идентификатор конфигуратора: подпись «БухПроф AI» отсеивается до постановки", () => {
	const spec = findAdminCommand("IB_INSTALL_EXTENSION")!;
	const bad = buildAdminPayload(spec, { baseKey: "buh", name: "БухПроф AI", contentBase64: "AAAA" });
	assert.equal(bad.ok, false);
	assert.match((bad as { message: string }).message, /одно слово/);
	assert.equal(buildAdminPayload(spec, { baseKey: "buh", name: "buhprof_api", contentBase64: "AAAA" }).ok, true);
	assert.equal(buildAdminPayload(spec, { baseKey: "buh", name: "Расширение_1", contentBase64: "AAAA" }).ok, true);
	assert.equal(buildAdminPayload(spec, { baseKey: "buh", name: "_x", contentBase64: "AAAA" }).ok, false, "начинается с буквы");
	assert.equal(buildAdminPayload(findAdminCommand("IB_DELETE_EXTENSION")!, { baseKey: "buh", name: "a.b" }).ok, false);
});

test("С4 (задача агента 28.09): повтор «занято» установки и удаления расширения — через подготовку, только у агента, входящего в закрытую базу", () => {
	const fresh = { ...agent, version: "0.1.0+2026-09-28 13:57 (+05)" };
	assert.equal(escalatesOnBusy("IB_INSTALL_EXTENSION", fresh), true);
	assert.equal(escalatesOnBusy("IB_DELETE_EXTENSION", fresh), true);
	assert.equal(escalatesOnBusy("IB_BACKUP", fresh), false, "другие типы — обычный повтор");
	// Сборка старше входа с кодом разрешения: закрытый нами вход отказал бы и самому агенту (КР-1).
	assert.equal(escalatesOnBusy("IB_INSTALL_EXTENSION", { ...agent, version: "0.1.0+2026-09-27 21:54 (+05)" }), false);
	assert.equal(escalatesOnBusy("IB_INSTALL_EXTENSION", { ...agent, version: null }), false, "сборку не разобрали — не рискуем");
	assert.equal(escalatesOnBusy("IB_INSTALL_EXTENSION", { ...fresh, capabilities: ["ib.admin", "IB_INSTALL_EXTENSION"] }), false, "нечем готовить");
});

test("С4: «занято» после попытки без подготовки — удержанная копия с состоянием подготовки, раннер закрывает базу и выпускает её", async () => {
	const f = fakeQueue({ [LIST]: sessions(S1) });
	const src = f.op("inst", { type: "IB_INSTALL_EXTENSION", payload: { baseKey: "buh", name: "buhprof_api" } });
	src.state = "failed";
	src.error = BUSY.error!;
	const copy = await escalateBusyToExclusive({ queue: f.q, lanes: new ExclusiveLanes() },
		{ id: "inst", type: "IB_INSTALL_EXTENSION", base_key: "buh", user_uuid: "u1" }, agent, 60);
	assert.equal(copy, "inst-r2");
	assert.deepEqual(f.retries, [{ id: "inst", hold: true }], "копия удержана: в открытую базу она не уходит");
	assert.deepEqual(f.patches[0], { id: "inst-r2", patch: { exclusive: {} } });
	for (let i = 0; i < 50 && !f.released.includes("inst-r2"); i += 1) await tick();
	assert.deepEqual(f.released, ["inst-r2"]);
	// Подготовка шла до выпуска: запрет заданий, закрытие входа, список и снятие сеанса.
	assert.deepEqual(typesOf(f).slice(0, 4), [JOBS, LOCK, LIST, TERM]);
});

test("С4: попытки кончились — повтора через подготовку нет, отказ остаётся в задании", async () => {
	const f = fakeQueue();
	const src = f.op("inst", { type: "IB_INSTALL_EXTENSION", attempt: 3, payload: { baseKey: "buh" } });
	src.state = "failed";
	const copy = await escalateBusyToExclusive({ queue: f.q, lanes: new ExclusiveLanes() },
		{ id: "inst", type: "IB_INSTALL_EXTENSION", base_key: "buh", user_uuid: "u1" }, agent, 60);
	assert.equal(copy, null);
	assert.deepEqual(f.patches, []);
	assert.deepEqual(f.enqueued, []);
});
