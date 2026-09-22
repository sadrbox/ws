/**
 * Хранилища канала 1С: ключи ходов (§2) и смена токена базы (§3).
 *
 * Здесь проверяется то, чего не видно на уровне роутера, а стоит дороже всего:
 *   — ключ занимается ОДНИМ запросом (вставка и есть замок): два одновременных хода не разойдутся;
 *   — просроченный ключ не держит ход вечно, но и не воскрешает чужой ответ;
 *   — смена токена оставляет прежний годным на время перекрытия и хранит преемника закрытым;
 *   — перекрытие закрывает только ПРЕДШЕСТВЕННИКА: чужой токен той же базы трогать нельзя;
 *   — сменённый токен по истечении перекрытия равен отозванному.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TurnKeyStore } from "../src/chat/turnKeys.ts";
import { BaseTokenStore } from "../src/bases/tokens.ts";
import type { Db } from "../src/db/pool.ts";

type Call = { sql: string; params: unknown[] };

function fakeDb(calls: Call[], answer: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): Db {
	return { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return answer(sql, params); } } as unknown as Db;
}

const PAIR = { baseId: "bbbbbbbb-0000-4000-8000-000000000001", userId: "0f6c1c1e-6a57-4c6e-9b2a-1d4f2c9e7a01", key: "k-1" };

// ── §2. Ключи ходов ──────────────────────────────────────────────────────────

test("§2: ключ занимается вставкой — это и есть замок, второй запрос к базе не нужен", async () => {
	const calls: Call[] = [];
	const state = await new TurnKeyStore(fakeDb(calls, () => ({ rows: [], rowCount: 1 })), 24).claim(PAIR);

	assert.deepEqual(state, { kind: "fresh" });
	assert.equal(calls.length, 1, "занял ключ — читать нечего");
	assert.match(calls[0]!.sql, /INSERT INTO onec_chat_turn_keys/);
	assert.match(calls[0]!.sql, /ON CONFLICT \(base_id, user_id, key\) DO UPDATE/);
	// Просроченная строка уступает место новому ходу; живая — нет.
	assert.match(calls[0]!.sql, /WHERE onec_chat_turn_keys\.expires_at <= now\(\)/);
});

test("§2: ключ занят — узнаём судьбу первого хода, а не начинаем второй", async () => {
	const done = await new TurnKeyStore(fakeDb([], (sql) => sql.startsWith("INSERT")
		? { rows: [], rowCount: 0 }
		: { rows: [{ state: "done", conversation_id: "c1", status: 200, response: { success: true } }], rowCount: 1 }), 24).claim(PAIR);
	assert.deepEqual(done, { kind: "done", status: 200, response: { success: true } });

	const running = await new TurnKeyStore(fakeDb([], (sql) => sql.startsWith("INSERT")
		? { rows: [], rowCount: 0 }
		: { rows: [{ state: "running", conversation_id: "c1", status: null, response: null }], rowCount: 1 }), 24).claim(PAIR);
	assert.deepEqual(running, { kind: "running", conversationId: "c1" });
});

test("§2: 500 освобождает ключ — повтор после своей же поломки обязан сработать", async () => {
	const calls: Call[] = [];
	await new TurnKeyStore(fakeDb(calls, () => ({ rows: [], rowCount: 1 })), 24).release(PAIR);
	assert.match(calls[0]!.sql, /DELETE FROM onec_chat_turn_keys/);
	// Готовый ответ не стираем: его мог записать уже другой запрос.
	assert.match(calls[0]!.sql, /state = 'running'/);
});

// ── §3. Смена токена базы ────────────────────────────────────────────────────

test("§3: смена выпускает преемника, оставляет прежний годным на перекрытие и хранит новый закрытым", async () => {
	const calls: Call[] = [];
	const db = fakeDb(calls, (sql) => sql.startsWith("SELECT base_id")
		? { rows: [{ base_id: PAIR.baseId, organization_uuid: "org" }], rowCount: 1 }
		: { rows: [], rowCount: 1 });
	const token = await new BaseTokenStore(db, "секрет сервиса", { rotateDays: 90, overlapHours: 24 }).rotate("t1", "rotation");

	assert.match(String(token), /^bpb_/);
	const insert = calls.find((c) => c.sql.includes("INSERT INTO base_tokens"))!;
	assert.ok(insert, "преемник не выпущен");
	assert.notEqual(insert.params[3], token, "в базе — только хэш; сам токен не хранится");
	const mark = calls.find((c) => c.sql.includes("SET replaced_by"))!;
	assert.match(mark.sql, /accepted_until = now\(\) \+ \(\$3 \|\| ' hours'\)::interval/);
	assert.equal(mark.params[2], 24);
	assert.notEqual(mark.params[3], token, "копия преемника хранится закрытой, а не открытым текстом");
	// Меняем только НЕотозванный и ещё не сменённый токен: иначе у базы стало бы два преемника.
	const pick = calls[0]!;
	assert.match(pick.sql, /revoked_at IS NULL AND replaced_by IS NULL/);
});

test("§3: недошедший токен отдаётся тем же — и перекрытие продлевается, а не обрывается", async () => {
	const calls: Call[] = [];
	// Копию преемника делает сам магазин: берём её из запроса смены и возвращаем на перечитывание.
	let sealed = "";
	const db = fakeDb(calls, (sql, params) => {
		if (sql.startsWith("SELECT base_id")) return { rows: [{ base_id: PAIR.baseId, organization_uuid: "org" }], rowCount: 1 };
		if (sql.includes("SET replaced_by")) { sealed = String(params[3]); return { rows: [], rowCount: 1 }; }
		if (sql.includes("SET accepted_until = GREATEST")) return { rows: [{ pending_secret: sealed }], rowCount: 1 };
		return { rows: [], rowCount: 1 };
	});
	const store = new BaseTokenStore(db, "секрет сервиса", { rotateDays: 90, overlapHours: 24 });
	const token = await store.rotate("t1", "rotation");

	assert.equal(await store.redeliver("t1"), token, "второй токен на каждый недошедший ответ — россыпь годных ключей");
	const extend = calls.find((c) => c.sql.includes("GREATEST"))!;
	assert.match(extend.sql, /pending_secret IS NOT NULL/, "продлевать нечего, если преемника нет");
});

test("§3: чужим секретом преемник не читается — смена просто не состоится", async () => {
	let sealed = "";
	const db = fakeDb([], (sql, params) => {
		if (sql.startsWith("SELECT base_id")) return { rows: [{ base_id: PAIR.baseId, organization_uuid: "org" }], rowCount: 1 };
		if (sql.includes("SET replaced_by")) { sealed = String(params[3]); return { rows: [], rowCount: 1 }; }
		if (sql.includes("GREATEST")) return { rows: [{ pending_secret: sealed }], rowCount: 1 };
		return { rows: [], rowCount: 1 };
	});
	await new BaseTokenStore(db, "секрет сервиса").rotate("t1", "rotation");
	assert.equal(await new BaseTokenStore(db, "другой секрет").redeliver("t1"), null);
});

test("§3: перекрытие закрывает только предшественника", async () => {
	const calls: Call[] = [];
	await new BaseTokenStore(fakeDb(calls, () => ({ rows: [], rowCount: 1 }))).markUsed("t2");
	const close = calls.find((c) => c.sql.includes("SET accepted_until = now()"))!;
	assert.match(close.sql, /WHERE replaced_by = \$1/, "прочие токены базы — не наше дело: их выпускали руками");
	assert.match(close.sql, /pending_secret = NULL/, "доставка подтверждена — копию преемника держать незачем");
	assert.match(calls[0]!.sql, /first_used_at = now\(\) WHERE id = \$1 AND first_used_at IS NULL/);
});

test("§3: сменённый токен после перекрытия равен отозванному, до — ещё годен", async () => {
	const row = (acceptedUntil: Date | null) => ({
		id: "t1", base_id: PAIR.baseId, key: "Dev_01", name: "База", organization_uuid: "org", revoked_at: null, disabled_at: null,
		rotate_after: null, replaced_by: acceptedUntil ? "t2" : null, accepted_until: acceptedUntil, pending_secret: null, first_used_at: new Date(),
	});
	const at = (ms: number) => new BaseTokenStore(fakeDb([], () => ({ rows: [row(new Date(Date.now() + ms))], rowCount: 1 }))).resolve("bpb_x");

	assert.equal((await at(60_000))!.revoked, false);
	assert.equal((await at(-60_000))!.revoked, true, "перекрытие кончилось — токена больше нет");
});
