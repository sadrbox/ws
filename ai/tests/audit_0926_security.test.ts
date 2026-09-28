/**
 * ПРАВА, ДОСТУП И НАДЁЖНОСТЬ МАРШРУТОВ — ИСПРАВЛЕНИЯ АУДИТА 26.09 (Б11, Б14, Н1, раздел 5 «Сервис ИИ»).
 *
 * Роутеры — на живом express, зависимости — подставные. Каждый тест — сценарий из аудита, который до правки
 * проходил: чужой БИН, перезаписанная заявка, бывший администратор, квота кластера, расписание в обход
 * разрешений, команды чужой организации, «числится за другим сервером», токен в сохранённом ответе.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express, { Router } from "express";
import jwt from "jsonwebtoken";
import type { AddressInfo } from "node:net";
import { safeRouter } from "../src/http/safeRouter.ts";
import { loadErpUser } from "../src/auth/index.ts";
import { loadConfig } from "../src/config.ts";
import { agentEnrollRouter } from "../src/http/agentEnrollRouter.ts";
import { onecChatRouter, withoutBaseToken } from "../src/http/onecChatRouter.ts";
import { onecRouter } from "../src/http/onecRouter.ts";
import { onecActorName } from "../src/erp/tasks.ts";
import type { Db } from "../src/db/pool.ts";
import type { Logger } from "../src/logger.ts";

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

async function listen(app: express.Express) {
	const srv = await new Promise<import("node:http").Server>((ok) => { const s = app.listen(0, () => ok(s)); });
	return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, close: () => { srv.closeAllConnections(); srv.close(); } };
}

// ── Н1: отказ промиса — ответ, а не повисший запрос ─────────────────────────

test("Н1: отказ в async `r.use` и в маршруте — 500 сразу; негодный идентификатор (22P02) — 400", async () => {
	const r = safeRouter(Router(), silent, "тест");
	r.use(async (req, _res, next) => {
		if (req.path === "/mw") throw new Error("БД недоступна");
		next();
	});
	r.get("/mw", (_req, res) => { res.json({ ok: true }); });
	r.get("/route", async () => { throw new Error("сбой"); });
	r.get("/uuid", async () => { throw Object.assign(new Error("invalid input syntax for type uuid"), { code: "22P02" }); });
	const app = express();
	app.use(r);
	const s = await listen(app);
	try {
		const ask = async (p: string) => {
			const res = await fetch(`${s.url}${p}`, { signal: AbortSignal.timeout(3000) });
			return { status: res.status, body: await res.json() as { error?: { code: string } } };
		};
		assert.equal((await ask("/mw")).status, 500, "промежуточный обработчик раньше оставлял запрос висеть");
		assert.equal((await ask("/route")).status, 500);
		const bad = await ask("/uuid");
		assert.deepEqual([bad.status, bad.body.error?.code], [400, "VALIDATION_ERROR"]);
	} finally { s.close(); }
});

// ── Б11: права на 1С — только по организациям членства ─────────────────────

test("Б11: «Администрирование 1С» считается только по организациям, где пользователь состоит", async () => {
	const seen: unknown[][] = [];
	const erp = {
		query: async (sql: string, p: unknown[] = []) => {
			if (sql.includes("FROM users")) return { rows: [{ uuid: "u", is_super_admin: false, organization_uuid: "org-a" }] };
			if (sql.includes("FROM access_rights")) return { rows: [{ organization_uuid: "org-a", role: "member" }] };
			// Право есть только в org-b, откуда человека убрали (строка прав осталась — ERP её не удаляет).
			const perms = [{ org: "org-b", model: "OneCAdmin", level: "full" }, { org: "org-b", model: "OneCAdmin.BaseUsers.delete", level: "full" }];
			const allowed = (p[1] as string[] | undefined) ?? null;
			const mine = perms.filter((x) => allowed && allowed.includes(x.org));
			seen.push(p);
			if (sql.includes("count(*) FILTER")) {
				const main = mine.filter((x) => x.model === "OneCAdmin");
				return { rows: [{ full: String(main.filter((x) => x.level === "full").length), any: String(main.length) }] };
			}
			if (sql.includes("LIKE 'OneCAdmin.%'")) return { rows: mine.filter((x) => x.model.startsWith("OneCAdmin.")).map((x) => ({ model_name: x.model, access_level: x.level })) };
			return { rows: [] };
		},
	} as unknown as Db;
	const u = await loadErpUser(erp, "u");
	assert.equal(u!.canOnecAdmin, false, "бывший администратор организации больше не видит 1С");
	assert.equal(u!.canOnecWrite, false);
	assert.deepEqual(u!.onec.baseUsers, []);
	assert.ok(seen.every((p) => Array.isArray(p[1]) && (p[1] as string[]).join() === "org-a"), "фильтр получает организации членства");
});

// ── Б11: заявка агента и доверие к X-Forwarded-For ─────────────────────────

test("Б11: TRUST_PROXY по умолчанию — лимит заявок по настоящему адресу, подмена X-Forwarded-For не помогает", async () => {
	const cfg = loadConfig({ DATABASE_URL: "postgres://x@h/db", ERP_DATABASE_URL: "postgres://x@h/erp", JWT_SECRET: "x".repeat(20), AGENT_ADMIN_KEY: "y".repeat(20) });
	assert.equal(cfg.TRUST_PROXY, "loopback,uniquelocal");
	const submitted: (string | null)[] = [];
	const store = {
		submit: async (_i: unknown, _ip: string | null, secret?: string | null) => {
			submitted.push(secret ?? null);
			return { row: { id: "00000000-0000-4000-8000-000000000001", code: "AAA-111", name: "n", role: "business", computer: "PC", serviceName: "S", expiresAt: new Date() }, secret: "s", repeated: false };
		},
	};
	const app = express();
	app.set("trust proxy", cfg.TRUST_PROXY);
	app.use(express.json());
	app.use("/agent/v1", agentEnrollRouter({ enrollments: store as never, agents: { rotateToken: async () => null }, audit: { write: async () => {} }, log: silent, perHour: 2 }));
	const s = await listen(app);
	const body = JSON.stringify({ name: "Бух", role: "business", serviceName: "BPAPIAgent", computer: "PC" });
	const enroll = async (xff: string, extra: Record<string, string> = {}) => (await fetch(`${s.url}/agent/v1/enroll`, {
		method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": xff, ...extra }, body,
	})).status;
	try {
		// Cloudflare дописывает настоящий адрес ПРАВОЙ записью; левую пишет сам клиент — каждый раз новую.
		assert.equal(await enroll("1.1.1.1, 203.0.113.7"), 200);
		assert.equal(await enroll("2.2.2.2, 203.0.113.7", { "x-enrollment-secret": "old-secret" }), 200);
		assert.equal(await enroll("3.3.3.3, 203.0.113.7"), 429, "подменённая левая запись больше не даёт нового адреса");
		assert.equal(await enroll("4.4.4.4, 198.51.100.1"), 200, "другой настоящий адрес — свой лимит");
		// Секрет прежней заявки доходит до хранилища: только с ним заявка обновляется, без него — новая.
		assert.deepEqual(submitted, [null, "old-secret", null]);
	} finally { s.close(); }
});

// ── Б11: канал 1С — организации базы, автор, токен в ответе идемпотентности ─

const TOKEN = "bpb_test";
const BASE_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const ORG = "a1410911-7421-45da-9632-7e4fc48e91c2";
const USER1C = "0f6c1c1e-6a57-4c6e-9b2a-1d4f2c9e7a01";
const OWN_BIN = "831111302342";
const FOREIGN_BIN = "999999999999";

async function channel(opts: { rotateDue?: boolean; turnKeys?: unknown; workflow?: unknown; files?: unknown; chatPerMin?: number; maxTurnAttachmentBytes?: number } = {}) {
	const approved = new Set<string>();
	const created: { actor: unknown; key: unknown }[] = [];
	const baseOrgs = {
		remember: async (_b: string, orgs: { bin?: string | null }[]) => ({ remembered: orgs.length, pending: orgs.map((o) => String(o.bin)).filter((b) => !approved.has(b)) }),
		approve: async (_b: string, bin: string) => { approved.add(bin); return true; },
		has: async (_b: string, bin: string) => approved.has(bin),
	};
	const tasks = {
		enabled: true,
		createTask: async (actor: unknown, _t: unknown, o: { idempotencyKey?: unknown } = {}) => { created.push({ actor, key: o.idempotencyKey }); return { uuid: "t1" }; },
		listTasks: async () => [],
	};
	const tokens = { resolve: async (t: string) => (t === TOKEN
		? { tokenId: "tk1", baseId: BASE_ID, baseKey: "Dev_01", baseName: "Бух", organizationUuid: ORG, revoked: false, baseDisabled: false, rotateDue: !!opts.rotateDue }
		: null) };
	const erp = { query: async (sql: string) => (sql.includes("SELECT bin FROM organizations") ? { rows: [{ bin: OWN_BIN }] } : { rows: [{ name: "ТОО" }] }) } as unknown as Db;
	const app = express();
	app.use(express.json());
	app.use("/v1/onec-chat", onecChatRouter({
		workflow: (opts.workflow ?? null) as never, tokens, erp, log: silent, version: "t", tasks: tasks as never, baseOrgs: baseOrgs as never,
		turnKeys: (opts.turnKeys ?? null) as never, files: (opts.files ?? null) as never, chatPerMin: opts.chatPerMin,
		maxTurnAttachmentBytes: opts.maxTurnAttachmentBytes,
		rotation: { markUsed: async () => {}, rotate: async () => "bpb_NEW_SECRET_TOKEN", redeliver: async () => null } as never,
	}));
	const s = await listen(app);
	const send = async (method: string, path: string, body: unknown, extra: Record<string, string> = {}, user = USER1C) => {
		const r = await fetch(`${s.url}/v1/onec-chat${path}`, {
			method, headers: { "content-type": "application/json", "x-base-token": TOKEN, "x-1c-user-id": user, ...extra }, body: JSON.stringify(body),
		});
		return { status: r.status, body: await r.json() as { data?: Record<string, any>; error?: { code: string } } };
	};
	return { send, approved, created, close: s.close };
}

test("Б11: база не добавляет себе чужой БИН — он ждёт одобрения; БИН организации токена одобряется сам", async () => {
	const h = await channel();
	try {
		const r = await h.send("POST", "/organizations", { organizations: [{ bin: OWN_BIN, name: "Своя" }, { bin: FOREIGN_BIN, name: "Чужая" }] });
		assert.equal(r.status, 200);
		assert.deepEqual(r.body.data!.pending, [FOREIGN_BIN]);
		assert.deepEqual([...h.approved], [OWN_BIN]);
		// Задачи по чужому БИН не открываются.
		const foreign = await h.send("POST", "/tasks", { bin: FOREIGN_BIN, user: { name: "Бухгалтер" }, name: "x" });
		assert.equal(foreign.status, 403);
		assert.equal(foreign.body.error!.code, "ORG_NOT_IN_BASE");
	} finally { h.close(); }
});

test("Б11: автор задачи из 1С — с пометкой базы из токена; ключ запроса уходит в ERP", async () => {
	const h = await channel();
	try {
		await h.send("POST", "/organizations", { organizations: [{ bin: OWN_BIN }] });
		const r = await h.send("POST", "/tasks", { bin: OWN_BIN, user: { name: "ivanov" }, name: "Сверка" }, { "idempotency-key": "k-1" });
		assert.equal(r.status, 201);
		// «ivanov» больше не совпадает с логином сотрудника фирмы в ERP.
		assert.deepEqual(h.created[0]!.actor, { bin: OWN_BIN, user: { name: "ivanov (1С: Dev_01)" } });
		assert.equal(h.created[0]!.key, `1c:${BASE_ID}:k-1`);
		assert.equal(onecActorName("  ", "Б"), "Пользователь 1С (1С: Б)");
	} finally { h.close(); }
});

test("Б11: новый токен базы уходит клиенту, но не оседает в сохранённом ответе хода", async () => {
	const stored: unknown[] = [];
	const turnKeys = { claim: async () => ({ kind: "fresh" }), note: async () => {}, finish: async (_p: unknown, _s: number, body: unknown) => { stored.push(body); }, release: async () => {} };
	const workflow = { prepare: async () => "c0000000-0000-4000-8000-000000000001", handle: async (_u: unknown, id: string) => ({ conversationId: id, state: "IDLE", text: "ок" }) };
	const h = await channel({ rotateDue: true, turnKeys, workflow });
	try {
		const r = await h.send("POST", "/turn", { user: { id: USER1C, name: "Б" }, text: "привет" }, { "idempotency-key": "k-2", "x-ext-version": "9.9.9" });
		assert.equal(r.body.data!.baseToken, "bpb_NEW_SECRET_TOKEN");
		await new Promise((res) => setTimeout(res, 20));
		assert.equal(stored.length, 1);
		assert.ok(!JSON.stringify(stored[0]).includes("bpb_NEW_SECRET_TOKEN"), "токен не записан в onec_chat_turn_keys");
		assert.deepEqual(withoutBaseToken({ success: true, data: { a: 1, baseToken: "t" } }), { success: true, data: { a: 1 } });
	} finally { h.close(); }
});

test("вложения канала 1С: предел байт на ход; лимит ходов считается и на базу целиком", async () => {
	const big = Buffer.alloc(600_000, 1);
	const files = { getForOwner: async () => ({ fileName: "a.pdf", mimeType: "application/pdf", content: big }), save: async () => ({}) };
	const workflow = { prepare: async () => "c0000000-0000-4000-8000-000000000001", handle: async (_u: unknown, id: string) => ({ conversationId: id, state: "IDLE", text: "ок" }), handleInBackground: async () => {} };
	const h = await channel({ files, workflow, maxTurnAttachmentBytes: 1_000_000, chatPerMin: 1 });
	try {
		const two = [{ fileName: "a.pdf", fileId: "00000000-0000-4000-8000-00000000000a" }, { fileName: "b.pdf", fileId: "00000000-0000-4000-8000-00000000000b" }];
		const r = await h.send("POST", "/turn", { user: { id: USER1C, name: "Б" }, attachments: two });
		assert.equal(r.status, 413);
		// X-1C-User-Id называет клиент: новый UUID на каждый ход не обходит лимит базы (1 × 5 в минуту).
		const statuses: number[] = [];
		for (let i = 0; i < 7; i++) {
			const u = `0f6c1c1e-6a57-4c6e-9b2a-1d4f2c9e7b${String(i).padStart(2, "0")}`;
			statuses.push((await h.send("POST", "/turn", { user: { id: u, name: "Б" }, text: `ход ${i}` }, {}, u)).status);
		}
		assert.ok(statuses.includes(429), `лимит на базу не сработал: ${statuses.join(",")}`);
	} finally { h.close(); }
});

// ── Б11, Б14: панель 1С ─────────────────────────────────────────────────────

const JWT_SECRET = "test-secret";
// Серверы — настоящие UUID: выбор кластера (`?serverId=`, `X-Onec-Server`) принимает только их.
const SRV1 = "aaaaaaaa-0000-4000-8000-000000000001";
const SRV2 = "aaaaaaaa-0000-4000-8000-000000000002";
const ADMIN_U = "11111111-1111-1111-1111-111111111111";
const NOBODY_U = "22222222-2222-2222-2222-222222222222";
const WRITER_U = "33333333-3333-3333-3333-333333333333";

/** Пользователи ERP: без права; с полным правом, но без вложенных разрешений; суперадмин. */
const erpUsers = {
	query: async (sql: string, p: unknown[] = []) => {
		const uuid = String(p[0]);
		if (sql.includes("FROM users")) return { rows: [{ uuid, is_super_admin: uuid === ADMIN_U, organization_uuid: "org-1" }] };
		if (sql.includes("FROM access_rights")) return { rows: [{ organization_uuid: "org-1", role: "member" }] };
		if (sql.includes("count(*) FILTER")) return { rows: [{ full: uuid === WRITER_U ? "1" : "0", any: uuid === WRITER_U ? "1" : "0" }] };
		return { rows: [] };
	},
};

