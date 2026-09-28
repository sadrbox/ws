/**
 * ОЧЕРЕДЬ КОМАНД — исправления аудита 27.09 (docs/AUDIT_CRITICAL_2026-09-27.md): КР-12 (удержание монопольной
 * операции до выпуска, повтор её же раннером, состояние подготовки не уходит агенту, «под обслуживанием» — только
 * обслуживание), КР-20 (молчание агента не губит долгое ожидание; более новая заявка той же службы), I8 (оборванный
 * опрос возвращает команду со сроком ожидания).
 *
 * Первая часть — SQL на подставной базе (идёт всегда). Вторая — на настоящем Postgres, ТОЛЬКО на одноразовой базе:
 * AI_TEST_DATABASE_URL, в имени базы обязано быть «test»; без переменной пропускается.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "../src/db/migrate.ts";
import { CommandQueue, MAINTENANCE_TYPES, ORPHAN_WAIT_SHARE } from "../src/commands/queue.ts";
import { BatchService } from "../src/onec/batches.ts";
import { EnrollmentStore } from "../src/agents/enrollments.ts";
import { RegistrationStore } from "../src/bases/registrations.ts";
import type { Db } from "../src/db/pool.ts";
import type { Logger } from "../src/logger.ts";

type Call = { sql: string; params: unknown[] };

/** Подставная база: ответ по тексту запроса. */
function fakeDb(calls: Call[], answer: (sql: string) => unknown[] = () => []): Db {
	const query = async (sql: string, params: unknown[] = []) => {
		calls.push({ sql, params });
		const rows = answer(sql);
		return { rows, rowCount: rows.length };
	};
	return { query, connect: async () => ({ query, release: () => {} }) } as unknown as Db;
}

// ── SQL ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("КР-12: удержанная до выпуска команда — available_at позже её собственного срока ожидания", async () => {
	const calls: Call[] = [];
	const q = new CommandQueue(fakeDb(calls, () => [{ id: "cmd_1" }]));
	await q.enqueue({ agentId: "a", organizationUuid: "o", baseKey: "b", type: "IB_BACKUP", payload: {}, queueWaitSeconds: 43200, hold: true });
	const ins = calls.find((c) => c.sql.includes("INSERT INTO commands"))!;
	assert.match(ins.sql, /CASE WHEN \$15::boolean THEN now\(\) \+ \(\$10 \|\| ' seconds'\)::interval \+ interval '1 day'/);
	assert.equal(ins.params[14], true);
	await q.enqueue({ agentId: "a", organizationUuid: "o", baseKey: "b", type: "IB_BACKUP", payload: {} });
	assert.equal(calls.filter((c) => c.sql.includes("INSERT INTO commands"))[1]!.params[14], false, "обычная команда не удержана");
});

test("КР-12 п. 1: повтор раннером — копия удержана и получает состояние подготовки, исходная отмечена movedTo", async () => {
	const calls: Call[] = [];
	const q = new CommandQueue(fakeDb(calls, () => [{ id: "cmd_new", agent_id: "a" }]));
	assert.equal(await q.retryBusy("cmd_old", 43200, { hold: true }), "cmd_new");
	assert.match(calls[0]!.sql, /CASE WHEN \$7::boolean THEN payload ELSE payload - 'exclusive' END/);
	assert.match(calls[0]!.sql, /jsonb_set\(payload, '\{exclusive,movedTo\}', to_jsonb\(\$2::text\)\)/);
	assert.match(calls[0]!.sql, /\+ interval '1 day'/);
	assert.equal(calls[0]!.params[6], true);
	await q.retryBusy("cmd_old", 43200);
	assert.equal(calls[1]!.params[6], false, "обычный повтор — как прежде: без состояния и с паузой");
});

test("КР-12: выдача не отдаёт агенту состояние подготовки и не выдаёт отменённую между выборкой и записью", async () => {
	const calls: Call[] = [];
	const q = new CommandQueue(fakeDb(calls, (sql) => (sql.includes("RETURNING u.*")
		? [{ id: "c1", type: "IB_BACKUP", base_key: "b", payload: { baseKey: "b", exclusive: { locked: true } }, expires_at: new Date(), queue_expires_at: new Date() }]
		: [])));
	const got = await q.take("a", 0);
	assert.deepEqual(got[0]!.payload, { baseKey: "b" });
	const upd = calls.find((c) => c.sql.includes("RETURNING u.*"))!;
	assert.match(upd.sql, /WHERE u\.id = prev\.id AND u\.state = 'queued'/);
	assert.match(upd.sql, /make_interval\(secs => ttl_seconds\)/);
});

