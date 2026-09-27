// Фиксация шапки документа одной транзакцией (services/documentCommit.js, У2/У4 аудита
// 26.09) — на фейковом prisma в памяти с откатом транзакции, без БД.
import { test } from "node:test";
import assert from "node:assert/strict";
import { commitDocumentHeader, requireStockRemovable, assertDocumentsRemovable } from "../services/documentCommit.js";
import { StockShortageError } from "../services/productRegister.js";
import { _setRecomputeLockRunner } from "../services/recomputeCosting.js";

// ─── Фейковый prisma (минимум: where-фильтр, транзакция со снимком и откатом) ──
const clone = (v) => (v instanceof Date ? new Date(v) : Array.isArray(v) ? v.map(clone)
	: v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
const cmp = (a, b) => { const x = a instanceof Date ? a.getTime() : a; const y = b instanceof Date ? b.getTime() : b; return x < y ? -1 : x > y ? 1 : 0; };
function matches(row, where) {
	for (const [k, v] of Object.entries(where ?? {})) {
		if (k === "NOT") { if (matches(row, v)) return false; continue; }
		if (k === "OR") { if (!v.some((w) => matches(row, w))) return false; continue; }
		const val = row[k];
		if (v === null) { if (val != null) return false; continue; }
		if (v instanceof Date || typeof v !== "object") { if (cmp(val, v) !== 0) return false; continue; }
		if (val === undefined && !("not" in v) && !("in" in v)) continue;
		if ("in" in v && !v.in.includes(val)) return false;
		if ("not" in v && (v.not === null ? val == null : cmp(val, v.not) === 0)) return false;
		if ("lt" in v && !(val != null && cmp(val, v.lt) < 0)) return false;
		if ("lte" in v && !(val != null && cmp(val, v.lte) <= 0)) return false;
		if ("gt" in v && !(val != null && cmp(val, v.gt) > 0)) return false;
		if ("gte" in v && !(val != null && cmp(val, v.gte) >= 0)) return false;
	}
	return true;
}
function fakeDb(seed) {
	let tables = clone(seed);
	let nextId = 1000;
	const table = (m) => (tables[m] ??= []);
	const apply = (row, data) => { for (const [k, v] of Object.entries(data)) if (v !== undefined && !(v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && v.create)) row[k] = clone(v); return row; };
	const delegate = (m) => ({
		findUnique: async ({ where }) => clone(table(m).find((r) => matches(r, where)) ?? null),
		findFirst: async ({ where } = {}) => clone(table(m).find((r) => matches(r, where)) ?? null),
		findMany: async ({ where } = {}) => clone(table(m).filter((r) => matches(r, where))),
		create: async ({ data }) => { const row = apply({ id: ++nextId, uuid: `${m}-${nextId}`, deletedAt: null }, data); table(m).push(row); return clone(row); },
		createMany: async ({ data }) => { for (const d of data) table(m).push(apply({ id: ++nextId, uuid: `${m}-${nextId}` }, d)); return { count: data.length }; },
		update: async ({ where, data }) => { const row = table(m).find((r) => matches(r, where)); if (!row) throw Object.assign(new Error("nf"), { code: "P2025" }); return clone(apply(row, data)); },
		updateMany: async ({ where, data }) => { const rows = table(m).filter((r) => matches(r, where)); rows.forEach((r) => apply(r, data)); return { count: rows.length }; },
		deleteMany: async ({ where } = {}) => { const before = table(m).length; tables[m] = table(m).filter((r) => !matches(r, where)); return { count: before - tables[m].length }; },
		aggregate: async ({ where, _sum = {}, _max = {} }) => {
			const rows = table(m).filter((r) => matches(r, where));
			return {
				_sum: Object.fromEntries(Object.keys(_sum).map((f) => [f, rows.reduce((s, r) => s + (Number(r[f]) || 0), 0)])),
				_max: Object.fromEntries(Object.keys(_max).map((f) => [f, rows.map((r) => r[f]).filter((x) => x != null).sort(cmp).pop() ?? null])),
			};
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
	const tx = new Proxy({}, { get: (_t, p) => (p === "$executeRawUnsafe" ? async () => 1 : p === "then" ? undefined : models[p]) });
	return new Proxy({}, {
		get: (_t, p) => {
			if (p === "$transaction") return async (fn) => { const snap = clone(tables); try { return await fn(tx); } catch (e) { tables = snap; throw e; } };
			if (p === "$executeRawUnsafe") return async () => 1;
			if (p === "then") return undefined;
			if (p === "_tables") return tables;
			return models[p];
		},
	});
}

const D = (s) => new Date(`${s}T12:00:00+05:00`);
const accounts = ["1330", "3310", "1420", "7010", "6010", "1210", "3130"].map((code) => ({ uuid: `acc-${code}`, code, organizationUuid: null, deletedAt: null }));
const base = () => ({
	purchase: [{ id: 1, uuid: "pur-1", organizationUuid: "o", date: D("2026-06-01"), posted: true, warehouseUuid: "w", counterpartyUuid: "cp", deletedAt: null, comment: null }],
	purchaseItem: [{ id: 2, uuid: "pi-1", purchaseUuid: "pur-1", productUuid: "p", quantity: 10, price: 100, amount: 1000, vatAmount: 0, posted: true, date: D("2026-06-01"), organizationUuid: "o", counterpartyUuid: "cp" }],
	productRegister: [
		{ id: 3, uuid: "pr-1", documentType: "purchase", documentUuid: "pur-1", documentId: 1, movementType: "in", quantity: 10, amount: 1000, productUuid: "p", warehouseUuid: "w", organizationUuid: "o", date: D("2026-06-01") },
		{ id: 4, uuid: "pr-2", documentType: "sale", documentUuid: "sale-1", documentId: 5, movementType: "out", quantity: 6, amount: 600, productUuid: "p", warehouseUuid: "w", organizationUuid: "o", date: D("2026-06-05") },
	],
	accountingEntry: [{ id: 6, uuid: "e-1", documentType: "purchase", documentUuid: "pur-1", organizationUuid: "o", date: D("2026-06-01"), debitAccountCode: "1330", creditAccountCode: "3310", amount: 1000 }],
	product: [{ id: 7, uuid: "p", name: "Товар", isService: false }],
	warehouse: [{ id: 8, uuid: "w", name: "Склад", organizationUuid: "o" }],
	counterparty: [{ id: 9, uuid: "cp", name: "Поставщик" }],
	chartOfAccount: accounts,
	organizationAccountingSetting: [{ id: 10, organizationUuid: "o", stockControl: true, startDate: new Date("2020-01-01"), deletedAt: null }],
});

test("распроведение поступления, из которого уже продано, — StockShortageError и полный откат (шапка, регистр, проводки)", async () => {
	_setRecomputeLockRunner(async () => ({ registers: 0, entries: 0 }));
	try {
		const db = fakeDb(base());
		const existing = db._tables.purchase[0];
		await assert.rejects(
			() => commitDocumentHeader({ documentType: "purchase", model: "purchase", uuid: "pur-1", data: { posted: false }, existing, itemModel: "purchaseItem", parentField: "purchaseUuid" }, db),
			(e) => e instanceof StockShortageError && e.shortages[0].kind === "inflow",
		);
		assert.equal(db._tables.purchase[0].posted, true, "шапка откатилась");
		assert.equal(db._tables.purchaseItem[0].posted, true, "строки откатились");
		assert.equal(db._tables.productRegister.filter((m) => m.documentUuid === "pur-1").length, 1, "регистр прежний");
		assert.equal(db._tables.accountingEntry.length, 1, "проводки прежние");
	} finally {
		_setRecomputeLockRunner(null);
	}
});

test("правка комментария проведённого поступления — фиксируется, строки денормализованы, пересчёт не запускается", async () => {
	let recomputes = 0;
	_setRecomputeLockRunner(async (_n, run) => { recomputes++; return run(); });
	try {
		const db = fakeDb(base());
		const existing = db._tables.purchase[0];
		const item = await commitDocumentHeader({
			documentType: "purchase", model: "purchase", uuid: "pur-1", data: { comment: "ок" }, existing,
			itemModel: "purchaseItem", parentField: "purchaseUuid",
		}, db);
		assert.equal(item.comment, "ок");
		assert.equal(db._tables.purchaseItem[0].posted, true);
		assert.equal(db._tables.productRegister.filter((m) => m.documentUuid === "pur-1").length, 1);
		assert.equal(recomputes, 0, "комментарий себестоимость не меняет — пересчёта нет");
	} finally {
		_setRecomputeLockRunner(null);
	}
});

test("перенос даты поступления после продажи — отказ; на день раньше — фиксируется и запускает пересчёт от ранней даты", async () => {
	const runs = [];
	_setRecomputeLockRunner(async (name, run) => { runs.push(name); return run(); });
	try {
		const db = fakeDb(base());
		const existing = db._tables.purchase[0];
		await assert.rejects(() => commitDocumentHeader({ documentType: "purchase", model: "purchase", uuid: "pur-1", data: { date: D("2026-06-10") }, existing, itemModel: "purchaseItem", parentField: "purchaseUuid" }, db), StockShortageError);
		assert.equal(db._tables.purchase[0].date.toISOString(), D("2026-06-01").toISOString());
		const item = await commitDocumentHeader({ documentType: "purchase", model: "purchase", uuid: "pur-1", data: { date: D("2026-05-31") }, existing, itemModel: "purchaseItem", parentField: "purchaseUuid" }, db);
		assert.equal(item.date.toISOString(), D("2026-05-31").toISOString());
		assert.equal(db._tables.purchaseItem[0].date.toISOString(), D("2026-05-31").toISOString(), "дата строк синхронизирована");
		// Пересчёт идёт в фоне (очередь организации) — дожидаемся его прохода.
		for (let i = 0; i < 50 && runs.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
		assert.equal(runs.length, 1, "перенос даты — пересчёт хвоста");
	} finally {
		_setRecomputeLockRunner(null);
	}
});

test("строки без денормализованных полей (списание): фиксация не падает на неизвестном поле", async () => {
	_setRecomputeLockRunner(async () => ({ registers: 0, entries: 0 }));
	try {
		const seed = base();
		seed.writeOff = [{ id: 20, uuid: "wo-1", organizationUuid: "o", date: D("2026-06-06"), posted: false, warehouseUuid: "w", deletedAt: null, amount: 0 }];
		seed.writeOffItem = [{ id: 21, uuid: "woi-1", writeOffUuid: "wo-1", productUuid: "p", quantity: 2, price: 0, amount: 0, organizationUuid: null }];
		seed.chartOfAccount = [...accounts, { uuid: "acc-7210", code: "7210", organizationUuid: null, deletedAt: null }];
		const db = fakeDb(seed);
		const item = await commitDocumentHeader({ documentType: "write_off", model: "writeOff", uuid: "wo-1", data: { posted: true }, existing: db._tables.writeOff[0], itemModel: "writeOffItem", parentField: "writeOffUuid" }, db);
		assert.equal(item.posted, true);
		assert.equal(db._tables.writeOffItem[0].organizationUuid, "o", "organizationUuid строки синхронизирован");
		assert.equal("date" in db._tables.writeOffItem[0], false, "поля date у строки списания нет — оно не записано");
		assert.equal(Number(item.amount), 200, "сумма списания = себестоимость 2×100");
	} finally {
		_setRecomputeLockRunner(null);
	}
});

test("requireStockRemovable: поступление, из которого продано, — 409; реализация — next()", async () => {
	const db = fakeDb(base());
	const req = { params: { id: "pur-1" }, user: { uuid: "u", organizationUuid: "o", allowedOrgUuids: ["o"] } };
	let status = null;
	const res = { status(s) { status = s; return this; }, json() { return this; } };
	let nexted = false;
	await requireStockRemovable("purchase", "purchase", db)(req, res, () => { nexted = true; });
	assert.equal(status, 409);
	assert.equal(nexted, false);
	// Расходный документ удалением остаток только увеличивает — проверки нет.
	await assertDocumentsRemovable("sale", "sale", ["sale-1"], req, db);
	// Пакет: чужие/непроведённые пропускаются, проведённое своё — 409.
	status = null;
	await requireStockRemovable("purchase", "purchase", db)({ params: {}, body: { uuids: ["pur-1"] }, user: req.user }, res, () => { nexted = true; });
	assert.equal(status, 409);
});
