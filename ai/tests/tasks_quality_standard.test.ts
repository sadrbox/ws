/**
 * Задачи в чате 1С под стандарт качества (E17, СК1.2, СК1.3, СК7.2; docs/PLAN_QUALITY_STANDARD_2026-09-25.md).
 *
 * Что здесь держим:
 *   — задачу закрывают только с конкретным результатом: без него и с «передала/написала» — отказ ещё до карточки;
 *   — напоминание и оценка — отдельные вызовы ERP (напоминания считаются, второе — кандидат в нарушение п. 2),
 *     и поэтому идут через карточку подтверждения, а не «по догадке» модели;
 *   — обращение клиента помечается видом `client_request`, обычная задача — не помечается вовсе;
 *   — задача, которую модель получила списком или сводкой, «видена»: раньше её uuid (ключ `taskId`) не попадал
 *     в виденные идентификаторы, и закрыть задачу из list_tasks было нельзя (найдено 25.09);
 *   — сводка задач не отдаётся по чужому БИН (так же, как сам вызов инструмента).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { serverTools, serverToolCard, serverToolQuestion } from "../src/chat/serverTools.ts";
import { ChatWorkflow, type ChatUser } from "../src/chat/workflow.ts";
import { onecChatRouter } from "../src/http/onecChatRouter.ts";
import { ErpRefused, ErpTasks, type ErpTask } from "../src/erp/tasks.ts";
import { collectIds, toolDefinitions, TOOLS_BY_NAME, ToolInputError } from "../src/tools/registry.ts";
import { Audit } from "../src/audit/index.ts";
import type { LLMRequest, LLMResponse, ToolCall } from "../src/llm/provider.ts";
import type { Db } from "../src/db/pool.ts";
import type { Logger } from "../src/logger.ts";

const BASE_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const ORG = "a1410911-7421-45da-9632-7e4fc48e91c2";
const USER = "0f6c1c1e-6a57-4c6e-9b2a-1d4f2c9e7a01";
const BIN = "831111302342";
const OTHER_BIN = "900000000001";
const TASK = "7c2b0a31-0000-4000-8000-000000000001";
const ALIEN_TASK = "11111111-0000-4000-8000-000000000009";

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

const task = (over: Partial<ErpTask> = {}): ErpTask => ({
	uuid: TASK, id: 12, name: "Сдать 200.00", description: null, status: "new", deadline: null,
	createdAt: "2026-09-22T10:00:00.000Z", updatedAt: "2026-09-22T10:00:00.000Z",
	curatorName: "Бухгалтер", executorName: "Айгуль", sourceLabel: null, ...over,
});

const onecUser = (bin = BIN): ChatUser => ({
	uuid: `1c:${BASE_ID}:${USER}`, organizationUuid: ORG, channel: "1c",
	onec: { baseId: BASE_ID, userName: "Директор", organization: { bin, name: "ТОО Алеппо", id: null } },
} as ChatUser);

const seen = (...ids: string[]) => ({ seenIds: new Set(ids) });
const build = (tool: string, input: Record<string, unknown>, ctx = seen(TASK)) => TOOLS_BY_NAME.get(tool)!.buildPayload(input, ctx);
const rejects = (fn: () => unknown, field: string) =>
	assert.throws(fn, (e: unknown) => e instanceof ToolInputError && e.field === field);

/** Исполнитель задач с подставной ERP: пишет, что и с чем вызвали. */
function runner(over: Record<string, unknown> = {}) {
	const calls: { method: string; args: unknown[] }[] = [];
	const rec = (method: string, ret: ErpTask) => async (...args: unknown[]) => { calls.push({ method, args }); return ret; };
	const tasks = {
		enabled: true,
		listTasks: async (...args: unknown[]) => { calls.push({ method: "listTasks", args }); return [task()]; },
		listNotes: async () => [],
		createTask: rec("createTask", task()),
		updateTask: rec("updateTask", task({ status: "done", result: "Сдана форма 200.00 за 3 квартал" })),
		remindTask: rec("remindTask", task({ reminderCount: 2 })),
		rateTask: rec("rateTask", task({ status: "done", clientRating: 4 })),
		...over,
	};
	const r = serverTools({ tasks: tasks as never, baseOrgs: { has: async (_b: string, bin: string) => bin === BIN } as never });
	return { r, calls, run: (tool: string, payload: Record<string, unknown>, user = onecUser()) => r.run(TOOLS_BY_NAME.get(tool)!, payload, user) };
}

