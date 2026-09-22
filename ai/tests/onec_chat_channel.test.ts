/**
 * Канал «расширение 1С ↔ сервис»: загрузка вложений, идемпотентность хода, смена токена, телеметрия.
 * Задача — docs/TASK_SERVICE_ONEC_CHAT_CHANNEL_2026-09-21.md, §1–§4.
 *
 * Держим то, что ошибкой обходится дороже всего:
 *   §1 файл, загруженный одним пользователем, не открывается другому по угаданному идентификатору;
 *      установка без хранилища отвечает 404 — по нему расширение возвращается к base64, а не падает;
 *   §2 повтор хода с тем же ключом не создаёт второго сообщения — ни после ответа, ни во время работы;
 *   §3 новый токен уезжает только расширению, которое умеет его сохранить, и один и тот же — пока не дошёл;
 *   §4 номер запроса возвращается, старое расширение получает внятный отказ, /ping называет умения.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { onecChatRouter, versionAtLeast, onecOwnerUuid } from "../src/http/onecChatRouter.ts";
import type { Db } from "../src/db/pool.ts";
import type { Logger } from "../src/logger.ts";

const TOKEN = "bpb_test-token";
const TOKEN_ID = "t1";
const BASE_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const ORG = "a1410911-7421-45da-9632-7e4fc48e91c2";
const USER = "0f6c1c1e-6a57-4c6e-9b2a-1d4f2c9e7a01";
const OTHER = "0f6c1c1e-6a57-4c6e-9b2a-1d4f2c9e7a02";

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

/** Ход: диалог заводится, текст и вложения запоминаются — этого довольно, чтобы судить о канале. */
function fakeWorkflow() {
	const turns: { conversationId: string; text: string; files: { fileName: string; bytes: number }[] }[] = [];
	let hold: (() => void) | null = null;
	const workflow = {
		prepare: async (_u: unknown, id: string | null) => id ?? "c0000000-0000-4000-8000-000000000001",
		handle: async (_u: unknown, id: string, text: string) => {
			if (hold) await new Promise<void>((resolve) => { hold = resolve; });
			turns.push({ conversationId: id, text, files: [] });
			return { conversationId: id, state: "IDLE", text: `ответ на «${text}»` };
		},
		handleInBackground: async (_u: unknown, id: string, text: string, attachments: { fileName: string; content: Buffer }[]) => {
			turns.push({ conversationId: id, text, files: attachments.map((a) => ({ fileName: a.fileName, bytes: a.content.length })) });
		},
	};
	return { workflow: workflow as never, turns, pause: () => { hold = () => {}; }, resume: () => { const h = hold; hold = null; if (typeof h === "function") h(); } };
}

/** Хранилище файлов в памяти: ровно те два метода, которыми пользуется канал. */
function fakeFiles() {
	const saved = new Map<string, { organizationUuid: string; userUuid: string; fileName: string; mimeType: string; content: Buffer }>();
	return {
		saved,
		store: {
			save: async (i: { organizationUuid: string; userUuid: string; fileName: string; mimeType: string; content: Buffer }) => {
				const fileId = randomUUID();
				saved.set(fileId, i);
				return { fileId, fileName: i.fileName, mimeType: i.mimeType, size: i.content.length, url: `/v1/files/${fileId}` };
			},
			getForOwner: async (id: string, org: string, owner: string) => {
				const f = saved.get(id);
				return f && f.organizationUuid === org && f.userUuid === owner ? { ...f, id, size: f.content.length } : null;
			},
		} as never,
	};
}

/** Ключи ходов в памяти: поведение хранилища, а не его SQL (SQL проверяется отдельно, ниже). */
function fakeTurnKeys() {
	const rows = new Map<string, { state: string; conversationId: string | null; status: number; response: unknown }>();
	const id = (p: { baseId: string; userId: string; key: string }) => `${p.baseId}:${p.userId}:${p.key}`;
	return {
		rows,
		store: {
			claim: async (p: { baseId: string; userId: string; key: string }) => {
				const x = rows.get(id(p));
				if (!x) { rows.set(id(p), { state: "running", conversationId: null, status: 0, response: null }); return { kind: "fresh" as const }; }
				return x.state === "done"
					? { kind: "done" as const, status: x.status, response: x.response }
					: { kind: "running" as const, conversationId: x.conversationId };
			},
			note: async (p: { baseId: string; userId: string; key: string }, conversationId: string) => { rows.get(id(p))!.conversationId = conversationId; },
			finish: async (p: { baseId: string; userId: string; key: string }, status: number, response: unknown) => {
				rows.set(id(p), { state: "done", conversationId: null, status, response });
			},
			release: async (p: { baseId: string; userId: string; key: string }) => { rows.delete(id(p)); },
		},
	};
}