test("I8: команда, возвращённая оборванным опросом, получает прежний срок ожидания очереди, а не «выдача + срок выполнения»", async () => {
	const calls: Call[] = [];
	const queueDeadline = new Date(Date.now() + 11 * 3600_000);
	const q = new CommandQueue(fakeDb(calls, (sql) => (sql.includes("RETURNING u.*")
		? [{ id: "c1", type: "IB_BACKUP", base_key: "b", payload: {}, expires_at: new Date(Date.now() + 900_000), queue_expires_at: queueDeadline }]
		: [])));
	const got = await q.take("a", 0);
	assert.equal(await q.requeue(got), 0);
	const upd = calls[calls.length - 1]!;
	assert.match(upd.sql, /SET state = 'queued', dispatched_at = NULL, dispatched_instance = NULL/);
	assert.match(upd.sql, /expires_at = COALESCE\(x\.until, c\.expires_at\)/);
	assert.deepEqual(upd.params, [["c1"], [queueDeadline.toISOString()]]);
	// Чужой объект (не из выдачи) — срок не трогаем.
	await q.requeue([{ id: "c2", type: "X", payload: {} }]);
	assert.deepEqual(calls[calls.length - 1]!.params, [["c2"], [null]]);
});

test("КР-20: «забрать некому» — не раньше доли ожидания самой команды", async () => {
	const calls: Call[] = [];
	await new CommandQueue(fakeDb(calls)).expireOrphaned(180);
	assert.match(calls[0]!.sql, /GREATEST\(\s*\$1::double precision,\s*\$2::double precision \* EXTRACT\(EPOCH FROM \(c\.expires_at - c\.created_at\)\)\)/);
	assert.deepEqual(calls[0]!.params, [180, ORPHAN_WAIT_SHARE]);
	// Одиночная команда (ожидание 15 мин) — прежние 3 мин; задание (12 ч) — часы.
	assert.equal(Math.max(180, ORPHAN_WAIT_SHARE * 900), 180);
	assert.ok(Math.max(180, ORPHAN_WAIT_SHARE * 43200) >= 2 * 3600);
});

test("КР-12 п. 5: «под обслуживанием» — только типы обслуживания, уже доступные к выдаче, и база, закрытая монопольной операцией", async () => {
	const calls: Call[] = [];
	await new CommandQueue(fakeDb(calls)).basesUnderMaintenance();
	assert.match(calls[0]!.sql, /c\.type = ANY\(\$1::text\[\]\)/);
	assert.match(calls[0]!.sql, /c\.available_at IS NULL OR c\.available_at <= now\(\)/);
	assert.match(calls[0]!.sql, /payload->'exclusive'->>'locked' = 'true'/);
	const types = calls[0]!.params[0] as string[];
	assert.ok(types.includes("IB_BACKUP") && types.includes("IB_CHECK") && types.includes("IB_RESTORE"));
	assert.ok(!types.includes("IB_LIST_USERS") && !types.includes("IB_CREATE_USER"), "чтения и правки пользователей базу не занимают");
	assert.deepEqual(types, [...MAINTENANCE_TYPES]);
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
	db = new pg.Pool({ connectionString: URL_, max: 6 });
	await migrate(db, silent);
});
after(async () => { if (db) await db.end(); });

async function agentRow(role: "admin" | "business" = "admin", seenAgo = "0 seconds"): Promise<string> {
	const id = randomUUID();
	await db.query(`INSERT INTO agents (id, organization_uuid, token_hash, role, last_seen_at) VALUES ($1, 'org', $2, $3, now() - $4::interval)`,
		[id, `t-${id}`, role, seenAgo]);
	return id;
}

async function batchRow(): Promise<string> {
	const id = randomUUID();
	await db.query(`INSERT INTO command_batches (id, organization_uuid, type, total) VALUES ($1, 'org', 'IB_BACKUP', 1)`, [id]);
	return id;
}

test("КР-12 (БД): удержанная не уходит агенту и после своего срока ожидания; выпущенная — уходит", { skip }, async () => {
	const q = new CommandQueue(db, 1);
	const agent = await agentRow();
	const cmd = await q.enqueue({ agentId: agent, organizationUuid: "org", baseKey: "Б1", type: "IB_BACKUP", payload: { baseKey: "Б1", exclusive: {} },
		queueWaitSeconds: 43200, inBase: true, hold: true });
	const row = await q.get(cmd.id);
	assert.ok(new Date(row!.available_at!).getTime() > new Date(row!.expires_at).getTime() + 23 * 3600_000, "available_at на сутки позже срока");
	assert.deepEqual(await q.take(agent, 0), []);
	// Даже когда до срока осталась минута (раньше — окно выдачи без подготовки).
	await db.query(`UPDATE commands SET expires_at = now() + interval '1 minute', available_at = now() + interval '1 minute' + interval '1 day' WHERE id = $1`, [cmd.id]);
	assert.deepEqual(await q.take(agent, 0), []);
	assert.equal(await q.release(cmd.id), true);
	const got = await q.take(agent, 0);
	assert.deepEqual(got.map((c) => c.id), [cmd.id]);
	assert.equal(got[0]!.payload.exclusive, undefined, "состояние подготовки агенту не уходит");
});

