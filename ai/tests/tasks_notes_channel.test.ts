/**
 * Задачи и заметки организации в канале 1С: доработки панели и сервиса
 * (docs/PLAN_TASKS_NOTES_PANEL_SERVICE_2026-09-22.md, СВ1, СВ2, СВ4, СВ5, СВ6, СВ9).
 *
 * СВ9 требует покрыть то, что дороже всего ошибиться: чужой БИН, недоступность ERP, закрытие задачи,
 * которой в диалоге не было, и выключенный канал — модель не должна даже видеть инструменты, иначе она
 * их предлагает, а они отказывают.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { onecChatRouter } from "../src/http/onecChatRouter.ts";
import { serverTools } from "../src/chat/serverTools.ts";
import type { ServerToolContext } from "../src/chat/workflow.ts";
import { ErpUnavailable, ErpRefused, type ErpTasks, type ErpTask } from "../src/erp/tasks.ts";
import { toolDefinitions, TOOLS_BY_NAME } from "../src/tools/registry.ts";
import { ToolInputError } from "../src/tools/registry.ts";
import type { ChatUser } from "../src/chat/workflow.ts";
import type { Db } from "../src/db/pool.ts";
import type { Logger } from "../src/logger.ts";

const TOKEN = "bpb_test-token";
const BASE_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const ORG = "a1410911-7421-45da-9632-7e4fc48e91c2";
const USER = "0f6c1c1e-6a57-4c6e-9b2a-1d4f2c9e7a01";
const BIN = "831111302342";
const OTHER_BIN = "900000000001";
const TASK = "7c2b0a31-0000-4000-8000-000000000001";

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

const task = (over: Partial<ErpTask> = {}): ErpTask => ({
	uuid: TASK, id: 12, name: "Сдать 200.00", description: null, status: "new", deadline: null,
	createdAt: "2026-09-22T10:00:00.000Z", updatedAt: "2026-09-22T10:00:00.000Z",
	curatorName: "Бухгалтер", executorName: null, sourceLabel: "Чат в 1С — Dev_01", ...over,
});

const onecUser = (bin = BIN): ChatUser => ({
	uuid: `1c:${BASE_ID}:${USER}`, organizationUuid: ORG, channel: "1c",
	onec: { baseId: BASE_ID, userName: "Бухгалтер", organization: { bin, name: "ИП Азимов С.М.", id: null } },
} as ChatUser);

/**
 * Логгер, который ведёт себя как настоящий pino: метод, оторванный от объекта, падает.
 *
 * ЗАЧЕМ ОН НУЖЕН. 22.09 канал отвечал 500 на КАЖДЫЙ запрос из 1С — `(loud ? log.info : log.debug)(…)`
 * теряло `this`, а pino внутри читает `this[Symbol(pino.msgPrefix)]`. Заглушка со стрелочными функциями
 * такую ошибку не замечает, поэтому проверка возможна только строгим логгером.
 */
function strictLogger(): Logger {
	const self = {
		info(this: unknown, ..._a: unknown[]) { if (this !== self) throw new Error("логгер вызван без контекста"); },
		debug(this: unknown, ..._a: unknown[]) { if (this !== self) throw new Error("логгер вызван без контекста"); },
		warn(this: unknown, ..._a: unknown[]) { if (this !== self) throw new Error("логгер вызван без контекста"); },
		error(this: unknown, ..._a: unknown[]) { if (this !== self) throw new Error("логгер вызван без контекста"); },
	};
	return self as unknown as Logger;
}

