// Фискальные чеки после аудита 26.09 (И4): чек — только по своему и проведённому документу; чужой
// чек не читается, не опрашивается и не удаляется. Сквозь HTTP, без БД: делегаты Prisma подменены.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { prisma } from "../prisma/prisma-client.js";
import fiscalRouter from "../api/router/fiscalreceipts.js";

const member = { uuid: "u1", username: "m", organizationUuid: "org-A", allowedOrgUuids: ["org-A"], adminOrgUuids: [], isOrgAdmin: false, isSuperAdmin: false };

function mock(map) {
	const saved = [];
	for (const [path, fn] of Object.entries(map)) {
		const [model, method] = path.split(".");
		saved.push([prisma[model], method, prisma[model][method]]);
		prisma[model][method] = fn;
	}
	return () => { for (const [t, k, v] of saved.reverse()) t[k] = v; };
}

async function withApp(fn) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => { req.user = { ...member }; next(); });
	app.use("/api/v1", fiscalRouter);
	const server = app.listen(0);
	try {
		const base = `http://127.0.0.1:${server.address().port}/api/v1`;
		return await fn(async (method, path, body) => {
			const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
			return { status: r.status, body: await r.json().catch(() => ({})) };
		});
	} finally {
		server.close();
	}
}

const sale = (over) => ({ id: 7, uuid: "s1", organizationUuid: "org-A", posted: true, amount: 1000, deletedAt: null, ...over });

test("И4: чек по непроведённой реализации — 409, в ОФД ничего не уходит", async () => {
	let created = false;
	const restore = mock({
		"sale.findUnique": async () => sale({ posted: false }),
		"saleItem.findMany": async () => [],
		"fiscalReceipt.findFirst": async () => null,
		"fiscalReceipt.create": async () => { created = true; return {}; },
	});
	try {
		await withApp(async (call) => {
			const r = await call("POST", "/fiscal-receipts", { documentType: "sale", documentUuid: "s1", paymentMethod: "cash" });
			assert.equal(r.status, 409);
			assert.match(r.body.message, /проведённому/);
			assert.equal(created, false);
		});
	} finally { restore(); }
});

test("чек по реализации чужой организации — 404, как несуществующий", async () => {
	const restore = mock({
		"sale.findUnique": async () => sale({ organizationUuid: "org-B" }),
		"saleItem.findMany": async () => [],
		"fiscalReceipt.findFirst": async () => { throw new Error("не должно вызываться"); },
	});
	try {
		await withApp(async (call) => {
			const r = await call("POST", "/fiscal-receipts", { documentType: "sale", documentUuid: "s1", paymentMethod: "cash" });
			assert.equal(r.status, 404);
		});
	} finally { restore(); }
});

test("чужой чек не читается и не опрашивается", async () => {
	const restore = mock({
		"fiscalReceipt.findUnique": async () => ({ id: 3, uuid: "r3", organizationUuid: "org-B", status: "payment_pending" }),
	});
	try {
		await withApp(async (call) => {
			assert.equal((await call("GET", "/fiscal-receipts/3")).status, 404);
			assert.equal((await call("POST", "/fiscal-receipts/3/check-payment")).status, 404);
			assert.equal((await call("DELETE", "/fiscal-receipts/3")).status, 404);
		});
	} finally { restore(); }
});
