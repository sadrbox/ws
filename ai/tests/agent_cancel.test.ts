/**
 * S4 из docs/TASKS_ONEC_FIXES_2026-09-13.md: `AGENT_CANCEL_COMMAND` — прервать начатую команду.
 *
 * Держим то, что ошибкой обходится дороже всего: прерывается только ЧТЕНИЕ (обрыв выгрузки или
 * обновления оставляет базу в промежуточном состоянии); отмену получает только агент с
 * `agent.cancel` (старые сборки её объявляют, но не доносят); прерванную команду закрывает
 * сервис, иначе она держит место до срока; сама отмена места внутрибазовых не ждёт.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { abortAllowed, agentCanRun, buildAdminPayload, findAdminCommand, isAbortable } from "../src/commands/admin.ts";
import { CommandQueue } from "../src/commands/queue.ts";
import { isDestructive } from "../src/onec/access.ts";
import type { Db } from "../src/db/pool.ts";

type Call = { sql: string; params: unknown[] };

function fakeDb(calls: Call[], answer: (sql: string) => { rows: unknown[]; rowCount: number }): Db {
	return {
		query: async (sql: string, params: unknown[] = []) => {
			calls.push({ sql, params });
			return answer(sql);
		},
		connect: async () => { throw new Error("не нужен"); },
	} as unknown as Db;
}

test("спецификация: CRITICAL, способность agent.cancel, без базы", () => {
	const spec = findAdminCommand("AGENT_CANCEL_COMMAND");
	assert.ok(spec, "команды нет в белом списке");
	assert.equal(spec.operation, "CRITICAL");
	assert.equal(spec.capability, "agent.cancel");
	assert.equal(spec.requiresBase, false);
	assert.ok(buildAdminPayload(spec, { commandId: "c-1" }).ok);
	assert.ok(buildAdminPayload(spec, { commandId: "c-1", force: true }).ok);
	assert.equal(buildAdminPayload(spec, {}).ok, false);
	assert.equal(buildAdminPayload(spec, { commandId: "c-1", baseKey: "x" }).ok, false);
});

test("гейт: сборка без agent.cancel отмену не получает, даже если объявляет тип команды", () => {
	const spec = findAdminCommand("AGENT_CANCEL_COMMAND")!;
	// Сборки 12.09 23:48 — 13.09 12:12: тип объявлен, но отмена не доходит до занятого агента.
	assert.equal(agentCanRun({ role: "admin", capabilities: ["cluster.admin", "agent.procs", "AGENT_CANCEL_COMMAND"] }, spec), false);
	assert.equal(agentCanRun({ role: "admin", capabilities: ["cluster.admin", "agent.cancel", "AGENT_CANCEL_COMMAND"] }, spec), true);
});

test("прервать можно только начатое чтение у агента, который умеет отмену", () => {
	assert.equal(isAbortable("dispatched", "IB_LIST_USERS", true), true);
	assert.equal(isAbortable("queued", "IB_LIST_USERS", true), false, "не начатое отменяют до начала");
	assert.equal(isAbortable("done", "IB_LIST_USERS", true), false);
	assert.equal(isAbortable("dispatched", "IB_BACKUP", true), false, "выгрузку не обрываем");
	assert.equal(isAbortable("dispatched", "IB_UPDATE_USER", true), false, "запись не обрываем");
	assert.equal(isAbortable("dispatched", "IB_LIST_USERS", false), false, "агент без agent.cancel");
});

test("прерванную команду закрывает сервис — только начатую — и будит опрос агента", async () => {
	const calls: Call[] = [];
	const queue = new CommandQueue(fakeDb(calls, (sql) =>
		sql.includes("COMMAND_ABORTED") ? { rows: [{ agent_id: "agent-1", base_key: "abdali" }], rowCount: 1 } : { rows: [], rowCount: 0 }));

	assert.equal(await queue.abort("cmd-1", "user-1", "снята по запросу"), true);
	const upd = calls.find((c) => c.sql.includes("COMMAND_ABORTED"));
	assert.ok(upd);
	assert.match(upd.sql, /state = 'canceled'/);
	assert.match(upd.sql, /WHERE id = \$1 AND state = 'dispatched'/);
	assert.deepEqual(upd.params, ["cmd-1", "user-1", "снята по запросу"]);
});

test("итог успел прийти сам — прерывать нечего", async () => {
	const queue = new CommandQueue(fakeDb([], () => ({ rows: [], rowCount: 0 })));
	assert.equal(await queue.abort("cmd-1", "user-1", null), false);
});

test("место внутрибазовых считает только команды с базой — отмена его не ждёт", async () => {
	const calls: Call[] = [];
	const db = fakeDb(calls, (sql) =>
		sql.includes("count(*)") ? { rows: [{ n: "0" }], rowCount: 1 } : { rows: [], rowCount: 0 });
	await new CommandQueue(db).take("agent-1", 0, "SERVER#1");
	const busy = calls.find((c) => c.sql.includes("count(*)") && c.sql.includes("dispatched"));
	assert.ok(busy, "подсчёт занятых мест не выполнялся");
	assert.match(busy.sql, /base_key IS NOT NULL/);
});

test("прерывание — изменение: уровню readonly недоступно", () => {
	assert.equal(isDestructive("POST", "/commands/7c1/abort"), true);
});

test("С23: проверку без «Исправлять» прерывают — только у агента, снимающего конфигуратор", () => {
	assert.equal(abortAllowed("IB_CHECK", { baseKey: "b" }), true);
	assert.equal(abortAllowed("IB_CHECK", { baseKey: "b", repair: true }), false, "исправление не обрываем");
	assert.equal(abortAllowed("IB_RESTORE", { baseKey: "b" }), false);
	const old = { canCancel: true, canCancelCheck: false };
	const fresh = { canCancel: true, canCancelCheck: true };
	assert.equal(isAbortable("dispatched", "IB_CHECK", old, { baseKey: "b" }), false, "агент без А21");
	assert.equal(isAbortable("dispatched", "IB_CHECK", fresh, { baseKey: "b" }), true);
	assert.equal(isAbortable("dispatched", "IB_CHECK", fresh, { baseKey: "b", repair: true }), false);
	assert.equal(isAbortable("dispatched", "IB_LIST_USERS", fresh), true);
});
