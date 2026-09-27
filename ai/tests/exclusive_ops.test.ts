// Монопольная операция по базе (exclusiveOps.ts, 27.09): установка расширения выпускается агенту только
// после запрета регламентных заданий, закрытия входа и снятия сеансов, а после — вход открывается и запрет
// возвращается по `was`. Очередь подставная: команды не выполняются, ответы задаёт тест по типу команды.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ExclusiveRunner, EXCLUSIVE_TYPES, recoverExclusive, type ExclusiveQueue } from "../src/onec/exclusiveOps.ts";
import { BATCHABLE, startBatch, type BatchDeps } from "../src/onec/batchRunner.ts";
import { buildAdminPayload, findAdminCommand } from "../src/commands/admin.ts";
import type { ExclusivePendingRow } from "../src/commands/queue.ts";

const agent = { id: "adm", organizationUuid: "org-1", role: "admin" as const, disabled: false,
	capabilities: ["cluster.admin", "ib.admin", "CLUSTER_SET_SCHEDULED_JOBS", "CLUSTER_SET_SESSIONS_LOCK", "CLUSTER_LIST_SESSIONS", "CLUSTER_TERMINATE_SESSION", "IB_INSTALL_EXTENSION"] };

type Answer = { state: string; result?: unknown; error?: { code: string; message: string } };
type Rec = { id: string; type: string; payload: Record<string, unknown>; inBase: boolean; availableAt: Date | null };

/** Подставная очередь: ответ по типу (или по порядку для одного типа), журнал постановок и выпусков. */
function fakeQueue(answers: Record<string, Answer | Answer[]>, pending: ExclusivePendingRow[] = []) {
	const enqueued: Rec[] = [];
	const released: string[] = [];
	const failed: { id: string; code: string; message: string }[] = [];
	const patches: { id: string; patch: Record<string, unknown> }[] = [];
	const state = new Map<string, Answer>();
	const q: ExclusiveQueue & { listExclusivePending: () => Promise<ExclusivePendingRow[]> } = {
		patchPayload: async (id, patch) => { patches.push({ id, patch }); },
		listExclusivePending: async () => pending,
		enqueue: async (i) => {
			const id = `cmd-${enqueued.length + 1}`;
			enqueued.push({ id, type: i.type, payload: i.payload, inBase: !!i.inBase, availableAt: i.availableAt ?? null });
			const a = answers[i.type];
			const ans = Array.isArray(a) ? (a.shift() ?? { state: "done", result: {} }) : (a ?? { state: "done", result: {} });
			state.set(id, ans);
			return { id, agent_id: i.agentId, expires_at: new Date(Date.now() + 60_000) } as never;
		},
		waitResult: async (id) => {
			const a = state.get(id) ?? { state: "done", result: {} };
			return { id, state: a.state, result: a.result ?? null, error: a.error ?? null, expires_at: null } as never;
		},
		release: async (id) => { released.push(id); return true; },
		failQueued: async (id, e) => { failed.push({ id, code: e.code, message: e.message }); return true; },
	};
	return { q, enqueued, released, failed, patches, state };
}

const input = (commandId: string) => ({ agent, baseKey: "buh", commandId, userUuid: "u1", queueWaitSeconds: 60 });

test("установка и удаление расширения — монопольные; агент без кластерных команд подготовки не получает", () => {
	assert.ok(EXCLUSIVE_TYPES.has("IB_INSTALL_EXTENSION") && EXCLUSIVE_TYPES.has("IB_DELETE_EXTENSION"));
	assert.ok(ExclusiveRunner.canPrepare(agent));
	assert.equal(ExclusiveRunner.canPrepare({ ...agent, capabilities: ["ib.admin"] }), false);
});

