// Фабрика строк документа (аудит 26.09: У1, У3, У8, У9) — настоящий express-роутер на
// фейковом prisma в памяти (с транзакциями и откатом), без БД.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createDocumentItemsRouter } from "../api/router/_documentItemsFactory.js";
import { createPurchaseFixedAssetItemsRouter } from "../api/router/purchasefixedassetitems.js";
import { invalidateClosedBoundary } from "../services/periodLock.js";
import { _setRecomputeLockRunner } from "../services/recomputeCosting.js";

// ─── Фейковый prisma ─────────────────────────────────────────────────────────
const clone = (v) => (v instanceof Date ? new Date(v) : Array.isArray(v) ? v.map(clone)
	: v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);

function cmp(a, b) {
	const x = a instanceof Date ? a.getTime() : a;
	const y = b instanceof Date ? b.getTime() : b;
	return x < y ? -1 : x > y ? 1 : 0;
}
function matches(row, where) {
	for (const [k, v] of Object.entries(where ?? {})) {
		if (k === "NOT") { if (matches(row, v)) return false; continue; }
		if (k === "OR") { if (!v.some((w) => matches(row, w))) return false; continue; }
		if (k === "AND") { if (!v.every((w) => matches(row, w))) return false; continue; }
		const val = row[k];
		if (v === null) { if (val != null) return false; continue; }
		if (v instanceof Date || typeof v !== "object") { if (cmp(val, v) !== 0) return false; continue; }
		if (val === undefined && !("not" in v) && !("in" in v)) continue; // фильтр по связи — не моделируем
		if ("in" in v && !v.in.includes(val)) return false;
		if ("not" in v && (v.not === null ? val == null : cmp(val, v.not) === 0)) return false;
		if ("lt" in v && !(val != null && cmp(val, v.lt) < 0)) return false;
		if ("lte" in v && !(val != null && cmp(val, v.lte) <= 0)) return false;
		if ("gt" in v && !(val != null && cmp(val, v.gt) > 0)) return false;
		if ("gte" in v && !(val != null && cmp(val, v.gte) >= 0)) return false;
		if ("equals" in v && cmp(val, v.equals) !== 0) return false;
	}
	return true;
}

