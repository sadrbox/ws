/**
 * S1 и S2 из docs/TASKS_ONEC_FIXES_2026-09-13.md.
 *
 * S1. Прощальный heartbeat (`status: "OFFLINE"`) освобождает владение токеном — но только
 * если прощается сам владелец. Ошибка в первую сторону — 409 «другой экземпляр» после каждого
 * обновления службы; во вторую — прощание чужой копии токена снимает владение с работающего
 * агента.
 *
 * S2. Поздний результат не перетирает отменённую команду; по истёкшей — принимается, как раньше.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isFarewell } from "../src/agents/instances.ts";
import { AgentService } from "../src/agents/service.ts";
import { CommandQueue } from "../src/commands/queue.ts";
import type { Db } from "../src/db/pool.ts";

type Call = { sql: string; params: unknown[] };

function fakeDb(calls: Call[], rowCount: number, rows: unknown[] = []): Db {
	return {
		query: async (sql: string, params: unknown[] = []) => {
			calls.push({ sql, params });
			return { rows, rowCount };
		},
		connect: async () => { throw new Error("не нужен"); },
	} as unknown as Db;
}

test("S1: прощание — только OFFLINE; обычный heartbeat владение не трогает", () => {
	assert.equal(isFarewell("OFFLINE"), true);
	assert.equal(isFarewell(" offline "), true);
	assert.equal(isFarewell("ONLINE"), false);
	assert.equal(isFarewell("DEGRADED"), false);
});

test("S1: владение снимается только у того экземпляра, который прощается", async () => {
	const calls: Call[] = [];
	const released = await new AgentService(fakeDb(calls, 1), 90).releaseOwnershipIf("agent-1", "SERVER#5692");

	assert.equal(released, true);
	const upd = calls.find((c) => c.sql.includes("UPDATE agents"));
	assert.ok(upd, "снятия не было");
	// Сравнение с владельцем — в самом UPDATE: между чтением и снятием аренду мог забрать новый процесс.
	assert.match(upd.sql, /owner_instance_id = NULL/);
	assert.match(upd.sql, /WHERE id = \$1 AND owner_instance_id = \$2/);
	assert.deepEqual(upd.params, ["agent-1", "SERVER#5692"]);
});

test("S1: прощание чужого экземпляра ничего не снимает", async () => {
	// Владелец другой — условие UPDATE не совпало, строк 0.
	const released = await new AgentService(fakeDb([], 0), 90).releaseOwnershipIf("agent-1", "X57#3316");
	assert.equal(released, false);
});

test("S2: результат не принимается по отменённой команде, по истёкшей — принимается", async () => {
	const calls: Call[] = [];
	const row = await new CommandQueue(fakeDb(calls, 0)).complete("agent-1", {
		commandId: "cmd-1", agentId: "agent-1", status: "SUCCESS", result: { ok: true },
	} as Parameters<CommandQueue["complete"]>[1]);

	assert.equal(row, null, "по отменённой команде строки нет — обработчик ответит ignored");
	const upd = calls.find((c) => c.sql.includes("UPDATE commands"));
	assert.ok(upd);
	assert.match(upd.sql, /state <> 'canceled'/);
	// Истёкшие не исключены: агент досылает их результаты из spool, и это правда о работе.
	assert.doesNotMatch(upd.sql.split("WHERE")[1] ?? "", /expired/);
	// …но такой результат отмечается поздним (С21).
	assert.match(upd.sql, /late = late OR state = 'expired'/);
});
