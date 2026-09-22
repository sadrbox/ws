/**
 * Долги и остатки организации из 1С (ПН9): маршрут `POST /v1/organization-finance`.
 *
 * Держим то, что ошибкой обходится дороже всего:
 *   — маршрут живёт В ПОЛЬЗОВАТЕЛЬСКОМ API, а не в разделе администрирования: его смотрит бухгалтер в
 *     карточке своей организации, и право «Администрирование 1С» для этого требовать нельзя;
 *   — чужая организация не отдаётся даже по явно присланному uuid, а БИН берётся у ERP, а не у клиента:
 *     иначе по подставленному БИН можно было бы спросить чужую базу;
 *   — команда, которой сборка агента не знает, не ставится вовсе;
 *   — половины ответа независимы: долги могли не дасться, а остатки дались — и наоборот;
 *   — «1С не ответила за N с» — это TIMEOUT, а не пустая карточка: команда жива и повтор обычно приносит ответ.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import type { AddressInfo } from "node:net";
import { userRouter } from "../src/http/userRouter.ts";

const JWT_SECRET = "test-secret";
const USER = "11111111-1111-1111-1111-111111111111";
const ORG = "a1410911-7421-45da-9632-7e4fc48e91c2";
const OTHER_ORG = "b2410911-7421-45da-9632-7e4fc48e91c2";
const BIN = "831111302342";

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** ERP: пользователь с доступом к одной организации; БИН — оттуда же, из базы ERP. */
const erpDb = (bin: string | null) => ({
	query: async (sql: string) => {
		if (sql.includes("FROM users")) return { rows: [{ uuid: USER, is_super_admin: false, organization_uuid: ORG }], rowCount: 1 };
		if (sql.includes("FROM access_rights")) return { rows: [{ organization_uuid: ORG, role: "user" }], rowCount: 1 };
		if (sql.includes("count(*) FILTER")) return { rows: [{ full: "0", any: "0" }], rowCount: 1 };
		if (sql.includes("SELECT bin, name FROM organizations")) return { rows: [{ bin, name: "ТОО Ромашка" }], rowCount: 1 };
		if (sql.includes("FROM organizations")) return { rows: [{ uuid: ORG, name: "ТОО Ромашка", legal_name: null, bin }], rowCount: 1 };
		return { rows: [], rowCount: 0 };
	},
});

type Opts = {
	bin?: string | null;
	/** Способности бизнес-агента; `null` — агента для этой организации нет. */
	capabilities?: string[] | null;
	/** Что вернёт очередь по типу команды; `null` — не дождались (жива, но ответа нет). */
	results?: Record<string, { state: string; result?: unknown; error?: { code: string; message: string } } | null>;
};

