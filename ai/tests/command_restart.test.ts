/**
 * Перезапуск агента не должен останавливать очередь на четверть часа.
 *
 * ЖИВОЙ СЛУЧАЙ 12.09 (23:14). Службу агента обновили. Забранная ею `IB_LIST_USERS` по базе
 * `abdali` осталась без ответа — прерванная посреди работы команда не оставляет ничего даже
 * в spool. При `AGENT_IB_PARALLEL = 1` она заняла единственное место внутрибазовых операций,
 * и двенадцать минут панель показывала «Выполняется» там, где не выполнялось ничего.
 *
 * Проверяется ровно то, из-за чего это молча повторится: команда помечается процессом,
 * который её забрал, и при регистрации НОВОГО процесса закрывается — но только чужая.
 * Ошибка в последнем условии дороже самой задержки: агент регистрируется повторно и без
 * перезапуска (перевыпуск токена, появившийся вход в базу), и закрытие СВОИХ команд убило бы
 * выгрузку базы, которая честно идёт третий час.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandQueue } from "../src/commands/queue.ts";
import type { Db } from "../src/db/pool.ts";

type Call = { sql: string; params: unknown[] };

/** Поддельная база: запоминает запросы и отвечает тем, что нужно разбираемому пути. */
function fakeDb(calls: Call[], answer: (sql: string) => { rows: unknown[]; rowCount: number }): Db {
	const query = async (sql: string, params: unknown[] = []) => {
		calls.push({ sql, params });
		return answer(sql);
	};
	return {
		query,
		// Выдача команд идёт в транзакции с замком на агента (А1): клиент отдаёт те же ответы, что и пул.
		connect: async () => ({ query, release: () => {} }),
	} as unknown as Db;
}

test("выдача команды запоминает процесс агента", async () => {
	const calls: Call[] = [];
	const db = fakeDb(calls, (sql) =>
		sql.includes("count(*)") ? { rows: [{ n: "0" }], rowCount: 1 } : { rows: [], rowCount: 0 });

	await new CommandQueue(db).take("agent-1", 0, "X57#3316");

	const dispatch = calls.find((c) => c.sql.includes("SET state = 'dispatched'"));
	assert.ok(dispatch, "команда выдачи не выполнялась");
	assert.match(dispatch.sql, /dispatched_instance = \$3/);
	assert.equal(dispatch.params[2], "X57#3316");
});

test("сборка без имени экземпляра работает как раньше: пишем NULL, а не выдумываем", async () => {
	const calls: Call[] = [];
	const db = fakeDb(calls, (sql) =>
		sql.includes("count(*)") ? { rows: [{ n: "0" }], rowCount: 1 } : { rows: [], rowCount: 0 });

	await new CommandQueue(db).take("agent-1", 0);

	const dispatch = calls.find((c) => c.sql.includes("SET state = 'dispatched'"));
	assert.equal(dispatch?.params[2], null);
});

test("регистрация нового процесса закрывает команды прежнего — и только их", async () => {
	const calls: Call[] = [];
	const db = fakeDb(calls, () => ({
		rows: [{ id: "cmd_1", type: "IB_LIST_USERS", base_key: "abdali" }], rowCount: 1,
	}));

	const lost = await new CommandQueue(db).failLostByRestart("agent-1", "X57#9999");

	assert.deepEqual(lost, [{ id: "cmd_1", type: "IB_LIST_USERS", baseKey: "abdali" }]);
	const [call] = calls;
	// Закрываем только ЗАБРАННЫЕ и только ЧУЖИМ процессом.
	assert.match(call.sql, /state = 'dispatched'/);
	assert.match(call.sql, /dispatched_instance <> \$2/);
	// Неизвестно, кто забрал (старая сборка, команда до миграции) — не трогаем: их закроет срок.
	assert.match(call.sql, /dispatched_instance IS NOT NULL/);
	assert.deepEqual(call.params, ["agent-1", "X57#9999"]);
	assert.match(JSON.stringify(call.sql), /AGENT_RESTARTED/);
});

test("экземпляр не назван — не закрываем ничего вслепую", async () => {
	const calls: Call[] = [];
	const db = fakeDb(calls, () => ({ rows: [], rowCount: 0 }));

	const lost = await new CommandQueue(db).failLostByRestart("agent-1", "");

	assert.deepEqual(lost, []);
	assert.equal(calls.length, 0, "запроса к базе быть не должно");
});
