// Блокировка задачи между процессами (services/clusterLock.js) — без базы: подставной «Postgres»
// держит advisory-локи так же, как настоящий, — лок принадлежит СОЕДИНЕНИЮ, повторно входим
// своим соединением, снимается только им же или обрывом соединения.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createLockSession, lockKeyOf } from "../services/clusterLock.js";

/** Подставной сервер: ключ лока → {владелец-соединение, счётчик входов}. */
function fakeServer() {
	const locks = new Map();
	let seq = 0;
	const clients = [];
	const server = {
		locks,
		clients,
		/** Фабрика соединений для createLockSession. */
		connect: async () => {
			if (server.failConnect) throw new Error("connect ECONNREFUSED");
			const c = new EventEmitter();
			c.id = ++seq;
			c.ended = false;
			c.queries = [];
			c.query = async (sql, [ns, key]) => {
				if (c.ended) throw new Error("Client was closed");
				if (server.failQuery?.(sql, c)) throw new Error("query failed");
				c.queries.push(sql);
				const k = `${ns}:${key}`;
				const cur = locks.get(k);
				if (sql.includes("pg_try_advisory_lock")) {
					if (!cur) { locks.set(k, { owner: c.id, count: 1 }); return { rows: [{ ok: true }] }; }
					if (cur.owner === c.id) { cur.count++; return { rows: [{ ok: true }] }; }
					return { rows: [{ ok: false }] };
				}
				if (sql.includes("pg_advisory_unlock")) {
					// Как Postgres: чужой лок не снимается (WARNING + false).
					if (!cur || cur.owner !== c.id) return { rows: [{ ok: false }] };
					if (--cur.count === 0) locks.delete(k);
					return { rows: [{ ok: true }] };
				}
				throw new Error(`неожиданный запрос: ${sql}`);
			};
			const release = () => { for (const [k, v] of locks) if (v.owner === c.id) locks.delete(k); };
			c.end = async () => { if (c.ended) return; c.ended = true; release(); c.emit("end"); };
			/** Обрыв сети: сервер снимает локи соединения, клиент получает error. */
			c.kill = () => { c.ended = true; release(); c.emit("error", new Error("Connection terminated unexpectedly")); };
			clients.push(c);
			return c;
		},
	};
	return server;
}

const quietLog = { warn: () => {} };
const deferred = () => {
	let resolve;
	const promise = new Promise((r) => { resolve = r; });
	return { promise, resolve };
};

test("лок снимается в том же соединении, где взят: после задачи он свободен для другого воркера", async () => {
	const srv = fakeServer();
	const a = createLockSession({ connect: srv.connect, clustered: true, log: quietLog });
	const b = createLockSession({ connect: srv.connect, clustered: true, log: quietLog });
	assert.equal(await a.withLock("backup", async () => "done-a"), "done-a");
	assert.equal(srv.locks.size, 0, "после задачи лок не висит");
	assert.equal(await b.withLock("backup", async () => "done-b"), "done-b");
	assert.equal(srv.locks.size, 0);
});

test("два воркера: пока задача идёт у одного, второй пропускает запуск", async () => {
	const srv = fakeServer();
	const a = createLockSession({ connect: srv.connect, clustered: true, log: quietLog });
	const b = createLockSession({ connect: srv.connect, clustered: true, log: quietLog });
	const gate = deferred();
	let runsB = 0;
	const first = a.withLock("backup", () => gate.promise);
	await new Promise((r) => setImmediate(r));
	assert.equal(await b.withLock("backup", async () => { runsB++; }), undefined);
	assert.equal(runsB, 0, "второй воркер задачу не выполнил");
	gate.resolve("ok");
	assert.equal(await first, "ok");
	await b.withLock("backup", async () => { runsB++; });
	assert.equal(runsB, 1, "после окончания первой задачи второй воркер её берёт");
});

test("та же задача дважды в одном процессе: второй запуск пропущен, Postgres не спрашиваем", async () => {
	const srv = fakeServer();
	const a = createLockSession({ connect: srv.connect, clustered: true, log: quietLog });
	const gate = deferred();
	let runs = 0;
	const first = a.withLock("backup", async () => { runs++; await gate.promise; });
	const second = a.withLock("backup", async () => { runs++; });
	assert.equal(await second, undefined);
	gate.resolve();
	await first;
	assert.equal(runs, 1);
	const tries = srv.clients[0].queries.filter((q) => q.includes("pg_try_advisory_lock"));
	assert.equal(tries.length, 1, "повторного входа в сессионный лок нет");
	assert.equal(srv.locks.size, 0);
});

