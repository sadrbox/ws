// РЕГИСТРАЦИЯ БАЗЫ 1С (СВ4, часть 1 контракта) — роутер на живом express, хранилище заявок в памяти.
//
// Что проверяется: заявка без токена → код и секрет; повтор той же базы — та же заявка и тот же код, прежний
// секрет больше не действует; неверный секрет — 404; токен — один раз при первом опросе после одобрения, прежние
// токены базы отзываются; отказ — с причиной; лимит заявок в час.

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { baseRegistrationRouter } from "../src/http/baseRegistrationRouter.ts";
import { newPollSecret, newRegistrationCode, normalizeCode, type RegistrationBody, type RegistrationRow } from "../src/bases/registrations.ts";
import type { Logger } from "../src/logger.ts";

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/** Хранилище заявок в памяти — та же семантика, что у RegistrationStore. */
function memStore() {
	const rows: (RegistrationRow & { secretHash: string })[] = [];
	let n = 0;
	return {
		rows,
		submit: async (body: RegistrationBody, ip: string | null) => {
			const secret = newPollSecret();
			const open = rows.find((r) => r.onecBaseId === body.base.id && r.state === "PENDING");
			if (open) { open.secretHash = hash(secret); open.repeats++; open.ip = ip; return { row: open, secret, repeated: true }; }
			const now = new Date();
			const row = {
				id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, code: newRegistrationCode(), onecBaseId: body.base.id, baseName: body.base.name,
				body, ip, repeats: 0, state: "PENDING" as const, note: null, decidedBy: null, decidedAt: null, organizationUuid: null, baseId: null,
				baseKey: null, tokenId: null, tokenDeliveredAt: null, createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 7 * 86400_000),
				secretHash: hash(secret),
			};
			rows.push(row);
			return { row, secret, repeated: false };
		},
		bySecret: async (id: string, secret: string) => rows.find((r) => r.id === id && r.secretHash === hash(secret)) ?? null,
		claimDelivery: async (id: string) => {
			const r = rows.find((x) => x.id === id && x.state === "APPROVED" && !x.tokenDeliveredAt);
			if (!r) return false;
			r.tokenDeliveredAt = new Date();
			return true;
		},
		setToken: async (id: string, tokenId: string) => { rows.find((x) => x.id === id)!.tokenId = tokenId; },
		releaseDelivery: async (id: string) => { const r = rows.find((x) => x.id === id)!; if (!r.tokenId) r.tokenDeliveredAt = null; },
		previousTokens: async (onecBaseId: string, exceptId: string) => rows.filter((r) => r.onecBaseId === onecBaseId && r.id !== exceptId && r.tokenId).map((r) => r.tokenId!),
		approve: (id: string) => Object.assign(rows.find((x) => x.id === id)!, { state: "APPROVED", organizationUuid: "org-1", baseId: "base-1", baseKey: "Бух_Альфа", decidedBy: "admin" }),
		reject: (id: string, note: string) => Object.assign(rows.find((x) => x.id === id)!, { state: "REJECTED", note }),
	};
}

