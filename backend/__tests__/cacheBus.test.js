// Н7 аудита 26.09: сброс кэша в одном воркере кластера должен доходить до остальных. HEADLESS:
// две шины (services/chatBus.js) на подставном «Postgres» — два воркера в одном процессе.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createBus } from "../services/chatBus.js";
import { createCacheBus, CACHE_CHANNEL } from "../services/cacheBus.js";

/** Подставной Postgres: NOTIFY раздаётся всем слушателям канала (и отправителю тоже, как настоящий). */
function fakeHub() {
	const listening = new Set();
	return {
		connect: async () => {
			const c = new EventEmitter();
			c.query = async (sql, params = []) => {
				if (sql.startsWith("LISTEN ")) { listening.add(c); return { rows: [] }; }
				const [channel, ...payloads] = params;
				setImmediate(() => { for (const l of listening) for (const p of payloads) l.emit("notification", { channel, payload: p }); });
				return { rows: [{}] };
			};
			c.end = async () => { listening.delete(c); };
			return c;
		},
	};
}

const quiet = { warn: () => {}, info: () => {} };
const tick = () => new Promise((r) => setTimeout(r, 30));

/** «Воркер»: своя шина, свой реестр кэшей, свой кэш-Map. */
function worker(hub) {
	const bus = createBus({ connect: hub.connect, clustered: true, log: quiet });
	const caches = createCacheBus({ publish: bus.publish, subscribe: bus.subscribe, log: quiet });
	const store = new Map([["chartOfAccount", "старый план"], ["subkontoType", "виды"]]);
	const broadcast = caches.onCacheInvalidate("refCache", (key) => (key ? store.delete(key) : store.clear()));
	return { bus, store, invalidate: (key) => { store.delete(key); broadcast(key); } };
}

test("сброс в одном воркере чистит кэш в другом, чужие ключи не трогает", async () => {
	const hub = fakeHub();
	const a = worker(hub);
	const b = worker(hub);
	await tick(); // подписки открыли LISTEN
	a.invalidate("chartOfAccount");
	await tick();
	assert.equal(a.store.has("chartOfAccount"), false);
	assert.equal(b.store.has("chartOfAccount"), false, "соседний воркер тоже сбросил план счетов");
	assert.equal(b.store.get("subkontoType"), "виды", "другой ключ остался");
	await a.bus.close();
	await b.bus.close();
});

test("сброс без ключа чистит кэш целиком; события других кэшей и чата не мешают", async () => {
	const hub = fakeHub();
	const a = worker(hub);
	const b = worker(hub);
	const chat = [];
	b.bus.subscribe(["org-1"], (e) => chat.push(e));
	await tick();
	a.bus.publish(CACHE_CHANNEL, { type: "cache-invalidate", name: "другой-кэш", key: "chartOfAccount" });
	a.bus.publish("org-1", { type: "chat", text: "привет" });
	await tick();
	assert.equal(b.store.size, 2, "чужое имя кэша — не наш сброс");
	assert.deepEqual(chat, [{ type: "chat", text: "привет" }], "служебный канал не попадает в чат организации");
	a.invalidate(null);
	await tick();
	assert.equal(b.store.size, 0);
	await a.bus.close();
	await b.bus.close();
});

test("упавший обработчик сброса не мешает остальным", () => {
	const subs = [];
	const caches = createCacheBus({
		publish: (org, e) => subs.forEach((fn) => fn(e)),
		subscribe: (_orgs, fn) => subs.push(fn),
		log: quiet,
	});
	let ok = 0;
	caches.onCacheInvalidate("x", () => { throw new Error("сломан"); });
	const broadcast = caches.onCacheInvalidate("x", () => { ok++; });
	broadcast("k");
	assert.equal(ok, 1);
	assert.equal(subs.length, 1, "подписка на шину одна на реестр, а не на каждый кэш");
});