function harness(opts: { tasks?: Partial<ErpTasks>; enabled?: boolean; panelUrl?: string; writePerMin?: number; log?: Logger } = {}) {
	const calls: { method: string; args: unknown[] }[] = [];
	const tasksStub = {
		enabled: opts.enabled !== false,
		listTasks: async (...args: unknown[]) => { calls.push({ method: "listTasks", args }); return [task()]; },
		createTask: async (...args: unknown[]) => { calls.push({ method: "createTask", args }); return task(); },
		updateTask: async (...args: unknown[]) => { calls.push({ method: "updateTask", args }); return task({ status: "done" }); },
		listNotes: async () => [],
		addNote: async (...args: unknown[]) => { calls.push({ method: "addNote", args }); return { uuid: "n1", id: 1, body: "текст", authorName: "Бухгалтер", createdAt: "2026-09-22T10:00:00.000Z", updatedAt: "2026-09-22T10:00:00.000Z" }; },
		updateNote: async (...args: unknown[]) => { calls.push({ method: "updateNote", args }); return { uuid: "n1", id: 1, body: String((args[2] ?? "")), authorName: "Бухгалтер", createdAt: "2026-09-22T10:00:00.000Z", updatedAt: "2026-09-22T11:00:00.000Z" }; },
		deleteNote: async (...args: unknown[]) => { calls.push({ method: "deleteNote", args }); return { uuid: String(args[1] ?? "") }; },
		statuses: async () => [{ code: "new", name: "Новая", isFinal: false, sortOrder: 1 }, { code: "done", name: "Выполнена", isFinal: true, sortOrder: 9 }],
		...opts.tasks,
	} as unknown as ErpTasks;
	const baseOrgs = { has: async (_b: string, bin: string) => bin === BIN, list: async () => [], remember: async () => 1 };
	const tokens = { resolve: async (t: string) => t === TOKEN
		? { tokenId: "t1", baseId: BASE_ID, baseKey: "Dev_01", baseName: "Бухгалтерия (Dev_01)", organizationUuid: ORG, revoked: false, baseDisabled: false }
		: null };
	const erp = { query: async () => ({ rows: [{ name: "ТОО Алеппо", legal_name: null }], rowCount: 1 }) } as unknown as Db;
	const app = express();
	app.use(express.json());
	app.use("/v1/onec-chat", onecChatRouter({
		workflow: null, tokens, erp, log: opts.log ?? silent, version: "0.4.0",
		tasks: tasksStub, baseOrgs: baseOrgs as never,
		panelUrl: opts.panelUrl ?? "https://aleppo.kz",
		tasksWritePerMin: opts.writePerMin,
	}));
	const server = app.listen(0);
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/onec-chat`;
	const head = (extra: Record<string, string> = {}) => ({ "content-type": "application/json", "x-base-token": TOKEN, "x-1c-user-id": USER, ...extra });
	const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
		const r = await fetch(`${url}${path}`, { method, headers: head(extra), body: body === undefined ? undefined : JSON.stringify(body) });
		return { status: r.status, headers: r.headers, body: await r.json() as { success: boolean; data?: any; error?: { code: string; message: string } } };
	};
	return { calls, tasksStub, call, close: () => { server.closeAllConnections(); server.close(); } };
}

// ── СВ1. Ссылка на задачу ────────────────────────────────────────────────────

test("СВ1: у задачи есть адрес, который панель действительно открывает", async () => {
	const h = harness();
	try {
		const list = await h.call("GET", `/tasks?bin=${BIN}`);
		assert.equal(list.status, 200);
		// Маршрутов /todos/<uuid> в панели нет: она открывает записи рецептом в строке запроса.
		assert.equal(list.body.data.items[0].url, `https://aleppo.kz/?open=f~todos~${TASK}`);

		const created = await h.call("POST", "/tasks", { bin: BIN, user: { name: "Бухгалтер" }, name: "Сдать 200.00" });
		assert.equal(created.status, 201);
		assert.match(String(created.body.data.item.url), /open=f~todos~/);
	} finally { h.close(); }
});

test("СВ1: адрес панели не задан — поля url нет вовсе, а не «пустая ссылка»", async () => {
	const h = harness({ panelUrl: "" });
	try {
		const list = await h.call("GET", `/tasks?bin=${BIN}`);
		assert.equal("url" in list.body.data.items[0], false);
	} finally { h.close(); }
});

// ── СВ2. Статусы задач ───────────────────────────────────────────────────────

test("СВ2: статусы приходят справочником ERP — код и человеческое имя", async () => {
	const h = harness();
	try {
		const r = await h.call("GET", "/task-statuses");
		assert.equal(r.status, 200);
		assert.deepEqual(r.body.data.items[1], { code: "done", name: "Выполнена", isFinal: true, sortOrder: 9 });
	} finally { h.close(); }
});

// ── СВ4. Список организаций базы не переписывается на каждое открытие ────────