function fakeDb(seed) {
	let tables = clone(seed);
	let nextId = 1000;
	const table = (m) => (tables[m] ??= []);
	const applyData = (row, data) => {
		for (const [k, v] of Object.entries(data)) {
			if (v === undefined) continue;
			if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
				if (v.connect) { row[`${k}Uuid`] = v.connect.uuid; continue; }
				if (v.disconnect) { row[`${k}Uuid`] = null; continue; }
				if (v.create) continue; // вложенная аналитика проводок — не храним
			}
			row[k] = clone(v);
		}
		return row;
	};
	const delegate = (m) => ({
		findUnique: async ({ where }) => clone(table(m).find((r) => matches(r, where)) ?? null),
		findFirst: async ({ where } = {}) => clone(table(m).find((r) => matches(r, where)) ?? null),
		findMany: async ({ where } = {}) => clone(table(m).filter((r) => matches(r, where))),
		count: async ({ where } = {}) => table(m).filter((r) => matches(r, where)).length,
		create: async ({ data }) => {
			const row = applyData({ id: ++nextId, uuid: data.uuid ?? `${m}-${nextId}`, deletedAt: null }, data);
			table(m).push(row);
			return clone(row);
		},
		createMany: async ({ data }) => {
			for (const d of data) table(m).push(applyData({ id: ++nextId, uuid: `${m}-${nextId}`, deletedAt: null }, d));
			return { count: data.length };
		},
		update: async ({ where, data }) => {
			const row = table(m).find((r) => matches(r, where));
			if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
			applyData(row, data);
			return clone(row);
		},
		updateMany: async ({ where, data }) => {
			const rows = table(m).filter((r) => matches(r, where));
			rows.forEach((r) => applyData(r, data));
			return { count: rows.length };
		},
		delete: async ({ where }) => {
			const i = table(m).findIndex((r) => matches(r, where));
			if (i < 0) throw Object.assign(new Error("not found"), { code: "P2025" });
			return table(m).splice(i, 1)[0];
		},
		deleteMany: async ({ where } = {}) => {
			const before = table(m).length;
			tables[m] = table(m).filter((r) => !matches(r, where));
			return { count: before - tables[m].length };
		},
		aggregate: async ({ where, _sum = {}, _max = {} }) => {
			const rows = table(m).filter((r) => matches(r, where));
			const sum = Object.fromEntries(Object.keys(_sum).map((f) => [f, rows.reduce((s, r) => s + (Number(r[f]) || 0), 0)]));
			const max = Object.fromEntries(Object.keys(_max).map((f) => [f, rows.map((r) => r[f]).filter((x) => x != null).sort(cmp).pop() ?? null]));
			return { _sum: sum, _max: max };
		},
		groupBy: async ({ by, where, _sum = {} }) => {
			const g = new Map();
			for (const r of table(m).filter((x) => matches(x, where))) {
				const k = by.map((f) => r[f]).join("|");
				const cur = g.get(k) ?? { ...Object.fromEntries(by.map((f) => [f, r[f]])), _sum: Object.fromEntries(Object.keys(_sum).map((f) => [f, 0])) };
				for (const f of Object.keys(_sum)) cur._sum[f] += Number(r[f]) || 0;
				g.set(k, cur);
			}
			return [...g.values()];
		},
	});
	const models = new Proxy({}, { get: (_t, m) => (typeof m === "string" ? delegate(m) : undefined) });
	const tx = new Proxy({}, {
		get: (_t, p) => (p === "$executeRawUnsafe" ? async () => 1 : p === "then" ? undefined : models[p]),
	});
	const db = new Proxy({}, {
		get: (_t, p) => {
			if (p === "$transaction") {
				return async (fn) => {
					const snapshot = clone(tables);
					try { return await fn(tx); } catch (e) { tables = snapshot; throw e; }
				};
			}
			if (p === "$executeRawUnsafe") return async () => 1;
			if (p === "then") return undefined;
			if (p === "_tables") return tables;
			return models[p];
		},
	});
	return db;
}

// ─── Стенд: express + роутер фабрики ────────────────────────────────────────
let server;
let base;
const routers = new Map();
before(async () => {
	_setRecomputeLockRunner(async () => ({ registers: 0, entries: 0 })); // фон пересчёта — вхолостую
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => { req.user = { uuid: "u1", organizationUuid: req.headers["x-org"], allowedOrgUuids: [req.headers["x-org"]] }; next(); });
	app.use((req, res, next) => {
		const r = routers.get(req.headers["x-stand"]);
		return r ? r(req, res, next) : next();
	});
	server = app.listen(0);
	await new Promise((r) => server.once("listening", r));
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); _setRecomputeLockRunner(null); });

let standN = 0;
function stand(config, seed, make = createDocumentItemsRouter) {
	const db = fakeDb(seed);
	const id = `s${++standN}`;
	routers.set(id, make({ ...config, client: db }));
	const call = async (method, path, body, org) => {
		const r = await fetch(`${base}${path}`, {
			method,
			headers: { "content-type": "application/json", "x-stand": id, "x-org": org },
			body: body ? JSON.stringify(body) : undefined,
		});
		return { status: r.status, body: await r.json() };
	};
	return { db, call };
}

const D = (s) => new Date(`${s}T12:00:00+05:00`);
const accounts = ["1330", "7210", "3310", "6280", "1420"].map((code) => ({ uuid: `acc-${code}`, code, organizationUuid: null, deletedAt: null }));

// ─── У1: закрытый период ─────────────────────────────────────────────────────