// ── Инструменты: что модель может и чего не может ────────────────────────────

test("СК1.2: закрыть задачу без результата нельзя — и «передала/написала» результатом не считается", () => {
	rejects(() => build("complete_task", { taskId: TASK }), "result");
	rejects(() => build("complete_task", { taskId: TASK, result: "   " }), "result");
	for (const bare of ["Передала", "написала.", "Я уже позвонила", "не ответили", "Программа не работает", "Готово!", "ок"]) {
		rejects(() => build("complete_task", { taskId: TASK, result: bare }), "result");
	}
	// Слово стандарта в составе настоящего результата — уже результат.
	assert.deepEqual(build("complete_task", { taskId: TASK, result: "Передала акт сверки клиенту, подписан 20.09 без расхождений" }), {
		taskId: TASK, result: "Передала акт сверки клиенту, подписан 20.09 без расхождений", close: true,
	});
	const schema = TOOLS_BY_NAME.get("complete_task")!.inputSchema as { required: string[] };
	assert.deepEqual(schema.required, ["taskId", "result"], "модель видит результат обязательным ещё в схеме");
});

test("СК1.2: update_task передаёт результат, если он назван, — для завершающего статуса ERP его требует", () => {
	assert.deepEqual(build("update_task", { taskId: TASK, status: "done", result: " Отчёт сдан, квитанция в 1С " }), {
		taskId: TASK, status: "done", result: "Отчёт сдан, квитанция в 1С",
	});
	assert.equal("result" in build("update_task", { taskId: TASK, deadline: "2026-10-01" }), false);
	rejects(() => build("update_task", { taskId: TASK, status: "done", result: "написала" }), "result");
});

test("СК1.3: напомнить можно только о задаче из диалога; комментарий — если сказан", () => {
	assert.deepEqual(build("remind_task", { taskId: TASK, note: " ждём до пятницы " }), { taskId: TASK, note: "ждём до пятницы" });
	assert.deepEqual(build("remind_task", { taskId: TASK, note: "  " }), { taskId: TASK });
	rejects(() => build("remind_task", { taskId: ALIEN_TASK }), "taskId");
	const spec = TOOLS_BY_NAME.get("remind_task")!;
	assert.equal(spec.operation, "WRITE", "напоминание считается в ERP — без карточки его не отправить");
	assert.equal(spec.commandType, "TASKS_REMIND");
	assert.equal(spec.runsOnServer, true);
});

test("СК7.2: оценка — целое от 1 до 5, только по задаче из диалога", () => {
	assert.deepEqual(build("rate_task", { taskId: TASK, rating: 5, comment: " всё быстро " }), { taskId: TASK, rating: 5, comment: "всё быстро" });
	assert.deepEqual(build("rate_task", { taskId: TASK, rating: "4" }), { taskId: TASK, rating: 4 });
	for (const bad of [0, 6, 3.5, "отлично", undefined]) rejects(() => build("rate_task", { taskId: TASK, rating: bad }), "rating");
	rejects(() => build("rate_task", { taskId: ALIEN_TASK, rating: 5 }), "taskId");
	const spec = TOOLS_BY_NAME.get("rate_task")!;
	assert.deepEqual([spec.operation, spec.commandType, spec.runsOnServer], ["WRITE", "TASKS_RATE", true]);
});

test("СК1.1: обращение клиента — вид client_request; обычная задача вида не несёт вовсе", () => {
	assert.equal(build("create_task", { name: "Подготовить акт сверки", clientRequest: true }).kind, "client_request");
	assert.equal("kind" in build("create_task", { name: "Себе: проверить 1210" }), false);
	assert.equal("kind" in build("create_task", { name: "раз", clientRequest: false }), false);
});

test("новые инструменты уезжают модели только вместе с остальными задачами", () => {
	const names = (on: boolean) => toolDefinitions({ serverTools: on }).map((t) => t.name);
	for (const n of ["remind_task", "rate_task"]) {
		assert.ok(names(true).includes(n));
		assert.equal(names(false).includes(n), false, "инструмент, который всё равно откажет, модели не показываем");
	}
});

// ── Исполнитель: что уходит в ERP ────────────────────────────────────────────

