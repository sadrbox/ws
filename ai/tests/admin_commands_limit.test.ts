// СЛУЖЕБНЫЙ ВХОД /admin/v1/commands И ЛИМИТ ТАРИФА (C8).
//
// Бизнес-команда с адресом базы сверх лимита не ставится и через служебный вход; обход — только флагом force и
// с отдельной записью в аудите. Команды без адреса и команды админ-агенту — как раньше.

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { adminRouter } from "../src/http/adminRouter.ts";

const KEY = "admin-key-test";
const AGENT = "11111111-1111-4111-8111-111111111111";

async function harness(role: "business" | "admin" = "business") {
	const enqueued: string[] = [];
	const audit: string[] = [];
	const base = (key: string, pos: number) => ({ key, pos, status: "ONLINE", transport: "com", extVersion: "1.4.0", overLimit: null, seenAt: null, organizations: [{ id: null, name: key, bin: `00000000000${pos}` }] });
	const app = express();
	app.use(express.json());
	app.use("/admin/v1", adminRouter({
		cfg: { AGENT_ADMIN_KEY: KEY } as never,
		log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
		agents: { get: async () => ({ id: AGENT, role, online: true, organizationUuid: "org", limits: { maxBases: 1, maxBins: null } }) } as never,
		queue: { enqueue: async (i: { type: string }) => { enqueued.push(i.type); return { id: "cmd_1", agent_id: AGENT, base_key: null, type: i.type, state: "queued", request_id: null, payload: {}, result: null, error: null, onec_http_status: null, created_at: new Date(), dispatched_at: null, finished_at: null }; } } as never,
		audit: { write: async (e: { event: string }) => { audit.push(e.event); } } as never,
		agentBases: { list: async () => [base("Б1", 0), base("Б2", 1)] } as never,
	}));
	const server = app.listen(0);
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin/v1/commands`;
	const post = async (body: unknown) => {
		const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-admin-key": KEY }, body: JSON.stringify(body) });
		return { status: r.status, body: await r.json() as { error?: { code: string } } };
	};
	return { enqueued, audit, post, close: () => { server.closeAllConnections(); server.close(); } };
}

test("бизнес-команда в базу сверх лимита — 403 LICENSE_LIMIT; с force — ставится и пишется в аудит", async () => {
	const h = await harness();
	try {
		const denied = await h.post({ agentId: AGENT, type: "SEARCH_COUNTERPARTIES", payload: { q: "x", baseKey: "Б2" } });
		assert.equal(denied.status, 403);
		assert.equal(denied.body.error!.code, "LICENSE_LIMIT");
		assert.deepEqual(h.enqueued, []);

		const ok = await h.post({ agentId: AGENT, type: "SEARCH_COUNTERPARTIES", payload: { q: "x", baseKey: "Б1" } });
		assert.equal(ok.status, 201);

		const forced = await h.post({ agentId: AGENT, type: "SEARCH_COUNTERPARTIES", payload: { q: "x", baseKey: "Б2" }, force: true });
		assert.equal(forced.status, 201);
		assert.ok(h.audit.includes("command.limit_bypass"));

		const noAddress = await h.post({ agentId: AGENT, type: "HEALTH", payload: {} });
		assert.equal(noAddress.status, 201);
	} finally { h.close(); }
});

test("админ-агенту лимит баз не применяется", async () => {
	const h = await harness("admin");
	try {
		assert.equal((await h.post({ agentId: AGENT, type: "IB_INFO", payload: { baseKey: "Б2" } })).status, 201);
	} finally { h.close(); }
});
