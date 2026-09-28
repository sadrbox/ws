/**
 * ФАЙЛ .cfe НЕ ЖИВЁТ В ЖУРНАЛЕ КОМАНД (С3 docs/TASK_SERVICE_FROM_AGENT_AUDIT_2026-09-28.md, 28.09).
 *
 * Установка расширения: выполненная — файл сразу в сводку `{size, sha256}`; неуспешная — через сутки (до того его
 * берут «Повторить неуспешные» и повтор «база занята»). Выгрузка: файл в результате — через час. Повтор задания с уже
 * очищенным файлом пропускает базу с причиной, а не отдаёт агенту установку без файла.
 *
 * Первая часть — на подставной базе (идёт всегда). Вторая — на настоящем Postgres, ТОЛЬКО на одноразовой базе:
 * AI_TEST_DATABASE_URL, в имени базы обязано быть «test»; без переменной пропускается.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import pg from "pg";
import type { AddressInfo } from "node:net";
import { migrate } from "../src/db/migrate.ts";
import { CommandQueue } from "../src/commands/queue.ts";
import {
	CONTENT_SCRUB_BATCH, EXPORT_CONTENT_KEEP_SECS, INSTALL_CONTENT_KEEP_FAILED_SECS, contentDigest, digestsById,
} from "../src/commands/contentDigest.ts";
import { STORED_CONTENT_GONE, findAdminCommand, payloadRefusal, storedContentRefusal } from "../src/commands/admin.ts";
import { onecRouter } from "../src/http/onecRouter.ts";
import type { Db } from "../src/db/pool.ts";
import type { Logger } from "../src/logger.ts";

type Call = { sql: string; params: unknown[] };
type Answer = { rows: unknown[]; rowCount?: number } | Error;

/** Подставная база: ответ по тексту запроса; Error — запрос падает. */
function fakeDb(calls: Call[], answer: (sql: string) => Answer = () => ({ rows: [] })): Db {
	const query = async (sql: string, params: unknown[] = []) => {
		calls.push({ sql, params });
		const a = answer(sql);
		if (a instanceof Error) throw a;
		return { rows: a.rows, rowCount: a.rowCount ?? a.rows.length };
	};
	return { query, connect: async () => ({ query, release: () => {} }) } as unknown as Db;
}

// «hello» — известная сводка.
const HELLO_B64 = "aGVsbG8=";
const HELLO_SHA = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

// ── Сводка ───────────────────────────────────────────────────────────────────────────────────────────────────

test("сводка: размер раскодированного файла и SHA-256 его байтов", () => {
	assert.deepEqual(contentDigest(HELLO_B64), { size: 5, sha256: HELLO_SHA });
	// Без выравнивания «=» — то же содержимое.
	assert.deepEqual(contentDigest("aGVsbG8"), { size: 5, sha256: HELLO_SHA });
	const bin = Buffer.from([0, 255, 1, 254, 127]);
	assert.equal(contentDigest(bin.toString("base64")).size, 5);
});

test("сводка: битый base64 не бросает — описывает то, что раскодировалось", () => {
	assert.doesNotThrow(() => contentDigest("@@@ не base64 ###"));
	assert.deepEqual(contentDigest(""), { size: 0, sha256: EMPTY_SHA });
	assert.deepEqual(digestsById([{ id: "a", content: HELLO_B64 }, { id: "b", content: null }]),
		{ a: { size: 5, sha256: HELLO_SHA }, b: null });
});

test("сроки: неуспешная установка — сутки, выгрузка — час, порция — 50 строк", () => {
	assert.equal(INSTALL_CONTENT_KEEP_FAILED_SECS, 86_400);
	assert.equal(EXPORT_CONTENT_KEEP_SECS, 3_600);
	assert.equal(CONTENT_SCRUB_BATCH, 50);
});

// ── Закрытие команды ─────────────────────────────────────────────────────────────────────────────────────────

