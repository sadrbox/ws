// КР-9 и КР-16 аудита 27.09 — что считается «изменением, влияющим на себестоимость», и
// фоновый пересчёт, переживающий перезапуск. Headless: фейковый prisma в памяти
// (__tests__/_fakePrisma.js), хранилище отметок — в памяти вместо app_settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { fakeDb } from "./_fakePrisma.js";
import { commitDocumentHeader } from "../services/documentCommit.js";
import {
	costingFieldsChanged,
	_setRecomputeLockRunner,
	_setDirtyStore,
	_resetRecomputeState,
	dirtyKey,
	recomputeIfRetroactive,
	resumeDirtyRecomputes,
	stopRecomputes,
	scheduleRecompute,
} from "../services/recomputeCosting.js";

const D = (s) => new Date(`${s}T10:00:00+05:00`);
const waitFor = async (cond) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)); };

// ─── КР-9 ─────────────────────────────────────────────────────────────────────
test("КР-9: costingFieldsChanged — влияет всё, кроме перечисленных безразличных полей", () => {
	const gtd = { date: D("2026-09-01"), posted: true, warehouseUuid: "wA", comment: "a", number: "1", dutyAmount: new Prisma.Decimal("0.00"), customsFeeAmount: null, counterpartyUuid: "cp" };
	assert.equal(costingFieldsChanged(gtd, { dutyAmount: 500 }), true, "пошлина 0→500");
	assert.equal(costingFieldsChanged(gtd, { customsFeeAmount: 10 }), true, "сбор null→10");
	assert.equal(costingFieldsChanged(gtd, { dutyAmount: 0, comment: "b", number: "7", counterpartyUuid: "cp2", declarationNumber: "ГТД-1" }), false, "реквизиты и то же значение пошлины");
	assert.equal(costingFieldsChanged(gtd, { dutyAmount: "0" }), false, "Decimal 0 и строка «0» — одно и то же");
	assert.equal(costingFieldsChanged(gtd, { date: new Date(D("2026-09-01")) }), false, "та же дата");
	assert.equal(costingFieldsChanged(gtd, { date: D("2026-08-31") }), true, "перенос даты");
	assert.equal(costingFieldsChanged(gtd, { exciseAmount: 5 }), true, "поля нет в выборке — считаем изменившимся");
	assert.equal(costingFieldsChanged(gtd, {}), false);
});

const accounts = ["1330", "3310", "3390", "1420", "7010", "6010", "1210", "3130"].map((code, i) => ({ id: 200 + i, uuid: `acc-${code}`, code, name: code, organizationUuid: null, deletedAt: null }));
function gtdSeed() {
	return {
		organization: [{ id: 1, uuid: "o", name: "Орг" }],
		warehouse: [{ id: 2, uuid: "wA", name: "Склад A", organizationUuid: "o" }],
		product: [{ id: 3, uuid: "p", name: "Товар", sku: "", isService: false }],
		counterparty: [{ id: 4, uuid: "cp", name: "Поставщик", organizationUuid: "o" }],
		chartOfAccount: accounts,
		importDeclaration: [{ id: 10, uuid: "gtd-1", number: "1", organizationUuid: "o", counterpartyUuid: "cp", warehouseUuid: "wA", date: D("2026-09-01"), posted: true, deletedAt: null, amount: 1000, dutyAmount: 0, customsFeeAmount: 0, exciseAmount: 0, importVatAmount: 0, comment: null }],
		importDeclarationItem: [{ id: 11, uuid: "gi-1", importDeclarationUuid: "gtd-1", productUuid: "p", quantity: 10, price: 100, amount: 1000, organizationUuid: "o", deletedAt: null }],
		productRegister: [
			{ id: 12, uuid: "pr-1", documentType: "import_declaration", documentUuid: "gtd-1", documentId: 10, movementType: "in", quantity: 10, amount: 1000, productUuid: "p", warehouseUuid: "wA", organizationUuid: "o", date: D("2026-09-01") },
			// Продажа после ГТД — ввод задним числом делает её себестоимость устаревшей.
			{ id: 13, uuid: "pr-2", documentType: "sale", documentUuid: "sale-1", documentId: 20, movementType: "out", quantity: 5, amount: 500, productUuid: "p", warehouseUuid: "wA", organizationUuid: "o", date: D("2026-09-05") },
		],
	};
}
const gtdExisting = { uuid: "gtd-1", organizationUuid: "o", posted: true, number: "1", warehouseUuid: "wA", date: D("2026-09-01") };
const commitGtd = (db, data) => commitDocumentHeader({
	documentType: "import_declaration", model: "importDeclaration", uuid: "gtd-1", data, existing: gtdExisting,
	itemModel: "importDeclarationItem", parentField: "importDeclarationUuid",
}, db);