test("порядок: запрет заданий → закрыть вход → сеансы сняты → выпуск операции → вход открыт → задания как были", async () => {
	const f = fakeQueue({
		CLUSTER_SET_SCHEDULED_JOBS: [{ state: "done", result: { ok: true, denied: true, was: false } }, { state: "done", result: { ok: true } }],
		CLUSTER_LIST_SESSIONS: { state: "done", result: { items: [
			{ session: "11111111-2222-3333-4444-555555555555", user: "Иванов", "app-id": "1CV8C" },
			{ session: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", user: "", "app-id": "BackgroundJob" },
		] } },
	});
	f.state.set("op", { state: "done", result: { ok: true } });
	const out = await new ExclusiveRunner(f.q).run(input("op"), { ttlSeconds: 900 });

	assert.deepEqual(f.enqueued.map((e) => e.type), [
		"CLUSTER_SET_SCHEDULED_JOBS", "CLUSTER_SET_SESSIONS_LOCK", "CLUSTER_LIST_SESSIONS",
		"CLUSTER_TERMINATE_SESSION", "CLUSTER_TERMINATE_SESSION",
		"CLUSTER_SET_SESSIONS_LOCK", "CLUSTER_SET_SCHEDULED_JOBS",
	]);
	assert.equal(f.enqueued[0].payload.denied, true);
	assert.equal(f.enqueued[1].payload.enabled, true);
	assert.equal(f.enqueued[3].payload.sessionId, "11111111-2222-3333-4444-555555555555");
	assert.equal(f.enqueued[5].payload.enabled, false, "вход открывается после операции");
	assert.equal(f.enqueued[6].payload.denied, false, "запрет заданий возвращается по was");
	assert.ok(f.enqueued.every((e) => e.inBase === false && e.payload.baseKey === "buh"), "подготовка не занимает место базы");
	assert.deepEqual(f.released, ["op"]);
	assert.equal(f.failed.length, 0);
	assert.equal(out.prepared, true);
	assert.equal(out.terminated, 2);
	assert.equal(out.operation, "done");
	assert.deepEqual(out.restoreProblems, []);
	// Состояние шагов — в команде: после запрета, после закрытия входа и после возврата.
	assert.deepEqual(f.patches.map((p) => (p.patch.exclusive as { locked: boolean; restored?: boolean })), [
		{ jobsWas: false, locked: false }, { jobsWas: false, locked: true }, { jobsWas: false, locked: true, restored: true },
	]);
});

test("не закрылся вход — операция агенту не выдаётся, отказ с причиной у команды задания, задания возвращены", async () => {
	const f = fakeQueue({
		CLUSTER_SET_SCHEDULED_JOBS: [{ state: "done", result: { was: true } }, { state: "done", result: {} }],
		CLUSTER_SET_SESSIONS_LOCK: { state: "failed", error: { code: "RAC_ERROR", message: "не удалось закрыть базу для входа" } },
	});
	const out = await new ExclusiveRunner(f.q).run(input("op"), { ttlSeconds: 900 });
	assert.deepEqual(f.released, []);
	assert.equal(f.failed.length, 1);
	assert.equal(f.failed[0].code, "EXCLUSIVE_PREP_FAILED");
	assert.match(f.failed[0].message, /не удалось закрыть базу для входа/);
	assert.match(f.failed[0].message, /агенту не выдавалась/);
	// Запрет ставился (was=true) — возвращается прежнее значение, вход не трогаем: он не закрывался.
	assert.deepEqual(f.enqueued.map((e) => e.type), ["CLUSTER_SET_SCHEDULED_JOBS", "CLUSTER_SET_SESSIONS_LOCK", "CLUSTER_SET_SCHEDULED_JOBS"]);
	assert.equal(f.enqueued[2].payload.denied, true);
	assert.equal(out.released, false);
	assert.equal(out.operation, null);
});

test("сеанс не снялся или без идентификатора — операция не выпускается, вход открывается обратно", async () => {
	const f = fakeQueue({
		CLUSTER_SET_SCHEDULED_JOBS: { state: "done", result: { was: false } },
		CLUSTER_LIST_SESSIONS: { state: "done", result: { items: [{ "session-id": "12", user: "Петров" }] } },
	});
	const out = await new ExclusiveRunner(f.q).run(input("op"), { ttlSeconds: 900 });
	assert.deepEqual(f.released, []);
	assert.match(f.failed[0].message, /сеанс без идентификатора кластера \(12\)/);
	const types = f.enqueued.map((e) => e.type);
	assert.ok(types.includes("CLUSTER_SET_SESSIONS_LOCK") && f.enqueued[f.enqueued.length - 2].payload.enabled === false, "вход открыт обратно");
	assert.equal(out.terminated, 0);
});

test("операция упала у агента — база всё равно возвращается; сбой возврата попадает в итог", async () => {
	const f = fakeQueue({
		CLUSTER_SET_SCHEDULED_JOBS: [{ state: "done", result: { was: false } }, { state: "failed", error: { code: "RAC_ERROR", message: "rac не ответил" } }],
		CLUSTER_LIST_SESSIONS: { state: "done", result: { items: [] } },
	});
	f.state.set("op", { state: "failed", error: { code: "IB_ERROR", message: "Расширение с таким именем уже существует!" } });
	const out = await new ExclusiveRunner(f.q).run(input("op"), { ttlSeconds: 900 });
	assert.deepEqual(f.released, ["op"]);
	assert.equal(out.operation, "failed");
	assert.deepEqual(out.restoreProblems, ["Запрет регламентных заданий: rac не ответил"]);
	assert.equal(f.enqueued[f.enqueued.length - 2].payload.enabled, false, "вход открыт");
});

test("агент без кластерных команд: операция выпускается сразу, подготовки нет", async () => {
	const f = fakeQueue({});
	const out = await new ExclusiveRunner(f.q).run({ ...input("op"), agent: { ...agent, capabilities: ["ib.admin", "IB_INSTALL_EXTENSION"] } }, { ttlSeconds: 900 });
	assert.deepEqual(f.enqueued, []);
	assert.deepEqual(f.released, ["op"]);
	assert.equal(out.prepared, false);
	assert.match(out.note ?? "", /без закрытия базы/);
});

test("задание «Установить расширение»: команда ставится отложенной, подготовка запускается рядом", async () => {
	assert.ok(BATCHABLE.has("IB_INSTALL_EXTENSION"));
	const f = fakeQueue({
		CLUSTER_SET_SCHEDULED_JOBS: { state: "done", result: { was: false } },
		CLUSTER_LIST_SESSIONS: { state: "done", result: { items: [] } },
	});
	const deps = {
		agents: { pickAdminAgent: async () => agent },
		queue: f.q,
		batches: { create: async () => "batch-1", attach: async () => {}, noteSkipped: async () => {} },
		bases: { findByKeyGlobal: async (key: string) => ({ key, disabled: false, clusterStatus: "ONLINE" }) },
	} as unknown as BatchDeps;
	const r = await startBatch(deps, {
		type: "IB_INSTALL_EXTENSION", baseKeys: ["buh"], payload: { name: "buhprof_api", contentBase64: "AAAA", safeMode: true },
		organizationUuid: "org-1", userUuid: "u1",
	});
	assert.ok(!("error" in r));
	assert.equal(r.queued, 1);
	const op = f.enqueued[0];
	assert.equal(op.type, "IB_INSTALL_EXTENSION");
	assert.ok(op.availableAt && op.availableAt.getTime() > Date.now() + 3600_000, "выдача отложена до подготовки");
	// Подготовка идёт в фоне: дать ей пройти.
	for (let i = 0; i < 20 && !f.released.length; i++) await new Promise((res) => setTimeout(res, 5));
	assert.deepEqual(f.released, [op.id]);
	assert.ok(f.enqueued.some((e) => e.type === "CLUSTER_SET_SESSIONS_LOCK" && e.payload.enabled === true));
});

test("восстановление на старте: брошенная закрытой база открывается, запрет заданий возвращается, отметка restored", async () => {
	const row: ExclusivePendingRow = {
		id: "old-op", agent_id: "adm", organization_uuid: "org-1", base_key: "buh", state: "failed", ttl_seconds: 900,
		exclusive: { jobsWas: false, locked: true },
	};
	const f = fakeQueue({ CLUSTER_SET_SCHEDULED_JOBS: { state: "done", result: {} } }, [row]);
	const n = await recoverExclusive(f.q);
	assert.equal(n, 1);
	for (let i = 0; i < 20 && f.patches.length === 0; i++) await new Promise((res) => setTimeout(res, 5));
	assert.deepEqual(f.enqueued.map((e) => [e.type, e.payload.enabled ?? e.payload.denied]), [["CLUSTER_SET_SESSIONS_LOCK", false], ["CLUSTER_SET_SCHEDULED_JOBS", false]]);
	assert.deepEqual(f.patches[0], { id: "old-op", patch: { exclusive: { jobsWas: false, locked: true, restored: true } } });
});

test("восстановление: запрет ставился с was=true, вход не закрывался — только запрет возвращается", async () => {
	const row: ExclusivePendingRow = { id: "old-2", agent_id: "adm", organization_uuid: "org-1", base_key: "buh", state: "done", ttl_seconds: 900, exclusive: { jobsWas: true, locked: false } };
	const f = fakeQueue({}, [row]);
	await recoverExclusive(f.q);
	for (let i = 0; i < 20 && f.patches.length === 0; i++) await new Promise((res) => setTimeout(res, 5));
	assert.deepEqual(f.enqueued.map((e) => [e.type, e.payload.denied]), [["CLUSTER_SET_SCHEDULED_JOBS", true]]);
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
