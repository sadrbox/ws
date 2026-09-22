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
	/** Серверы, где есть каждая база реестра (C9–C11); нет — один сервер srv-1. */
	servers?: { id: string; name: string; organizationUuid: string }[];
	scope?: "all" | "organizations";
} = {}) {
	const journal: string[] = [];
	const enqueued: { type: string; payload: Record<string, unknown> }[] = [];
	const known = opts.bases ?? [{ key: "_transition", clusterStatus: "ONLINE" }];
	const results = opts.results ?? {};
	const servers = opts.servers ?? [{ id: "srv-1", name: "SERVER", organizationUuid: "org-1" }];

	const bases = {
		findByKeyGlobal: async (key: string) => {
			const b = known.find((x) => x.key === key);
			return b ? { id: `id-${key}`, key, serverName: "SERVER", disabled: !!b.disabled, clusterStatus: b.clusterStatus, status: b.clusterStatus } : null;
		},
		listAll: async () => known.map((b) => ({ key: b.key, clusterStatus: b.clusterStatus })),
		sync: async () => { journal.push("sync"); },
		applyPublications: async () => { journal.push("applyPublications"); return { marked: 1, cleared: 0, matched: 1 }; },
		staleDbCheck: async () => opts.staleKeys ?? [],
		serversWithKey: async (key: string) => (known.some((b) => b.key === key) ? servers : []),
		listServers: async () => servers,
		removeMissing: async () => { journal.push("removeMissing"); return opts.removed ?? true; },
	};
	const queue = {
		enqueue: async (i: { type: string; payload: Record<string, unknown> }) => {
			enqueued.push({ type: i.type, payload: i.payload });
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
	const agents = {
		pickAdminAgent: async () => admin,
		listAll: async () => [admin],
		create: async (organizationUuid: string, name: string) => { journal.push(`create:${organizationUuid || "-"}:${name}`); return { agent: { id: "new", name, organizationUuid }, token: "bpa_x" }; },
		rename: async (id: string, name: string) => { journal.push(`rename:${id}:${name}`); return true; },
		setDisabled: async (id: string, disabled: boolean) => { journal.push(`setDisabled:${id}:${disabled}`); return true; },
		setOrganization: async (id: string, org: string) => { journal.push(`setOrganization:${id}:${org}`); return true; },
		findById: async (id: string) => (id === "bizOld"
			? { id: "bizOld", name: "Бухгалтерия", role: "business", online: false, disabled: true, organizationUuid: "org-2", capabilities: [], limits: { maxBases: null, maxBins: null } }
			: id === "biz"
			? { id: "biz", name: "Бухгалтерия", role: "business", online: true, disabled: false, organizationUuid: "org-2",
				capabilities: ["agent.procs", "agent.cancel", "agent.config", "agent.restart", "agent.update"],
				limits: { maxBases: 2, maxBins: null } }
			: admin),
		/** Исполнитель бизнес-команды по базе (самопроверка базы): кого выберет сервис для SELF_CHECK. */
		pickAgentFor: async (_org: string, baseKey: string) => (opts.businessAgent === null ? null : {
			id: "biz", organizationUuid: "org-1", role: "business", online: true, disabled: false,
			capabilities: opts.businessAgent ?? ["HEALTH", "SELF_CHECK"], baseKey,
		}),
		setLimits: async (id: string, l: unknown) => { journal.push(`setLimits:${id}:${JSON.stringify(l)}`); return true; },
		setActiveBins: async (id: string, bins: unknown) => { journal.push(`setActiveBins:${id}:${JSON.stringify(bins)}`); return true; },
	};
	const agentBase = (key: string, pos: number, transport: string) => ({
		key, pos, status: "ONLINE", transport, extVersion: "1.4.0", overLimit: null, seenAt: null,
		organizations: [{ id: `o-${key}`, name: key, bin: `00000000000${pos}` }],
	});
	const agentBases = { list: async () => [agentBase("Б1", 0, "com"), agentBase("Б2", 1, "com"), agentBase("Б3", 2, "http")], listMany: async () => new Map() };
	const audit = {
		write: async () => { journal.push("audit"); },
		listChatCalls: async (o: { baseId?: string | null }) => { journal.push(`chatCalls:${o.baseId ?? "-"}`); return opts.chatCalls ?? []; },
		listChatFailures: async () => [],
	};

	const app = express();
	app.use(express.json());
	app.use("/v1/onec", onecRouter({
		erp: erpDb(opts.superAdmin ?? true), cfg: { JWT_SECRET, ONEC_COMMAND_TIMEOUT_SECS: 5, RATE_LIMIT_ONEC_CLUSTER_PER_MIN: 1000, ONEC_SERVER_SCOPE: opts.scope ?? "all" },
		log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
		agents, bases, queue, audit,
		batches: { ownerOf: async () => ({ organizationUuid: "org-1", userUuid: null }) },
		registry: { userSummary: async (ids: unknown) => { journal.push(`userSummary:${JSON.stringify(ids)}`); return []; }, extensionSummary: async () => [] },
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
			approve: async (id: string, d: { organizationUuid: string; agentId: string }) => { journal.push(`approveEnroll:${id}:${d.organizationUuid || "-"}:${d.agentId}`); return true; },
			list: async () => [],
		},
		activation: {
			get: async (agentId: string, bin: string) => ({ agentId, bin, state: bin === "000000000009" ? "APPROVED" : "PENDING" }),
			decide: async (agentId: string, bin: string, d: { state: string }) => { journal.push(`decide:${agentId}:${bin}:${d.state}`); return true; },
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

	const bad = await h.call("PUT", "/agents/biz/limits", { maxBases: -1, maxBins: "" });
	assert.equal(bad.status, 400);
	const ok = await h.call("PUT", "/agents/biz/limits", { maxBases: 3, maxBins: "" });
	assert.equal(ok.status, 200);
	assert.ok(h.journal.includes('setLimits:biz:{"maxBases":3,"maxBins":null}'));
	const adm = await h.call("PUT", "/agents/adm/limits", { maxBases: 3 });
	assert.equal(adm.status, 409);
	h.close();

	const notSuper = await harness({ superAdmin: false });
	const denied = await notSuper.call("PUT", "/agents/biz/limits", { maxBases: 100 });
	assert.equal(denied.status, 403);
	assert.ok(!notSuper.journal.some((j) => j.startsWith("setLimits")));
	notSuper.close();
});

test("лимит: не названное в запросе поле сохраняет прежнее значение", async () => {
	const h = await harness();
	const r = await h.call("PUT", "/agents/biz/limits", { maxBins: 4 });
	assert.equal(r.status, 200);
	assert.ok(h.journal.includes('setLimits:biz:{"maxBases":2,"maxBins":4}'));
	h.close();
});

test("активация БИН: у агента без списка — список заводится из обслуживаемых сейчас плюс новый; сверх тарифа — предупреждение", async () => {
	const h = await harness();
	// Агент biz: maxBases 2 → обслуживаются Б1 и Б2 (БИНы …000, …001); просят …002 из базы сверх лимита.
	const r = await h.call("POST", "/activation-requests/biz/000000000002/approve", {});
	assert.equal(r.status, 200);
	assert.ok(h.journal.includes('setActiveBins:biz:["000000000000","000000000001","000000000002"]'), h.journal.join("\n"));
	assert.ok(h.journal.includes("decide:biz:000000000002:APPROVED"));
	const again = await h.call("POST", "/activation-requests/biz/000000000009/approve", {});
	assert.equal(again.status, 409);
	const noNote = await h.call("POST", "/activation-requests/biz/000000000002/reject", {});
	assert.equal(noNote.status, 400);
	h.close();

	const notSuper = await harness({ superAdmin: false });
	assert.equal((await notSuper.call("POST", "/activation-requests/biz/000000000002/approve", {})).status, 403);
	notSuper.close();
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

test("C11: при ONEC_SERVER_SCOPE=organizations чужой сервер не виден не суперадмину", async () => {
	const servers = [{ id: S1, name: "SRV-A", organizationUuid: "org-1" }, { id: S2, name: "SRV-B", organizationUuid: "org-2" }];
	const h = await harness({ servers, scope: "organizations", superAdmin: false });
	// Пользователь — в org-1: сервер org-2 ему закрыт, а одноимённая база однозначна (виден один сервер).
	const denied = await h.call("GET", `/bases/_transition/info?serverId=${S2}`);
	assert.equal(denied.status, 403);
	const listed = await h.call("GET", "/servers");
	assert.deepEqual(((listed.body.data as unknown as { items: { id: string }[] }).items).map((x) => x.id), [S1]);
	const one = await h.call("GET", "/bases/_transition/info");
	assert.equal(one.status, 200);
	h.close();
});

test("п. 1: сводка бизнес-агента — его команда HEALTH, а не админская AGENT_HEALTH", async () => {
	const h = await harness({ results: { HEALTH: { bases: [{ key: "Б1", status: "ONLINE" }], limits: { maxBases: 2 } } } });
	const r = await h.call("GET", "/agents/biz/health");
	assert.equal(r.status, 200);
	assert.deepEqual(h.enqueued.map((c) => c.type), ["HEALTH"]);
	h.close();
});

test("п. 7: снятие процесса адресуется выбранному агенту; чужой агент по id не виден", async () => {
	const h = await harness();
	const r = await h.call("POST", "/agent-processes/4242/kill", { agentId: "11111111-1111-4111-8111-111111111111" });
	// Агент по id — заглушка отдаёт админ-агента: команда ушла ему, а не «первому на связи».
	assert.equal(r.status, 200);
	assert.deepEqual(h.enqueued.map((c) => [c.type, c.payload.pid]), [["AGENT_KILL_PROCESS", 4242]]);
	h.close();

	const servers = [{ id: "aaaaaaaa-0000-4000-8000-000000000002", name: "SRV-B", organizationUuid: "org-2" }];
	const scoped = await harness({ servers, scope: "organizations", superAdmin: false });
	// Админ-агент заглушки — на srv-1, которого нет среди видимых серверов пользователя org-1.
	const hidden = await scoped.call("GET", "/agents/adm/commands");
	assert.equal(hidden.status, 404);
	scoped.close();
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

test("агент кластера подключается без организации ERP: он обслуживает весь сервер, а не одну организацию", async () => {
	const h = await harness();
	const adm = await h.call("POST", "/enrollments/enr-adm/approve", {});
	assert.equal(adm.status, 200);
	assert.ok(h.journal.some((j) => j.startsWith("approveEnroll:enr-adm:-:")), h.journal.join("\n"));
	assert.ok(h.journal.includes("create:-:Кластер"), "агент заведён без организации");

	// Бизнес-агенту организация по-прежнему обязательна: по ней выбирается исполнитель команд чата.
	const biz = await h.call("POST", "/enrollments/enr-biz/approve", {});
	assert.equal(biz.status, 400);

	// И создание вручную: «агент кластера» — без организации.
	const created = await h.call("POST", "/agents", { name: "Кластер 2", cluster: true });
	assert.equal(created.status, 201);
	assert.ok(h.journal.includes("create:-:Кластер 2"));
	h.close();
});

test("повторное подключение той же службы приводит прежнего агента в соответствие с решением", async () => {
	const h = await harness();
	// Заглушка агента «biz»: отключён, в организации org-2, со старым именем.
	const r = await h.call("POST", "/enrollments/enr-again/approve", { organizationUuid: "org-1" });
	assert.equal(r.status, 200);
	assert.equal((r.body.data as unknown as { created: boolean }).created, false, "агент тот же, а не новый");
	assert.ok(h.journal.includes("setDisabled:bizOld:false"), "отключённого включаем: его только что одобрили");
	assert.ok(h.journal.includes("rename:bizOld:Бухгалтерия, новое имя"));
	assert.ok(h.journal.includes("setOrganization:bizOld:org-1"), "организация из решения, иначе команды чата его не найдут");
	h.close();
});

test("аудит 21.09: заявка не забирает токен у работающего агента — по умолчанию заводится новый", async () => {
	const h = await harness();
	// «biz» на связи; заявка той же службы (previousAgent → biz) не должна занимать его без явного выбора.
	const r = await h.call("POST", "/enrollments/enr-live/approve", { organizationUuid: "org-1" });
	assert.equal(r.status, 200);
	assert.equal((r.body.data as unknown as { created: boolean }).created, true);
	assert.ok(h.journal.some((j) => j.startsWith("create:org-1:")), h.journal.join("\n"));
	h.close();
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

test("самопроверка базы идёт бизнес-агенту той базы — командой SELF_CHECK с её ключом", async () => {
	const h = await harness({ results: { SELF_CHECK: { ok: true, version: "1.6.0", checks: [] } } });
	try {
		const r = await h.call("POST", "/bases/_transition/self-check");
		assert.equal(r.status, 200);
		assert.deepEqual(h.enqueued.at(-1)!.type, "SELF_CHECK");
		assert.equal((r.body as unknown as { data: { ok: boolean } }).data.ok, true);
	} finally { h.close(); }
});

test("самопроверка: агента нет — 409 и текст про агента, а не «база не найдена»", async () => {
	const h = await harness({ businessAgent: null });
	try {
		const r = await h.call("POST", "/bases/_transition/self-check");
		assert.equal(r.status, 409);
		assert.equal((r.body as unknown as { error: { code: string } }).error.code, "AGENT_OFFLINE");
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
