// Шина событий реального времени (services/chatBus.js) — без базы: подставной «Postgres» раздаёт
// уведомления всем слушателям канала (и отправителю тоже, как настоящий) и, как настоящий, отвергает
// нагрузку от 8000 байт.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createBus, splitUtf8 } from "../services/chatBus.js";

function fakeHub() {
	const listening = new Set();
	const hub = {
		connects: 0,
		clients: [],
		connect: async () => {
			if (hub.failConnect) throw new Error("connect ECONNREFUSED");
			hub.connects++;
			const c = new EventEmitter();
			c.ended = false;
			c.query = async (sql, params = []) => {
				if (c.ended) throw new Error("Client was closed");
				if (sql.startsWith("LISTEN ")) { listening.add(c); return { rows: [] }; }
				if (sql.includes("pg_notify")) {
					const [channel, ...payloads] = params;
					for (const p of payloads) {
						if (Buffer.byteLength(p) >= 8000) throw new Error("payload string too long");
					}
					// Доставка — после «фиксации», всем слушателям канала, отправителю тоже.
					setImmediate(() => {
						for (const l of listening) for (const p of payloads) l.emit("notification", { channel, payload: p });
					});
					return { rows: [{}] };
				}
				throw new Error(`неожиданный запрос: ${sql}`);
			};
			c.end = async () => { if (c.ended) return; c.ended = true; listening.delete(c); c.emit("end"); };
			c.kill = () => { c.ended = true; listening.delete(c); c.emit("error", new Error("terminating connection due to administrator command")); };
			hub.clients.push(c);
			return c;
		},
	};
	return hub;
}

const quiet = { warn: () => {}, info: () => {} };
const tick = () => new Promise((r) => setTimeout(r, 20));

test("одиночный процесс: доставка своим подписчикам, база не трогается", async () => {
	const hub = fakeHub();
	const bus = createBus({ connect: hub.connect, clustered: false, log: quiet });
	const got = [];
	bus.subscribe(["org-1"], (e) => got.push(e));
	bus.publish("org-1", { type: "chat", message: { text: "привет" } });
	await tick();
	assert.deepEqual(got, [{ type: "chat", message: { text: "привет" } }]);
	assert.equal(hub.connects, 0);
});

test("кластер: событие доходит до подписчика другого воркера, у публикующего — без дубля", async () => {
	const hub = fakeHub();
	const a = createBus({ connect: hub.connect, clustered: true, log: quiet });
	const b = createBus({ connect: hub.connect, clustered: true, log: quiet });
	const gotA = [];
	const gotB = [];
	a.subscribe(["org-1"], (e) => gotA.push(e));
	b.subscribe(["org-1"], (e) => gotB.push(e));
	await tick();
	a.publish("org-1", { type: "notify", userUuid: "u1" });
	await tick();
	assert.deepEqual(gotA, [{ type: "notify", userUuid: "u1" }], "своему — один раз, сразу");
	assert.deepEqual(gotB, [{ type: "notify", userUuid: "u1" }], "другому воркеру — через канал");
	await a.close();
	await b.close();
});

test("кластер: событие чужой организации не приходит", async () => {
	const hub = fakeHub();
	const a = createBus({ connect: hub.connect, clustered: true, log: quiet });
	const b = createBus({ connect: hub.connect, clustered: true, log: quiet });
	const gotB = [];
	b.subscribe(["org-2"], (e) => gotB.push(e));
	await tick();
	a.publish("org-1", { type: "task" });
	await tick();
	assert.deepEqual(gotB, []);
	await a.close();
	await b.close();
});

test("длинное сообщение чата (кириллица, больше предела NOTIFY) режется и собирается без потерь", async () => {
	const hub = fakeHub();
	const a = createBus({ connect: hub.connect, clustered: true, log: quiet });
	const b = createBus({ connect: hub.connect, clustered: true, log: quiet });
	const gotB = [];
	b.subscribe(["org-1"], (e) => gotB.push(e));
	await tick();
	const text = "Сверка с контрагентом | итог: ✅ ".repeat(1500); // ≈ 60 КБ в UTF-8, с «|» внутри
	a.publish("org-1", { type: "chat", message: { uuid: "m1", text } });
	await tick();
	assert.equal(gotB.length, 1);
	assert.equal(gotB[0].message.text, text);
	assert.equal(b._state().pending, 0, "собранные части не копятся");
	await a.close();
	await b.close();
});

test("обрыв соединения: переподключение, дальше события снова ходят", async () => {
	const hub = fakeHub();
	const warns = [];
	const a = createBus({ connect: hub.connect, clustered: true, log: quiet });
	const b = createBus({ connect: hub.connect, clustered: true, log: { warn: (m) => warns.push(m), info: () => {} }, reconnectMs: [10] });
	const gotB = [];
	b.subscribe(["org-1"], (e) => gotB.push(e));
	await tick();
	const bClient = hub.clients.at(-1);
	bClient.kill();
	assert.ok(warns.some((m) => /оборвано/.test(m)));
	await new Promise((r) => setTimeout(r, 60));
	assert.equal(b._state().connected, true, "переподключилась");
	a.publish("org-1", { type: "task", n: 2 });
	await tick();
	assert.deepEqual(gotB, [{ type: "task", n: 2 }]);
	await a.close();
	await b.close();
});

test("база недоступна: свои подписчики получают событие, публикация не бросает", async () => {
	const hub = fakeHub();
	hub.failConnect = true;
	const a = createBus({ connect: hub.connect, clustered: true, log: quiet, reconnectMs: [5] });
	const got = [];
	a.subscribe(["org-1"], (e) => got.push(e));
	assert.doesNotThrow(() => a.publish("org-1", { type: "chat" }));
	await tick();
	assert.deepEqual(got, [{ type: "chat" }]);
	await a.close();
});

test("отписка снимает обработчик", async () => {
	const bus = createBus({ clustered: false, log: quiet });
	const got = [];
	const off = bus.subscribe(["org-1", "org-1", null], (e) => got.push(e));
	bus.publish("org-1", { type: "a" });
	off();
	bus.publish("org-1", { type: "b" });
	assert.deepEqual(got, [{ type: "a" }]);
});

test("splitUtf8: части не длиннее предела в байтах и не рвут символ", () => {
	const text = "аб🙂вг".repeat(1000);
	const parts = splitUtf8(text, 7000);
	assert.ok(parts.length > 1);
	assert.ok(parts.every((p) => Buffer.byteLength(p) <= 7000));
	assert.equal(parts.join(""), text);
	assert.deepEqual(splitUtf8("", 10), [""]);
});