const installRow = (state: string, extra: Record<string, unknown> = {}) => ({
	id: "cmd_1", agent_id: "a", base_key: "buh", type: "IB_INSTALL_EXTENSION", state,
	payload: { baseKey: "buh", name: "buhprof_api", contentBase64: HELLO_B64, safeMode: true, exclusive: { locked: true } },
	...extra,
});

test("установка выполнена — файл сразу заменён сводкой, остальное в payload не тронуто", async () => {
	const calls: Call[] = [];
	const q = new CommandQueue(fakeDb(calls, (sql) => (sql.includes("RETURNING *") ? { rows: [installRow("done")] } : { rows: [], rowCount: 1 })));
	const row = await q.complete("a", { commandId: "cmd_1", agentId: "a", status: "SUCCESS", result: { ok: true, name: "buhprof_api" } });
	assert.equal(calls.length, 2, "закрытие и отдельная очистка");
	assert.match(calls[1]!.sql, /SET payload = \(payload - 'contentBase64'\) \|\| jsonb_build_object\('contentDigest', \$2::jsonb\)/);
	assert.match(calls[1]!.sql, /WHERE id = \$1 AND payload \? 'contentBase64'/);
	assert.deepEqual(JSON.parse(String(calls[1]!.params[1])), { size: 5, sha256: HELLO_SHA });
	assert.equal(row!.payload.contentBase64, undefined);
	assert.deepEqual(row!.payload.contentDigest, { size: 5, sha256: HELLO_SHA });
	assert.equal(row!.payload.name, "buhprof_api");
	assert.deepEqual(row!.payload.exclusive, { locked: true }, "состояние подготовки не затёрто");
});

test("установка не выполнена — файл остаётся: его берут повтор «база занята» и «Повторить неуспешные»", async () => {
	const calls: Call[] = [];
	const q = new CommandQueue(fakeDb(calls, () => ({ rows: [installRow("failed")] })));
	const row = await q.complete("a", { commandId: "cmd_1", agentId: "a", status: "ERROR", error: { code: "IB_BUSY", message: "занята" } });
	assert.equal(calls.length, 1, "только закрытие");
	assert.equal(row!.payload.contentBase64, HELLO_B64);
});

test("выгрузка выполнена — файл в результате остаётся: панель забирает его по /commands/:id", async () => {
	const calls: Call[] = [];
	const q = new CommandQueue(fakeDb(calls, () => ({ rows: [{ id: "cmd_2", agent_id: "a", base_key: "buh", type: "IB_EXPORT_EXTENSION", state: "done",
		payload: { baseKey: "buh", name: "x" }, result: { ok: true, contentBase64: HELLO_B64, size: 5 } }] })));
	const row = await q.complete("a", { commandId: "cmd_2", agentId: "a", status: "SUCCESS", result: { ok: true, contentBase64: HELLO_B64, size: 5 } });
	assert.equal(calls.length, 1);
	assert.equal((row!.result as { contentBase64?: string }).contentBase64, HELLO_B64);
});

test("сбой очистки не мешает закрытию: команда принята, файл — ежечасному проходу, сбой — в журнал", async () => {
	const calls: Call[] = [];
	const warned: string[] = [];
	const q = new CommandQueue(fakeDb(calls, (sql) => (sql.includes("RETURNING *") ? { rows: [installRow("done")] } : new Error("deadlock detected"))));
	q.setLog({ warn: ((_o: object, msg: string) => { warned.push(msg); }) as unknown as Logger["warn"] });
	const row = await q.complete("a", { commandId: "cmd_1", agentId: "a", status: "SUCCESS", result: { ok: true } });
	assert.equal(row!.state, "done");
	assert.equal(row!.payload.contentBase64, HELLO_B64, "в ответе — то, что в базе");
	assert.equal(warned.length, 1);
	assert.match(warned[0]!, /ежечасная очистка/);
});

// ── Ежечасный проход ─────────────────────────────────────────────────────────────────────────────────────────