async function panel(opts: { scope?: "all" | "organizations"; clusterPerMin?: number } = {}) {
	const enqueued: string[] = [];
	const admin = { id: "adm", organizationUuid: "org-1", role: "admin", disabled: false, online: true, serverId: SRV1, capabilities: ["cluster.admin", "ib.admin"], version: "2026-09-17" };
	const biz = { id: "biz", organizationUuid: "org-2", role: "business", disabled: false, online: true, serverId: null, capabilities: [] };
	const commands: Record<string, Record<string, unknown>> = {
		"cmd-biz": { id: "cmd-biz", agent_id: "biz", organization_uuid: "org-2", state: "done", result: { debts: 1_000_000 }, type: "GET_DEBTS", created_at: new Date() },
		"cmd-adm": { id: "cmd-adm", agent_id: "adm", organization_uuid: "org-1", state: "done", result: { items: [] }, type: "CLUSTER_LIST_SESSIONS", created_at: new Date() },
	};
	const app = express();
	app.use(express.json());
	app.use("/v1/onec", onecRouter({
		erp: erpUsers, cfg: { JWT_SECRET, ONEC_COMMAND_TIMEOUT_SECS: 1, RATE_LIMIT_ONEC_CLUSTER_PER_MIN: opts.clusterPerMin ?? 1000, ONEC_SERVER_SCOPE: opts.scope ?? "all", AGENT_OFFLINE_AFTER_SECS: 90 },
		log: silent,
		agents: {
			pickAdminAgent: async (_k: unknown, o: { allowedServers?: Set<string> | null } = {}) => (!o.allowedServers || o.allowedServers.has(SRV1) ? admin : null),
			listAll: async () => [admin, biz], findById: async (id: string) => (id === "biz" ? biz : admin),
		},
		bases: {
			listAll: async () => [
				{ key: "своя", serverId: SRV1, disabled: false, clusterStatus: "ONLINE", status: "ONLINE", extensionNames: [] },
				{ key: "соседняя", serverId: SRV2, disabled: false, clusterStatus: "ONLINE", status: "ONLINE", extensionNames: [] },
			],
			sync: async () => {}, applyPublications: async () => ({}), staleDbCheck: async () => [],
			listServers: async () => [{ id: SRV1, name: "S1", organizationUuid: "org-1" }, { id: SRV2, name: "S2", organizationUuid: "org-2" }],
			// «чужая» есть только на сервере другой организации.
			serversWithKey: async (key: string) => (key === "чужая" ? [{ id: SRV2, name: "S2", organizationUuid: "org-2" }] : [{ id: SRV1, name: "S1", organizationUuid: "org-1" }]),
			findByKeyGlobal: async (key: string) => ({ key, serverId: key === "чужая" ? SRV2 : SRV1, disabled: false, clusterStatus: "ONLINE", status: "ONLINE", extensionNames: [] }),
		},
		queue: {
			enqueue: async (i: { type: string }) => { enqueued.push(i.type); return { id: `cmd-${enqueued.length}` }; },
			waitResult: async (id: string) => ({ id, state: "done", result: { items: [{ key: "своя", status: "ONLINE" }] } }),
			get: async (id: string) => commands[id] ?? null,
			sweep: async () => ({ overdue: 0, orphaned: 0 }),
		},
		audit: { write: async () => {} },
		batches: { ownerOf: async () => null },
		registry: {}, registrations: {}, baseTokens: {}, credentials: { usersByBaseKeys: async () => new Map() },
		schedules: { create: async () => { throw new Error("расписание не должно было сохраниться"); } },
		agentBases: {}, enrollments: {}, activation: {},
	} as never));
	const s = await listen(app);
	const call = async (who: string, method: string, path: string, body?: unknown) => {
		const r = await fetch(`${s.url}/v1/onec${path}`, {
			method, headers: { authorization: `Bearer ${jwt.sign({ uuid: who }, JWT_SECRET)}`, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		return { status: r.status, body: await r.json() as { data?: any; error?: { code: string; message: string } } };
	};
	return { call, enqueued, close: s.close };
}

test("Б11: пользователь без права не выбирает общую квоту кластера — администраторы не получают 429", async () => {
	const h = await panel({ clusterPerMin: 2 });
	try {
		for (let i = 0; i < 5; i++) assert.equal((await h.call(NOBODY_U, "GET", "/sessions")).status, 403);
		assert.equal((await h.call(ADMIN_U, "GET", "/sessions")).status, 200, "квота осталась за теми, у кого есть право");
	} finally { h.close(); }
});

test("Б11: расписание не обходит вложенные разрешения — IB_DELETE_USER по двум базам без «Пользователи баз: удаление»", async () => {
	const h = await panel();
	try {
		const r = await h.call(WRITER_U, "POST", "/schedules", { name: "Чистка", type: "IB_DELETE_USER", baseKeys: ["a", "b"], atTime: "02:00", payload: { name: "ivanov" } });
		assert.equal(r.status, 403);
		assert.equal(r.body.error!.code, "FORBIDDEN_ONEC_PERMISSION");
		// Через пакет — тот же отказ, как и было.
		assert.equal((await h.call(WRITER_U, "POST", "/batch", { type: "IB_DELETE_USER", baseKeys: ["a", "b"], payload: { name: "ivanov" } })).status, 403);
	} finally { h.close(); }
});

test("Б11: в режиме all результат команды бизнес-агента чужой организации не читается; кластерные — видны", async () => {
	const h = await panel();
	try {
		const foreign = await h.call(WRITER_U, "GET", "/commands/cmd-biz");
		assert.equal(foreign.status, 404);
		assert.ok(!JSON.stringify(foreign.body).includes("1000000"));
		assert.equal((await h.call(WRITER_U, "GET", "/commands/cmd-adm")).status, 200);
		assert.equal((await h.call(ADMIN_U, "GET", "/commands/cmd-biz")).status, 200, "суперадмину видно всё");
	} finally { h.close(); }
});

test("передача от фронта: «Обновить» выбранного кластера отдаёт базы только его, а не всех серверов", async () => {
	const h = await panel();
	try {
		const r = await h.call(ADMIN_U, "POST", `/bases/refresh?serverId=${SRV1}`, {});
		assert.equal(r.status, 200);
		assert.deepEqual((r.body.data.items as { key: string }[]).map((b) => b.key), ["своя"]);
		// Без выбранного сервера — как раньше, все видимые.
		const all = await h.call(ADMIN_U, "POST", "/bases/refresh", {});
		assert.deepEqual((all.body.data.items as { key: string }[]).map((b) => b.key).sort(), ["своя", "соседняя"]);
	} finally { h.close(); }
});
