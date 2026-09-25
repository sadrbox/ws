// Обрыв соединения с Postgres не роняет сервис (src/db/pool.ts) — без базы: события пула и соединения
// подаются руками, как их подаёт pg при «terminating connection due to administrator command».

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import pg from "pg";
import { guardPool } from "../src/db/pool.ts";

function fakeLog() {
	const warns: { entry: Record<string, unknown>; msg: string }[] = [];
	return { warns, log: { warn: (entry: Record<string, unknown>, msg: string) => { warns.push({ entry, msg }); } } };
}

const terminated = () => Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" });

test("обрыв простаивающего соединения: событие пула обработано, процесс не падает", () => {
	const pool = new pg.Pool({ connectionString: "postgres://nobody@127.0.0.1:1/none" });
	const { warns, log } = fakeLog();
	guardPool(pool, "db", log);
	// Без слушателя `error` это событие бросило бы исключение — ровно так сервис и падал.
	assert.doesNotThrow(() => pool.emit("error", terminated(), new EventEmitter()));
	assert.equal(warns.length, 1);
	assert.deepEqual(warns[0].entry, { pool: "db", code: "57P01", err: "terminating connection due to administrator command" });
});

test("обрыв выданного соединения (транзакция между запросами): слушает само соединение", () => {
	const pool = new pg.Pool({ connectionString: "postgres://nobody@127.0.0.1:1/none" });
	const { warns, log } = fakeLog();
	guardPool(pool, "db", log);
	const client = new EventEmitter();
	pool.emit("connect", client);
	assert.doesNotThrow(() => client.emit("error", terminated()));
	assert.equal(warns.length, 1);
});

test("одна ошибка простаивающего соединения приходит дважды (соединение, затем пул) — запись одна", () => {
	const pool = new pg.Pool({ connectionString: "postgres://nobody@127.0.0.1:1/none" });
	const { warns, log } = fakeLog();
	guardPool(pool, "erp", log);
	const client = new EventEmitter();
	pool.emit("connect", client);
	const err = terminated();
	client.emit("error", err);
	pool.emit("error", err, client);
	assert.equal(warns.length, 1);
	pool.emit("error", terminated(), client);
	assert.equal(warns.length, 2, "новая ошибка — новая запись");
});

test("без логгера (инструменты) — пишет в консоль и тоже не падает", (t) => {
	const pool = new pg.Pool({ connectionString: "postgres://nobody@127.0.0.1:1/none" });
	const warn = t.mock.method(console, "warn", () => {});
	guardPool(pool, "db");
	assert.doesNotThrow(() => pool.emit("error", terminated(), new EventEmitter()));
	assert.equal(warn.mock.callCount(), 1);
});