test("У1: строки проведённого документа закрытого месяца не меняются — 423, строки на месте", async () => {
	invalidateClosedBoundary();
	const org = "org-u1";
	const { db, call } = stand(
		{ MODEL: "purchaseItem", ROUTE: "purchaseitems", PARENT_MODEL: "purchase", PARENT_FIELD: "purchaseUuid", hasTaxes: true, hasSourceRowId: true, extraStringFields: ["batchUuid"] },
		{
			purchase: [{ id: 1, uuid: "pur-1", organizationUuid: org, date: D("2026-05-20"), posted: true, warehouseUuid: "w", deletedAt: null }],
			purchaseItem: [{ id: 2, uuid: "pi-1", purchaseUuid: "pur-1", productUuid: "p", quantity: 5, price: 100, amount: 500 }],
			monthClose: [{ id: 3, uuid: "mc-1", organizationUuid: org, posted: true, deletedAt: null, periodStart: new Date("2026-05-01T00:00:00Z"), periodEnd: new Date("2026-05-31T00:00:00Z") }],
		},
	);
	const add = await call("POST", "/purchaseitems", { purchaseUuid: "pur-1", productUuid: "p", quantity: 1, price: 1 }, org);
	assert.equal(add.status, 423);
	const upd = await call("PUT", "/purchaseitems/pi-1", { quantity: 50 }, org);
	assert.equal(upd.status, 423);
	const del = await call("DELETE", "/purchaseitems/pi-1", null, org);
	assert.equal(del.status, 423);
	const batch = await call("POST", "/purchaseitems/batch", { operations: [{ action: "delete", uuid: "pi-1" }] }, org);
	assert.equal(batch.status, 423);
	assert.equal(db._tables.purchaseItem.length, 1);
	assert.equal(Number(db._tables.purchaseItem[0].quantity), 5);
	// Чтение строк закрытого периода — можно.
	assert.equal((await call("GET", "/purchaseitems?purchaseUuid=pur-1", null, org)).status, 200);
});

// ─── У3: строки + контроль остатка + регистр — одна операция ────────────────

function writeOffStand(org) {
	return stand(
		{ MODEL: "writeOffItem", ROUTE: "writeoffitems", PARENT_MODEL: "writeOff", PARENT_FIELD: "writeOffUuid", hasTaxes: false, hasSourceRowId: true, extraStringFields: ["batchUuid"] },
		{
			writeOff: [{ id: 10, uuid: "wo-1", organizationUuid: org, date: D("2026-06-10"), posted: true, warehouseUuid: "w", amount: 0, deletedAt: null }],
			writeOffItem: [],
			productRegister: [{ id: 11, uuid: "pr-1", documentType: "purchase", documentUuid: "pur-1", documentId: 1, movementType: "in", quantity: 5, amount: 500, productUuid: "p", warehouseUuid: "w", organizationUuid: org, date: D("2026-06-01") }],
			product: [{ id: 12, uuid: "p", name: "Товар", isService: false }],
			warehouse: [{ id: 13, uuid: "w", name: "Склад" }],
			chartOfAccount: accounts,
		},
	);
}

test("У3: нехватка остатка — 409 и НИЧЕГО не записано (ни строки, ни сумма, ни регистр)", async () => {
	invalidateClosedBoundary();
	const org = "org-u3a";
	const { db, call } = writeOffStand(org);
	const r = await call("POST", "/writeoffitems/batch", { operations: [{ action: "create", data: { writeOffUuid: "wo-1", productUuid: "p", quantity: 10 } }] }, org);
	assert.equal(r.status, 409);
	assert.match(r.body.message, /нужно 10, доступно 5/);
	assert.equal(db._tables.writeOffItem.length, 0, "строки откатились");
	assert.equal(db._tables.productRegister.length, 1, "регистр прежний");
});