async function harness(perHour = 100) {
	const store = memStore();
	const issued: string[] = [];
	const revoked: string[] = [];
	const journal: string[] = [];
	const tokens = {
		issue: async () => { const id = `tok-${issued.length + 1}`; issued.push(id); return { id, token: `bpb_secret_${id}`, organizationUuid: "org-1" }; },
		revoke: async (id: string) => { revoked.push(id); return true; },
	};
	const erp = { query: async () => ({ rows: [{ name: "ТОО Алеппо", legal_name: null }], rowCount: 1 }) };
	const app = express();
	app.set("trust proxy", true);
	app.use(express.json());
	app.use("/v1/onec-chat", baseRegistrationRouter({
		registrations: store as never, tokens, erp: erp as never, log: silent, perHour,
		audit: { write: async (e: { event: string; details?: Record<string, unknown> }) => { journal.push(`${e.event} ${JSON.stringify(e.details ?? {})}`); } },
	}));
	const server = app.listen(0);
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/onec-chat`;
	const submit = async (body: unknown, ip = "10.0.0.1") => {
		const r = await fetch(`${url}/register`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
		return { status: r.status, body: await r.json() as { success: boolean; data?: Record<string, any>; error?: { code: string } } };
	};
	const poll = async (id: string, secret: string) => {
		const r = await fetch(`${url}/register/${id}`, { headers: { "x-registration-secret": secret } });
		return { status: r.status, body: await r.json() as { success: boolean; data?: Record<string, any>; error?: { code: string } } };
	};
	return { store, issued, revoked, journal, submit, poll, close: () => { server.closeAllConnections(); server.close(); } };
}

const request = (baseId = "ib-1111") => ({
	base: { id: baseId, name: "Бух_Альфа", kind: "server", server: "srv-1c", configuration: { name: "БухгалтерияДляКазахстана", version: "3.0.44.1" }, extensionVersion: "1.5.0", computer: "SRV-1C" },
	organizations: [{ id: "o1", name: "ТОО Альфа", bin: "123456789012" }],
	user: { id: "u1", name: "Администратор" }, contact: "Иванова А.", comment: "с 1 октября",
});

test("заявка: код и секрет; повтор — та же заявка и код, прежний секрет не действует; чужой секрет — 404", async () => {
	const h = await harness();
	try {
		const a = await h.submit(request());
		assert.equal(a.status, 200);
		const d = a.body.data!;
		assert.match(d.code, /^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
		assert.match(d.pollSecret, /^[A-Za-z0-9_-]{43}$/);
		assert.equal(d.pollAfterSecs, 10);

		const pending = await h.poll(d.registrationId, d.pollSecret);
		assert.deepEqual([pending.status, pending.body.data!.state, pending.body.data!.token], [200, "PENDING", undefined]);

		const again = await h.submit(request());
		assert.equal(again.body.data!.registrationId, d.registrationId);
		assert.equal(again.body.data!.code, d.code);
		assert.equal((await h.poll(d.registrationId, d.pollSecret)).status, 404, "прежний секрет больше не действует");
		assert.equal((await h.poll(d.registrationId, again.body.data!.pollSecret)).status, 200);
		assert.equal((await h.poll(d.registrationId, "wrong-secret")).status, 404);
		assert.equal((await h.poll("не-uuid", again.body.data!.pollSecret)).status, 404);
		// Секрет в журнал не попадает.
		assert.ok(!h.journal.some((j) => j.includes(d.pollSecret) || j.includes(again.body.data!.pollSecret)));
	} finally { h.close(); }
});

test("одобрение: токен — один раз при первом опросе, прежние токены этой базы отзываются", async () => {
	const h = await harness();
	try {
		// Прежняя одобренная заявка той же базы с выданным токеном.
		const old = await h.submit(request());
		h.store.approve(old.body.data!.registrationId);
		const first = await h.poll(old.body.data!.registrationId, old.body.data!.pollSecret);
		assert.equal(first.body.data!.token, "bpb_secret_tok-1");

		const fresh = await h.submit(request());
		assert.notEqual(fresh.body.data!.registrationId, old.body.data!.registrationId, "решённая заявка не переиспользуется");
		h.store.approve(fresh.body.data!.registrationId);
		const p1 = await h.poll(fresh.body.data!.registrationId, fresh.body.data!.pollSecret);
		assert.equal(p1.body.data!.state, "APPROVED");
		assert.equal(p1.body.data!.token, "bpb_secret_tok-2");
		assert.deepEqual(p1.body.data!.base, { key: "Бух_Альфа", name: "Бух_Альфа" });
		assert.deepEqual(p1.body.data!.organization, { uuid: "org-1", name: "ТОО Алеппо" });
		assert.deepEqual(h.revoked, ["tok-1"]);

		const p2 = await h.poll(fresh.body.data!.registrationId, fresh.body.data!.pollSecret);
		assert.equal(p2.body.data!.state, "APPROVED");
		assert.equal(p2.body.data!.token, undefined, "второй раз токен не выдаётся");
		assert.equal(h.issued.length, 2);
		assert.ok(!h.journal.some((j) => j.includes("bpb_secret")), "токен в журнал не попадает");
	} finally { h.close(); }
});

test("отказ — с причиной, без токена; некорректная заявка — 400", async () => {
	const h = await harness();
	try {
		const a = await h.submit(request());
		h.store.reject(a.body.data!.registrationId, "нет договора");
		const p = await h.poll(a.body.data!.registrationId, a.body.data!.pollSecret);
		assert.deepEqual([p.body.data!.state, p.body.data!.note, p.body.data!.token], ["REJECTED", "нет договора", undefined]);
		const bad = await h.submit({ base: { name: "без id" } });
		assert.equal(bad.status, 400);
		assert.equal(bad.body.error!.code, "VALIDATION_ERROR");
	} finally { h.close(); }
});

test("лимит: не больше N заявок в час с адреса и с базы", async () => {
	const h = await harness(2);
	try {
		assert.equal((await h.submit(request("ib-a"), "10.0.0.7")).status, 200);
		assert.equal((await h.submit(request("ib-b"), "10.0.0.7")).status, 200);
		assert.equal((await h.submit(request("ib-c"), "10.0.0.7")).status, 429, "третья с того же адреса");
		assert.equal((await h.submit(request("ib-a"), "10.0.0.8")).status, 200);
		assert.equal((await h.submit(request("ib-a"), "10.0.0.9")).status, 429, "третья от той же базы");
	} finally { h.close(); }
});

test("код заявки: без похожих знаков; поиск по коду — без дефиса и регистра", () => {
	for (let i = 0; i < 200; i++) assert.match(newRegistrationCode(), /^[A-HJKMNP-Z2-9]{3}-[A-HJKMNP-Z2-9]{3}$/);
	assert.equal(normalizeCode(" k7m-42q "), "K7M42Q");
});
