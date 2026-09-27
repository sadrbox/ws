/**
 * ИСПРАВЛЕНИЯ АУДИТА 26.09 НА НАСТОЯЩЕМ POSTGRES — SQL, который подставными базами не проверить.
 *
 * Идёт ТОЛЬКО на одноразовой базе: AI_TEST_DATABASE_URL, в имени базы обязано быть «test» (рабочую базу сервиса
 * тест не тронет ни при какой ошибке окружения). Без переменной тесты пропускаются. Миграции применяются тем же
 * migrate(), что и при старте сервиса, — проверяется и сама 045.
 *
 * Что держим:
 *   Б11 — повтор заявки агента/базы без секрета не трогает чужую заявку; с секретом — та же заявка; одобрение
 *         закрывает соседние; организации базы действуют только одобренными;
 *   Н4  — выданная команда с истёкшим сроком не держит место базы вечно; sweep снимает просрочку;
 *   P3  — остановленное задание не продолжается повтором «база занята»; гонка ротации токена базы;
 *   Н9  — окно расписания занимается атомарно и один раз (миллисекунды отметки);
 *   И29 — повтор изменяющей команды с тем же requestId присоединяется к идущей, а не ставит вторую.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "../src/db/migrate.ts";
import { EnrollmentStore } from "../src/agents/enrollments.ts";
import { RegistrationStore } from "../src/bases/registrations.ts";
import { BaseOrganizationsStore } from "../src/bases/organizations.ts";
import { CommandQueue } from "../src/commands/queue.ts";
import { ScheduleStore } from "../src/onec/schedules.ts";
import { BaseTokenStore } from "../src/bases/tokens.ts";
import { recoverInterruptedTurns } from "../src/chat/recovery.ts";
import type { Logger } from "../src/logger.ts";

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

const input = (computer = "BUH-PC-02", role: "business" | "admin" = "business") =>
	({ name: "Бухгалтерия", role, serverName: "SRV", serviceName: "BPAPIAgent", computer, version: "1" });

test("Б11: повтор заявки агента без секрета — новая заявка; прежняя с её секретом и ролью цела", { skip }, async () => {
	const s = new EnrollmentStore(db);
	const a = await s.submit(input("PC-A"), "10.0.0.1");
	// Атакующий знает имя компьютера и службы, но не секрет: пытается сменить роль на admin.
	const b = await s.submit(input("PC-A", "admin"), "6.6.6.6");
	assert.notEqual(b.row.id, a.row.id);
	assert.notEqual(b.row.code, a.row.code);
	assert.equal(b.repeated, false);
	const orig = await s.bySecret(a.row.id, a.secret);
	assert.ok(orig, "прежний секрет по-прежнему открывает свою заявку");
	assert.equal(orig!.role, "business", "роль прежней заявки не перезаписана");
	assert.equal(orig!.state, "PENDING");
	// Повтор настоящим агентом С секретом — та же заявка и тот же код, секрет новый.
	const c = await s.submit(input("pc-a"), "10.0.0.1", a.secret);
	assert.equal(c.row.id, a.row.id);
	assert.equal(c.row.code, a.row.code);
	assert.equal(c.repeated, true);
	assert.equal(await s.bySecret(a.row.id, a.secret), null, "прежний секрет больше не действует");
	assert.ok(await s.bySecret(a.row.id, c.secret));
	// Одобрение одной закрывает соседнюю заявку той же службы.
	const agentId = randomUUID();
	await db.query(`INSERT INTO agents (id, organization_uuid, token_hash) VALUES ($1, 'org', 'x')`, [agentId]);
	assert.equal(await s.approve(a.row.id, { organizationUuid: "org", agentId, decidedBy: "admin" }), true);
	const sibling = await s.get(b.row.id);
	assert.equal(sibling!.state, "REJECTED");
	assert.match(sibling!.note ?? "", new RegExp(a.row.code));
	// Прежний агент службы — одним запросом на список.
	const again = await s.submit(input("PC-A"), "10.0.0.1");
	const prev = await s.previousAgents([{ id: again.row.id, computer: again.row.computer, serviceName: again.row.serviceName }]);
	assert.equal(prev.get(again.row.id), agentId);
});

test("Б11: повтор заявки базы без секрета не меняет её список БИНов", { skip }, async () => {
	const s = new RegistrationStore(db);
	const body = (bins: string[]) => ({ base: { id: "onec-base-1", name: "Бух" }, organizations: bins.map((bin) => ({ bin, name: bin })) });
	const a = await s.submit(body(["111111111111"]), "10.0.0.1");
	const b = await s.submit(body(["999999999999"]), "6.6.6.6");
	assert.notEqual(b.row.id, a.row.id);
	const orig = await s.bySecret(a.row.id, a.secret);
	assert.deepEqual(orig!.body.organizations.map((o) => o.bin), ["111111111111"]);
	const c = await s.submit(body(["111111111111", "222222222222"]), "10.0.0.1", a.secret);
	assert.equal(c.row.id, a.row.id);
	assert.deepEqual(c.row.body.organizations.map((o) => o.bin), ["111111111111", "222222222222"]);
});

test("Б11: организации базы — присланное базой ждёт одобрения, одобренное действует", { skip }, async () => {
	const s = new BaseOrganizationsStore(db);
	const baseId = randomUUID();
	const sent = await s.remember(baseId, [{ bin: "111111111111", name: "Своя" }, { bin: "999999999999", name: "Чужая" }], { source: "base" });
	assert.equal(sent.remembered, 2);
	assert.deepEqual(sent.pending.sort(), ["111111111111", "999999999999"]);
	assert.equal(await s.has(baseId, "999999999999"), false, "названный базой БИН сам по себе не открывает задачи");
	// Организация токена базы — одобряется.
	assert.equal(await s.approve(baseId, "111111111111", "токен", "token"), true);
	assert.equal(await s.has(baseId, "111111111111"), true);
	// Повторная присылка не снимает одобрения и не одобряет ожидающее.
	const again = await s.remember(baseId, [{ bin: "111111111111", name: "Своя (новое имя)" }, { bin: "999999999999" }], { source: "base" });
	assert.deepEqual(again.pending, ["999999999999"]);
	assert.equal(await s.has(baseId, "111111111111"), true);
	const listed = new Map((await s.list(baseId)).map((x) => [x.bin, x]));
	assert.deepEqual([listed.get("111111111111")?.name, listed.get("111111111111")?.approved], ["Своя (новое имя)", true]);
	assert.deepEqual([listed.get("999999999999")?.name, listed.get("999999999999")?.approved], ["Чужая", false]);
	assert.ok((await s.pending()).some((x) => x.baseId === baseId && x.bin === "999999999999"));
	// Отклонить можно только ожидающее; одобренное не убирается.
	assert.equal(await s.rejectPending(baseId, "111111111111"), false);
	assert.equal(await s.rejectPending(baseId, "999999999999"), true);
	// Одобренная заявка на регистрацию — БИНы действуют сразу.
	const reg = await s.remember(baseId, [{ bin: "222222222222" }], { approvedBy: "admin", source: "registration" });
	assert.deepEqual(reg.pending, []);
	assert.equal(await s.has(baseId, "222222222222"), true);
});

test("Б11: миграция 045 одобряет прежние строки только из одобренной заявки базы", { skip }, async () => {
	const baseId = randomUUID();
	const serverId = randomUUID();
	await db.query(`INSERT INTO servers (id, organization_uuid, name) VALUES ($1, 'org', $2)`, [serverId, `srv-${serverId.slice(0, 6)}`]);
	await db.query(`INSERT INTO bases (id, server_id, key) VALUES ($1, $2, 'Бух045')`, [baseId, serverId]);
	await db.query(`INSERT INTO base_registrations (id, code, secret_hash, onec_base_id, base_name, body, state, base_id, expires_at)
	                VALUES ($1, 'AAA-045', 'x', 'onec-045', 'Бух', $2, 'APPROVED', $3, now() + interval '1 day')`,
		[randomUUID(), JSON.stringify({ base: { id: "onec-045", name: "Бух" }, organizations: [{ bin: "333333333333" }] }), baseId]);
	await db.query(`INSERT INTO base_organizations (base_id, bin) VALUES ($1, '333333333333'), ($1, '444444444444')`, [baseId]);
	// Строки «как до миграции»: без одобрения и источника. Шаг миграции — тот же SQL, что в файле.
	const sql = (await import("node:fs")).readFileSync(new URL("../migrations/045_audit_0926.sql", import.meta.url), "utf8");
	const step = sql.slice(sql.indexOf("UPDATE base_organizations o"), sql.indexOf("CREATE INDEX IF NOT EXISTS base_organizations_pending_idx"));
	await db.query(step);
	const s = new BaseOrganizationsStore(db);
	assert.equal(await s.has(baseId, "333333333333"), true, "БИН из одобренной заявки — действует");
	assert.equal(await s.has(baseId, "444444444444"), false, "присланный самой базой — ждёт одобрения");
});

async function agentRow(org = "org"): Promise<string> {
	const id = randomUUID();
	await db.query(`INSERT INTO agents (id, organization_uuid, token_hash, last_seen_at) VALUES ($1, $2, 'x', now())`, [id, org]);
	return id;
}

test("Н4: выданная команда с истёкшим сроком перестаёт держать место базы; sweep снимает её сам", { skip }, async () => {
	const q = new CommandQueue(db, 1, 60);
	const agent = await agentRow();
	const first = await q.enqueue({ agentId: agent, organizationUuid: "org", baseKey: "Б1", type: "IB_INFO", payload: {}, ttlSeconds: 60 });
	const got = await q.take(agent, 0);
	assert.deepEqual(got.map((c) => c.id), [first.id]);
	const second = await q.enqueue({ agentId: agent, organizationUuid: "org", baseKey: "Б1", type: "IB_INFO", payload: {}, ttlSeconds: 60 });
	assert.deepEqual(await q.take(agent, 0), [], "пока первая выполняется — место базы занято");
	// Ответ потерян, срок истёк давно (дольше grace), а таймер ещё не прошёл: место уже свободно.
	await db.query(`UPDATE commands SET expires_at = now() - interval '5 minutes' WHERE id = $1`, [first.id]);
	assert.deepEqual((await q.take(agent, 0)).map((c) => c.id), [second.id]);
	// Таймер: просроченная выданная — в expired с понятной причиной; повторный вызов в пределах паузы — ничего.
	const swept = await q.sweep(180);
	assert.ok(swept.overdue >= 1);
	const row = await q.get(first.id);
	assert.equal(row!.state, "expired");
	assert.equal(row!.error?.code, "COMMAND_EXPIRED");
	assert.deepEqual(await q.sweep(180, 60_000), { overdue: 0, orphaned: 0 });
});

test("P3: остановленное задание не продолжается повтором «база занята»", { skip }, async () => {
	const q = new CommandQueue(db, 1);
	const agent = await agentRow();
	const batchId = randomUUID();
	await db.query(`INSERT INTO command_batches (id, organization_uuid, type, total) VALUES ($1, 'org', 'IB_BACKUP', 1)`, [batchId]);
	const cmd = await q.enqueue({ agentId: agent, organizationUuid: "org", baseKey: "Б2", type: "IB_BACKUP", payload: {} });
	await db.query(`UPDATE commands SET batch_id = $2, state = 'failed', error = '{"code":"IB_BUSY","message":"занята"}' WHERE id = $1`, [cmd.id, batchId]);
	await q.cancelBatch(batchId, "оператор");
	assert.equal(await q.retryBusy(cmd.id, 60), null);
	// Не остановленное — повторяется, как и раньше.
	const batch2 = randomUUID();
	await db.query(`INSERT INTO command_batches (id, organization_uuid, type, total) VALUES ($1, 'org', 'IB_BACKUP', 1)`, [batch2]);
	const cmd2 = await q.enqueue({ agentId: agent, organizationUuid: "org", baseKey: "Б3", type: "IB_BACKUP", payload: {} });
	await db.query(`UPDATE commands SET batch_id = $2, state = 'failed', error = '{"code":"IB_BUSY","message":"занята"}' WHERE id = $1`, [cmd2.id, batch2]);
	assert.ok(await q.retryBusy(cmd2.id, 60));
});

test("P3: учётная запись базы подставляется ПОСЛЕ транзакции выдачи — пул не блокируется", { skip }, async () => {
	const q = new CommandQueue(db, 4);
	const agent = await agentRow();
	let inTx = -1;
	q.setAuthResolver(async (_agent, keys) => {
		// Во время подстановки транзакция выдачи уже закрыта: сессий с открытой транзакцией у этого агента нет.
		const r = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'`);
		inTx = Number(r.rows[0]!.n);
		return new Map(keys.map((k) => [k, { user: "adm", password: "p" }]));
	});
	await q.enqueue({ agentId: agent, organizationUuid: "org", baseKey: "Б4", type: "IB_INFO", payload: {} });
	const got = await q.take(agent, 0);
	assert.equal(got.length, 1);
	assert.deepEqual(got[0]!.payload.auth, { user: "adm", password: "p" });
	assert.equal(inTx, 0);
	// В БД пароль не записан.
	const row = await q.get(got[0]!.id);
	assert.equal((row!.payload as Record<string, unknown>).auth, undefined);
});

test("И29: повтор изменяющей команды с тем же requestId присоединяется к идущей", { skip }, async () => {
	const q = new CommandQueue(db, 1);
	const agent = await agentRow();
	const a = await q.enqueue({ agentId: agent, organizationUuid: "org", baseKey: "Б5", type: "CREATE_SALE", payload: { x: 1 }, requestId: "req-1" });
	const b = await q.enqueue({ agentId: agent, organizationUuid: "org", baseKey: "Б5", type: "CREATE_SALE", payload: { x: 1 }, requestId: "req-1" });
	assert.equal(b.id, a.id);
	// Снятая до выдачи — не выполнится: отмена срабатывает только для ещё не выданной.
	assert.equal(await q.cancel([a.id], "chat-timeout"), 1);
	assert.equal((await q.get(a.id))!.state, "canceled");
});

test("Н9: окно расписания занимается один раз — второй тик и второй процесс его не получают", { skip }, async () => {
	const s = new ScheduleStore(db);
	const created = await s.create({ organizationUuid: "org", userUuid: "u", name: "Выгрузка", type: "IB_BACKUP", baseKeys: ["Б"], payload: {}, serverId: null, atTime: "02:00", weekdays: [], enabled: true });
	assert.equal(await s.claimRun(created.id, null), true);
	assert.equal(await s.claimRun(created.id, null), false, "второй тик того же окна");
	// Отметка с микросекундами, прочитанная через Date (миллисекунды), — всё равно совпадает.
	await db.query(`UPDATE maintenance_schedules SET last_run_at = '2026-09-25 02:00:00.123456+00' WHERE id = $1`, [created.id]);
	const seen = (await s.get(created.id))!.lastRunAt;
	assert.equal(await s.claimRun(created.id, seen), true);
	assert.equal(await s.claimRun(created.id, seen), false);
});

test("P3: гонка ротации токена базы — один преемник, лишнего действующего токена нет", { skip }, async () => {
	const serverId = randomUUID();
	const baseId = randomUUID();
	await db.query(`INSERT INTO servers (id, organization_uuid, name) VALUES ($1, 'org', $2)`, [serverId, `srv-${serverId.slice(0, 6)}`]);
	await db.query(`INSERT INTO bases (id, server_id, key) VALUES ($1, $2, 'БТ')`, [baseId, serverId]);
	const t = new BaseTokenStore(db, "secret-secret-secret-1234", { rotateDays: 90, overlapHours: 24 });
	const issued = await t.issue({ baseId, organizationUuid: "org", createdBy: "test" });
	const [x, y] = await Promise.all([t.rotate(issued.id, "rotation"), t.rotate(issued.id, "rotation")]);
	assert.ok(x && y);
	assert.equal(x, y, "оба хода отдают одного и того же преемника");
	const live = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM base_tokens WHERE base_id = $1 AND revoked_at IS NULL`, [baseId]);
	assert.equal(Number(live.rows[0]!.n), 2, "прежний (на перекрытие) и один преемник");
});

test("Н9: ходы, оборванные перезапуском, закрываются при старте; ключи хода освобождаются", { skip }, async () => {
	const conv = randomUUID();
	const serverId = randomUUID();
	const baseId = randomUUID();
	await db.query(`INSERT INTO servers (id, organization_uuid, name) VALUES ($1, 'org', $2)`, [serverId, `srv-${serverId.slice(0, 6)}`]);
	await db.query(`INSERT INTO bases (id, server_id, key) VALUES ($1, $2, 'БК')`, [baseId, serverId]);
	await db.query(`INSERT INTO conversations (id, organization_uuid, user_uuid, state) VALUES ($1, 'org', 'u', 'EXECUTING')`, [conv]);
	await db.query(`INSERT INTO onec_chat_turn_keys (base_id, user_id, key, expires_at) VALUES ($1, 'u1', 'k1', now() + interval '1 day')`, [baseId]);
	const r = await recoverInterruptedTurns(db, silent);
	assert.ok(r.conversations >= 1 && r.turnKeys >= 1);
	const c = await db.query<{ state: string }>(`SELECT state FROM conversations WHERE id = $1`, [conv]);
	assert.equal(c.rows[0]!.state, "FAILED");
	const m = await db.query<{ content: { text: string } }>(`SELECT content FROM messages WHERE conversation_id = $1`, [conv]);
	assert.match(m.rows[0]!.content.text, /перезапуск/);
});

test("P2 очереди: базы с незавершёнными командами агента кластера — «под обслуживанием»", { skip }, async () => {
	const q = new CommandQueue(db, 1);
	const admin = randomUUID();
	const biz = randomUUID();
	await db.query(`INSERT INTO agents (id, organization_uuid, token_hash, role, last_seen_at) VALUES ($1, 'org', 'x', 'admin', now()), ($2, 'org', 'y', 'business', now())`, [admin, biz]);
	const backup = await q.enqueue({ agentId: admin, organizationUuid: "org", baseKey: "Бух_01", type: "IB_BACKUP", payload: {} });
	await q.enqueue({ agentId: biz, organizationUuid: "org", baseKey: "Бух_02", type: "RUN_ACCOUNTING_CHECK", payload: {} });
	const busy = await q.basesUnderMaintenance();
	assert.equal(busy.has("бух_01"), true, "выгрузка агента кластера — обслуживание");
	assert.equal(busy.has("бух_02"), false, "команда бизнес-агента — не обслуживание");
	await q.cancel([backup.id], "test");
	assert.equal((await q.basesUnderMaintenance()).has("бух_01"), false);
});