test("КР-12 п. 1 (БД): повтор раннером — копия удержана, состояние в копии, исходная не в списке восстановления", { skip }, async () => {
	const q = new CommandQueue(db, 1);
	const agent = await agentRow();
	const batch = await batchRow();
	const op = await q.enqueue({ agentId: agent, organizationUuid: "org", baseKey: "Б2", type: "IB_INSTALL_EXTENSION",
		payload: { baseKey: "Б2", exclusive: { jobsWas: false, locked: true } }, queueWaitSeconds: 43200, hold: true });
	await db.query(`UPDATE commands SET batch_id = $2, state = 'failed', error = '{"code":"IB_BUSY","message":"занята"}' WHERE id = $1`, [op.id, batch]);
	const copyId = await q.retryBusy(op.id, 43200, { hold: true });
	assert.ok(copyId);
	const copy = (await q.get(copyId!))!;
	assert.equal(copy.state, "queued");
	assert.ok(new Date(copy.available_at!).getTime() > new Date(copy.expires_at).getTime(), "копия удержана до выпуска раннером");
	assert.deepEqual(copy.payload.exclusive, { jobsWas: false, locked: true });
	const src = (await q.get(op.id))!;
	assert.equal(src.retried_by, copyId);
	assert.equal((src.payload.exclusive as { movedTo?: string }).movedTo, copyId);
	const pending = await q.listExclusivePending(["IB_INSTALL_EXTENSION"]);
	assert.ok(pending.some((p) => p.id === copyId) && !pending.some((p) => p.id === op.id), "восстановление видит одну команду операции");
});

test("I8 (БД): обрыв опроса возвращает команду задания со сроком ожидания очереди", { skip }, async () => {
	const q = new CommandQueue(db, 1);
	const agent = await agentRow();
	const cmd = await q.enqueue({ agentId: agent, organizationUuid: "org", baseKey: "Б3", type: "IB_BACKUP", payload: {}, ttlSeconds: 900, queueWaitSeconds: 43200, inBase: true });
	const before = new Date((await q.get(cmd.id))!.expires_at).getTime();
	const got = await q.take(agent, 0, "PC#1");
	assert.equal(got.length, 1);
	assert.ok(new Date((await q.get(cmd.id))!.expires_at).getTime() < before - 3600_000, "выдача поставила срок выполнения");
	assert.equal(await q.requeue(got), 1);
	const back = (await q.get(cmd.id))!;
	assert.equal(back.state, "queued");
	assert.equal(back.dispatched_at, null);
	assert.equal(new Date(back.expires_at).getTime(), before, "прежний срок ожидания (12 ч), а не 15 мин");
});

test("КР-20 (БД): молчание агента закрывает короткое ожидание через минуты, а ожидание задания — только через часы", { skip }, async () => {
	const q = new CommandQueue(db, 1);
	const silent10m = await agentRow("admin", "10 minutes");
	const short = await q.enqueue({ agentId: silent10m, organizationUuid: "org", baseKey: "Б4", type: "IB_INFO", payload: {}, ttlSeconds: 900 });
	const nightly = await q.enqueue({ agentId: silent10m, organizationUuid: "org", baseKey: "Б5", type: "IB_BACKUP", payload: {}, ttlSeconds: 900, queueWaitSeconds: 43200 });
	await q.expireOrphaned(180);
	assert.equal((await q.get(short.id))!.state, "expired");
	assert.equal((await q.get(short.id))!.error?.code, "AGENT_OFFLINE");
	assert.equal((await q.get(nightly.id))!.state, "queued", "обновление службы на 10 минут не губит ночное задание");
	const silent3h = await agentRow("admin", "3 hours");
	const lost = await q.enqueue({ agentId: silent3h, organizationUuid: "org", baseKey: "Б6", type: "IB_BACKUP", payload: {}, ttlSeconds: 900, queueWaitSeconds: 43200 });
	await q.expireOrphaned(180);
	assert.equal((await q.get(lost.id))!.state, "expired", "агента нет часами — задание закрывается с причиной");
});