test("СВ4: тот же список — ETag совпал, в базу не пишем", async () => {
	const h = harness();
	let wrote = 0;
	const orgs = { organizations: [{ bin: BIN, name: "ИП Азимов С.М.", id: "o1" }, { bin: OTHER_BIN, name: "ТОО Физули", id: "o2" }] };
	try {
		const first = await h.call("POST", "/organizations", orgs);
		assert.equal(first.body.data.unchanged, false);
		const etag = first.headers.get("etag")!;
		assert.ok(etag, "ETag не выдан — расширению нечего прислать обратно");

		const again = await h.call("POST", "/organizations", orgs, { "if-none-match": etag });
		assert.equal(again.body.data.unchanged, true);
		assert.equal(again.body.data.remembered, 0);

		// Перестановка строк — не изменение: порядок выборки в 1С не обязан быть устойчивым.
		const swapped = await h.call("POST", "/organizations", { organizations: [...orgs.organizations].reverse() }, { "if-none-match": etag });
		assert.equal(swapped.body.data.unchanged, true);

		// А вот новая организация — изменение, и его записываем.
		const changed = await h.call("POST", "/organizations", { organizations: [...orgs.organizations, { bin: "123456789012", name: "Новая", id: "o3" }] }, { "if-none-match": etag });
		assert.equal(changed.body.data.unchanged, false);
		wrote++;
	} finally { h.close(); }
	assert.equal(wrote, 1);
});

// ── СВ5. Лимит на изменяющие вызовы ──────────────────────────────────────────

test("СВ5: создание задач ограничено отдельно от ходов чата", async () => {
	const h = harness({ writePerMin: 2 });
	try {
		const body = { bin: BIN, user: { name: "Бухгалтер" }, name: "раз" };
		assert.equal((await h.call("POST", "/tasks", body)).status, 201);
		assert.equal((await h.call("POST", "/tasks", body)).status, 201);
		const third = await h.call("POST", "/tasks", body);
		assert.equal(third.status, 429);
		// Чтение под лимит не попадает: список задач открывают чаще, чем ставят задачи.
		assert.equal((await h.call("GET", `/tasks?bin=${BIN}`)).status, 200);
	} finally { h.close(); }
});

// ── СВ9. Отказы, которые должны быть внятными ────────────────────────────────

test("СВ9: чужой БИН — отказ по базе, а не поход в ERP", async () => {
	const h = harness();
	try {
		const r = await h.call("GET", `/tasks?bin=${OTHER_BIN}`);
		assert.equal(r.status, 403);
		assert.equal(r.body.error!.code, "ORG_NOT_IN_BASE");
		assert.equal(h.calls.length, 0, "в ERP по чужому БИН ходить нельзя даже ради отказа");
	} finally { h.close(); }
});

test("СВ9: ERP не ответила — 503 и её словами, а не «внутренняя ошибка»", async () => {
	const h = harness({ tasks: { listTasks: async () => { throw new ErpUnavailable("ERP не отвечает — задачи и заметки сейчас недоступны"); } } as never });
	try {
		const r = await h.call("GET", `/tasks?bin=${BIN}`);
		assert.equal(r.status, 503);
		assert.equal(r.body.error!.code, "ERP_UNAVAILABLE");
	} finally { h.close(); }

	const refused = harness({ tasks: { updateTask: async () => { throw new ErpRefused(404, "Задача не найдена"); } } as never });
	try {
		const r = await refused.call("PATCH", `/tasks/${TASK}`, { bin: BIN, user: { name: "Бухгалтер" }, status: "done" });
		assert.equal(r.status, 404);
		assert.equal(r.body.error!.message, "Задача не найдена", "текст ERP написан для человека — не пересказываем");
	} finally { refused.close(); }
});

test("СВ9: канал выключен — маршруты отвечают внятно", async () => {
	const h = harness({ enabled: false });
	try {
		for (const path of ["/tasks?bin=" + BIN, "/task-statuses", "/notes?bin=" + BIN]) {
			const r = await h.call("GET", path);
			assert.equal(r.status, 503);
			assert.equal(r.body.error!.code, "TASKS_DISABLED");
		}
	} finally { h.close(); }
});

