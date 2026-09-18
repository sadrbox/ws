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
const erpDb = () => ({
	query: async (sql: string) => {
		if (sql.includes("FROM users")) return { rows: [{ uuid: USER, is_super_admin: true, organization_uuid: "org-1" }], rowCount: 1 };
		if (sql.includes("FROM access_rights")) return { rows: [{ organization_uuid: "org-1", role: "admin" }], rowCount: 1 };
		if (sql.includes("count(*) FILTER")) return { rows: [{ full: "1", any: "1" }], rowCount: 1 };
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
} = {}) {
	const journal: string[] = [];
	const enqueued: { type: string; payload: Record<string, unknown> }[] = [];
	const known = opts.bases ?? [{ key: "_transition", clusterStatus: "ONLINE" }];
	const results = opts.results ?? {};

	const bases = {
		findByKeyGlobal: async (key: string) => {
			const b = known.find((x) => x.key === key);
			return b ? { id: `id-${key}`, key, serverName: "SERVER", disabled: !!b.disabled, clusterStatus: b.clusterStatus, status: b.clusterStatus } : null;
		},
		listAll: async () => known.map((b) => ({ key: b.key, clusterStatus: b.clusterStatus })),
		sync: async () => { journal.push("sync"); },
		applyPublications: async () => { journal.push("applyPublications"); return { marked: 1, cleared: 0, matched: 1 }; },
		staleDbCheck: async () => opts.staleKeys ?? [],
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
	const agents = {
		pickAdminAgent: async () => ({
			id: "adm", organizationUuid: "org-1", role: "admin", disabled: false, serverId: "srv-1",
			capabilities: ["cluster.admin", "ib.admin"], version: "2026-09-17",
		}),
		findById: async () => ({ id: "adm", serverId: "srv-1", role: "admin" }),
	};
	const audit = { write: async () => { journal.push("audit"); } };

	const app = express();
	app.use(express.json());
	app.use("/v1/onec", onecRouter({
		erp: erpDb(), cfg: { JWT_SECRET, ONEC_COMMAND_TIMEOUT_SECS: 5, RATE_LIMIT_ONEC_CLUSTER_PER_MIN: 1000 },
		log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
		agents, bases, queue, audit,
		batches: {}, registry: {}, credentials: { usersByBaseKeys: async () => new Map() }, schedules: {},
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
	return { call, journal, enqueued, close: () => srv.close() };
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