test("КР-9: пошлина ГТД 0→500 задним числом — регистр ГТД пересобран и пересчёт хвоста поставлен", async () => {
	const runs = [];
	_setRecomputeLockRunner(async (name) => { runs.push(name); return { registers: 0, entries: 0 }; });
	try {
		const db = fakeDb(gtdSeed());
		await commitGtd(db, { dutyAmount: 500, number: "1" });
		const inMv = db._tables.productRegister.find((m) => m.documentUuid === "gtd-1");
		assert.equal(Number(inMv.amount), 1500, "приход ГТД — по landed cost");
		await waitFor(() => runs.length > 0);
		assert.equal(runs.length, 1, "себестоимость проданного после ГТД пересчитывается");
	} finally {
		_setRecomputeLockRunner(null);
	}
});

test("КР-9: пересохранение ГТД формой без изменений (тело целиком) — пересчёта нет", async () => {
	const runs = [];
	_setRecomputeLockRunner(async (name) => { runs.push(name); return { registers: 0, entries: 0 }; });
	try {
		const db = fakeDb(gtdSeed());
		await commitGtd(db, {
			comment: "уточнение", number: "1", organizationUuid: "o", counterpartyUuid: "cp", warehouseUuid: "wA", posted: true,
			date: D("2026-09-01"), amount: 1000, dutyAmount: 0, customsFeeAmount: 0, exciseAmount: 0, importVatAmount: 0, declarationNumber: "ГТД-7",
		});
		await new Promise((r) => setTimeout(r, 50));
		assert.equal(runs.length, 0, "ничего влияющего не поменялось");
	} finally {
		_setRecomputeLockRunner(null);
	}
});

// ─── КР-16: «грязная дата» пересчёта в базе, остановка и дообработка ─────────
/** Хранилище отметок в памяти (вместо app_settings). */
function memStore() {
	const m = new Map();
	return { m, get: async (k) => m.get(k) ?? null, set: async (k, v) => { if (v == null) m.delete(k); else m.set(k, String(v)); } };
}
/** Мок-клиент пересчёта: движения позже есть (ретроактив), документы — по docsOf(model). */
function recomputeClient({ docsOf = () => [], reconcileFails = false } = {}) {
	const tables = ["purchase", "sale", "inventoryTransfer", "saleReturn", "purchaseReturn", "importDeclaration", "writeOff", "goodsReceipt", "cashOrder", "bankStatement", "payrollCalculation", "payrollPayment", "monthClose"];
	const c = {};
	for (const t of tables) c[t] = { findMany: async () => docsOf(t) };
	c.monthClose.aggregate = async () => ({ _max: { periodEnd: null } });
	c.productRegister = { findFirst: async () => ({ id: 1 }), findMany: async () => [] };
	c.organization = { findMany: async () => [{ uuid: "o" }, { uuid: "o2" }] };
	if (reconcileFails) c.productRegister.deleteMany = async () => { throw new Error("сбой документа"); };
	return c;
}
/** Отложенный старт прохода: лок «берётся», но run() — по сигналу. */
function gatedLock() {
	let open;
	const gate = new Promise((r) => { open = r; });
	const runs = [];
	_setRecomputeLockRunner(async (name, run) => { runs.push(name); await gate; return run(); });
	return { open, runs };
}
const settle = async (store, cond) => { for (let i = 0; i < 200 && !cond(store); i++) await new Promise((r) => setTimeout(r, 5)); };

