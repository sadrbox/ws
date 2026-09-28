// КР-15 аудита 27.09 (платформенная часть), приём итогов проверок — HEADLESS, без БД.
// Ожидание блокировки приёма (клиент, проверка) ограничено SET LOCAL lock_timeout: не дождались —
// понятный отказ CheckIngestBusyError → 503 с Retry-After, ключ идемпотентности посылки свободен
// (раньше ожидание обрывал общий statement_timeout пула: 57014 → «Ошибка сервера»).
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { prisma } from "../prisma/prisma-client.js";
import { lockCheckIngest, CheckIngestBusyError, INGEST_LOCK_WAIT_MS } from "../services/quality/checks.js";
import bpaiRouter from "../api/router/bpai.js";

/** Ошибка так, как её отдаёт Prisma 7 + adapter-pg (проверено на одноразовой базе). */
const pgError = (code, message) => Object.assign(new Error(`Raw query failed. Code: \`${code}\`. Message: \`${message}\``), {
	name: "PrismaClientKnownRequestError",
	code: "P2010",
	meta: { driverAdapterError: { name: "DriverAdapterError", cause: { originalCode: code, originalMessage: message, kind: "postgres", code } } },
});

function fakeTx({ lockError = null } = {}) {
	const calls = [];
	return {
		calls,
		$executeRawUnsafe: async (sql) => { calls.push(sql); return 0; },
		$executeRaw: async (strings, ...values) => { calls.push(strings.join("?") + " " + JSON.stringify(values)); if (lockError) throw lockError; return 1; },
		checkRun: { findFirst: async () => null, create: async ({ data }) => ({ uuid: "run-1", ...data }) },
	};
}

test("КР-15: lockCheckIngest — предел ожидания задаётся в транзакции ДО блокировки", async () => {
	const tx = fakeTx();
	await lockCheckIngest(tx, "org-1", "dup_items");
	assert.equal(tx.calls[0], `SET LOCAL lock_timeout = ${INGEST_LOCK_WAIT_MS}`);
	assert.match(tx.calls[1], /pg_advisory_xact_lock/);
	assert.match(tx.calls[1], /check-ingest:org-1:dup_items/);
	assert.ok(INGEST_LOCK_WAIT_MS < 30_000, "меньше statement_timeout пула по умолчанию — срабатывает именно он");
	const tx2 = fakeTx();
	await lockCheckIngest(tx2, "org-1", "x", 750);
	assert.equal(tx2.calls[0], "SET LOCAL lock_timeout = 750");
});

test("КР-15: не дождались блокировки (55P03, или 57014 при коротком statement_timeout) — CheckIngestBusyError; прочее — как есть", async () => {
	for (const [code, msg] of [["55P03", "canceling statement due to lock timeout"], ["57014", "canceling statement due to statement timeout"]]) {
		await assert.rejects(lockCheckIngest(fakeTx({ lockError: pgError(code, msg) }), "org-1", "dup_items"), (e) => {
			assert.ok(e instanceof CheckIngestBusyError, code);
			assert.equal(e.status, 503);
			assert.equal(e.code, "CHECK_INGEST_BUSY");
			assert.match(e.message, /dup_items/);
			return true;
		});
	}
	const other = pgError("40P01", "deadlock detected");
	await assert.rejects(lockCheckIngest(fakeTx({ lockError: other }), "org-1", "x"), (e) => e === other);
});

/** Подменить методы Prisma на время теста. */
function mock(map) {
	const saved = [];
	for (const [path, fn] of Object.entries(map)) {
		const [model, method] = path.split(".");
		const target = method ? prisma[model] : prisma;
		const key = method ?? model;
		saved.push([target, key, target[key]]);
		target[key] = fn;
	}
	return () => { for (const [t, k, v] of saved.reverse()) t[k] = v; };
}

test("КР-15: POST /bpai/checks/results при занятом приёме — 503 с Retry-After, ключ посылки освобождён; повтор принимается", async () => {
	const keys = new Map();
	let busy = true;
	const restore = mock({
		"idempotencyKey.create": async ({ data }) => { if (keys.has(data.key)) throw Object.assign(new Error("dup"), { code: "P2002" }); keys.set(data.key, { ...data, status: null, createdAt: new Date() }); return keys.get(data.key); },
		"idempotencyKey.findUnique": async ({ where }) => keys.get(where.key) ?? null,
		"idempotencyKey.update": async ({ where, data }) => Object.assign(keys.get(where.key), data),
		"idempotencyKey.delete": async ({ where }) => { keys.delete(where.key); },
		"organization.findFirst": async () => ({ uuid: "org-1" }),
		"appSetting.findUnique": async () => null,
		"$transaction": async (fn) => fn(fakeTx({ lockError: busy ? pgError("55P03", "canceling statement due to lock timeout") : null })),
	});
	const app = express();
	app.use(express.json());
	app.use("/bpai", bpaiRouter);
	const srv = app.listen(0);
	try {
		await new Promise((r) => srv.once("listening", r));
		const post = async () => {
			const r = await fetch(`http://127.0.0.1:${srv.address().port}/bpai/checks/results`, {
				method: "POST",
				headers: { "content-type": "application/json", "Idempotency-Key": "checks:abc" },
				// Прогон с ошибкой 1С: транзакция приёма есть, находок нет — дальше транзакции код не идёт.
				body: JSON.stringify({ bin: "123456789012", baseKey: "b1", runs: [{ check: "dup_items", ok: false, error: { code: "X", message: "y" } }], snapshots: [] }),
			});
			return { status: r.status, retryAfter: r.headers.get("retry-after"), body: await r.json() };
		};
		const r1 = await post();
		assert.equal(r1.status, 503);
		assert.equal(r1.retryAfter, "60");
		assert.equal(r1.body.code, "CHECK_INGEST_BUSY");
		assert.equal(keys.has("checks:abc"), false, "временный отказ не прилипает к ключу посылки");
		busy = false;
		const r2 = await post();
		assert.equal(r2.status, 200);
		assert.equal(r2.body.data.runs, 1);
		assert.equal(keys.get("checks:abc")?.status, 200, "принятая посылка запомнена");
	} finally {
		srv.close();
		restore();
	}
});