test("У3: в пределах остатка — строки, регистр и проводки записаны вместе", async () => {
	invalidateClosedBoundary();
	const org = "org-u3b";
	const { db, call } = writeOffStand(org);
	const r = await call("POST", "/writeoffitems/batch", { operations: [{ action: "create", data: { writeOffUuid: "wo-1", productUuid: "p", quantity: 3 } }] }, org);
	assert.equal(r.status, 200, JSON.stringify(r.body));
	assert.equal(db._tables.writeOffItem.length, 1);
	const out = db._tables.productRegister.filter((m) => m.documentUuid === "wo-1");
	assert.equal(out.length, 1);
	assert.equal(Number(out[0].quantity), 3);
	assert.equal(Number(out[0].amount), 300, "себестоимость по средней 100");
	assert.equal(Number(db._tables.writeOff[0].amount), 300, "итог списания = себестоимость");
	assert.ok((db._tables.accountingEntry ?? []).some((e) => e.documentUuid === "wo-1" && e.debitAccountCode === "7210" && Number(e.amount) === 300));
});

// ─── У8: пакетное создание без налогов не теряет поля ────────────────────────

test("У8: пакет без налогов сохраняет batchUuid, positionNumber, sourceRowId и accountingQuantity", async () => {
	invalidateClosedBoundary();
	const org = "org-u8";
	const gr = stand(
		{ MODEL: "importDeclarationItem", ROUTE: "importdeclarationitems", PARENT_MODEL: "importDeclaration", PARENT_FIELD: "importDeclarationUuid", hasTaxes: false, hasSourceRowId: true, extraStringFields: ["positionNumber", "batchUuid"] },
		{ importDeclaration: [{ id: 1, uuid: "gtd-1", organizationUuid: org, date: D("2026-06-10"), posted: false, deletedAt: null }] },
	);
	const r = await gr.call("POST", "/importdeclarationitems/batch", { operations: [{ action: "create", data: { importDeclarationUuid: "gtd-1", productUuid: "p", quantity: 2, price: 10, batchUuid: "b-1", positionNumber: "7", sourceRowId: "src-1" } }] }, org);
	assert.equal(r.status, 200, JSON.stringify(r.body));
	const row = gr.db._tables.importDeclarationItem[0];
	assert.equal(row.batchUuid, "b-1");
	assert.equal(row.positionNumber, "7");
	assert.equal(row.sourceRowId, "src-1");

	const sc = stand(
		{ MODEL: "stockCountItem", ROUTE: "stockcountitems", PARENT_MODEL: "stockCount", PARENT_FIELD: "stockCountUuid", hasTaxes: false, extraNumberFields: ["accountingQuantity"] },
		{
			stockCount: [{ id: 1, uuid: "sc-1", organizationUuid: org, date: D("2026-06-10"), posted: false, deletedAt: null }],
			stockCountItem: [{ id: 2, uuid: "sci-1", stockCountUuid: "sc-1", productUuid: "p", quantity: 1, price: 0, amount: 0, accountingQuantity: 0 }],
		},
	);
	const u = await sc.call("POST", "/stockcountitems/batch", { operations: [{ action: "update", uuid: "sci-1", data: { accountingQuantity: 12 } }] }, org);
	assert.equal(u.status, 200);
	assert.equal(sc.db._tables.stockCountItem[0].accountingQuantity, 12);
});

// ─── У9: отрицательное количество ────────────────────────────────────────────

test("У9: отрицательное количество — 422, строка не создана", async () => {
	invalidateClosedBoundary();
	const org = "org-u9";
	const { db, call } = writeOffStand(org);
	const r = await call("POST", "/writeoffitems", { writeOffUuid: "wo-1", productUuid: "p", quantity: -5 }, org);
	assert.equal(r.status, 422);
	const b = await call("POST", "/writeoffitems/batch", { operations: [{ action: "create", data: { writeOffUuid: "wo-1", productUuid: "p", quantity: "-1" } }] }, org);
	assert.equal(b.status, 422);
	assert.equal(db._tables.writeOffItem.length, 0);
});

// ─── У8: сумма поступления = ТМЗ + ОС ───────────────────────────────────────