test("исполнитель: закрытие несёт результат, напоминание и оценка — свои вызовы ERP", async () => {
	const h = runner();
	const done = await h.run("complete_task", { taskId: TASK, result: "Сдана форма 200.00 за 3 квартал", close: true });
	assert.equal(done.ok, true);
	const upd = h.calls.find((c) => c.method === "updateTask")!;
	assert.deepEqual(upd.args[0], { bin: BIN, user: { name: "Директор" } });
	assert.equal(upd.args[1], TASK);
	assert.equal((upd.args[2] as { result?: string }).result, "Сдана форма 200.00 за 3 квартал");
	assert.equal((upd.args[2] as { close?: boolean }).close, true);
	assert.equal(done.ok && (done.data as { result?: string }).result, "Сдана форма 200.00 за 3 квартал", "модель видит, с чем закрыто");

	const reminded = await h.run("remind_task", { taskId: TASK, note: "ждём до пятницы" });
	assert.deepEqual(h.calls.find((c) => c.method === "remindTask")!.args, [{ bin: BIN, user: { name: "Директор" } }, TASK, "ждём до пятницы"]);
	assert.equal(reminded.ok && (reminded.data as { reminderCount?: number }).reminderCount, 2);

	const rated = await h.run("rate_task", { taskId: TASK, rating: 4, comment: "быстро" });
	assert.deepEqual(h.calls.find((c) => c.method === "rateTask")!.args, [{ bin: BIN, user: { name: "Директор" } }, TASK, 4, "быстро"]);
	assert.equal(rated.ok && (rated.data as { clientRating?: number }).clientRating, 4);
});

test("исполнитель: вид обращения доезжает до ERP, у обычной задачи его нет", async () => {
	const h = runner();
	await h.run("create_task", { name: "Подготовить акт сверки", kind: "client_request" });
	await h.run("create_task", { name: "Себе" });
	const [a, b] = h.calls.filter((c) => c.method === "createTask").map((c) => c.args[1] as Record<string, unknown>);
	assert.equal(a!.kind, "client_request");
	assert.equal("kind" in b!, false);
});

test("исполнитель: отказ ERP «Нужен результат» доходит до модели её словами", async () => {
	const h = runner({ updateTask: async () => { throw new ErpRefused(400, "Нужен результат: что сделано"); } });
	const r = await h.run("complete_task", { taskId: TASK, result: "Сдан отчёт", close: true });
	assert.equal(r.ok, false);
	assert.deepEqual(r.ok ? null : r.error, { code: "ERP_REFUSED", message: "Нужен результат: что сделано" });
});

test("исполнитель: чужой БИН не проходит и в напоминании", async () => {
	const h = runner();
	const r = await h.run("remind_task", { taskId: TASK }, onecUser(OTHER_BIN));
	assert.equal(r.ok ? "" : r.error?.code, "ORG_NOT_IN_BASE");
	assert.equal(h.calls.length, 0);
});

// ── Виденные идентификаторы: задачу из списка и из сводки можно закрыть ─────

test("задача из list_tasks «видена»: её можно закрыть, напомнить и оценить (раньше taskId в виденные не попадал)", async () => {
	const h = runner();
	const listed = await h.run("list_tasks", {});
	assert.equal(listed.ok, true);
	const ids = new Set<string>();
	collectIds(listed.ok ? listed.data : null, ids);
	assert.ok(ids.has(TASK), "uuid задачи из списка должен попасть в виденные");
	assert.deepEqual(build("complete_task", { taskId: TASK, result: "Сдан отчёт 200.00" }, { seenIds: ids }).taskId, TASK);
	assert.deepEqual(build("remind_task", { taskId: TASK }, { seenIds: ids }), { taskId: TASK });
});

test("сводка задач отдаёт их идентификаторы — модель вправе закрыть задачу, названную в сводке", async () => {
	const h = runner();
	const s = await h.r.summary!(onecUser());
	assert.ok(s);
	assert.match(s!.text, /taskId 7c2b0a31/);
	assert.deepEqual(s!.ids, [TASK]);
});

test("сводка по чужому БИН не собирается: в ERP за чужими задачами не ходим", async () => {
	const h = runner();
	assert.equal(await h.r.summary!(onecUser(OTHER_BIN)), null);
	assert.equal(h.calls.length, 0, "ни задач, ни заметок чужой организации в контекст модели");
});

// ── Карточки подтверждения ──────────────────────────────────────────────────

