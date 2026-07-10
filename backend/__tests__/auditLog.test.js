import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDiff, snapshot, normalizeValue, objectNameOf, SECRET_FIELDS } from "../services/auditLog.js";

test("secret-поля не попадают ни в снимок, ни в diff", () => {
	const before = { uuid: "u1", username: "ivan", password: "old-hash", twoFactorSecret: "S1" };
	const after = { uuid: "u1", username: "ivan", password: "new-hash", twoFactorSecret: "S2" };
	const snap = snapshot(after);
	assert.equal("password" in snap, false);
	assert.equal("twoFactorSecret" in snap, false);
	// пароль сменился, но это НЕ должно порождать запись об изменении
	assert.deepEqual(computeDiff(before, after), {});
	assert.ok(SECRET_FIELDS.has("password"));
});

test("updatedAt/id не считаются изменением", () => {
	const before = { uuid: "u1", id: 1, name: "A", updatedAt: new Date("2026-01-01") };
	const after = { uuid: "u1", id: 1, name: "A", updatedAt: new Date("2026-07-10") };
	assert.deepEqual(computeDiff(before, after), {});
});

test("diff содержит только изменённые поля, в форме {from,to}", () => {
	const before = { uuid: "u1", name: "Старое", posted: false, comment: null };
	const after = { uuid: "u1", name: "Новое", posted: true, comment: null };
	assert.deepEqual(computeDiff(before, after), {
		name: { from: "Старое", to: "Новое" },
		posted: { from: false, to: true },
	});
});

test("null и пустая строка эквивалентны (очистка поля формой)", () => {
	assert.deepEqual(computeDiff({ comment: null }, { comment: "" }), {});
	assert.deepEqual(computeDiff({ comment: "" }, { comment: null }), {});
});

test("Decimal и Date нормализуются; связи пропускаются", () => {
	const decimal = { toNumber: () => 100.5 };
	assert.equal(normalizeValue(decimal), 100.5);
	assert.equal(normalizeValue(new Date("2026-07-10T00:00:00Z")), "2026-07-10T00:00:00.000Z");
	// Объект-связь (без toNumber) исключается из снимка.
	assert.equal(normalizeValue({ name: "Орг" }), undefined);
	assert.equal("organization" in snapshot({ organization: { name: "Орг" } }), false);
	// Decimal(100) и число 100 считаются равными → не изменение.
	assert.deepEqual(computeDiff({ amount: { toNumber: () => 100 } }, { amount: 100 }), {});
});

test("create/delete дают равномерный diff (from=null / to=null)", () => {
	const rec = { uuid: "u1", name: "Товар" };
	assert.deepEqual(computeDiff({}, rec), { uuid: { from: null, to: "u1" }, name: { from: null, to: "Товар" } });
	assert.deepEqual(computeDiff(rec, {}), { uuid: { from: "u1", to: null }, name: { from: "Товар", to: null } });
});

test("длинные строки обрезаются", () => {
	const long = "x".repeat(600);
	const v = normalizeValue(long);
	assert.equal(v.length, 501); // 500 + символ обрезки
	assert.ok(v.endsWith("…"));
});

test("objectNameOf: name → fullName → № number → username → тип", () => {
	assert.equal(objectNameOf({ name: "Товар" }, "Product"), "Товар");
	assert.equal(objectNameOf({ fullName: "Иванов" }, "Employee"), "Иванов");
	assert.equal(objectNameOf({ number: "СПИС-000001" }, "WriteOff"), "№ СПИС-000001");
	assert.equal(objectNameOf({ username: "admin" }, "User"), "admin");
	assert.equal(objectNameOf({}, "Purchase"), "Purchase");
});

// ── Ретенция журнала ────────────────────────────────────────────────────────
import { retentionDays, shouldPrune, pruneAuditLog, _resetPruneThrottle, DEFAULT_RETENTION_DAYS, AUTH_ACTIONS } from "../services/auditLog.js";

test("retentionDays: дефолт, переопределение и мусорное значение", () => {
	delete process.env.AUDIT_RETENTION_DAYS;
	assert.equal(retentionDays(), DEFAULT_RETENTION_DAYS);
	process.env.AUDIT_RETENTION_DAYS = "30";
	assert.equal(retentionDays(), 30);
	process.env.AUDIT_RETENTION_DAYS = "не-число";
	assert.equal(retentionDays(), DEFAULT_RETENTION_DAYS, "мусор → дефолт, а не NaN");
	process.env.AUDIT_RETENTION_DAYS = "0";
	assert.equal(retentionDays(), 0, "0 = чистка отключена");
	delete process.env.AUDIT_RETENTION_DAYS;
});

test("pruneAuditLog: неположительный срок = чистка отключена (БД не трогается)", async () => {
	const client = { activityHistory: { deleteMany: () => { throw new Error("не должен вызываться"); } } };
	assert.deepEqual(await pruneAuditLog(0, client), { deleted: 0, skipped: true });
	assert.deepEqual(await pruneAuditLog(-5, client), { deleted: 0, skipped: true });
});

test("pruneAuditLog: удаляет записи старше cutoff", async () => {
	let captured;
	const client = { activityHistory: { deleteMany: (args) => { captured = args; return { count: 7 }; } } };
	const res = await pruneAuditLog(30, client);
	assert.equal(res.deleted, 7);
	const cutoff = captured.where.actionDate.lt;
	const ageDays = (Date.now() - cutoff.getTime()) / 86400000;
	assert.ok(Math.abs(ageDays - 30) < 0.01, `cutoff ≈ 30 дней назад, получено ${ageDays}`);
});

test("shouldPrune: троттлинг раз в сутки", () => {
	_resetPruneThrottle();
	const now = Date.now();
	assert.equal(shouldPrune(now), true, "первый вызов разрешён");
	assert.equal(shouldPrune(now + 1000), false, "повтор через секунду — нет");
	assert.equal(shouldPrune(now + 23 * 3600_000), false, "через 23ч — ещё нет");
	assert.equal(shouldPrune(now + 25 * 3600_000), true, "через 25ч — снова можно");
	_resetPruneThrottle();
});

test("AUTH_ACTIONS покрывают события безопасности", () => {
	assert.deepEqual(Object.values(AUTH_ACTIONS).sort(), [
		"2fa_disabled", "2fa_enabled", "login", "login_failed", "password_changed",
	]);
});