test("одно соединение на процесс, сколько бы задач ни было", async () => {
	const srv = fakeServer();
	const a = createLockSession({ connect: srv.connect, clustered: true, log: quietLog });
	await Promise.all(["backup", "audit-cleanup", "quality-sla", "quality-regulation"].map((n) => a.withLock(n, async () => n)));
	await a.withLock("backup", async () => {});
	assert.equal(srv.clients.length, 1);
	assert.equal(srv.locks.size, 0);
	assert.deepEqual(a._state().held, []);
});

test("обрыв соединения: локи сняты сервером, задача дорабатывает, следующая открывает новое соединение", async () => {
	const srv = fakeServer();
	const warns = [];
	const a = createLockSession({ connect: srv.connect, clustered: true, log: { warn: (m) => warns.push(m) } });
	const b = createLockSession({ connect: srv.connect, clustered: true, log: quietLog });
	const gate = deferred();
	const first = a.withLock("backup", () => gate.promise);
	await new Promise((r) => setImmediate(r));
	srv.clients[0].kill();
	assert.ok(warns.some((m) => /без защиты/.test(m)), "обрыв при идущей задаче — в журнал");
	// Лок снят вместе с соединением: другой воркер может взять задачу (её прежний запуск ещё идёт).
	assert.equal(await b.withLock("backup", async () => "b"), "b");
	gate.resolve("a");
	assert.equal(await first, "a", "прерванная защита не роняет задачу");
	// Снятие не ушло в чужое/новое соединение.
	assert.equal(srv.clients[0].queries.filter((q) => q.includes("unlock")).length, 0);
	assert.equal(await a.withLock("backup", async () => "again"), "again");
	assert.equal(srv.clients.filter((c) => !c.ended).length >= 1, true);
	assert.equal(a._state().generation >= 1, true, "открыто новое соединение");
	assert.equal(srv.locks.size, 0);
});

test("ошибка блокировки: одиночный процесс выполняет без неё, воркер кластера пропускает запуск", async () => {
	const srv = fakeServer();
	srv.failConnect = true;
	const msgs = [];
	const single = createLockSession({ connect: srv.connect, clustered: false, log: quietLog });
	assert.equal(await single.withLock("backup", async () => "ran", (m) => msgs.push(m)), "ran");
	assert.match(msgs.at(-1), /выполняю без неё/);
	let ran = false;
	const worker = createLockSession({ connect: srv.connect, clustered: true, log: quietLog });
	assert.equal(await worker.withLock("backup", async () => { ran = true; }, (m) => msgs.push(m)), undefined);
	assert.equal(ran, false);
	assert.match(msgs.at(-1), /запуск пропущен/);
	// База вернулась — следующий тик работает как обычно.
	srv.failConnect = false;
	assert.equal(await worker.withLock("backup", async () => "ok"), "ok");
});

test("не удалось снять лок — соединение закрывается, лок не висит", async () => {
	const srv = fakeServer();
	const a = createLockSession({ connect: srv.connect, clustered: true, log: quietLog });
	srv.failQuery = (sql) => sql.includes("pg_advisory_unlock");
	assert.equal(await a.withLock("backup", async () => "ok"), "ok");
	assert.equal(srv.clients[0].ended, true, "соединение закрыто");
	assert.equal(srv.locks.size, 0, "лок ушёл вместе с соединением");
	srv.failQuery = null;
	const b = createLockSession({ connect: srv.connect, clustered: true, log: quietLog });
	assert.equal(await b.withLock("backup", async () => "b"), "b");
});

test("ошибка задачи: лок снят, ошибка — вызывающему", async () => {
	const srv = fakeServer();
	const a = createLockSession({ connect: srv.connect, clustered: true, log: quietLog });
	await assert.rejects(a.withLock("backup", async () => { throw new Error("pg_dump упал"); }), /pg_dump упал/);
	assert.equal(srv.locks.size, 0);
	assert.deepEqual(a._state().held, []);
});

test("ключ — из имени задачи, одинаковый во всех процессах", () => {
	assert.equal(lockKeyOf("backup"), lockKeyOf("backup"));
	assert.notEqual(lockKeyOf("backup"), lockKeyOf("audit-cleanup"));
	assert.ok(Number.isInteger(lockKeyOf("quality-sla")) && Math.abs(lockKeyOf("quality-sla")) <= 2 ** 31);
});
