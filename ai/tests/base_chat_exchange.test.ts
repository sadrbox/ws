/**
 * С2: версия расширения и последний обмен — из канала чата.
 *
 * Здесь проверяется ЦЕНА записи, а не её содержимое: форма 1С опрашивает диалог раз в секунду, и UPDATE на
 * каждый запрос — это запись в базу секунда в секунду на каждого работающего человека ради поля, которое читают
 * глазами раз в день. Но обновление расширения у клиента — ровно то событие, из-за которого в панель и смотрят,
 * поэтому смена версии должна доезжать немедленно, а не через минуту.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BaseChatExchangeStore } from "../src/bases/chatExchange.ts";
import type { Db } from "../src/db/pool.ts";

const BASE = "bbbbbbbb-0000-4000-8000-000000000001";

/** База данных, которая только записывает, о чём её спросили. */
function fakeDb() {
	const calls: { sql: string; params: unknown[] }[] = [];
	const db = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: [], rowCount: 0 }; } };
	return { calls, db: db as unknown as Db };
}

test("С2: подряд идущие запросы одной базы не превращаются в поток UPDATE", async () => {
	const { calls, db } = fakeDb();
	const store = new BaseChatExchangeStore(db, { throttleMs: 60_000 });
	assert.equal(await store.note(BASE, "1.6.1"), true, "первый запрос пишется всегда");
	assert.equal(await store.note(BASE, "1.6.1"), false);
	assert.equal(await store.note(BASE, "1.6.1"), false);
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0]!.params, [BASE, "1.6.1"]);
});

test("С2: сменилась версия — пишем немедленно, не дожидаясь срока", async () => {
	const { calls, db } = fakeDb();
	const store = new BaseChatExchangeStore(db, { throttleMs: 60_000 });
	await store.note(BASE, "1.6.0");
	assert.equal(await store.note(BASE, "1.6.1"), true, "обновление у клиента — то самое событие, ради которого смотрят в панель");
	assert.equal(calls.length, 2);
	assert.equal(calls[1]!.params[1], "1.6.1");
});

test("С2: срок вышел — пишем снова, чтобы «последний обмен» не отставал", async () => {
	const { calls, db } = fakeDb();
	const store = new BaseChatExchangeStore(db, { throttleMs: 0 });
	await store.note(BASE, "1.6.1");
	await store.note(BASE, "1.6.1");
	assert.equal(calls.length, 2);
});

test("С2: версии в запросе нет — время обновляем, известную сборку не затираем", async () => {
	const { calls, db } = fakeDb();
	const store = new BaseChatExchangeStore(db, { throttleMs: 60_000 });
	await store.note(BASE, null);
	assert.equal(calls.length, 1);
	// Пустая строка в параметре и `NULLIF($2, '')` в запросе — это и есть «не затирать».
	assert.equal(calls[0]!.params[1], "");
	assert.match(calls[0]!.sql, /NULLIF\(\$2, ''\)/);
	assert.match(calls[0]!.sql, /chat_seen_at = now\(\)/);
});

test("С2: разные базы считаются по отдельности", async () => {
	const { calls, db } = fakeDb();
	const store = new BaseChatExchangeStore(db, { throttleMs: 60_000 });
	await store.note(BASE, "1.6.1");
	await store.note("bbbbbbbb-0000-4000-8000-000000000002", "1.6.1");
	assert.equal(calls.length, 2);
});