test("проход: неуспешные установки — старше суток, выгрузки — старше часа, только где файл ещё лежит", async () => {
	const calls: Call[] = [];
	const q = new CommandQueue(fakeDb(calls, (sql) => {
		if (sql.includes("SELECT id, payload->>'contentBase64'")) return { rows: [{ id: "i1", content: HELLO_B64 }] };
		if (sql.includes("SELECT c.id")) return { rows: [{ id: "e1", content: HELLO_B64 }, { id: "e2", content: null }] };
		return { rows: [], rowCount: sql.includes("SET payload") ? 1 : 2 };
	}));
	const r = await q.scrubStoredContent();
	assert.deepEqual(r, { installs: 1, exports: 2 });
	assert.equal(calls.length, 4, "порции неполные — второго прохода нет");

	const [selInst, updInst, selExp, updExp] = calls;
	assert.match(selInst!.sql, /payload \? 'contentBase64'/);
	assert.match(selInst!.sql, /state = 'done'/, "выполненная, чей файл не убрало закрытие, — сразу");
	assert.match(selInst!.sql, /state IN \('failed', 'canceled', 'expired'\)/);
	assert.match(selInst!.sql, /COALESCE\(finished_at, created_at\) < now\(\) - make_interval\(secs => \$2::int\)/);
	assert.deepEqual(selInst!.params, ["IB_INSTALL_EXTENSION", 86_400, 50]);
	assert.match(updInst!.sql, /jsonb_each\(\$1::jsonb\)/);
	assert.match(updInst!.sql, /c\.payload \? 'contentBase64'/, "идемпотентно: только строки с файлом");
	assert.deepEqual(JSON.parse(String(updInst!.params[0])), { i1: { size: 5, sha256: HELLO_SHA } });

	assert.match(selExp!.sql, /c\.state = 'done'/);
	assert.match(selExp!.sql, /c\.result->'data' \? 'contentBase64'/, "конверт шлюза — тоже");
	assert.deepEqual(selExp!.params, ["IB_EXPORT_EXTENSION", 3_600, 50]);
	assert.match(updExp!.sql, /jsonb_set\(c\.result, '\{data\}'/);
	// Без скобок Postgres читает `result -> ('data' - …)` и отказывает (поймано на настоящей базе).
	assert.match(updExp!.sql, /\(\(c\.result->'data'\) - 'contentBase64'\)/);
	assert.deepEqual(JSON.parse(String(updExp!.params[0])), { e1: { size: 5, sha256: HELLO_SHA }, e2: null });
});

test("проход: полная порция — следующий проход; нечего чистить — ни одной записи", async () => {
	const calls: Call[] = [];
	let left = 5;
	const q = new CommandQueue(fakeDb(calls, (sql) => {
		if (sql.includes("SELECT id, payload")) {
			const n = Math.min(2, left);
			return { rows: Array.from({ length: n }, (_, i) => ({ id: `i${left - i}`, content: HELLO_B64 })) };
		}
		if (sql.includes("SET payload")) { const n = Math.min(2, left); left -= n; return { rows: [], rowCount: n }; }
		return { rows: [] };
	}));
	assert.deepEqual(await q.scrubStoredContent({ batch: 2 }), { installs: 5, exports: 0 });
	assert.equal(calls.filter((c) => c.sql.includes("SET payload")).length, 3, "2 + 2 + 1");

	const idle: Call[] = [];
	assert.deepEqual(await new CommandQueue(fakeDb(idle)).scrubStoredContent(), { installs: 0, exports: 0 });
	assert.ok(idle.every((c) => /^\s*SELECT/.test(c.sql)), "без файлов — только выборки");
});

test("проход: строки нашлись, но не очищена ни одна — не крутится до предела", async () => {
	const calls: Call[] = [];
	const q = new CommandQueue(fakeDb(calls, (sql) => (sql.includes("SELECT id, payload")
		? { rows: [{ id: "i1", content: HELLO_B64 }, { id: "i2", content: HELLO_B64 }] }
		: { rows: [], rowCount: 0 })));
	await q.scrubStoredContent({ batch: 2, maxPasses: 50 });
	assert.equal(calls.filter((c) => c.sql.includes("SELECT id, payload")).length, 1);
});

// ── Повтор неуспешных ───────────────────────────────────────────────────────────────────────────────────────

test("payloadRefusal: установка без файла агенту не уходит, остальное — как прежде", () => {
	const spec = findAdminCommand("IB_INSTALL_EXTENSION")!;
	const agent = { capabilities: ["ib.admin"] };
	const scrubbed = { baseKey: "buh", name: "buhprof_api", contentDigest: { size: 5, sha256: HELLO_SHA } };
	assert.equal(payloadRefusal(agent, spec, scrubbed), STORED_CONTENT_GONE);
	assert.equal(payloadRefusal(agent, spec, { ...scrubbed, contentBase64: HELLO_B64 }), null);
	assert.equal(storedContentRefusal("IB_DELETE_EXTENSION", { baseKey: "buh", name: "x" }), null);
	assert.match(STORED_CONTENT_GONE, /сутки после отказа.*запустите установку заново/);
});

const JWT_SECRET = "test-secret";
const USER = "11111111-1111-1111-1111-111111111111";

test("«Повторить неуспешные»: база с уже очищенным файлом — в пропущенные с причиной, с файлом — агенту", async () => {
	const enqueued: { type: string; baseKey: string | null; payload: Record<string, unknown> }[] = [];
	const noted: { baseKey: string; reason: string }[][] = [];
	let picked = 0;
	const admin = { id: "adm", organizationUuid: "org-1", role: "admin", disabled: false, online: true, serverId: "srv-1",
		capabilities: ["cluster.admin", "ib.admin"], version: "2026-09-28" };
	const app = express();
	app.use(express.json());
	app.use("/v1/onec", onecRouter({
		erp: {
			query: async (sql: string) => {
				if (sql.includes("FROM users")) return { rows: [{ uuid: USER, is_super_admin: true, organization_uuid: "org-1" }], rowCount: 1 };
				if (sql.includes("FROM access_rights")) return { rows: [{ organization_uuid: "org-1", role: "admin" }], rowCount: 1 };
				if (sql.includes("count(*) FILTER")) return { rows: [{ full: "1", any: "1" }], rowCount: 1 };
				return { rows: [], rowCount: 0 };
			},
		},
		cfg: { JWT_SECRET, ONEC_COMMAND_TIMEOUT_SECS: 1, RATE_LIMIT_ONEC_CLUSTER_PER_MIN: 1000, ONEC_SERVER_SCOPE: "all", AGENT_OFFLINE_AFTER_SECS: 90 },
		log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
		agents: { pickAdminAgent: async () => { picked += 1; return admin; }, listAll: async () => [admin], findById: async () => admin },
		bases: { listServers: async () => [{ id: "srv-1", name: "S1", organizationUuid: "org-1" }] },
		queue: {
			enqueue: async (i: { type: string; baseKey: string | null; payload: Record<string, unknown> }) => {
				enqueued.push({ type: i.type, baseKey: i.baseKey, payload: i.payload });
				return { id: `cmd-${enqueued.length}` };
			},
		},
		audit: { write: async () => {} },
		batches: {
			ownerOf: async () => ({ organizationUuid: "org-1", userUuid: USER }),
			progress: async () => ({ type: "IB_INSTALL_EXTENSION" }),
			failedCommands: async () => [
				// Отказ минуту назад — файл на месте.
				{ base_key: "свежая", type: "IB_INSTALL_EXTENSION", server_id: "srv-1",
					payload: { baseKey: "свежая", name: "buhprof_api", contentBase64: HELLO_B64, exclusive: { restored: true } } },
				// Отказ позавчера — файл уже заменён сводкой.
				{ base_key: "старая", type: "IB_INSTALL_EXTENSION", server_id: "srv-1",
					payload: { baseKey: "старая", name: "buhprof_api", contentDigest: { size: 5, sha256: HELLO_SHA } } },
			],
			create: async () => "batch-2",
			attach: async () => {},
			noteSkipped: async (_id: string, s: { baseKey: string; reason: string }[]) => { noted.push(s); },
		},
		registry: {}, registrations: {}, baseTokens: {}, credentials: {}, schedules: {}, agentBases: {}, enrollments: {}, activation: {},
	} as never));
	const srv = await new Promise<import("node:http").Server>((ok) => { const s = app.listen(0, () => ok(s)); });
	try {
		const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1/onec/batches/batch-1/retry`, {
			method: "POST",
			headers: { authorization: `Bearer ${jwt.sign({ uuid: USER }, JWT_SECRET)}`, "content-type": "application/json" },
			body: "{}",
		});
		const body = await r.json() as { data: { queued: number; total: number; skipped: { baseKey: string; reason: string }[] } };
		assert.equal(r.status, 202);
		assert.equal(body.data.total, 2);
		assert.equal(body.data.queued, 1);
		assert.deepEqual(body.data.skipped, [{ baseKey: "старая", reason: STORED_CONTENT_GONE }]);
		assert.deepEqual(noted, [[{ baseKey: "старая", reason: STORED_CONTENT_GONE }]], "причина осталась в самом задании");
		assert.equal(picked, 1, "агента для базы без файла даже не выбирали");
		assert.equal(enqueued.length, 1);
		assert.equal(enqueued[0]!.baseKey, "свежая");
		assert.equal(enqueued[0]!.payload.contentBase64, HELLO_B64);
	} finally { srv.close(); }
});

// ── Настоящий Postgres ───────────────────────────────────────────────────────────────────────────────────────

const URL_ = process.env.AI_TEST_DATABASE_URL ?? "";
const dbName = (() => { try { return new URL(URL_).pathname.slice(1); } catch { return ""; } })();
const enabled = !!URL_ && /test/i.test(dbName);
const skip = enabled ? false : "нет одноразовой базы (AI_TEST_DATABASE_URL с «test» в имени)";
const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
let db: pg.Pool;

before(async () => {
	if (!enabled) return;
	db = new pg.Pool({ connectionString: URL_, max: 4 });
	await migrate(db, silent);
});
after(async () => { if (db) await db.end(); });

async function agentRow(): Promise<string> {
	const id = randomUUID();
	await db.query(`INSERT INTO agents (id, organization_uuid, token_hash, role) VALUES ($1, 'org', $2, 'admin')`, [id, `t-${id}`]);
	return id;
}

/** Команда в нужном состоянии, закрытая `ago` назад. */
async function commandRow(agent: string, c: { type: string; state: string; ago: string; payload?: unknown; result?: unknown }): Promise<string> {
	const id = "cmd_" + randomUUID().replace(/-/g, "").slice(0, 16);
	await db.query(
		`INSERT INTO commands (id, agent_id, organization_uuid, base_key, type, payload, state, result, expires_at, finished_at)
		 VALUES ($1, $2, 'org', 'Б', $3, $4::jsonb, $5, $6::jsonb, now() + interval '1 hour',
		         CASE WHEN $5 IN ('queued', 'dispatched') THEN NULL ELSE now() - $7::interval END)`,
		[id, agent, c.type, JSON.stringify(c.payload ?? {}), c.state, c.result === undefined ? null : JSON.stringify(c.result), c.ago],
	);
	return id;
}

const payloadOf = async (id: string) => (await db.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM commands WHERE id = $1`, [id])).rows[0]!.payload;
const resultOf = async (id: string) => (await db.query<{ result: Record<string, unknown> }>(`SELECT result FROM commands WHERE id = $1`, [id])).rows[0]!.result;

test("БД: закрытие выполненной установки заменяет файл сводкой, не трогая состояния подготовки", { skip }, async () => {
	const q = new CommandQueue(db, 1);
	const agent = await agentRow();
	const id = await commandRow(agent, { type: "IB_INSTALL_EXTENSION", state: "dispatched", ago: "0 seconds",
		payload: { baseKey: "Б", name: "buhprof_api", contentBase64: HELLO_B64, exclusive: { locked: true } } });
	const row = await q.complete(agent, { commandId: id, agentId: agent, status: "SUCCESS", result: { ok: true } });
	assert.equal(row!.state, "done");
	const p = await payloadOf(id);
	assert.equal("contentBase64" in p, false);
	assert.deepEqual(p.contentDigest, { size: 5, sha256: HELLO_SHA });
	assert.deepEqual(p.exclusive, { locked: true });
	assert.deepEqual(row!.payload, p, "ответ совпадает с базой");
});

test("БД: ежечасный проход — неуспешные установки старше суток, выгрузки старше часа; свежие и незавершённые не тронуты", { skip }, async () => {
	const q = new CommandQueue(db, 1);
	const agent = await agentRow();
	const inst = (state: string, ago: string) => commandRow(agent, { type: "IB_INSTALL_EXTENSION", state, ago,
		payload: { baseKey: "Б", name: "buhprof_api", contentBase64: HELLO_B64 } });
	const failedOld = await inst("failed", "25 hours");
	const canceledOld = await inst("canceled", "25 hours");
	const expiredOld = await inst("expired", "2 days");
	const failedFresh = await inst("failed", "23 hours");
	const doneLeft = await inst("done", "1 minute");
	const queued = await inst("queued", "0 seconds");
	const exportOld = await commandRow(agent, { type: "IB_EXPORT_EXTENSION", state: "done", ago: "61 minutes",
		result: { ok: true, name: "buhprof_api", fileName: "buhprof_api.cfe", size: 5, contentBase64: HELLO_B64, via: "com" } });
	const exportWrapped = await commandRow(agent, { type: "IB_EXPORT_EXTENSION", state: "done", ago: "2 hours",
		result: { success: true, data: { ok: true, size: 5, contentBase64: HELLO_B64 } } });
	const exportFresh = await commandRow(agent, { type: "IB_EXPORT_EXTENSION", state: "done", ago: "10 minutes",
		result: { ok: true, size: 5, contentBase64: HELLO_B64 } });

	const r = await q.scrubStoredContent({ batch: 2 });
	assert.ok(r.installs >= 4 && r.exports >= 2, JSON.stringify(r));

	for (const id of [failedOld, canceledOld, expiredOld, doneLeft]) {
		const p = await payloadOf(id);
		assert.equal("contentBase64" in p, false, id);
		assert.deepEqual(p.contentDigest, { size: 5, sha256: HELLO_SHA });
		assert.equal(p.name, "buhprof_api");
	}
	for (const id of [failedFresh, queued]) assert.equal((await payloadOf(id)).contentBase64, HELLO_B64, id);

	const e = await resultOf(exportOld);
	assert.equal("contentBase64" in e, false);
	assert.deepEqual(e.contentDigest, { size: 5, sha256: HELLO_SHA });
	assert.equal(e.size, 5, "size агента на месте");
	assert.equal(e.fileName, "buhprof_api.cfe");
	const w = (await resultOf(exportWrapped)).data as Record<string, unknown>;
	assert.equal("contentBase64" in w, false);
	assert.deepEqual(w.contentDigest, { size: 5, sha256: HELLO_SHA });
	assert.equal((await resultOf(exportFresh)).contentBase64, HELLO_B64);

	// Идемпотентно: второй проход по этим строкам ничего не находит.
	const before2 = await payloadOf(failedOld);
	await q.scrubStoredContent();
	assert.deepEqual(await payloadOf(failedOld), before2);
});
