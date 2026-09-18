// Выборочная проверка баз данных внутри «Обновить» (18.09).
//
// Полная проверка всех баз идёт десятки секунд и стучится в СУБД по каждой базе (живой замер 17.09: 111 баз — 34 с).
// Поэтому «Обновить» проверяет только тех, кого ещё не проверяли или проверяли давно, — а «проверено» ставится по
// ответу агента, а не по факту запроса.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "../src/db/pool.ts";
import { BaseService } from "../src/bases/service.ts";

type Call = { sql: string; params: unknown[] };

function recorder(rows: Record<string, unknown>[] = []): { db: Db; calls: Call[] } {
	const calls: Call[] = [];
	const db = {
		query: async (sql: string, params: unknown[] = []) => {
			calls.push({ sql, params });
			return { rows, rowCount: rows.length };
		},
	} as unknown as Db;
	return { db, calls };
}
const find = (calls: Call[], needle: string) => calls.find((c) => c.sql.includes(needle));

test("«проверено» ставится только тем базам, про которые агент ответил определённо", async () => {
	const { db, calls } = recorder();
	await new BaseService(db).applyDbPresence("srv-1", [
		{ key: "alive", dbMissing: false },
		{ key: "dead", dbMissing: true },
		// Проверить не удалось: признака нет — и отметки «проверено» быть не должно.
		{ key: "unknown" },
		{ key: "unknown2", dbMissing: null },
	]);
	const marked = find(calls, "db_checked_at = now()");
	assert.ok(marked, "отметка «проверено» не поставлена");
	assert.deepEqual(marked.params[1], ["alive", "dead"]);
});

test("ответ без единого признака не трогает реестр вовсе", async () => {
	const { db, calls } = recorder();
	await new BaseService(db).applyDbPresence("srv-1", [{ key: "x" }]);
	assert.equal(calls.length, 0);
});

test("проверяем новых и давно не проверявшихся, скрытых и отсутствующих в кластере — нет", async () => {
	const { db, calls } = recorder([{ key: "a" }, { key: "b" }]);
	const keys = await new BaseService(db).staleDbCheck("srv-1", 24, 20);
	assert.deepEqual(keys, ["a", "b"]);
	const q = calls[0];
	assert.match(q.sql, /db_checked_at IS NULL OR db_checked_at < now\(\)/);
	assert.match(q.sql, /disabled_at IS NULL/);
	assert.match(q.sql, /status <> 'MISSING'/);
	// Сначала те, кого не проверяли ни разу.
	assert.match(q.sql, /ORDER BY db_checked_at NULLS FIRST/);
	assert.deepEqual(q.params, ["srv-1", 24, 20]);
});