type Owner = { rotateDue?: boolean; pending?: boolean; firstUse?: boolean };

function harness(opts: { files?: boolean; keys?: boolean; rotation?: boolean; owner?: Owner; minExt?: string; rotateMinExt?: string } = {}) {
	const wf = fakeWorkflow();
	const files = fakeFiles();
	const keys = fakeTurnKeys();
	const rotated: string[] = [];
	const used: string[] = [];
	const rotation = {
		markUsed: async (tokenId: string) => { used.push(tokenId); },
		rotate: async (tokenId: string) => { rotated.push(tokenId); return "bpb_new-token"; },
		redeliver: async () => "bpb_pending-token",
	};
	const tokens = {
		resolve: async (t: string) => t === TOKEN
			? { tokenId: TOKEN_ID, baseId: BASE_ID, baseKey: "Dev_01", baseName: "Бухгалтерия (Dev_01)", organizationUuid: ORG, revoked: false, baseDisabled: false, ...opts.owner }
			: null,
	};
	const erp = { query: async () => ({ rows: [{ name: "ТОО Алеппо", legal_name: null }], rowCount: 1 }) } as unknown as Db;
	const app = express();
	app.use(express.json({ limit: "10mb" }));
	app.use("/v1/onec-chat", onecChatRouter({
		workflow: wf.workflow, tokens, erp, log: silent, version: "0.4.0",
		files: opts.files === false ? null : files.store,
		turnKeys: opts.keys === false ? null : keys.store,
		rotation: opts.rotation === false ? null : rotation,
		rotationMinExtVersion: opts.rotateMinExt ?? "1.5.0",
		minExtVersion: opts.minExt ?? "",
		maxAttachmentBytes: 64 * 1024,
	}));
	const server = app.listen(0);
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/onec-chat`;
	const head = (user: string, extra: Record<string, string> = {}) => ({ "x-base-token": TOKEN, "x-1c-user-id": user, ...extra });
	return {
		wf, files, keys, rotated, used,
		get: async (path: string, extra: Record<string, string> = {}, user = USER) => {
			const r = await fetch(`${url}${path}`, { headers: head(user, extra) });
			return { status: r.status, headers: r.headers, body: await r.json() as { success: boolean; data?: Record<string, any>; error?: { code: string; message: string } } };
		},
		upload: async (bytes: Buffer, fileName: string, user = USER) => {
			const r = await fetch(`${url}/uploads?fileName=${encodeURIComponent(fileName)}`, {
				method: "POST", headers: head(user, { "content-type": "application/pdf" }),
				// Буфер — в те же байты, но типом, который понимает fetch.
				body: new Uint8Array(bytes),
			});
			return { status: r.status, body: await r.json() as { success: boolean; data?: any; error?: { code: string } } };
		},
		turn: async (body: Record<string, unknown>, extra: Record<string, string> = {}, user = USER) => {
			const r = await fetch(`${url}/turn`, {
				method: "POST", headers: head(user, { "content-type": "application/json", ...extra }),
				body: JSON.stringify({ user: { id: user, name: "Бухгалтер" }, ...body }),
			});
			return { status: r.status, headers: r.headers, body: await r.json() as { success: boolean; data?: any; error?: { code: string; message: string } } };
		},
		close: () => { server.closeAllConnections(); server.close(); },
	};
}

// ── §1. Вложение отдельным запросом ──────────────────────────────────────────

test("§1: загрузка возвращает fileId, длину и sha256, а ход с fileId получает те самые байты", async () => {
	const h = harness();
	try {
		const bytes = Buffer.alloc(4096, 7);
		const up = await h.upload(bytes, "Выписка за август.pdf");
		assert.equal(up.status, 200);
		assert.equal(up.body.data.bytes, 4096);
		assert.equal(up.body.data.sha256, createHash("sha256").update(bytes).digest("hex"));
		// Кириллическое имя едет в строке запроса закодированным — и доходит целым.
		assert.equal(h.files.saved.get(up.body.data.fileId)!.fileName, "Выписка за август.pdf");
		assert.equal(h.files.saved.get(up.body.data.fileId)!.userUuid, onecOwnerUuid(BASE_ID, USER));

		const t = await h.turn({ text: "разнеси выписку", attachments: [{ fileName: "Выписка за август.pdf", fileId: up.body.data.fileId }] });
		assert.equal(t.status, 200);
		assert.equal(t.body.data.state, "PROCESSING");
		assert.deepEqual(h.wf.turns[0]!.files, [{ fileName: "Выписка за август.pdf", bytes: 4096 }]);
	} finally { h.close(); }
});

test("§1: чужой файл по идентификатору не открывается, неизвестный — UNKNOWN_FILE", async () => {
	const h = harness();
	try {
		const up = await h.upload(Buffer.alloc(16, 1), "Чужая.pdf");
		const mine = await h.turn({ text: "разнеси", attachments: [{ fileName: "Чужая.pdf", fileId: up.body.data.fileId }] }, {}, OTHER);
		assert.equal(mine.status, 400);
		assert.equal(mine.body.error!.code, "UNKNOWN_FILE");

		const unknown = await h.turn({ text: "разнеси", attachments: [{ fileName: "Нет.pdf", fileId: randomUUID() }] });
		assert.equal(unknown.body.error!.code, "UNKNOWN_FILE");
	} finally { h.close(); }
});

test("§1: base64 остаётся, но вместе с fileId в одном вложении — отказ; файл сверх предела — FILE_TOO_LARGE", async () => {
	const h = harness();
	try {
		const old = await h.turn({ text: "разнеси", attachments: [{ fileName: "Старая.pdf", content: Buffer.alloc(32, 3).toString("base64") }] });
		assert.equal(old.status, 200, "прежний путь не должен устареть: расширения обновляются не в один день");
		assert.equal(h.wf.turns[0]!.files[0]!.bytes, 32);

		const both = await h.turn({ text: "разнеси", attachments: [{ fileName: "Обе.pdf", content: "AQI=", fileId: randomUUID() }] });
		assert.equal(both.status, 400);
		assert.equal(both.body.error!.code, "VALIDATION_ERROR");

		const big = await h.upload(Buffer.alloc(64 * 1024 + 1, 9), "Толстая.pdf");
		assert.equal(big.status, 413);
		assert.equal(big.body.error!.code, "FILE_TOO_LARGE");
	} finally { h.close(); }
});

test("§1: установка без хранилища отвечает 404 — по нему расширение возвращается к base64", async () => {
	const h = harness({ files: false });
	try {
		const up = await h.upload(Buffer.alloc(8, 1), "Выписка.pdf");
		assert.equal(up.status, 404);
		assert.equal(up.body.error!.code, "UNKNOWN_ROUTE");
		const ping = await h.get("/ping");
		assert.ok(!ping.body.data!.features.includes("uploads"), "чего нет — того и не обещаем");
	} finally { h.close(); }
});

// ── §2. Idempotency-Key ──────────────────────────────────────────────────────

test("§2: повтор с тем же ключом отдаёт прежний ответ и не создаёт второго хода", async () => {
	const h = harness();
	try {
		const key = randomUUID();
		const first = await h.turn({ text: "сколько я должен" }, { "idempotency-key": key });
		assert.equal(first.status, 200);
		assert.equal(first.body.data.text, "ответ на «сколько я должен»");

		const again = await h.turn({ text: "сколько я должен" }, { "idempotency-key": key });
		assert.equal(again.status, 200);
		assert.deepEqual(again.body, first.body, "повтор обязан получить ТОТ ЖЕ ответ, а не «уже сделано»");
		assert.equal(h.wf.turns.length, 1, "второго хода быть не должно");
	} finally { h.close(); }
});

test("§2: ключ пришёл, пока прежний ход идёт — 202 и тот же диалог, а не второй ход", async () => {
	const h = harness();
	try {
		const key = randomUUID();
		h.wf.pause();
		const slow = h.turn({ text: "долгий" }, { "idempotency-key": key });
		await new Promise((r) => setTimeout(r, 30));
		const again = await h.turn({ text: "долгий" }, { "idempotency-key": key });
		assert.equal(again.status, 202);
		assert.equal(again.body.data.state, "PROCESSING");
		// Тот же диалог, а не пустота: форма откроет его и дождётся итога там.
		assert.equal(again.body.data.conversationId, "c0000000-0000-4000-8000-000000000001");
		h.wf.resume();
		await slow;
		assert.equal(h.wf.turns.length, 1);
	} finally { h.close(); }
});

test("§2: без ключа канал работает как прежде — два хода остаются двумя", async () => {
	const h = harness();
	try {
		await h.turn({ text: "раз" });
		await h.turn({ text: "раз" });
		assert.equal(h.wf.turns.length, 2);
	} finally { h.close(); }
});

// ── §3. Тихая смена токена базы ──────────────────────────────────────────────

test("§3: срок вышел — новый токен едет в ответе хода, но только расширению, которое умеет его сохранить", async () => {
	const fresh = harness({ owner: { rotateDue: true } });
	try {
		const t = await fresh.turn({ text: "привет" }, { "x-ext-version": "1.5.0" });
		assert.equal(t.body.data.baseToken, "bpb_new-token");
		assert.deepEqual(fresh.rotated, [TOKEN_ID]);
	} finally { fresh.close(); }

	const old = harness({ owner: { rotateDue: true } });
	try {
		const t = await old.turn({ text: "привет" }, { "x-ext-version": "1.4.9" });
		assert.equal(t.body.data.baseToken, undefined, "старое расширение новый токен не сохранит — и осталось бы без связи");
		assert.deepEqual(old.rotated, []);
	} finally { old.close(); }
});

test("§3: ответ с токеном не дошёл — на следующем ходе едет ТОТ ЖЕ токен, а не ещё один", async () => {
	const h = harness({ owner: { pending: true } });
	try {
		const t = await h.turn({ text: "привет" }, { "x-ext-version": "1.5.0" });
		assert.equal(t.body.data.baseToken, "bpb_pending-token");
		assert.deepEqual(h.rotated, [], "второй токен на каждый недошедший ответ — это россыпь годных ключей");
	} finally { h.close(); }
});

test("§3: первый запрос новым токеном закрывает перекрытие", async () => {
	const h = harness({ owner: { firstUse: true } });
	try {
		await h.get("/ping");
		await new Promise((r) => setTimeout(r, 10));
		assert.deepEqual(h.used, [TOKEN_ID]);
	} finally { h.close(); }
});

// ── §4. Версия расширения, номер запроса, features ───────────────────────────

test("§4: номер запроса возвращается в ответе, features называют включённое", async () => {
	const h = harness();
	try {
		const id = randomUUID();
		const ping = await h.get("/ping", { "x-request-id": id, "x-ext-version": "1.5.0" });
		assert.equal(ping.headers.get("x-request-id"), id, "один номер в двух журналах — иначе разбор по крупицам");
		assert.deepEqual(ping.body.data!.features, ["uploads", "idempotency", "token-rotation"]);
	} finally { h.close(); }
});

test("§4: старое расширение получает EXT_TOO_OLD, а не отказ на незнакомое поле", async () => {
	const h = harness({ minExt: "1.5.0" });
	try {
		const old = await h.get("/ping", { "x-ext-version": "1.4.0" });
		assert.equal(old.status, 426);
		assert.equal(old.body.error!.code, "EXT_TOO_OLD");
		assert.match(old.body.error!.message, /1\.5\.0/);

		const ok = await h.get("/ping", { "x-ext-version": "1.10.0" });
		assert.equal(ok.status, 200, "1.10 новее 1.5: версии сравниваются числами, а не по алфавиту");

		const silentOld = await h.get("/ping");
		assert.equal(silentOld.status, 200, "версии нет вовсе — это сборка до §4, её не отсекаем");
	} finally { h.close(); }
});

test("§4: сравнение версий", () => {
	assert.equal(versionAtLeast("1.5.0", "1.5.0"), true);
	assert.equal(versionAtLeast("1.10.0", "1.9.9"), true);
	assert.equal(versionAtLeast("1.4.9", "1.5.0"), false);
	assert.equal(versionAtLeast("2.0", "1.9.9"), true);
	assert.equal(versionAtLeast("", ""), true, "предел не задан — не проверяем");
});