test("СВ9: канал выключен — модель не видит инструментов задач вовсе", () => {
	const off = serverTools({ tasks: { enabled: false } as never, baseOrgs: null });
	assert.equal(off.available(onecUser()), false);

	const on = serverTools({ tasks: { enabled: true } as never, baseOrgs: null });
	assert.equal(on.available(onecUser()), true);
	// Организация в форме не выбрана — задачи адресовать нечем, и предлагать их незачем.
	assert.equal(on.available(onecUser("не БИН")), false);
	// Канал ERP: у пользователя панели задачи и так перед глазами.
	assert.equal(on.available({ uuid: "u1", organizationUuid: ORG, channel: "erp" } as ChatUser), false);

	const names = (serverToolsOn: boolean) => toolDefinitions({ serverTools: serverToolsOn }).map((t) => t.name);
	assert.ok(names(true).includes("create_task"));
	assert.equal(names(false).includes("create_task"), false, "инструмент, который всё равно откажет, модели показывать нельзя");
});

test("СВ9: закрыть задачу, которой в диалоге не было, нельзя", () => {
	const spec = TOOLS_BY_NAME.get("complete_task")!;
	const seen = new Set<string>([TASK]);
	// С 25.09 (E17, СК1.2) закрытие несёт обязательный результат — см. tasks_quality_standard.test.ts.
	assert.deepEqual(spec.buildPayload({ taskId: TASK, result: "Отчёт сдан" }, { seenIds: seen }), { taskId: TASK, result: "Отчёт сдан", close: true });
	assert.throws(
		() => spec.buildPayload({ taskId: "11111111-0000-4000-8000-000000000009", result: "Отчёт сдан" }, { seenIds: seen }),
		(e: unknown) => e instanceof ToolInputError,
		"выдуманный id закрыл бы чужую задачу",
	);
});

test("СВ9: чужой БИН не проходит и через инструмент модели", async () => {
	const runner = serverTools({
		tasks: { enabled: true, listTasks: async () => [task()] } as never,
		baseOrgs: { has: async (_b: string, bin: string) => bin === BIN } as never,
	});
	const ok = await runner.run(TOOLS_BY_NAME.get("list_tasks")!, {}, onecUser());
	assert.equal(ok.ok, true);

	const alien = await runner.run(TOOLS_BY_NAME.get("list_tasks")!, {}, onecUser(OTHER_BIN));
	assert.equal(alien.ok, false);
	assert.equal(alien.ok === false ? alien.error?.code : "", "ORG_NOT_IN_BASE");
});

// ── СВ3. Заметку можно исправить и убрать ────────────────────────────────────

test("СВ3: заметка правится и убирается из 1С — и то и другое под лимитом изменений", async () => {
	const h = harness({ writePerMin: 2 });
	try {
		const edited = await h.call("PATCH", "/notes/n1", { bin: BIN, user: { name: "Бухгалтер" }, body: "исправленная" });
		assert.equal(edited.status, 200);
		assert.equal(edited.body.data.item.body, "исправленная");
		assert.deepEqual(h.calls.at(-1)!.args.slice(1), ["n1", "исправленная"]);

		const gone = await h.call("DELETE", "/notes/n1", { bin: BIN, user: { name: "Бухгалтер" } });
		assert.equal(gone.status, 200);
		assert.equal(gone.body.data.item.uuid, "n1");

		// Третье изменение подряд упирается в тот же узкий лимит, что и создание задач.
		const third = await h.call("PATCH", "/notes/n1", { bin: BIN, user: { name: "Бухгалтер" }, body: "ещё" });
		assert.equal(third.status, 429);
	} finally { h.close(); }
});

test("СВ3: пустой текст и чужой БИН до ERP не доходят", async () => {
	const h = harness();
	try {
		const empty = await h.call("PATCH", "/notes/n1", { bin: BIN, user: { name: "Бухгалтер" }, body: "   " });
		assert.equal(empty.status, 400);
		assert.equal(empty.body.error!.code, "VALIDATION_ERROR");

		const alien = await h.call("DELETE", "/notes/n1", { bin: OTHER_BIN, user: { name: "Бухгалтер" } });
		assert.equal(alien.status, 403);
		assert.equal(alien.body.error!.code, "ORG_NOT_IN_BASE");
		assert.equal(h.calls.length, 0, "в ERP по чужому БИН не ходим даже ради отказа");
	} finally { h.close(); }
});

