// Z5 — единый планировщик: реестр задач, opt-in по интервалу, запуск/дедуп. HEADLESS.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerTask, listTasks, startScheduler, _reset } from "../services/scheduler.js";

beforeEach(() => _reset());

test("registerTask: intervalMs<=0 → задача выключена (не в реестре)", () => {
	assert.equal(registerTask({ name: "off", intervalMs: 0, run: () => {} }), false);
	assert.equal(registerTask({ name: "neg", intervalMs: -5, run: () => {} }), false);
	assert.equal(listTasks().length, 0);
});

test("registerTask: валидная задача попадает в реестр", () => {
	assert.equal(registerTask({ name: "backup", intervalMs: 3600000, run: () => {} }), true);
	assert.deepEqual(listTasks(), [{ name: "backup", intervalMs: 3600000 }]);
});

test("registerTask: без name/run — ошибка", () => {
	assert.throws(() => registerTask({ intervalMs: 1000, run: () => {} }), /name и run/);
	assert.throws(() => registerTask({ name: "x", intervalMs: 1000 }), /name и run/);
});

test("startScheduler: возвращает имена и выполняет задачу после initialDelay", async () => {
	let ran = 0;
	registerTask({ name: "t1", intervalMs: 3600000, initialDelayMs: 10, run: () => { ran++; return "ok"; } });
	const names = startScheduler({ log: { info() {}, error() {} } });
	assert.deepEqual(names, ["t1"]);
	await new Promise((r) => setTimeout(r, 60));
	assert.equal(ran, 1, "первый прогон произошёл после initialDelay");
});

test("startScheduler: ошибка задачи не роняет планировщик", async () => {
	let good = 0;
	registerTask({ name: "bad", intervalMs: 3600000, initialDelayMs: 10, run: () => { throw new Error("boom"); } });
	registerTask({ name: "good", intervalMs: 3600000, initialDelayMs: 10, run: () => { good++; } });
	const errs = [];
	startScheduler({ log: { info() {}, error: (m) => errs.push(m) } });
	await new Promise((r) => setTimeout(r, 60));
	assert.equal(good, 1, "исправная задача выполнилась несмотря на падение соседней");
	assert.ok(errs.some((m) => /bad/.test(m)), "ошибка залогирована");
});

test("startScheduler: задача выполняется под переданной блокировкой", async () => {
	/*
	 * В проде воркеров четыре, и без блокировки бэкап делался бы четырежды одновременно.
	 * Планировщик про базу не знает — блокировку передаёт вызывающий (services/clusterLock.js).
	 */
	_reset();
	const calls = [];
	let ran = 0;
	registerTask({ name: "locked", intervalMs: 60_000, initialDelayMs: 10, run: () => { ran += 1; } });
	startScheduler({
		log: { info() {}, warn() {}, error() {} },
		withLock: async (name, run) => { calls.push(name); return run(); },
	});
	await new Promise((r) => setTimeout(r, 60));
	assert.equal(ran, 1, "задача выполнена");
	assert.deepEqual(calls, ["locked"], "и именно через блокировку");
	_reset();
});

test("startScheduler: не получив блокировку, задачу не выполняем", async () => {
	// Значит её уже ведёт другой воркер: делать её вторым нечего, ждать — тоже.
	_reset();
	let ran = 0;
	registerTask({ name: "busy", intervalMs: 60_000, initialDelayMs: 10, run: () => { ran += 1; } });
	startScheduler({
		log: { info() {}, warn() {}, error() {} },
		withLock: async () => undefined,
	});
	await new Promise((r) => setTimeout(r, 60));
	assert.equal(ran, 0);
	_reset();
});
