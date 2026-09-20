// ПОДКЛЮЧЕНИЕ АГЕНТА ПО КОДУ (СВ5) — роутер на живом express, заявки в памяти.
//
// Заявка без токена → код и секрет; повтор с того же компьютера и службы — та же заявка, прежний секрет не
// действует; неверный секрет — 404; после одобрения идентификатор и токен — ровно один раз, токен выпускается
// при выдаче (rotate-token), в журнал не попадает.

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { agentEnrollRouter } from "../src/http/agentEnrollRouter.ts";
import { newPollSecret, newRegistrationCode } from "../src/bases/registrations.ts";
import type { EnrollmentInput, EnrollmentRow } from "../src/agents/enrollments.ts";
import type { Logger } from "../src/logger.ts";

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const AGENT = "22222222-2222-4222-8222-222222222222";

function memStore() {
	const rows: (EnrollmentRow & { secretHash: string })[] = [];
	let n = 0;
	const same = (r: EnrollmentRow, i: EnrollmentInput) => r.computer.toLowerCase() === i.computer.toLowerCase() && r.serviceName.toLowerCase() === i.serviceName.toLowerCase();
	return {
		rows,
		submit: async (input: EnrollmentInput, ip: string | null) => {
			const secret = newPollSecret();
			const open = rows.find((r) => same(r, input) && r.state === "PENDING");
			if (open) { open.secretHash = hash(secret); open.repeats++; return { row: open, secret, repeated: true }; }
			const now = new Date();
			const row = {
				id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, code: newRegistrationCode(), computer: input.computer, serviceName: input.serviceName,
				name: input.name, role: input.role, serverName: input.serverName ?? null, version: input.version ?? null, ip, repeats: 0, state: "PENDING" as const,
				note: null, decidedBy: null, decidedAt: null, organizationUuid: null, agentId: null, tokenDeliveredAt: null,
				createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 86400_000), secretHash: hash(secret),
			};
			rows.push(row);
			return { row, secret, repeated: false };
		},
		bySecret: async (id: string, secret: string) => rows.find((r) => r.id === id && r.secretHash === hash(secret)) ?? null,
		claimDelivery: async (id: string) => {
			const r = rows.find((x) => x.id === id && x.state === "APPROVED" && !x.tokenDeliveredAt && x.agentId);
			if (!r) return false;
			r.tokenDeliveredAt = new Date();
			return true;
		},
		releaseDelivery: async (id: string) => { rows.find((x) => x.id === id)!.tokenDeliveredAt = null; },
	};
}

async function harness(perHour = 100) {
	const store = memStore();
	const journal: string[] = [];
	let rotations = 0;
	const app = express();
	app.set("trust proxy", true);
	app.use(express.json());
	app.use("/agent/v1", agentEnrollRouter({
		enrollments: store as never, erp: { query: async () => ({ rows: [{ name: "ИП Азимов С.М.", legal_name: null }] }) } as never, log: silent, perHour,
		agents: { rotateToken: async (id: string) => (id === AGENT ? `bpa_secret_${++rotations}` : null) },
		audit: { write: async (e: { event: string; details?: Record<string, unknown> }) => { journal.push(`${e.event} ${JSON.stringify(e.details ?? {})}`); } },
	}));
	const server = app.listen(0);
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/agent/v1`;
	const enroll = async (body: unknown, ip = "10.0.0.1") => {
		const r = await fetch(`${url}/enroll`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
		return { status: r.status, body: await r.json() as { data?: Record<string, any>; error?: { code: string } } };
	};
	const poll = async (id: string, secret: string) => {
		const r = await fetch(`${url}/enroll/${id}`, { headers: { "x-enrollment-secret": secret } });
		return { status: r.status, body: await r.json() as { data?: Record<string, any> } };
	};
	return { store, journal, enroll, poll, close: () => { server.closeAllConnections(); server.close(); } };
}

const request = (computer = "BUH-PC-02") => ({ name: "Бухгалтерия, 2 этаж", role: "business", serverName: "SRV-1C", serviceName: "BPAPIAgent", computer, version: "0.1.0+2026-09-19 21:36 (+05)" });

test("заявка агента: код; повтор с того же компьютера — та же заявка, прежний секрет не действует", async () => {
	const h = await harness();
	try {
		const a = await h.enroll(request());
		assert.equal(a.status, 200);
		assert.match(a.body.data!.code, /^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
		assert.equal(a.body.data!.pollAfterSecs, 5);
		const again = await h.enroll({ ...request(), computer: "buh-pc-02" });
		assert.equal(again.body.data!.enrollmentId, a.body.data!.enrollmentId);
		assert.equal((await h.poll(a.body.data!.enrollmentId, a.body.data!.pollSecret)).status, 404);
		const p = await h.poll(a.body.data!.enrollmentId, again.body.data!.pollSecret);
		assert.deepEqual([p.status, p.body.data!.state, p.body.data!.token], [200, "PENDING", undefined]);
		assert.equal((await h.enroll({ ...request(), role: "кто-то" })).status, 400);
	} finally { h.close(); }
});

test("одобрение: идентификатор и токен — один раз; токен в журнал не попадает", async () => {
	const h = await harness();
	try {
		const a = await h.enroll(request());
		Object.assign(h.store.rows[0], { state: "APPROVED", agentId: AGENT, organizationUuid: "org-1", decidedBy: "admin" });
		const p1 = await h.poll(a.body.data!.enrollmentId, a.body.data!.pollSecret);
		assert.equal(p1.body.data!.agentId, AGENT);
		assert.equal(p1.body.data!.token, "bpa_secret_1");
		assert.deepEqual(p1.body.data!.organization, { uuid: "org-1", name: "ИП Азимов С.М." });
		const p2 = await h.poll(a.body.data!.enrollmentId, a.body.data!.pollSecret);
		assert.deepEqual([p2.body.data!.state, p2.body.data!.token, p2.body.data!.agentId], ["APPROVED", undefined, undefined]);
		assert.ok(!h.journal.some((j) => j.includes("bpa_secret") || j.includes(a.body.data!.pollSecret)));
	} finally { h.close(); }
});

test("лимит: не больше N заявок в час с одного адреса", async () => {
	const h = await harness(2);
	try {
		assert.equal((await h.enroll(request("PC-1"), "10.0.0.9")).status, 200);
		assert.equal((await h.enroll(request("PC-2"), "10.0.0.9")).status, 200);
		assert.equal((await h.enroll(request("PC-3"), "10.0.0.9")).status, 429);
	} finally { h.close(); }
});
