// МАРШРУТЫ ПАНЕЛИ 1С — на живом express, с подставными зависимостями (18.09).
//
// ЗАЧЕМ. Маршрутов сервиса до сих пор не проверял никто: `onecRouter` держался на компиляторе, а он не видит ни
// порядка действий («сначала применить срез баз, потом публикации»), ни условий отказа. Две недавние правки —
// «Обновить» с публикациями и выборочной проверкой баз и удаление записи о базе — как раз про порядок и условия.
//
// Подставляем ровно то, что трогают эти два маршрута: пользователя ERP с полным правом, выбор агента, очередь
// команд (сразу отвечает готовым результатом) и реестр баз, записывающий, что и в каком порядке с ним делали.

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import type { AddressInfo } from "node:net";
import { onecRouter } from "../src/http/onecRouter.ts";

const JWT_SECRET = "test-secret";
const USER = "11111111-1111-1111-1111-111111111111";

/** ERP-пользователь с полным правом «Администрирование 1С»: четыре запроса loadErpUser. */
const erpDb = (superAdmin = true) => ({
	query: async (sql: string) => {
		if (sql.includes("FROM users")) return { rows: [{ uuid: USER, is_super_admin: superAdmin, organization_uuid: "org-1" }], rowCount: 1 };
		if (sql.includes("FROM access_rights")) return { rows: [{ organization_uuid: "org-1", role: "admin" }], rowCount: 1 };
		if (sql.includes("count(*) FILTER")) return { rows: [{ full: "1", any: "1" }], rowCount: 1 };
		if (sql.includes("FROM organizations")) return { rows: [{ uuid: "org-1", name: "ТОО Альфа", legal_name: null, bin: "123456789012" }], rowCount: 1 };
		return { rows: [], rowCount: 0 };
	},
});

type BaseRow = { key: string; clusterStatus: string; disabled?: boolean };