test("КР-12 п. 5 (БД): под обслуживанием — выгрузка к выдаче и закрытая монопольной операцией база; не удержанная и не чтение", { skip }, async () => {
	const q = new CommandQueue(db, 1);
	const admin = await agentRow("admin");
	// Ключи — свои на каждый прогон: выборка по всем агентам, а одноразовая база переживает прогоны.
	const k = (n: number) => `Обсл_${n}_${admin.slice(0, 6)}`;
	const held = await q.enqueue({ agentId: admin, organizationUuid: "org", baseKey: k(1), type: "IB_BACKUP", payload: { exclusive: {} }, queueWaitSeconds: 43200, hold: true });
	await q.enqueue({ agentId: admin, organizationUuid: "org", baseKey: k(2), type: "IB_LIST_USERS", payload: {} });
	await q.enqueue({ agentId: admin, organizationUuid: "org", baseKey: k(3), type: "IB_CHECK", payload: {} });
	const closed = await q.enqueue({ agentId: admin, organizationUuid: "org", baseKey: k(4), type: "IB_INSTALL_EXTENSION",
		payload: { exclusive: { jobsWas: false, locked: true } }, hold: true, queueWaitSeconds: 43200 });
	let busy = await q.basesUnderMaintenance();
	assert.equal(busy.has(k(1).toLowerCase()), false, "удержанная до подготовки (12 ч) — ещё не обслуживание");
	assert.equal(busy.has(k(2).toLowerCase()), false, "чтение — не обслуживание");
	assert.equal(busy.has(k(3).toLowerCase()), true);
	assert.equal(busy.has(k(4).toLowerCase()), true, "вход закрыт монопольной операцией");
	await q.release(held.id);
	await q.patchPayload(closed.id, { exclusive: { jobsWas: false, locked: true, restored: true } });
	await q.cancel([closed.id], "test");
	busy = await q.basesUnderMaintenance();
	assert.equal(busy.has(k(1).toLowerCase()), true, "выпущенная выгрузка — обслуживание");
	assert.equal(busy.has(k(4).toLowerCase()), false, "база возвращена");
});

test("КР-12 (БД): строка задания — удержанная операция без «повтор в …», копия — со временем выпуска раннером", { skip }, async () => {
	const q = new CommandQueue(db, 1);
	const agent = await agentRow();
	const batches = new BatchService(db);
	const batch = await batches.create({ organizationUuid: "org", userUuid: null, type: "IB_BACKUP", payload: {}, total: 1 });
	const cmd = await q.enqueue({ agentId: agent, organizationUuid: "org", baseKey: "Б7", type: "IB_BACKUP", payload: { exclusive: {} }, queueWaitSeconds: 43200, hold: true });
	await batches.attach(batch, cmd.id);
	let p = (await batches.progress(batch))!;
	assert.equal(p.items[0]!.retryAt, null);
	const at = new Date(Date.now() + 120_000).toISOString();
	await q.patchPayload(cmd.id, { exclusive: { locked: true, releaseAt: at } });
	p = (await batches.progress(batch))!;
	assert.equal(p.items[0]!.retryAt, at);
});

test("КР-20 (БД): более новая ожидающая заявка той же службы — её код; у самой новой — нет", { skip }, async () => {
	const s = new EnrollmentStore(db);
	const input = { name: "Бухгалтерия", role: "business" as const, serviceName: "BPAPIAgent", computer: `PC-${randomUUID().slice(0, 6)}` };
	const a = await s.submit(input, "10.0.0.1");
	// Сборка 19.09 повторяет заявку без секрета — новая заявка, агент опрашивает уже её.
	await db.query(`UPDATE agent_enrollments SET created_at = now() - interval '5 minutes' WHERE id = $1`, [a.row.id]);
	const b = await s.submit(input, "10.0.0.1");
	assert.equal(await s.newerPending(a.row.id), b.row.code);
	assert.equal(await s.newerPending(b.row.id), null);
	await s.reject(b.row.id, { decidedBy: "admin", note: "чужая" });
	assert.equal(await s.newerPending(a.row.id), null, "отклонённая новая не мешает одобрить прежнюю");
});

test("КР-20 (БД): заявки баз — более новая ожидающая той же базы (onec_base_id); у самой новой и после отказа — нет", { skip }, async () => {
	const s = new RegistrationStore(db);
	const body = { base: { id: randomUUID(), name: "Nord Beer" }, organizations: [{ bin: "180240037695", name: "ТОО Nord Beer" }] };
	const a = await s.submit(body, "10.0.0.1");
	// Старое расширение повторяет заявку без секрета — новая заявка, база опрашивает уже её.
	await db.query(`UPDATE base_registrations SET created_at = now() - interval '5 minutes' WHERE id = $1`, [a.row.id]);
	const b = await s.submit(body, "10.0.0.1");
	const other = await s.submit({ ...body, base: { id: randomUUID(), name: "Другая" } }, "10.0.0.2");
	assert.equal(await s.newerPending(a.row.id), b.row.code);
	assert.equal(await s.newerPending(b.row.id), null);
	assert.equal(await s.newerPending(other.row.id), null, "другая база — не соседка");
	await s.reject(b.row.id, { decidedBy: "admin", note: "чужая" });
	assert.equal(await s.newerPending(a.row.id), null, "отклонённая новая не мешает одобрить прежнюю");
});