test("карточки задач называют задачу по имени и показывают, что именно уйдёт в ERP", () => {
	const names = { nameOf: (id: unknown) => (id === TASK ? "Сдать 200.00" : String(id)) };
	assert.equal(serverToolCard("complete_task", { taskId: TASK, result: "Сдана форма 200.00", close: true }, names),
		"Закрыть задачу «Сдать 200.00»\nРезультат: Сдана форма 200.00");
	assert.equal(serverToolCard("remind_task", { taskId: TASK, note: "ждём до пятницы" }, names),
		"Напомнить о задаче «Сдать 200.00»\nКомментарий: ждём до пятницы\nИсполнитель получит напоминание от вашего имени.");
	assert.equal(serverToolCard("rate_task", { taskId: TASK, rating: 4 }, names), "Оценка задачи «Сдать 200.00»: 4 из 5");
	assert.match(serverToolCard("create_task", { name: "Акт сверки", kind: "client_request" }, names)!, /^Новое обращение в BuhProf AI\nЗадача: Акт сверки/);
	assert.match(serverToolCard("update_task", { taskId: TASK, deadline: "" }, names)!, /Срок: снять/);
	// Имени нет — идентификатор: карточка честнее пустой.
	assert.match(serverToolCard("complete_task", { taskId: ALIEN_TASK, result: "x" }, names)!, new RegExp(ALIEN_TASK));
	assert.equal(serverToolCard("create_sale", {}, names), null, "документы 1С — не сюда");

	assert.equal(serverToolQuestion("complete_task"), "Закрыть задачу?");
	assert.equal(serverToolQuestion("remind_task"), "Отправить напоминание?");
	assert.equal(serverToolQuestion("rate_task"), "Сохранить оценку?");
	assert.equal(serverToolQuestion("create_sale"), null);
});

// ── Клиент ERP: адреса и тела ────────────────────────────────────────────────

async function erpStub(handler: (req: { method: string; path: string; body: any; key: string | undefined }) => { status?: number; json: unknown }) {
	const seenReqs: { method: string; path: string; body: any; key: string | undefined }[] = [];
	const app = express();
	app.use(express.json());
	app.use((req, res) => {
		const r = { method: req.method, path: req.path, body: req.body, key: req.header("x-api-key") };
		seenReqs.push(r);
		const out = handler(r);
		res.status(out.status ?? 200).json(out.json);
	});
	const srv = await new Promise<import("node:http").Server>((ok) => { const s = app.listen(0, () => ok(s)); });
	const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
	return { url, seen: seenReqs, close: () => srv.close() };
}

test("ErpTasks: напоминание, оценка, результат и вид — ровно по маршрутам бэкенда", async () => {
	const stub = await erpStub(() => ({ json: { success: true, item: task() } }));
	try {
		const erp = new ErpTasks({ url: stub.url, key: "k-1", timeoutMs: 5000, log: silent });
		const actor = { bin: BIN, user: { name: "Директор" } };
		await erp.remindTask(actor, TASK, "ждём");
		await erp.remindTask(actor, TASK);
		await erp.rateTask(actor, TASK, 5, "спасибо");
		await erp.updateTask(actor, TASK, { close: true, result: "Сдано" });
		await erp.createTask(actor, { name: "Акт", kind: "client_request" });
		assert.deepEqual(stub.seen.map((r) => [r.method, r.path]), [
			["POST", `/bpai/tasks/${TASK}/remind`],
			["POST", `/bpai/tasks/${TASK}/remind`],
			["POST", `/bpai/tasks/${TASK}/rate`],
			["PATCH", `/bpai/tasks/${TASK}`],
			["POST", "/bpai/tasks"],
		]);
		assert.deepEqual(stub.seen[0]!.body, { bin: BIN, user: { name: "Директор" }, note: "ждём" });
		assert.deepEqual(stub.seen[1]!.body, { bin: BIN, user: { name: "Директор" } }, "пустой комментарий не едет");
		assert.deepEqual(stub.seen[2]!.body, { bin: BIN, user: { name: "Директор" }, rating: 5, comment: "спасибо" });
		assert.deepEqual(stub.seen[3]!.body, { bin: BIN, user: { name: "Директор" }, close: true, result: "Сдано" });
		assert.equal(stub.seen[4]!.body.kind, "client_request");
		assert.ok(stub.seen.every((r) => r.key === "k-1"));
	} finally { stub.close(); }
});