async function harness(opts: Opts = {}) {
	const enqueued: { type: string; payload: Record<string, unknown>; baseKey?: string }[] = [];
	const results = opts.results ?? {};
	const queue = {
		enqueue: async (i: { type: string; payload: Record<string, unknown>; baseKey?: string }) => {
			enqueued.push({ type: i.type, payload: i.payload, baseKey: i.baseKey });
			return { id: `cmd-${enqueued.length}`, type: i.type };
		},
		waitResult: async (id: string) => {
			const type = enqueued[Number(id.split("-")[1]) - 1]!.type;
			const r = results[type];
			if (r === null) return null;
			return r ?? { id, state: "done", result: { rows: [] } };
		},
	};
	const agents = {
		resolveBusiness: async () => (opts.capabilities === null
			? { kind: "none" as const }
			: {
				kind: "agent" as const, baseKey: "Dev_01", alsoIn: [], baseStatus: "ONLINE",
				agent: { id: "biz", organizationUuid: ORG, role: "business", online: true, disabled: false, capabilities: opts.capabilities ?? ["GET_DEBTS", "GET_BALANCES"] },
			}),
		visibleTo: async () => [],
	};
	const app = express();
	app.use(express.json());
	app.use("/v1", userRouter({
		erp: erpDb(opts.bin === undefined ? BIN : opts.bin) as never,
		cfg: { JWT_SECRET, ORG_FINANCE_TIMEOUT_SECS: 1, CHAT_ATTACHMENT_MAX_MB: 20 } as never,
		agents: agents as never, workflow: null, log: silent as never, files: {} as never, version: "0.4.0",
		queue: queue as never, audit: { write: async () => {} },
	}));
	const srv = await new Promise<import("node:http").Server>((ok) => { const s = app.listen(0, () => ok(s)); });
	const port = (srv.address() as AddressInfo).port;
	const token = jwt.sign({ uuid: USER }, JWT_SECRET);
	const call = async (body: unknown) => {
		const r = await fetch(`http://127.0.0.1:${port}/v1/organization-finance`, {
			method: "POST",
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		return { status: r.status, body: await r.json() as { success: boolean; data?: any; error?: { code: string; message: string } } };
	};
	return { call, enqueued, close: () => srv.close() };
}

test("ПН9: числа читаются без права «Администрирование 1С» — маршрут пользовательский", async () => {
	const h = await harness({ results: {
		GET_DEBTS: { state: "done", result: { rows: [{ name: "ТОО Альфа", receivable: 1000 }], total: 1 } },
		GET_BALANCES: { state: "done", result: { rows: [{ account: "1030", balance: 5000 }] } },
	} });
	try {
		const r = await h.call({ organizationUuid: ORG, onDate: "2026-09-22" });
		assert.equal(r.status, 200);
		assert.equal(r.body.data.debts.ok, true);
		assert.equal(r.body.data.balances.ok, true);
		assert.equal(r.body.data.onDate, "2026-09-22");
		assert.equal(r.body.data.baseKey, "Dev_01");
		assert.ok(r.body.data.readAt, "на какой миг числа верны — часть ответа: кэша нет, и это видно");
		// БИН подставляет сервис из ERP: по присланному можно было бы спросить чужую базу.
		assert.deepEqual(h.enqueued.map((c) => [c.type, c.payload.organizationBin, c.baseKey]), [
			["GET_DEBTS", BIN, "Dev_01"],
			["GET_BALANCES", BIN, "Dev_01"],
		]);
	} finally { h.close(); }
});

test("ПН9: чужая организация не отдаётся, даже если её uuid прислали явно", async () => {
	const h = await harness();
	try {
		const r = await h.call({ organizationUuid: OTHER_ORG });
		assert.equal(r.status, 403);
		assert.equal(r.body.error!.code, "FORBIDDEN");
		assert.equal(h.enqueued.length, 0);
	} finally { h.close(); }
});

test("ПН9: без БИН у организации спрашивать нечего — отказ называет причину", async () => {
	const h = await harness({ bin: null });
	try {
		const r = await h.call({ organizationUuid: ORG });
		assert.equal(r.status, 409);
		assert.equal(r.body.error!.code, "ORG_BIN_REQUIRED");
	} finally { h.close(); }
});

test("ПН9: агента для организации нет — 409 про агента, команда не ставится", async () => {
	const h = await harness({ capabilities: null });
	try {
		const r = await h.call({ organizationUuid: ORG });
		assert.equal(r.status, 409);
		assert.equal(r.body.error!.code, "AGENT_OFFLINE");
		assert.equal(h.enqueued.length, 0);
	} finally { h.close(); }
});

test("ПН9: сборка агента не знает GET_DEBTS — отказ до очереди (аудит 22.09)", async () => {
	const h = await harness({ capabilities: ["HEALTH", "CREATE_SALE"] });
	try {
		const r = await h.call({ organizationUuid: ORG });
		assert.equal(r.status, 409);
		assert.equal(r.body.error!.code, "CAPABILITY_MISSING");
		assert.equal(h.enqueued.length, 0);
	} finally { h.close(); }
});

test("ПН9: половины независимы — долги не дались, остатки дались", async () => {
	const h = await harness({ results: {
		GET_DEBTS: { state: "failed", error: { code: "ACCESS_DENIED", message: "нет прав на регистр" } },
		GET_BALANCES: { state: "done", result: { rows: [{ account: "1010", balance: 250 }] } },
	} });
	try {
		const r = await h.call({ organizationUuid: ORG });
		assert.equal(r.status, 200, "половина ответа полезнее пустого экрана");
		assert.equal(r.body.data.debts.ok, false);
		assert.equal(r.body.data.debts.error.code, "ACCESS_DENIED");
		assert.equal(r.body.data.balances.ok, true);
	} finally { h.close(); }
});

test("ПН9: 1С не ответила за отведённое время — TIMEOUT, а не «данных нет»", async () => {
	const h = await harness({ results: { GET_DEBTS: null, GET_BALANCES: null } });
	try {
		const r = await h.call({ organizationUuid: ORG });
		assert.equal(r.status, 200);
		assert.equal(r.body.data.debts.ok, false);
		assert.equal(r.body.data.debts.error.code, "TIMEOUT");
		// Текст называет срок: по нему видно, что команда жива и повтор имеет смысл.
		assert.match(r.body.data.debts.error.message, /1 с/);
	} finally { h.close(); }
});
