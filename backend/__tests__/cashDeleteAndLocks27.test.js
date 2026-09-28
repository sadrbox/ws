// Добор аудита 27.09 (учёт): удаление ПКО одной транзакцией с проверкой кассы (КР-13, хук
// handleDelete), 409 вместо 500 на занятой строке и в строках ОС поступления (КР-15), шапка
// возврата целиком для решения о пересчёте (КР-9). Headless: фейковый prisma в памяти.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { prisma, pool } from "../prisma/prisma-client.js";
import { fakeDb, installFake, withApp, pgError } from "./_fakePrisma.js";
import cashReceiptRouter from "../api/router/cashreceiptorders.js";
import cashExpenseRouter from "../api/router/cashexpenseorders.js";
import saleReturnsRouter from "../api/router/salereturns.js";
import { createPurchaseFixedAssetItemsRouter } from "../api/router/purchasefixedassetitems.js";
import { handleDelete } from "../utils/checkReferences.js";
import { respondPostingError } from "../services/accountingPosting.js";
import { _setRecomputeLockRunner } from "../services/recomputeCosting.js";

const D = (s) => new Date(`${s}T10:00:00+05:00`);
const user = { uuid: "u", username: "u", organizationUuid: "o", allowedOrgUuids: ["o"], isSuperAdmin: false, operatorDataAccess: true };
const accounts = ["1010", "1210", "1330", "2410", "3310", "6010", "7010", "1420", "3130"].map((code, i) => ({ id: 500 + i, uuid: `acc-${code}`, code, name: code, organizationUuid: null, deletedAt: null }));

/** Ошибка lock_timeout на запросе модели — так её отдаёт Prisma 7 + adapter-pg (проверено на одноразовой базе). */
const rowLockError = () => Object.assign(new Error("canceling statement due to lock timeout"), {
	name: "DriverAdapterError",
	cause: { originalCode: "55P03", originalMessage: "canceling statement due to lock timeout", kind: "postgres", code: "55P03" },
});

// ПКО: {uuid, amount, day}; РКО: {uuid, amount, day} — с их проводками по 1010.
function cashSeed({ receipts = [], expenses = [] }) {
	const orders = [];
	const entries = [];
	let id = 10;
	for (const [dir, list] of [["receipt", receipts], ["expense", expenses]]) {
		for (const o of list) {
			id++;
			orders.push({ id, uuid: o.uuid, direction: dir, number: String(id), organizationUuid: "o", counterpartyUuid: "cp", date: D(`2026-09-${o.day}`), amount: o.amount, operationType: dir === "receipt" ? "payment_from_customer" : "payment_to_supplier", posted: true, deletedAt: null, authorUuid: "u" });
			entries.push({ id: 100 + id, uuid: `e-${o.uuid}`, organizationUuid: "o", documentType: dir === "receipt" ? "cash_receipt_order" : "cash_expense_order", documentUuid: o.uuid, documentId: id, date: D(`2026-09-${o.day}`), debitAccountCode: dir === "receipt" ? "1010" : "3310", creditAccountCode: dir === "receipt" ? "1210" : "1010", amount: o.amount, description: null });
		}
	}
	return {
		organization: [{ id: 1, uuid: "o", name: "Орг" }],
		counterparty: [{ id: 2, uuid: "cp", name: "Контрагент", organizationUuid: "o" }],
		chartOfAccount: accounts,
		cashOrder: orders,
		accountingEntry: entries,
	};
}
const cashBalance = (db) => db._tables.accountingEntry.reduce((t, e) => t + (e.debitAccountCode === "1010" ? 1 : e.creditAccountCode === "1010" ? -1 : 0) * Number(e.amount), 0);

// ─── КР-13: удаление ПКО — проверка кассы, снятие проводок и удаление одной транзакцией ──
test("КР-13: удаление ПКО, из которого уже выдано, — 409, ордер и проводки на месте; без выдачи — удаляется с проводками", async () => {
	const db = fakeDb(cashSeed({ receipts: [{ uuid: "pko-1", amount: 1000, day: "05" }, { uuid: "pko-2", amount: 300, day: "05" }], expenses: [{ uuid: "rko-1", amount: 800, day: "06" }] }));
	const restore = installFake(prisma, db, { pool });
	try {
		await withApp(express, cashReceiptRouter, user, async (call) => {
			const r = await call("DELETE", "/cash-receipt-orders/pko-1");
			assert.equal(r.status, 409, JSON.stringify(r.body));
			assert.match(r.body.message, /Недостаточно денег в кассе/);
			assert.ok(db._tables.cashOrder.some((c) => c.uuid === "pko-1"), "ордер не удалён");
			assert.ok(db._tables.accountingEntry.some((e) => e.documentUuid === "pko-1"), "проводки не сняты — откат");
			const ok = await call("DELETE", "/cash-receipt-orders/pko-2");
			assert.equal(ok.status, 200, JSON.stringify(ok.body));
			assert.equal(db._tables.cashOrder.some((c) => c.uuid === "pko-2"), false);
			assert.equal(db._tables.accountingEntry.some((e) => e.documentUuid === "pko-2"), false, "проводки сняты в той же транзакции");
		});
		assert.equal(cashBalance(db), 200);
	} finally {
		restore();
	}
});