/** Стенд: роутер на express + журнал того, что делали с реестром и очередью. */
async function harness(opts: {
	bases?: BaseRow[];
	results?: Record<string, unknown>;
	removed?: boolean;
	staleKeys?: string[];
	superAdmin?: boolean;
	/** Способности бизнес-агента базы: `null` — агента нет вовсе (самопроверка базы). */
	businessAgent?: string[] | null;
	chatCalls?: Record<string, unknown>[];
	/** Срез баз, который сообщает каждый бизнес-агент установки. */
	slices?: { key: string; status: string | null; transport: "http" | "com" | null; extVersion: string | null; seenAt: string | null }[];
	/** Заявки и токены для сводки «Базы с расширением». */
	registrations?: Record<string, unknown>[];
	tokens?: Record<string, unknown>[];
	/** Что база сказала о себе сама по каналу чата (С2): версия расширения и последний обмен. */
	chat?: { baseKey: string; extVersion: string | null; seenAt: string | null }[];
	/** Отключён ли бизнес-агент установки: его срез не должен попадать ни в одну витрину. */
	businessDisabled?: boolean;
	/** Серверы, где есть каждая база реестра (C9–C11); нет — один сервер srv-1. */
	servers?: { id: string; name: string; organizationUuid: string }[];
	/** Заявки агентов для списка «Подключение агентов». */
	enrollments?: Record<string, unknown>[];
} = {}) {
	const journal: string[] = [];
	const enqueued: { type: string; payload: Record<string, unknown>; organizationUuid?: string }[] = [];
	const known = opts.bases ?? [{ key: "_transition", clusterStatus: "ONLINE" }];
	const results = opts.results ?? {};
	const servers = opts.servers ?? [{ id: "srv-1", name: "SERVER", organizationUuid: "org-1" }];

	const bases = {
		findByKeyGlobal: async (key: string) => {
			const b = known.find((x) => x.key === key);
			return b ? { id: `id-${key}`, key, serverName: "SERVER", disabled: !!b.disabled, clusterStatus: b.clusterStatus, status: b.clusterStatus } : null;
		},
		// Как в жизни: реестр ведёт админ-агент и версию расширения чаще всего не знает — её даёт срез.
		listAll: async () => known.map((b) => ({ key: b.key, clusterStatus: b.clusterStatus, extVersion: null })),
		sync: async () => { journal.push("sync"); },
		applyPublications: async () => { journal.push("applyPublications"); return { marked: 1, cleared: 0, matched: 1 }; },
		staleDbCheck: async () => opts.staleKeys ?? [],
		serversWithKey: async (key: string) => (known.some((b) => b.key === key) ? servers : []),
		listServers: async () => servers,
		removeMissing: async () => { journal.push("removeMissing"); return opts.removed ?? true; },
		setDisplayName: async (id: string, name: string | null) => { journal.push(`setDisplayName:${id}:${name ?? "-"}`); return true; },
		// Организация базы (В4): за ней числятся команды в базу — из заявки базы или её токена чата.
		organizationOf: async () => "org-base",
	};
	const queue = {
		enqueue: async (i: { type: string; payload: Record<string, unknown>; organizationUuid?: string }) => {
			enqueued.push({ type: i.type, payload: i.payload, organizationUuid: i.organizationUuid });
			journal.push(`enqueue:${i.type}`);
			return { id: `cmd-${enqueued.length}`, type: i.type };
		},
		waitResult: async (id: string) => {
			const type = enqueued[Number(id.split("-")[1]) - 1].type;
			return { id, state: "done", result: results[type] ?? { ok: true }, type };
		},
		expireOrphaned: async () => 0,
	};
	const admin = {
		id: "adm", organizationUuid: "org-1", role: "admin", disabled: false, online: true, serverId: "srv-1",
		capabilities: ["cluster.admin", "ib.admin", "agent.procs"], version: "2026-09-17",
	};
	const business = {
		id: "biz", role: "business", disabled: !!opts.businessDisabled, online: true, serverId: null,
		name: "Бухгалтерия", capabilities: [], version: "2026-09-22",
	};
	const agents = {
		pickAdminAgent: async () => admin,
		listAll: async () => [admin, business],
		// Организации у агента нет (Р1): журнал пишет роль и имя.
		create: async (name: string, role: string) => { journal.push(`create:${role}:${name}`); return { agent: { id: "new", name, role }, token: "bpa_x" }; },
		rename: async (id: string, name: string) => { journal.push(`rename:${id}:${name}`); return true; },
		setDisabled: async (id: string, disabled: boolean) => { journal.push(`setDisabled:${id}:${disabled}`); return true; },
		findById: async (id: string) => (id === "bizOld"
			? { id: "bizOld", name: "Бухгалтерия", role: "business", online: false, disabled: true, capabilities: [], limits: { maxBases: null } }
			: id === "biz"
			? { id: "biz", name: "Бухгалтерия", role: "business", online: true, disabled: false,
				capabilities: ["agent.procs", "agent.cancel", "agent.config", "agent.restart", "agent.update"],
				limits: { maxBases: 2 } }
			: admin),
		/** Исполнитель SELF_CHECK для базы реестра (по её одобренным БИН, В2): `null` — никто. */
		resolveForBase: async (baseId: string, baseKey: string) => {
			journal.push(`resolveForBase:${baseId}:${baseKey}`);
			return opts.businessAgent === null ? { kind: "none" } : {
				kind: "agent", agent: { id: "biz", role: "business", online: true, disabled: false, capabilities: opts.businessAgent ?? ["HEALTH", "SELF_CHECK"] },
			};
		},
		setLimits: async (id: string, l: unknown) => { journal.push(`setLimits:${id}:${JSON.stringify(l)}`); return true; },
	};
	const agentBase = (key: string, pos: number, transport: string) => ({
		key, pos, status: "ONLINE", transport, extVersion: "1.4.0", overLimit: null, seenAt: null,
		organizations: [{ id: `o-${key}`, name: key, bin: `00000000000${pos}` }],
	});
	const agentBases = {
		list: async () => [agentBase("Б1", 0, "com"), agentBase("Б2", 1, "com"), agentBase("Б3", 2, "http")],
		// Срез бизнес-агента: по нему список баз и сводка расширения берут версию (Б1/Б2 аудита 23.09).
		listMany: async (ids: readonly string[]) => new Map(ids.map((id) => [id, opts.slices ?? []])),
	};
	const audit = {
		write: async () => { journal.push("audit"); },
		listChatCalls: async (o: { baseId?: string | null }) => { journal.push(`chatCalls:${o.baseId ?? "-"}`); return opts.chatCalls ?? []; },
		listChatFailures: async () => [],
	};

	const app = express();
	app.use(express.json());
	app.use("/v1/onec", onecRouter({
		erp: erpDb(opts.superAdmin ?? true), cfg: { JWT_SECRET, ONEC_COMMAND_TIMEOUT_SECS: 5, RATE_LIMIT_ONEC_CLUSTER_PER_MIN: 1000 },
		log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
		agents, bases, queue, audit,
		batches: { ownerOf: async () => ({ organizationUuid: "org-1", userUuid: null }) },
		registry: { userSummary: async (ids: unknown) => { journal.push(`userSummary:${JSON.stringify(ids)}`); return []; }, extensionSummary: async () => [] },
		registrations: {
			list: async () => opts.registrations ?? [],
			get: async (id: string) => (opts.registrations ?? []).find((x) => x.id === id) ?? null,
			// Более новая ожидающая заявка той же базы (КР-20 аудита 27.09): у «reg-older» она есть.
			newerPending: async (id: string) => (id === "reg-older" ? "NEW-777" : null),
		},
		baseTokens: { list: async () => opts.tokens ?? [] },
		chatExchange: { list: async () => opts.chat ?? [] },
		credentials: { usersByBaseKeys: async () => new Map() }, schedules: {}, agentBases,
		enrollments: {
			get: async (id: string) => (id === "enr-adm"
				? { id, code: "ADM-001", state: "PENDING", role: "admin", computer: "SRV-1C", serviceName: "BPAPIAgentAdmin", name: "Кластер" }
				: id === "enr-live"
					? { id, code: "BIZ-003", state: "PENDING", role: "business", computer: "BUH-PC-3", serviceName: "BPAPIAgent", name: "Живой" }
				: id === "enr-again"
					? { id, code: "BIZ-002", state: "PENDING", role: "business", computer: "BUH-PC-2", serviceName: "BPAPIAgent", name: "Бухгалтерия, новое имя" }
					: { id, code: "BIZ-001", state: "PENDING", role: "business", computer: "BUH-PC", serviceName: "BPAPIAgent", name: "Бухгалтерия" }),
			previousAgent: async (computer: string) => (computer === "BUH-PC-2" ? "bizOld" : computer === "BUH-PC-3" ? "biz" : null),
			// Более новая ожидающая заявка той же службы (КР-20 аудита 27.09): у «enr-older» она есть.
			newerPending: async (id: string) => (id === "enr-older" ? "NEW-777" : null),
			approve: async (id: string, d: { agentId: string }) => { journal.push(`approveEnroll:${id}:${d.agentId}`); return true; },
			list: async () => opts.enrollments ?? [],
			previousAgents: async () => new Map(),
		},
	} as never));

	const srv = await new Promise<import("node:http").Server>((ok) => { const s = app.listen(0, () => ok(s)); });
	const port = (srv.address() as AddressInfo).port;
	const token = jwt.sign({ uuid: USER }, JWT_SECRET);
	const call = async (method: string, path: string, body?: unknown) => {
		const r = await fetch(`http://127.0.0.1:${port}/v1/onec${path}`, {
			method,
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		return { status: r.status, body: await r.json() as Record<string, never> };
	};
	return { call, journal, enqueued, url: `http://127.0.0.1:${port}/v1/onec`, token, close: () => srv.close() };
}

test("«Обновить» без просьбы о публикациях спрашивает только список баз", async () => {
	const h = await harness();
	const r = await h.call("POST", "/bases/refresh", {});
	assert.equal(r.status, 200);
	assert.deepEqual(h.enqueued.map((c) => c.type), ["CLUSTER_LIST_INFOBASES"]);
	assert.equal((r.body.data as Record<string, unknown>).publications, undefined);
	h.close();
});

test("«Обновить» с публикациями: обе команды сразу, срез публикаций применяется ПОСЛЕ списка баз", async () => {
	const h = await harness({
		results: {
			CLUSTER_LIST_INFOBASES: { items: [{ key: "_transition", status: "ONLINE" }] },
			CLUSTER_LIST_PUBLICATIONS: { items: [{ key: "_transition", published: true }], complete: true, source: "iis", lookedIn: ["C:\\inetpub"] },
		},
	});
	const r = await h.call("POST", "/bases/refresh", { publications: true });
	assert.equal(r.status, 200);
	assert.deepEqual(h.enqueued.map((c) => c.type).sort(), ["CLUSTER_LIST_INFOBASES", "CLUSTER_LIST_PUBLICATIONS"]);
	// Порядок записи важен: срез публикаций, пришедший раньше списка, не нашёл бы новых баз.
	assert.deepEqual(h.journal.filter((x) => x === "sync" || x === "applyPublications"), ["sync", "applyPublications"]);
	const data = r.body.data as { publications?: { report?: { accepted?: boolean; published?: number } } };
	assert.equal(data.publications?.report?.published, 1);
	h.close();
});

test("«Обновить» с проверкой баз данных: спрашивает только про давно не проверявшиеся", async () => {
	const h = await harness({
		staleKeys: ["_transition", "aibek"],
		results: {
			CLUSTER_LIST_INFOBASES: { items: [{ key: "_transition", status: "ONLINE" }] },
			CLUSTER_CHECK_BASES: { checked: 2, items: [{ key: "_transition", dbMissing: false }, { key: "aibek", dbMissing: true }] },
		},
	});
	const r = await h.call("POST", "/bases/refresh", { checkDb: true });
	const check = h.enqueued.find((c) => c.type === "CLUSTER_CHECK_BASES");
	assert.deepEqual(check?.payload.baseKeys, ["_transition", "aibek"]);
	assert.deepEqual((r.body.data as { dbCheck?: unknown }).dbCheck, { checked: 2, missing: 1 });
	h.close();
});

test("«Обновить»: проверять нечего — команда не ставится вовсе", async () => {
	const h = await harness({ staleKeys: [] });
	const r = await h.call("POST", "/bases/refresh", { checkDb: true });
	assert.equal(h.enqueued.filter((c) => c.type === "CLUSTER_CHECK_BASES").length, 0);
	assert.deepEqual((r.body.data as { dbCheck?: unknown }).dbCheck, { checked: 0, missing: 0 });
	h.close();
});

test("удаление записи о базе: база есть в кластере — отказ, реестр не тронут", async () => {
	const h = await harness({ bases: [{ key: "_transition", clusterStatus: "ONLINE" }] });
	const r = await h.call("DELETE", "/bases/_transition");
	assert.equal(r.status, 409);
	assert.equal((r.body.error as { code: string }).code, "BASE_IN_CLUSTER");
	assert.ok(!h.journal.includes("removeMissing"));
	h.close();
});

test("удаление записи о базе, которой нет в кластере: удаляем и пишем в аудит", async () => {
	const h = await harness({ bases: [{ key: "gone", clusterStatus: "MISSING", disabled: true }] });
	const r = await h.call("DELETE", "/bases/gone");
	assert.equal(r.status, 200);
	assert.deepEqual(h.journal.filter((x) => x === "removeMissing" || x === "audit"), ["removeMissing", "audit"]);
	h.close();
});

test("базы нет в реестре — 404, а не «нет агента»", async () => {
	const h = await harness();
	const r = await h.call("DELETE", "/bases/unknown-base");
	assert.equal(r.status, 404);
	assert.equal((r.body.error as { code: string }).code, "UNKNOWN_BASE");
	h.close();
});

test("базы бизнес-агента: третья при maxBases=2 — сверх лимита; лимит правит только администратор BuhProf", async () => {
	const h = await harness();
	const r = await h.call("GET", "/agents/biz/bases");
	assert.equal(r.status, 200);
	const data = r.body.data as { usage: unknown; canEditLimits: boolean; bases: { key: string; overLimitService: boolean }[] };
	assert.deepEqual(data.usage, { bases: 3, bins: 3 });
	assert.equal(data.canEditLimits, true);
	assert.deepEqual(data.bases.map((b) => b.overLimitService), [false, false, true]);

	const bad = await h.call("PUT", "/agents/biz/limits", { maxBases: -1 });
	assert.equal(bad.status, 400);
	// Лимит БИН отменён (В8): поле maxBins больше ничего не значит.
	const ok = await h.call("PUT", "/agents/biz/limits", { maxBases: 3, maxBins: 5 });
	assert.equal(ok.status, 200);
	assert.ok(h.journal.includes('setLimits:biz:{"maxBases":3}'));
	const adm = await h.call("PUT", "/agents/adm/limits", { maxBases: 3 });
	assert.equal(adm.status, 409);
	h.close();

	const notSuper = await harness({ superAdmin: false });
	const denied = await notSuper.call("PUT", "/agents/biz/limits", { maxBases: 100 });
	assert.equal(denied.status, 403);
	assert.ok(!notSuper.journal.some((j) => j.startsWith("setLimits")));
	notSuper.close();
});

test("активация БИН отменена (В8): маршрутов активации больше нет", async () => {
	const h = await harness();
	try {
		// Маршрута нет — отвечает сам express (не JSON), поэтому смотрим только код.
		const raw = (method: string, path: string) => fetch(`${h.url}${path}`, {
			method, headers: { authorization: `Bearer ${h.token}`, "content-type": "application/json" }, body: "{}",
		}).then((r) => r.status);
		assert.equal(await raw("POST", "/activation-requests/biz/000000000002/approve"), 404);
		assert.equal(await raw("PUT", "/agents/biz/active-bins"), 404);
	} finally { h.close(); }
});
const S1 = "aaaaaaaa-0000-4000-8000-000000000001";
const S2 = "aaaaaaaa-0000-4000-8000-000000000002";

test("C10: одноимённая база на двух серверах — без сервера 409 BASE_AMBIGUOUS, с сервером команда идёт", async () => {
	const h = await harness({ servers: [{ id: S1, name: "SRV-A", organizationUuid: "org-1" }, { id: S2, name: "SRV-B", organizationUuid: "org-2" }] });
	const amb = await h.call("GET", "/bases/_transition/info");
	assert.equal(amb.status, 409);
	assert.equal((amb.body.error as unknown as { code: string }).code, "BASE_AMBIGUOUS");
	assert.equal(h.enqueued.length, 0);
	const ok = await h.call("GET", `/bases/_transition/info?serverId=${S1}`);
	assert.equal(ok.status, 200);
	assert.deepEqual(h.enqueued.map((c) => c.type), ["CLUSTER_INFOBASE_INFO"]);
	h.close();
});

test("п. 1: сводка бизнес-агента — его команда HEALTH, а не админская AGENT_HEALTH", async () => {
	const h = await harness({ results: { HEALTH: { bases: [{ key: "Б1", status: "ONLINE" }], limits: { maxBases: 2 } } } });
	const r = await h.call("GET", "/agents/biz/health");
	assert.equal(r.status, 200);
	assert.deepEqual(h.enqueued.map((c) => c.type), ["HEALTH"]);
	h.close();
});

test("п. 7: снятие процесса адресуется выбранному агенту", async () => {
	const h = await harness();
	const r = await h.call("POST", "/agent-processes/4242/kill", { agentId: "11111111-1111-4111-8111-111111111111" });
	// Агент по id — заглушка отдаёт админ-агента: команда ушла ему, а не «первому на связи».
	assert.equal(r.status, 200);
	assert.deepEqual(h.enqueued.map((c) => [c.type, c.payload.pid]), [["AGENT_KILL_PROCESS", 4242]]);
	h.close();
});
test("управление службой бизнес-агента: настройки, перезапуск и обновление идут ему же", async () => {
	const h = await harness({ results: { AGENT_CONFIG_GET: { ibParallel: 2, bases: [] }, AGENT_CONFIG_SET: { changed: ["ibParallel"] }, AGENT_RESTART: { ok: true }, AGENT_UPDATE: { ok: true, accepted: true } } });
	assert.equal((await h.call("GET", "/agents/biz/config")).status, 200);
	assert.equal((await h.call("PUT", "/agents/biz/config", { patch: { ibParallel: 4 } })).status, 200);
	assert.equal((await h.call("POST", "/agents/biz/restart", { reason: "обновили настройки" })).status, 200);
	// Без адреса и хэша обновление не ставится: угадывать, откуда брать сборку, нельзя.
	const noUrl = await h.call("POST", "/agents/biz/update", { build: "2026-09-20 10:55" });
	assert.equal(noUrl.status, 400);
	const ok = await h.call("POST", "/agents/biz/update", { build: "2026-09-20 10:55", url: "https://ai.buhprof.kz/a.zip", sha256: "b".repeat(64) });
	assert.equal(ok.status, 200);
	assert.deepEqual(h.enqueued.map((c) => c.type), ["AGENT_CONFIG_GET", "AGENT_CONFIG_SET", "AGENT_RESTART", "AGENT_UPDATE"]);
	assert.equal(h.enqueued[3].payload.restart, true);
	h.close();
});

test("одобрение заявки — без организации у агента любой роли (Р1, В6)", async () => {
	const h = await harness();
	const adm = await h.call("POST", "/enrollments/enr-adm/approve", {});
	assert.equal(adm.status, 200);
	assert.ok(h.journal.some((j) => j.startsWith("approveEnroll:enr-adm:")), h.journal.join("\n"));
	assert.ok(h.journal.includes("create:admin:Кластер"));
	// Организацию, присланную старой панелью, сервис не читает вовсе.
	const biz = await h.call("POST", "/enrollments/enr-biz/approve", { organizationUuid: "org-1" });
	assert.equal(biz.status, 200);
	assert.ok(h.journal.includes("create:business:Бухгалтерия"));
	// И создание вручную — без активной организации.
	const created = await h.call("POST", "/agents", { name: "Кластер 2", cluster: true });
	assert.equal(created.status, 201);
	assert.ok(h.journal.includes("create:admin:Кластер 2"));
	const business = await h.call("POST", "/agents", { name: "Бизнес 2" });
	assert.equal(business.status, 201);
	assert.ok(h.journal.includes("create:business:Бизнес 2"));
	h.close();
});

test("повторное подключение той же службы приводит прежнего агента в соответствие с решением", async () => {
	const h = await harness();
	const r = await h.call("POST", "/enrollments/enr-again/approve", {});
	assert.equal(r.status, 200);
	assert.equal((r.body.data as unknown as { created: boolean }).created, false, "агент тот же, а не новый");
	assert.ok(h.journal.includes("setDisabled:bizOld:false"), "отключённого включаем: его только что одобрили");
	assert.ok(h.journal.includes("rename:bizOld:Бухгалтерия, новое имя"));
	h.close();
});

test("аудит 21.09: заявка не забирает токен у работающего агента — по умолчанию заводится новый", async () => {
	const h = await harness();
	// «biz» на связи; заявка той же службы (previousAgent → biz) не должна занимать его без явного выбора.
	const r = await h.call("POST", "/enrollments/enr-live/approve", {});
	assert.equal(r.status, 200);
	assert.equal((r.body.data as unknown as { created: boolean }).created, true);
	assert.ok(h.journal.some((j) => j.startsWith("create:business:")), h.journal.join("\n"));
	h.close();
});
test("КР-20: прежнюю заявку при более новой той же службы не одобрить — агент ждёт решения по новой", async () => {
	const h = await harness();
	try {
		const r = await h.call("POST", "/enrollments/enr-older/approve", { organizationUuid: "org-1" });
		assert.equal(r.status, 409);
		const err = r.body.error as unknown as { code: string; message: string };
		assert.equal(err.code, "NEWER_ENROLLMENT_PENDING");
		assert.match(err.message, /NEW-777/);
		assert.match(err.message, /сначала отклоните/);
		assert.ok(!h.journal.some((j) => j.startsWith("approveEnroll:") || j.startsWith("create:")), "ни одобрения, ни нового агента");
	} finally {
		h.close();
	}
});

test("КР-20: список заявок называет более новую ожидающую заявку той же службы — панель не даёт одобрить прежнюю", async () => {
	const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
	const enr = (id: string, code: string, computer: string, createdAt: string, state = "PENDING") =>
		({ id, code, computer, serviceName: "BPAPIAgent", name: "Бухгалтерия", role: "business", state, createdAt });
	const h = await harness({ enrollments: [
		enr("e-new", "NEW-002", "BUH-PC", at(1)),
		enr("e-old", "OLD-001", "buh-pc", at(10)),
		enr("e-other", "OTH-003", "OTHER-PC", at(5)),
		enr("e-done", "DON-004", "BUH-PC", at(0), "REJECTED"),
	] });
	try {
		const r = await h.call("GET", "/enrollments?state=");
		assert.equal(r.status, 200);
		const items = (r.body.data as unknown as { items: { id: string; newerPendingCode: string | null; pendingSiblings: number }[] }).items;
		const by = new Map(items.map((x) => [x.id, x]));
		assert.equal(by.get("e-old")!.newerPendingCode, "NEW-002", "компьютер без учёта регистра — та же служба");
		assert.equal(by.get("e-new")!.newerPendingCode, null);
		assert.equal(by.get("e-other")!.newerPendingCode, null);
		assert.equal(by.get("e-done")!.newerPendingCode, null, "решённая заявка не мешает");
		assert.equal(by.get("e-old")!.pendingSiblings, 1);
	} finally {
		h.close();
	}
});

/** Заявка базы в форме хранилища (RegistrationRow). */
const regRow = (id: string, code: string, onecBaseId: string, minAgo: number, state = "PENDING") => ({
	id, code, onecBaseId, baseName: "buh_nord", state, note: null, ip: null, repeats: 0, decidedBy: null, decidedAt: null,
	organizationUuid: null, baseId: null, baseKey: null, tokenId: null, tokenDeliveredAt: null,
	createdAt: new Date(Date.now() - minAgo * 60_000), updatedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000),
	body: { base: { id: onecBaseId, name: "Nord Beer" }, organizations: [] },
});

test("КР-20: заявки баз — список называет более новую ожидающую той же базы, прежнюю не одобрить (409)", async () => {
	const h = await harness({ registrations: [
		regRow("reg-new", "NEW-777", "ib-1", 1),
		regRow("reg-older", "OLD-001", "ib-1", 10),
		regRow("reg-other", "OTH-003", "ib-2", 5),
		regRow("reg-done", "DON-004", "ib-1", 0, "REJECTED"),
	] });
	try {
		const list = await h.call("GET", "/registrations");
		assert.equal(list.status, 200);
		const items = (list.body.data as unknown as { items: { id: string; newerPendingCode: string | null }[] }).items;
		const by = new Map(items.map((x) => [x.id, x.newerPendingCode]));
		assert.equal(by.get("reg-older"), "NEW-777");
		assert.equal(by.get("reg-new"), null);
		assert.equal(by.get("reg-other"), null);
		assert.equal(by.get("reg-done"), null, "решённая заявка не мешает");

		const r = await h.call("POST", "/registrations/reg-older/approve", { organizationUuid: "org-1", baseKey: "buh_nord" });
		assert.equal(r.status, 409);
		const err = r.body.error as unknown as { code: string; message: string };
		assert.equal(err.code, "NEWER_REGISTRATION_PENDING");
		assert.match(err.message, /NEW-777/);
		assert.match(err.message, /сначала отклоните/);
	} finally {
		h.close();
	}
});

test("аудит 21.09: хвостовая косая черта больше не обходит проверку прав", async () => {
	const h = await harness();
	// Тот же путь без черты — обычный отказ/ответ маршрута; с чертой раньше уходил мимо ОБОИХ гейтов прав.
	const r = await fetch(`${h.url}/bases/_transition/lock/`, {
		method: "POST", headers: { authorization: `Bearer ${h.token}`, "content-type": "application/json" }, body: JSON.stringify({ enabled: true }),
	});
	assert.equal(r.status, 404, "строгий путь: такого маршрута нет");
	assert.equal(h.enqueued.length, 0, "команда в кластер не ушла");
	h.close();
});

test("аудит 21.09: запрет регламентных заданий — разрушающая операция, просмотру не даётся", async () => {
	const h = await harness({ superAdmin: false });
	// erpDb даёт «полный доступ», поэтому проверяем сам список: путь должен считаться разрушающим.
	const { isDestructive } = await import("../src/onec/access.ts");
	assert.equal(isDestructive("POST", "/bases/acme/scheduled-jobs"), true);
	assert.equal(isDestructive("POST", "/bases/acme/scheduled-jobs/"), false, "гейт смотрит на нормализованный путь");
	h.close();
});

test("аудит 21.09: сводки пользователей и расширений считаются по выбранному кластеру", async () => {
	const h = await harness({ servers: [{ id: S1, name: "SRV-A", organizationUuid: "org-1" }, { id: S2, name: "SRV-B", organizationUuid: "org-1" }] });
	await h.call("GET", `/users?serverId=${S1}`);
	assert.ok(h.journal.includes(`userSummary:["${S1}"]`), h.journal.join("\n"));
	h.close();
});

// ── Самопроверка базы средствами расширения (СВ16) и журнал вызовов чата (ПН8) ──

test("самопроверка базы идёт бизнес-агенту той базы — командой SELF_CHECK, за организацией базы (В4)", async () => {
	const h = await harness({ results: { SELF_CHECK: { ok: true, version: "1.6.0", checks: [] } } });
	try {
		const r = await h.call("POST", "/bases/_transition/self-check");
		assert.equal(r.status, 200);
		assert.ok(h.journal.includes("resolveForBase:id-_transition:_transition"), h.journal.join("\n"));
		assert.equal(h.enqueued.at(-1)!.type, "SELF_CHECK");
		assert.equal(h.enqueued.at(-1)!.organizationUuid, "org-base");
		assert.equal((r.body as unknown as { data: { ok: boolean } }).data.ok, true);
	} finally { h.close(); }
});

test("самопроверка: агента нет — 409 и текст про агента, а не «база не найдена»", async () => {
	const h = await harness({ businessAgent: null });
	try {
		const r = await h.call("POST", "/bases/_transition/self-check");
		assert.equal(r.status, 409);
		assert.equal((r.body as unknown as { error: { code: string } }).error.code, "AGENT_UNAVAILABLE");
		assert.equal(h.enqueued.length, 0, "команда не ставится вовсе");
	} finally { h.close(); }
});

test("самопроверка: сборка агента не знает SELF_CHECK — отказ ДО очереди (аудит 22.09)", async () => {
	const h = await harness({ businessAgent: ["HEALTH", "CREATE_SALE"] });
	try {
		const r = await h.call("POST", "/bases/_transition/self-check");
		assert.equal(r.status, 409);
		assert.equal((r.body as unknown as { error: { code: string } }).error.code, "CAPABILITY_MISSING");
		assert.equal(h.enqueued.length, 0, "минуту ожидания и UNKNOWN_COMMAND по сети экономим");
	} finally { h.close(); }
});
test("журнал вызовов чата: отбор по базе доходит до хранилища, строки отдаются как есть", async () => {
	const rows = [{ at: "2026-09-22T10:00:00.000Z", tool: "list_documents", target: "1c", state: "ok", organizationUuid: null }];
	const h = await harness({ chatCalls: rows });
	try {
		const r = await h.call("GET", "/chat-calls?baseId=bbbbbbbb-0000-4000-8000-000000000001");
		assert.equal(r.status, 200);
		assert.equal((r.body as unknown as { data: { items: unknown[] } }).data.items.length, 1);
		assert.ok(h.journal.includes("chatCalls:bbbbbbbb-0000-4000-8000-000000000001"), "база передана в отбор");
	} finally { h.close(); }
});

// ── Базы с расширением: шов между маршрутом и правилами слияния (Б5 аудита 23.09) ──

test("сводка собирает базу из заявки и токена — без всякого кластера", async () => {
	const h = await harness({
		registrations: [{ baseKey: "erp_main", baseName: "Бухгалтерия", state: "APPROVED", organizationUuid: "org-1", decidedAt: new Date("2026-09-20T10:00:00Z"), body: { base: { extensionVersion: "1.5.0" } } }],
		tokens: [{ baseKey: "erp_main", organizationUuid: "org-1", createdAt: new Date(), revokedAt: null, replacedBy: null, acceptedUntil: null }],
		slices: [],
	});
	try {
		const r = await h.call("GET", "/extension-bases");
		assert.equal(r.status, 200);
		const items = (r.body as unknown as { data: { items: Record<string, unknown>[] } }).data.items;
		assert.equal(items.length, 1);
		assert.equal(items[0]!.baseKey, "erp_main");
		assert.equal(items[0]!.access, "active");
		// Версия со слов заявки, пока агент не сказал своё: источник назван честно.
		assert.equal(items[0]!.extVersionSource, "registration");
	} finally { h.close(); }
});

test("версию расширения показывает сводка, а список баз — нет", async () => {
	/*
	 * Колонку «Расширение» из списка баз сняли 23.09: реестр кластера ведёт админ-агент, версии он не
	 * знает, и у большинства клиентов колонка стояла пустой — а пустая колонка читается как «расширения
	 * нет». Версия осталась там, где собирается из всех источников, и подмешивать её в список незачем.
	 */
	const slices = [{ key: "_transition", status: "ONLINE", transport: "http" as const, extVersion: "1.6.0", seenAt: "2026-09-23T08:00:00.000Z" }];
	const h = await harness({ slices, registrations: [], tokens: [] });
	try {
		const bases = await h.call("GET", "/bases");
		const first = (bases.body as unknown as { data: { items: { key: string; extVersion: string | null }[] } }).data.items[0]!;
		assert.equal(first.extVersion, null, "в списке баз — только то, что знает сам реестр");

		const summary = await h.call("GET", "/extension-bases");
		const row = (summary.body as unknown as { data: { items: Record<string, unknown>[] } }).data.items[0]!;
		assert.equal(row.extVersion, "1.6.0", "а версию расширения спрашивают у сводки");
		assert.equal(row.extVersionSource, "agent");
	} finally { h.close(); }
});

test("С2: база без агента — версию и последний обмен даёт канал чата", async () => {
	const h = await harness({
		slices: [], registrations: [], businessAgent: null,
		tokens: [{ baseKey: "erp_main", organizationUuid: "org-1", createdAt: new Date(), revokedAt: null, replacedBy: null, acceptedUntil: null }],
		chat: [{ baseKey: "erp_main", extVersion: "1.6.1", seenAt: "2026-09-23T09:00:00.000Z" }],
	});
	try {
		const r = await h.call("GET", "/extension-bases");
		const row = (r.body as unknown as { data: { items: Record<string, unknown>[] } }).data.items[0]!;
		assert.equal(row.extVersion, "1.6.1");
		assert.equal(row.extVersionSource, "chat", "так и говорим: версию назвала сама база");
		assert.equal(row.lastExchangeAt, "2026-09-23T09:00:00.000Z");
		assert.equal(row.lastExchangeSource, "chat");
	} finally { h.close(); }
});

test("отключённый бизнес-агент в сводке молчит", async () => {
	const slices = [{ key: "_transition", status: "ONLINE", transport: "http" as const, extVersion: "1.6.0", seenAt: "2026-09-23T08:00:00.000Z" }];
	const h = await harness({ slices, businessDisabled: true, registrations: [], tokens: [] });
	try {
		const summary = await h.call("GET", "/extension-bases");
		assert.deepEqual((summary.body as unknown as { data: { items: unknown[] } }).data.items, [],
			"агенту, которого отключили, больше не верим: его базы в сводке нет");
	} finally { h.close(); }
});

test("наименование базы в панели: сохраняется, пустое — возвращает имя из кластера, чужой тип и длина — отказ", async () => {
	const h = await harness({ bases: [{ key: "buh1", clusterStatus: "ONLINE" }] });
	const saved = await h.call("PUT", "/bases/buh1/name", { name: "  Бухгалтерия (основная)  " });
	assert.equal(saved.status, 200);
	assert.equal((saved.body.data as Record<string, unknown>).name, "Бухгалтерия (основная)");
	const reset = await h.call("PUT", "/bases/buh1/name", { name: "" });
	assert.equal(reset.status, 200);
	assert.equal((reset.body.data as Record<string, unknown>).name, null);
	assert.deepEqual(h.journal.filter((x) => x.startsWith("setDisplayName") || x === "audit"), [
		"setDisplayName:id-buh1:Бухгалтерия (основная)", "audit", "setDisplayName:id-buh1:-", "audit",
	]);
	assert.equal((await h.call("PUT", "/bases/buh1/name", { name: 42 })).status, 400);
	assert.equal((await h.call("PUT", "/bases/buh1/name", { name: "x".repeat(201) })).status, 400);
	assert.equal((await h.call("PUT", "/bases/nope/name", { name: "X" })).status, 404);
	h.close();
});