test("ErpTasks: результаты проверок — POST /bpai/checks/results, ответ — счётчики из data", async () => {
	const stub = await erpStub((r) => (r.path === "/bpai/checks/results"
		? { json: { success: true, data: { findings: 12, tasksCreated: 3 } } }
		: { status: 404, json: { success: false, message: "нет" } }));
	try {
		const erp = new ErpTasks({ url: `${stub.url}/`, key: "k-1", timeoutMs: 5000, log: silent });
		const body = {
			bin: BIN, baseKey: "Dev_01", agentId: "ag-1", startedAt: "2026-09-25T02:30:00.000Z", finishedAt: "2026-09-25T02:31:00.000Z",
			catalog: { apiVersion: "1.7.0", checks: [], snapshots: [] }, runs: [], snapshots: [],
		};
		assert.deepEqual(await erp.sendCheckResults(body), { findings: 12, tasksCreated: 3 });
		assert.deepEqual(stub.seen[0]!.body, body);
		assert.equal(stub.seen[0]!.key, "k-1");

		const off = new ErpTasks({ url: stub.url, key: "", timeoutMs: 5000, log: silent });
		await assert.rejects(off.sendCheckResults(body), (e: unknown) => e instanceof ErpRefused && e.status === 503 && /проверок/.test(e.message));
	} finally { stub.close(); }
});

// ── Прямые маршруты формы 1С ────────────────────────────────────────────────

