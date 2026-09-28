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

/** Подставной журнал: findMany по actionDate < cutoff (самые старые, take), deleteMany по id. */
function fakeJournal(dates) {
	const rows = dates.map((d, i) => ({ id: i + 1, actionDate: d }));
	const calls = { find: [], del: [] };
	return {
		rows,
		calls,
		client: {
			activityHistory: {
				findMany: async (args) => {
					calls.find.push(args);
					return rows.filter((r) => r.actionDate < args.where.actionDate.lt).sort((a, b) => a.actionDate - b.actionDate).slice(0, args.take).map((r) => ({ id: r.id }));
				},
				deleteMany: async (args) => {
					calls.del.push(args);
					const ids = new Set(args.where?.id?.in ?? []);
					const before = rows.length;
					for (let i = rows.length - 1; i >= 0; i--) if (ids.has(rows[i].id)) rows.splice(i, 1);
					return { count: before - rows.length };
				},
			},
		},
	};
}

test("pruneAuditLog: удаляет записи старше cutoff", async () => {
	const day = 86400000;
	const j = fakeJournal([new Date(Date.now() - 40 * day), new Date(Date.now() - 31 * day), new Date(Date.now() - 2 * day)]);
	const res = await pruneAuditLog(30, j.client);
	assert.equal(res.deleted, 2);
	assert.deepEqual(j.rows.map((r) => r.id), [3], "свежая запись осталась");
	const cutoff = j.calls.find[0].where.actionDate.lt;
	const ageDays = (Date.now() - cutoff.getTime()) / 86400000;
	assert.ok(Math.abs(ageDays - 30) < 0.01, `cutoff ≈ 30 дней назад, получено ${ageDays}`);
});

test("pruneAuditLog: КР-15 — хвост журнала удаляется пачками по id, а не одним DELETE", async () => {
	const day = 86400000;
	const old = Array.from({ length: 12 }, (_, i) => new Date(Date.now() - (400 + i) * day));
	const j = fakeJournal([...old, new Date(Date.now() - day)]);
	const res = await pruneAuditLog(365, j.client, { batch: 5 });
	assert.equal(res.deleted, 12);
	assert.equal(res.more, undefined, "хвост дочищен за проход");
	assert.equal(j.calls.del.length, 3, "три пачки: 5 + 5 + 2");
	for (const c of j.calls.del) {
		assert.ok(Array.isArray(c.where?.id?.in) && c.where.id.in.length <= 5, "DELETE — по id пачки");
		assert.equal(c.where.actionDate, undefined, "не DELETE по всему сроку разом");
	}
	assert.equal(j.rows.length, 1);
	// Предохранитель: не больше maxBatches пачек за проход — остаток помечен.
	const k = fakeJournal(old);
	const part = await pruneAuditLog(365, k.client, { batch: 5, maxBatches: 2 });
	assert.equal(part.deleted, 10);
	assert.equal(part.more, true);
	assert.equal(k.rows.length, 2);
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
	/*
	 * Список закреплён целиком намеренно: новое событие безопасности обязано быть осознанным
	 * решением, а не побочным следствием правки. 24.09 добавлены три — вход отклонён не по
	 * паролю (О6), регистрация организации и присоединение по приглашению (О1): по ним
	 * восстанавливается, откуда в установке взялась организация и кто её завёл.
	 */
	assert.deepEqual(Object.values(AUTH_ACTIONS).sort(), [
		"2fa_disabled", "2fa_enabled", "login", "login_denied", "login_failed",
		"org_joined", "org_registered", "password_changed",
	]);
});

test("LOGIN_DENIED отделён от LOGIN_FAILED", () => {
	// Подбор пароля и «учётная запись верна, но организаций нет» — разные поводы для тревоги.
	// Слитые в один счётчик, они теряют оба: всплеск отказов перестаёт что-либо значить.
	assert.notEqual(AUTH_ACTIONS.LOGIN_DENIED, AUTH_ACTIONS.LOGIN_FAILED);
});