test("КР-13: удаление ПКО одновременно с РКО — касса не уходит в минус", async () => {
	const db = fakeDb(cashSeed({ receipts: [{ uuid: "pko-1", amount: 1000, day: "05" }] }), { latency: true });
	const restore = installFake(prisma, db, { pool });
	try {
		const [del, rko] = await Promise.all([
			withApp(express, cashReceiptRouter, user, (call) => call("DELETE", "/cash-receipt-orders/pko-1")),
			withApp(express, cashExpenseRouter, user, (call) => call("POST", "/cash-expense-orders", { number: "77", date: D("2026-09-06").toISOString(), organizationUuid: "o", counterpartyUuid: "cp", amount: 600, operationType: "payment_to_supplier" })),
		]);
		assert.deepEqual([del.status, rko.status].sort(), [200, 409], JSON.stringify([del.body.message, rko.body.message]));
		assert.ok(cashBalance(db) >= 0, `касса ${cashBalance(db)}`);
	} finally {
		restore();
	}
});

test("КР-13: пакетное удаление ПКО — каждый проверяется с учётом уже удалённых, отказ — в failed с текстом кассы", async () => {
	const db = fakeDb(cashSeed({ receipts: [{ uuid: "pko-1", amount: 500, day: "05" }, { uuid: "pko-2", amount: 500, day: "05" }], expenses: [{ uuid: "rko-1", amount: 400, day: "06" }] }));
	const restore = installFake(prisma, db, { pool });
	try {
		await withApp(express, cashReceiptRouter, user, async (call) => {
			const r = await call("POST", "/cash-receipt-orders/batch-delete", { uuids: ["pko-1", "pko-2"] });
			assert.equal(r.status, 200);
			assert.equal(r.body.deleted, 1, "один ПКО можно снять (остаток 100)");
			assert.equal(r.body.failed.length, 1);
			assert.match(r.body.failed[0].message, /Недостаточно денег в кассе/);
		});
		assert.equal(cashBalance(db), 100, "касса не ушла в минус");
	} finally {
		restore();
	}
});

test("handleDelete: без хука — прежний путь без транзакции; с хуком — ошибка хука откатывает удаление и отвечает через respondError", async () => {
	const db = fakeDb({ unitOfMeasure: [{ id: 1, uuid: "u1", name: "шт", organizationUuid: null }] });
	let txCalls = 0;
	const client = new Proxy(db, { get: (t, p) => (p === "$transaction" ? (...a) => { txCalls++; return t.$transaction(...a); } : t[p]) });
	const origQuery = pool.query;
	pool.query = async () => ({ rows: [] }); // карта FK и ссылки — пусто (без БД)
	try {
		let status = null;
		let body = null;
		const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
		const req = { params: { id: "u1" }, user: { ...user, isSuperAdmin: true } };
		await handleDelete({ req, res, prisma: client, modelName: "unitOfMeasure" });
		assert.equal(status, 200);
		assert.equal(txCalls, 0, "без хука транзакции нет — поведение прежнее");

		db._tables.unitOfMeasure = [{ id: 2, uuid: "u2", name: "кг", organizationUuid: null }];
		const hookError = Object.assign(new Error("нельзя"), { hook: true });
		await handleDelete({
			req: { ...req, params: { id: "u2" } }, res, prisma: client, modelName: "unitOfMeasure",
			inTransaction: async (tx) => { await tx.unitOfMeasure.update({ where: { uuid: "u2" }, data: { name: "изменено" } }); throw hookError; },
			respondError: (e, r) => (e.hook ? (r.status(409).json({ success: false, message: e.message }), true) : false),
		});
		assert.equal(status, 409);
		assert.equal(body.message, "нельзя");
		assert.equal(txCalls, 1);
		assert.deepEqual(db._tables.unitOfMeasure.map((x) => x.name), ["кг"], "и запись, и изменения хука откатились");
	} finally {
		pool.query = origQuery;
	}
});