test("форма 1С: результат закрытия и вид задачи проходят через сервис в ERP", async () => {
	const calls: { method: string; args: unknown[] }[] = [];
	const tasksStub = {
		enabled: true,
		createTask: async (...args: unknown[]) => { calls.push({ method: "createTask", args }); return task(); },
		updateTask: async (...args: unknown[]) => { calls.push({ method: "updateTask", args }); return task({ status: "done" }); },
	};
	const app = express();
	app.use(express.json());
	app.use("/v1/onec-chat", onecChatRouter({
		workflow: null, erp: { query: async () => ({ rows: [], rowCount: 0 }) } as never, log: silent, version: "0.4.0",
		tokens: { resolve: async () => ({ tokenId: "t1", baseId: BASE_ID, baseKey: "Dev_01", baseName: "Dev_01", organizationUuid: ORG, revoked: false, baseDisabled: false }) },
		tasks: tasksStub as never, baseOrgs: { has: async (_b: string, bin: string) => bin === BIN, list: async () => [], remember: async () => 1 } as never,
	}));
	const srv = await new Promise<import("node:http").Server>((ok) => { const s = app.listen(0, () => ok(s)); });
	const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1/onec-chat`;
	const send = (method: string, path: string, body: unknown) => fetch(`${url}${path}`, {
		method, headers: { "content-type": "application/json", "x-base-token": "bpb_x", "x-1c-user-id": USER }, body: JSON.stringify(body),
	});
	try {
		assert.equal((await send("PATCH", `/tasks/${TASK}`, { bin: BIN, user: { name: "Бухгалтер" }, close: true, result: " Сдано " })).status, 200);
		assert.equal((await send("PATCH", `/tasks/${TASK}`, { bin: BIN, user: { name: "Бухгалтер" }, close: true })).status, 200);
		const [withResult, without] = calls.filter((c) => c.method === "updateTask").map((c) => c.args[2] as Record<string, unknown>);
		assert.equal(withResult!.result, "Сдано");
		assert.equal("result" in without!, false, "нет результата — решает ERP, пустую строку не шлём");

		assert.equal((await send("POST", "/tasks", { bin: BIN, user: { name: "Бухгалтер" }, name: "Акт", kind: "client_request" })).status, 201);
		assert.equal((await send("POST", "/tasks", { bin: BIN, user: { name: "Бухгалтер" }, name: "Акт", kind: "урон" })).status, 201);
		const [asked, junk] = calls.filter((c) => c.method === "createTask").map((c) => c.args[1] as Record<string, unknown>);
		assert.equal(asked!.kind, "client_request");
		assert.equal("kind" in junk!, false, "незнакомый вид не пересылаем");
	} finally { srv.closeAllConnections(); srv.close(); }
});

// ── Сквозной сценарий: список → закрытие с результатом → карточка → подтверждение ──

/** База сервиса в памяти: ровно те запросы, что делает workflow канала 1С (как в onec_chat.test.ts). */
function memDb() {
	const convs = new Map<string, { id: string; user_uuid: string; organization_uuid: string; state: string; context: unknown }>();
	const msgs: { conversation_id: string; role: string; content: unknown }[] = [];
	const query = async (sql: string, p: unknown[] = []) => {
		if (sql.includes("INSERT INTO conversations")) {
			convs.set(String(p[0]), { id: String(p[0]), organization_uuid: String(p[1]), user_uuid: String(p[2]), state: "IDLE", context: { seenIds: [] } });
			return { rows: [], rowCount: 1 };
		}
		if (sql.includes("SELECT id, state, context FROM conversations")) {
			const c = convs.get(String(p[0]));
			return c && c.user_uuid === p[1] && c.organization_uuid === p[2] ? { rows: [{ id: c.id, state: c.state, context: structuredClone(c.context) }], rowCount: 1 } : { rows: [], rowCount: 0 };
		}
		if (sql.includes("UPDATE conversations SET state = $2")) {
			const c = convs.get(String(p[0]))!;
			c.state = String(p[1]); c.context = JSON.parse(String(p[2]));
			return { rows: [], rowCount: 1 };
		}
		if (sql.includes("INSERT INTO messages")) {
			msgs.push({ conversation_id: String(p[0]), role: String(p[1]), content: JSON.parse(String(p[2])) });
			return { rows: [], rowCount: 1 };
		}
		if (sql.includes("SELECT content FROM messages")) return { rows: msgs.filter((m) => m.conversation_id === p[0]).map((m) => ({ content: structuredClone(m.content) })), rowCount: 1 };
		if (sql.includes("INSERT INTO audit_log")) return { rows: [], rowCount: 1 };
		throw new Error(`memDb: неожиданный запрос ${sql.slice(0, 80)}`);
	};
	return { db: { query } as unknown as Db };
}

test("сквозной: задача из списка закрывается с результатом через карточку «Закрыть задачу?»", async () => {
	const steps: ((req: LLMRequest) => Partial<LLMResponse>)[] = [
		() => ({ toolCalls: [{ id: "c1", name: "list_tasks", input: {} } as ToolCall] }),
		() => ({ toolCalls: [{ id: "c2", name: "complete_task", input: { taskId: TASK, result: "Сдана форма 200.00 за 3 квартал, квитанция в 1С" } } as ToolCall] }),
		() => ({ text: "Задача закрыта." }),
	];
	const llm = {
		name: "script",
		chat: async (req: LLMRequest): Promise<LLMResponse> => {
			const step = steps.shift();
			if (!step) throw new Error("модель вызвана сверх сценария");
			const r = step(req);
			return { text: r.text ?? "", toolCalls: r.toolCalls ?? [], stopReason: r.toolCalls?.length ? "tool_use" : "end_turn", model: "script" };
		},
	};
	const h = runner();
	const mem = memDb();
	const forbidden = () => { throw new Error("задачи не идут в 1С"); };
	const workflow = new ChatWorkflow({
		db: mem.db, log: silent, llm,
		agents: { pickOnline: forbidden, listByOrganization: forbidden } as never,
		queue: { enqueue: forbidden, waitResult: forbidden } as never,
		audit: new Audit(mem.db, silent), confirmWrite: true, commandTimeoutMs: 1000, maxToolRounds: 8,
		files: { save: forbidden } as never, serverTools: h.r,
	});
	const user = onecUser();
	const id = await workflow.prepare(user, null);
	const asked = await workflow.handle(user, id, "закрой задачу по 200-й, отчёт сдан, квитанция в 1С");
	assert.equal(asked.state, "WAITING_CONFIRMATION", "задача из list_tasks должна пройти проверку «видена» и дойти до карточки");
	assert.equal(asked.confirmation?.card, "Закрыть задачу «Сдать 200.00»\nРезультат: Сдана форма 200.00 за 3 квартал, квитанция в 1С");
	assert.match(asked.text, /Закрыть задачу\?$/);
	assert.equal(h.calls.filter((c) => c.method === "updateTask").length, 0, "до подтверждения в ERP ничего не меняется");

	const done = await workflow.decide(user, id, true);
	assert.equal(done.state, "COMPLETED");
	const upd = h.calls.find((c) => c.method === "updateTask")!;
	assert.equal(upd.args[1], TASK);
	assert.deepEqual([(upd.args[2] as { close?: boolean }).close, (upd.args[2] as { result?: string }).result], [true, "Сдана форма 200.00 за 3 квартал, квитанция в 1С"]);
});
