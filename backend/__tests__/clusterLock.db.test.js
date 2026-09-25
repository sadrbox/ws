// Блокировка задачи между процессами (services/clusterLock.js) против живого Postgres.
//
// Идёт только на базе, в имени которой есть «test» (CI — buhprof_test, одноразовые копии): тест
// обрывает соединения своих же сессий (pg_terminate_backend) — на рабочей базе этому не место.
// Таблицы не нужны: advisory-локи живут вне схемы, хватит пустой базы.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createLockSession, lockKeyOf } from "../services/clusterLock.js";

const dbName = (() => {
	try { return new URL(process.env.DATABASE_URL || "").pathname.replace(/^\//, ""); } catch { return ""; }
})();
const RUN = /test/i.test(dbName);
const NAMESPACE = 7213002;
const quiet = { warn: () => {} };

let probe = null;
async function lockHolders(name) {
	probe ??= new pg.Client({ connectionString: process.env.DATABASE_URL });
	if (!probe._connected) { await probe.connect(); probe._connected = true; }
	const r = await probe.query(
		`SELECT a.pid, a.application_name FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
		 WHERE l.locktype = 'advisory' AND l.classid = $1 AND l.objid = $2 AND l.granted`,
		[NAMESPACE, lockKeyOf(name) >>> 0],
	);
	return r.rows;
}

after(async () => { if (probe?._connected) await probe.end(); });

test("живой Postgres: лок держит одно соединение блокировок и снимается им же", { skip: !RUN && `база «${dbName}» — не тестовая` }, async () => {
	const a = createLockSession({ clustered: true, log: quiet });
	const b = createLockSession({ clustered: true, log: quiet });
	try {
		let release;
		const running = a.withLock("db-test-backup", () => new Promise((r) => { release = r; }));
		await new Promise((r) => setTimeout(r, 200));
		const holders = await lockHolders("db-test-backup");
		assert.equal(holders.length, 1, "лок взят ровно одним соединением");
		assert.match(holders[0].application_name, /^aleppo-locks/, "и это соединение блокировок, а не пул");
		assert.equal(await b.withLock("db-test-backup", async () => "b"), undefined, "второй воркер пропускает");
		release("a");
		assert.equal(await running, "a");
		assert.equal((await lockHolders("db-test-backup")).length, 0, "после задачи лок снят (раньше висел на чужом соединении)");
		assert.equal(await b.withLock("db-test-backup", async () => "b"), "b");
	} finally {
		await a.close();
		await b.close();
	}
});

test("живой Postgres: обрыв соединения снимает лок, следующее взятие переподключается", { skip: !RUN && `база «${dbName}» — не тестовая` }, async () => {
	const a = createLockSession({ clustered: true, log: quiet });
	const b = createLockSession({ clustered: true, log: quiet });
	try {
		let release;
		const running = a.withLock("db-test-kill", () => new Promise((r) => { release = r; }));
		await new Promise((r) => setTimeout(r, 200));
		const [{ pid }] = await lockHolders("db-test-kill");
		await probe.query("SELECT pg_terminate_backend($1)", [pid]);
		await new Promise((r) => setTimeout(r, 300));
		assert.equal((await lockHolders("db-test-kill")).length, 0, "Postgres снял лок вместе с сессией");
		assert.equal(await b.withLock("db-test-kill", async () => "b"), "b", "задача снова доступна");
		release("a");
		assert.equal(await running, "a", "прерванная защита не роняет задачу");
		assert.equal(await a.withLock("db-test-kill", async () => "again"), "again", "новое соединение открыто");
		assert.equal((await lockHolders("db-test-kill")).length, 0);
	} finally {
		await a.close();
		await b.close();
	}
});