// ─── КР-15: 409 вместо 500 ─────────────────────────────────────────────────────
test("КР-15: блокировка строки не дождалась (55P03 на запросе модели) — respondPostingError отвечает 409", () => {
	let status = null;
	let body = null;
	const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
	assert.equal(respondPostingError(rowLockError(), res), true);
	assert.equal(status, 409);
	assert.match(body.message, /занят другим пользователем/);
	assert.equal(respondPostingError(pgError("55P03", "lock timeout"), res), true, "и в обёртке P2010");
	assert.equal(respondPostingError(new Error("прочее"), res), false);
});

function purchaseSeed() {
	return {
		organization: [{ id: 1, uuid: "o", name: "Орг" }],
		counterparty: [{ id: 2, uuid: "cp", name: "Поставщик", organizationUuid: "o" }],
		chartOfAccount: accounts,
		purchase: [{ id: 3, uuid: "pur-1", number: "1", organizationUuid: "o", counterpartyUuid: "cp", warehouseUuid: null, date: D("2026-09-01"), posted: true, deletedAt: null, amount: 0, vatAmount: 0, amountWithoutVat: 0, discountAmount: 0 }],
	};
}

test("КР-15: строки ОС поступления — документ занят (лок) или строка занята — 409, а не 500", async () => {
	for (const opts of [
		{ onLock: () => pgError("55P03", "canceling statement due to lock timeout") },
		{ overrides: { "purchase.update": async () => { throw rowLockError(); } } },
	]) {
		const db = fakeDb(purchaseSeed(), opts);
		const router = createPurchaseFixedAssetItemsRouter({ client: db });
		await withApp(express, router, user, async (call) => {
			const r = await call("POST", "/purchasefixedassetitems/batch", { operations: [{ action: "create", data: { purchaseUuid: "pur-1", fixedAssetName: "Станок", amount: 1000, vatRate: 0 } }] });
			assert.equal(r.status, 409, JSON.stringify(r.body));
			assert.match(r.body.message, /занят/);
		});
		assert.equal((db._tables.purchaseFixedAssetItem ?? []).length, 0, "откат");
	}
});

// ─── КР-9: возврат — решение о пересчёте по шапке целиком ────────────────────────
function saleReturnSeed() {
	return {
		organization: [{ id: 1, uuid: "o", name: "Орг" }],
		warehouse: [{ id: 2, uuid: "wA", name: "Склад A", organizationUuid: "o" }],
		product: [{ id: 3, uuid: "p", name: "Товар", sku: "", isService: false }],
		counterparty: [{ id: 4, uuid: "cp", name: "Покупатель", organizationUuid: "o" }],
		chartOfAccount: accounts,
		saleReturn: [{ id: 10, uuid: "sr-1", number: "1", organizationUuid: "o", counterpartyUuid: "cp", contractUuid: null, warehouseUuid: "wA", date: D("2026-09-05"), posted: false, deletedAt: null, amount: 300, amountWithoutVat: 300, vatAmount: 0, discountAmount: 0, comment: null, basisDocumentType: null, basisDocumentUuid: null }],
		saleReturnItem: [],
		// Движение позже возврата — ввод задним числом.
		productRegister: [{ id: 20, uuid: "pr-1", documentType: "purchase", documentUuid: "pur-1", documentId: 1, movementType: "in", quantity: 1, amount: 100, productUuid: "p", warehouseUuid: "wA", organizationUuid: "o", date: D("2026-09-20") }],
	};
}

test("КР-9: возврат от покупателя — пересохранение формой с теми же суммами пересчёт не запускает, перенос даты — запускает", async () => {
	const runs = [];
	_setRecomputeLockRunner(async (name) => { runs.push(name); return { registers: 0, entries: 0 }; });
	const restore = installFake(prisma, fakeDb(saleReturnSeed()), { pool });
	try {
		await withApp(express, saleReturnsRouter, user, async (call) => {
			const same = { comment: "уточнение", amount: 300, amountWithoutVat: 300, vatAmount: 0, discountAmount: 0, counterpartyUuid: "cp", warehouseUuid: "wA", number: "1" };
			let r = await call("PUT", "/sale-returns/sr-1", same);
			assert.equal(r.status, 200, JSON.stringify(r.body));
			await new Promise((res) => setTimeout(res, 30));
			assert.equal(runs.length, 0, "суммы те же — пересчёта нет");
			r = await call("PUT", "/sale-returns/sr-1", { ...same, date: D("2026-09-04").toISOString() });
			assert.equal(r.status, 200, JSON.stringify(r.body));
			for (let i = 0; i < 100 && !runs.length; i++) await new Promise((res) => setTimeout(res, 10));
			assert.equal(runs.length, 1, "перенос даты — пересчёт хвоста");
		});
	} finally {
		_setRecomputeLockRunner(null);
		restore();
	}
});