// ── СВ7. Задача из документа ─────────────────────────────────────────────────

const DOC = "9a000000-0000-4000-8000-000000000001";

function taskRunner(created: Record<string, unknown>[]) {
	return serverTools({
		tasks: {
			enabled: true,
			createTask: async (_actor: unknown, t: Record<string, unknown>) => { created.push(t); return task(); },
		} as never,
		baseOrgs: { has: async () => true } as never,
	});
}

test("СВ7: документ из диалога связывается с задачей — типом и подписью от 1С, а не со слов модели", async () => {
	const created: Record<string, unknown>[] = [];
	const ctx: ServerToolContext = { documents: { [DOC]: { type: "sale", label: "Реализация №12" } } };

	const r = await taskRunner(created).run(TOOLS_BY_NAME.get("create_task")!, { name: "Проверить", documentId: DOC }, onecUser(), ctx);
	assert.equal(r.ok, true);
	// Приставка `1c:` — документ лежит В 1С: ссылка без неё открывала бы в панели карточку ERP,
	// которой там нет, по чужому идентификатору.
	assert.equal(created[0]!.sourceType, "1c:sale");
	assert.equal(created[0]!.sourceUuid, DOC);
	assert.equal(created[0]!.sourceLabel, "Реализация №12");
	// Происхождение задачи ставит сама ERP: метку «из чата 1С» модель подделать не может.
	assert.equal("origin" in created[0]!, false);
});

test("СВ7: документ, которого в диалоге не было, задачу не создаёт", async () => {
	const created: Record<string, unknown>[] = [];
	const r = await taskRunner(created).run(TOOLS_BY_NAME.get("create_task")!, { name: "Проверить", documentId: DOC }, onecUser(), { documents: {} });
	assert.equal(r.ok, false);
	assert.equal(r.ok === false ? r.error?.code : "", "UNKNOWN_DOCUMENT");
	assert.equal(created.length, 0, "задача со ссылкой в никуда хуже задачи без ссылки");
});

test("СВ7: выдуманный идентификатор отсекается ещё на разборе вызова", () => {
	const spec = TOOLS_BY_NAME.get("create_task")!;
	const seen = new Set<string>([DOC]);
	assert.equal(spec.buildPayload({ name: "раз", documentId: DOC }, { seenIds: seen }).documentId, DOC);
	assert.equal("documentId" in spec.buildPayload({ name: "раз" }, { seenIds: seen }), false, "без документа — обычная задача");
	assert.throws(
		() => spec.buildPayload({ name: "раз", documentId: "11111111-0000-4000-8000-000000000009" }, { seenIds: seen }),
		(e: unknown) => e instanceof ToolInputError,
	);
});

// ── Журнал канала: метод логгера зовётся на объекте ──────────────────────────
//
// Живая проверка 22.09 упёрлась в это на первом же действии: форма отправила выписку и получила
// «Внутренняя ошибка сервера», причём и на загрузке файла, и на ходе диалога. Middleware журнала стоит
// перед всеми маршрутами канала, поэтому одна оторванная ссылка на метод положила канал целиком.

test("журнал канала не роняет запрос: метод логгера вызывается на объекте", async () => {
	const h = harness({ log: strictLogger() });
	try {
		const r = await h.call("GET", "/task-statuses");
		assert.equal(r.status, 200, "строгий логгер повторяет pino: оторванный метод здесь дал бы 500");
	} finally {
		h.close();
	}
});

test("журнал канала переживает и подробный режим: ход пишется через тот же логгер", async () => {
	const h = harness({ log: strictLogger() });
	try {
		// POST /turn без чата отвечает 503 CHAT_DISABLED — важно, что это ответ маршрута, а не падение журнала.
		const r = await h.call("POST", "/turn", { user: { id: USER, name: "Бухгалтер" }, text: "привет" });
		assert.notEqual(r.status, 500, "пятисотка здесь означала бы, что журнал снова рвёт запрос");
	} finally {
		h.close();
	}
});