test("КР-16: правка задним числом — отметка в базе до прохода; проход без сбоев её снимает", async () => {
	const store = memStore();
	_setDirtyStore(store);
	const { open } = gatedLock();
	try {
		const client = recomputeClient();
		const r = await recomputeIfRetroactive({ organizationUuid: "o", date: D("2026-09-01") }, client);
		assert.equal(r.reason, "scheduled");
		assert.equal(store.m.get(dirtyKey("o")), D("2026-09-01").toISOString(), "след есть ещё до прохода — перезапуск его не потеряет");
		// Более поздняя правка раннюю отметку не затирает.
		await recomputeIfRetroactive({ organizationUuid: "o", date: D("2026-09-10") }, client);
		assert.equal(store.m.get(dirtyKey("o")), D("2026-09-01").toISOString());
		open();
		await settle(store, (s) => !s.m.has(dirtyKey("o")));
		assert.equal(store.m.has(dirtyKey("o")), false, "проход прошёл — отметка снята");
	} finally {
		_setRecomputeLockRunner(null);
		_setDirtyStore(null);
		_resetRecomputeState();
	}
});

test("КР-16: остановка во время прохода — документы дальше не трогаются, отметка остаётся; после перезапуска — дообработка", async () => {
	const store = memStore();
	_setDirtyStore(store);
	const { open, runs } = gatedLock();
	let docsServed = 0;
	try {
		// Первый проход видит документ, но остановка приходит раньше — документ не начат.
		const client = recomputeClient({ docsOf: (t) => (t === "sale" && docsServed++ === 0 ? [{ uuid: "s1", id: 1, date: D("2026-09-05") }] : []) });
		await recomputeIfRetroactive({ organizationUuid: "o", date: D("2026-09-01") }, client);
		const stopped = stopRecomputes({ timeoutMs: 2_000 });
		open();
		assert.equal(await stopped, true, "проход завершился в срок");
		assert.equal(store.m.get(dirtyKey("o")), D("2026-09-01").toISOString(), "отметка осталась до следующего старта");
		// Во время остановки новые проходы не начинаются.
		const before = runs.length;
		await scheduleRecompute("o", D("2026-08-01"), client);
		assert.equal(runs.length, before);

		// «Перезапуск»: состояние процесса чистое, отметка — в базе.
		_resetRecomputeState();
		_setRecomputeLockRunner(async (_name, run) => run());
		assert.equal(await resumeDirtyRecomputes(client), 1, "организация с отметкой поставлена в пересчёт");
		await settle(store, (s) => !s.m.has(dirtyKey("o")));
		assert.equal(store.m.has(dirtyKey("o")), false, "дообработано — отметка снята");
	} finally {
		_setRecomputeLockRunner(null);
		_setDirtyStore(null);
		_resetRecomputeState();
	}
});

test("КР-16: проход со сбоем документа отметку не снимает", async () => {
	const store = memStore();
	_setDirtyStore(store);
	_setRecomputeLockRunner(async (_name, run) => run());
	const origError = console.error;
	console.error = () => {};
	try {
		const client = recomputeClient({ reconcileFails: true, docsOf: (t) => (t === "sale" ? [{ uuid: "s1", id: 1, date: D("2026-09-05") }] : []) });
		await recomputeIfRetroactive({ organizationUuid: "o", date: D("2026-09-01") }, client);
		await scheduleRecompute("o", null, client); // дождаться прохода
		assert.equal(store.m.get(dirtyKey("o")), D("2026-09-01").toISOString(), "документ не пересчитан — след остаётся");
	} finally {
		console.error = origError;
		_setRecomputeLockRunner(null);
		_setDirtyStore(null);
		_resetRecomputeState();
	}
});