test("У8: сумма шапки поступления включает табличную часть «Основные средства»", async () => {
	invalidateClosedBoundary();
	const org = "org-fa";
	const { db, call } = stand(
		{ MODEL: "purchaseItem", ROUTE: "purchaseitems", PARENT_MODEL: "purchase", PARENT_FIELD: "purchaseUuid", hasTaxes: true, hasSourceRowId: true, extraStringFields: ["batchUuid"] },
		{
			purchase: [{ id: 1, uuid: "pur-2", organizationUuid: org, date: D("2026-06-10"), posted: false, warehouseUuid: "w", deletedAt: null }],
			purchaseFixedAssetItem: [{ id: 2, uuid: "fa-1", purchaseUuid: "pur-2", amount: 1120, vatAmount: 120, deletedAt: null }],
		},
	);
	const r = await call("POST", "/purchaseitems", { purchaseUuid: "pur-2", productUuid: "p", quantity: 1, price: 224, vatRate: 12 }, org);
	assert.equal(r.status, 201, JSON.stringify(r.body));
	const pur = db._tables.purchase[0];
	assert.equal(Number(pur.amount), 1344); // 224 ТМЗ + 1120 ОС
	assert.equal(Number(pur.vatAmount), 144); // 24 + 120
});

test("чужой документ — 404 (изоляция сохранена)", async () => {
	const { call } = writeOffStand("org-own");
	const r = await call("POST", "/writeoffitems", { writeOffUuid: "wo-1", productUuid: "p", quantity: 1 }, "org-alien");
	assert.equal(r.status, 404);
});

// ─── У8: строки ОС поступления ───────────────────────────────────────────────

test("У8: строки ОС — владелец, сумма шапки ТМЗ+ОС и проводка Дт 2410 одной операцией; update не обнуляет сумму", async () => {
	invalidateClosedBoundary();
	const org = "org-fa2";
	const { db, call } = stand({}, {
		purchase: [{ id: 1, uuid: "pur-3", organizationUuid: org, date: D("2026-06-10"), posted: true, warehouseUuid: "w", counterpartyUuid: "cp", deletedAt: null }],
		purchaseItem: [{ id: 2, uuid: "pi-3", purchaseUuid: "pur-3", productUuid: null, quantity: 1, price: 112, amount: 112, vatAmount: 12, discountAmount: 0 }],
		chartOfAccount: ["2410", "3310", "1420"].map((code) => ({ uuid: `acc-${code}`, code, organizationUuid: null, deletedAt: null })),
		counterparty: [{ id: 3, uuid: "cp", name: "Поставщик" }],
		organizationAccountingSetting: [{ id: 4, organizationUuid: org, useVat: true, startDate: new Date("2020-01-01"), deletedAt: null }],
	}, createPurchaseFixedAssetItemsRouter);
	const r = await call("POST", "/purchasefixedassetitems/batch", { operations: [{ action: "create", data: { purchaseUuid: "pur-3", fixedAssetUuid: "fa", amount: 1120, vatRate: 12 } }] }, org);
	assert.equal(r.status, 200, JSON.stringify(r.body));
	assert.equal(Number(db._tables.purchase[0].amount), 1232);
	assert.ok((db._tables.accountingEntry ?? []).some((e) => e.debitAccountCode === "2410" && Number(e.amount) === 1000), "проводка ОС без НДС");
	const row = db._tables.purchaseFixedAssetItem[0];
	assert.equal(row.organizationUuid, org, "организация строки — организация поступления");
	// Частичный update (только имя) не обнуляет сумму.
	const u = await call("POST", "/purchasefixedassetitems/batch", { operations: [{ action: "update", uuid: row.uuid, data: { fixedAssetName: "Станок" } }] }, org);
	assert.equal(u.status, 200);
	assert.equal(Number(db._tables.purchaseFixedAssetItem[0].amount), 1120);
	// Чужая организация — 404.
	assert.equal((await call("POST", "/purchasefixedassetitems/batch", { operations: [{ action: "delete", uuid: row.uuid }] }, "org-alien")).status, 404);
	assert.equal((await call("GET", "/purchasefixedassetitems?purchaseUuid=pur-3", null, "org-alien")).status, 404);
});
