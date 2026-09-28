// КР-15 (учётная часть), КР-22 (журнал) и P3 аудита 27.09 — блокировки проведения, журнал,
// проводки документа. Headless: фейковый prisma в памяти (__tests__/_fakePrisma.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { prisma, pool } from "../prisma/prisma-client.js";
import { fakeDb, installFake, withApp, pgError } from "./_fakePrisma.js";
import {
	applyPostingTimeouts,
	lockDocument,
	lockStockPairs,
	withLongStatements,
	statementTimeoutFor,
	DocumentBusyError,
	POSTING_LOCK_WAIT_MS,
	LONG_STATEMENT_MS,
	POSTING_TX_OPTIONS,
} from "../services/documentLock.js";
import { respondPostingError } from "../services/accountingPosting.js";
import { createDocumentItemsRouter } from "../api/router/_documentItemsFactory.js";
import accountingRouter from "../api/router/accounting.js";
import { _setRecomputeLockRunner } from "../services/recomputeCosting.js";

const D = (s) => new Date(`${s}T10:00:00+05:00`);

/** tx-клиент, записывающий SQL; lockError — ошибка на pg_advisory_xact_lock. */
function sqlTx({ lockError = null } = {}) {
	const calls = [];
	return {
		calls,
		$executeRawUnsafe: async (sql) => {
			calls.push(sql);
			if (lockError && /pg_advisory_xact_lock/.test(sql)) throw lockError;
			return 0;
		},
	};
}

// ─── КР-15: пределы ожидания в транзакции проведения ─────────────────────────
test("КР-15: транзакция проведения задаёт себе пределы один раз — до первой блокировки", async () => {
	const tx = sqlTx();
	await lockDocument(tx, "sale", "s1");
	await lockDocument(tx, "sale", "s2");
	await lockStockPairs(tx, [{ productUuid: "p", warehouseUuid: "w" }]);
	assert.equal(tx.calls[0], `SET LOCAL statement_timeout = ${statementTimeoutFor(POSTING_TX_OPTIONS.timeout)}`);
	assert.equal(tx.calls[1], `SET LOCAL lock_timeout = ${POSTING_LOCK_WAIT_MS}`);
	assert.equal(tx.calls.filter((c) => c.startsWith("SET LOCAL")).length, 2, "повторные блокировки — без SET");
	assert.equal(tx.calls.filter((c) => /pg_advisory_xact_lock/.test(c)).length, 3);
	assert.ok(POSTING_LOCK_WAIT_MS < 30_000, "ожидание короче предела пула по умолчанию — срабатывает именно lock_timeout");
	await applyPostingTimeouts({}); // мок без SQL — без ошибок
});

test("КР-15: блокировку не дождались (55P03/57014) — DocumentBusyError → 409; прочие ошибки — как есть", async () => {
	for (const [code, msg] of [["55P03", "canceling statement due to lock timeout"], ["57014", "canceling statement due to statement timeout"]]) {
		await assert.rejects(lockDocument(sqlTx({ lockError: pgError(code, msg) }), "sale", "s1"), (e) => e instanceof DocumentBusyError && e.status === 409);
	}
	await assert.rejects(lockStockPairs(sqlTx({ lockError: pgError("55P03", "x") }), [{ productUuid: "p", warehouseUuid: "w" }]), (e) => e instanceof DocumentBusyError && /товара/.test(e.message));
	const other = pgError("40P01", "deadlock detected");
	await assert.rejects(lockDocument(sqlTx({ lockError: other }), "sale", "s1"), (e) => e === other);

	let status = null;
	let body = null;
	const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
	assert.equal(respondPostingError(new DocumentBusyError(), res), true);
	assert.equal(status, 409);
	assert.match(body.message, /занят другим пользователем/);
});

test("КР-15: statement_timeout — не ниже предела пула; пул без предела остаётся без предела", () => {
	const prev = process.env.DB_STATEMENT_TIMEOUT_MS;
	try {
		process.env.DB_STATEMENT_TIMEOUT_MS = "0";
		assert.equal(statementTimeoutFor(120_000), 0);
		process.env.DB_STATEMENT_TIMEOUT_MS = "600000";
		assert.equal(statementTimeoutFor(120_000), 600_000);
		delete process.env.DB_STATEMENT_TIMEOUT_MS;
		assert.equal(statementTimeoutFor(120_000), 120_000);
	} finally {
		if (prev === undefined) delete process.env.DB_STATEMENT_TIMEOUT_MS;
		else process.env.DB_STATEMENT_TIMEOUT_MS = prev;
	}
});

test("КР-15: withLongStatements — своя транзакция с поднятым пределом; внутри чужой транзакции — как есть", async () => {
	const db = fakeDb({ product: [{ id: 1, uuid: "p", name: "Товар" }] });
	const seen = [];
	const r = await withLongStatements(db, async (tx) => { seen.push(tx._settings?.statement_timeout); return tx.product.count(); });
	assert.equal(r, 1);
	assert.equal(seen[0], String(statementTimeoutFor(LONG_STATEMENT_MS)));
	const tx = sqlTx();
	assert.equal(await withLongStatements(tx, async (t) => (t === tx ? "same" : "other")), "same");
	assert.deepEqual(tx.calls, [], "в чужой транзакции пределы не трогаем");
});

// ─── КР-15 сквозь HTTP: занятый документ — 409 «повторите», а не 500 ─────────
const user = { uuid: "u", username: "u", organizationUuid: "o", allowedOrgUuids: ["o", "o2"], isSuperAdmin: false, operatorDataAccess: true };
const accounts = ["1330", "1210", "6010", "7010", "3130"].map((code, i) => ({ id: 300 + i, uuid: `acc-${code}`, code, name: code, organizationUuid: null, deletedAt: null }));
const mv = (id, documentType, documentUuid, documentId, movementType, quantity, productUuid, date) => ({
	id, uuid: `pr-${id}`, documentType, documentUuid, documentId, movementType, quantity, amount: quantity * 100,
	productUuid, warehouseUuid: "wA", organizationUuid: "o", date: D(date),
});
function salesSeed() {
	const sale = (id, uuid, day) => ({ id, uuid, number: String(id), organizationUuid: "o", counterpartyUuid: "cp", warehouseUuid: "wA", date: D(`2026-09-${day}`), posted: true, deletedAt: null, amount: 150, amountWithoutVat: 150, vatAmount: 0, basisDocumentType: null, basisDocumentUuid: null });
	const item = (id, saleUuid, productUuid) => ({ id, uuid: `si-${id}`, saleUuid, productUuid, quantity: 1, price: 150, amount: 150, amountWithoutVat: 150, vatAmount: 0, vatRate: 0, discountPercent: 0, discountAmount: 0, exciseRate: 0, exciseAmount: 0, deletedAt: null, organizationUuid: "o", posted: true });
	return {
		organization: [{ id: 1, uuid: "o", name: "Орг" }],
		warehouse: [{ id: 2, uuid: "wA", name: "Склад A", organizationUuid: "o" }],
		product: [{ id: 3, uuid: "pX", name: "X", sku: "", isService: false }, { id: 4, uuid: "pY", name: "Y", sku: "", isService: false }],
		counterparty: [{ id: 5, uuid: "cp", name: "Покупатель", organizationUuid: "o" }],
		chartOfAccount: accounts,
		sale: [sale(11, "s1", "10"), sale(12, "s2", "10"), sale(13, "s3", "10"), sale(14, "s4", "10")],
		saleItem: [item(21, "s1", "pX"), item(22, "s2", "pY"), item(23, "s3", "pY"), item(24, "s4", "pX")],
		productRegister: [
			mv(31, "purchase", "pur-1", 1, "in", 100, "pX", "2026-09-01"),
			mv(32, "purchase", "pur-1", 1, "in", 100, "pY", "2026-09-01"),
			mv(33, "sale", "s1", 11, "out", 1, "pX", "2026-09-10"),
			mv(34, "sale", "s2", 12, "out", 1, "pY", "2026-09-10"),
			mv(35, "sale", "s3", 13, "out", 1, "pY", "2026-09-10"),
			mv(36, "sale", "s4", 14, "out", 1, "pX", "2026-09-10"),
		],
	};
}

test("КР-15: строки документа, который держит другая транзакция дольше предела, — 409 «повторите»", async () => {
	const db = fakeDb(salesSeed(), { onLock: () => pgError("55P03", "canceling statement due to lock timeout") });
	const router = createDocumentItemsRouter({ MODEL: "saleItem", ROUTE: "saleitems", PARENT_MODEL: "sale", PARENT_FIELD: "saleUuid", hasTaxes: true, client: db });
	await withApp(express, router, user, async (call) => {
		const r = await call("POST", "/saleitems/batch", { operations: [{ action: "update", uuid: "si-21", data: { quantity: 2 } }] });
		assert.equal(r.status, 409, JSON.stringify(r.body));
		assert.match(r.body.message, /занят/);
	});
	assert.equal(db._tables.saleItem.find((i) => i.uuid === "si-21").quantity, 1, "строка не изменилась — откат");
});

// ─── P3: пакет строк нескольких документов — локи товаров одним набором ──────
test("P3: два пакета строк с общими товарами в разном порядке документов — без взаимной блокировки", async () => {
	_setRecomputeLockRunner(async () => ({ registers: 0, entries: 0 }));
	try {
		// Лок товара берётся с задержкой — обе транзакции успевают взять по первому товару.
		const STOCK_NS = "7213004:";
		const db = fakeDb(salesSeed(), { onLock: (key) => (key.startsWith(STOCK_NS) ? new Promise((r) => setTimeout(() => r(null), 20)) : null) });
		const router = createDocumentItemsRouter({ MODEL: "saleItem", ROUTE: "saleitems", PARENT_MODEL: "sale", PARENT_FIELD: "saleUuid", hasTaxes: true, client: db });
		await withApp(express, router, user, async (call) => {
			// Пакет 1: s1 (X), s2 (Y); пакет 2: s3 (Y), s4 (X). По документам поочерёдно — X,Y против Y,X.
			const b1 = call("POST", "/saleitems/batch", { operations: [{ action: "update", uuid: "si-21", data: { quantity: 2 } }, { action: "update", uuid: "si-22", data: { quantity: 2 } }] });
			const b2 = call("POST", "/saleitems/batch", { operations: [{ action: "update", uuid: "si-23", data: { quantity: 2 } }, { action: "update", uuid: "si-24", data: { quantity: 2 } }] });
			const timeout = new Promise((r) => setTimeout(() => r("deadlock"), 3000).unref());
			const res = await Promise.race([Promise.all([b1, b2]), timeout]);
			assert.notEqual(res, "deadlock", "пакеты ждут друг друга по кругу");
			assert.deepEqual(res.map((r) => r.status), [200, 200]);
		});
	} finally {
		_setRecomputeLockRunner(null);
	}
});

// ─── КР-22: журнал — проведённость до обрезки ─────────────────────────────────
function journalSeed() {
	const e = (id, documentUuid, day) => ({ id, uuid: `e-${id}`, organizationUuid: "o", documentType: "sale", documentUuid, documentId: id, date: D(`2026-09-${day}`), debitAccountCode: "1210", creditAccountCode: "6010", amount: 100, description: null });
	return {
		organization: [{ id: 1, uuid: "o", name: "Орг" }],
		chartOfAccount: accounts,
		sale: [
			{ id: 1, uuid: "draft", number: "1", organizationUuid: "o", posted: false, deletedAt: null, date: D("2026-09-01") },
			{ id: 2, uuid: "s1", number: "2", organizationUuid: "o", posted: true, deletedAt: null, date: D("2026-09-02") },
			{ id: 3, uuid: "s2", number: "3", organizationUuid: "o", posted: true, deletedAt: null, date: D("2026-09-03") },
			{ id: 4, uuid: "s3", number: "4", organizationUuid: "o", posted: true, deletedAt: null, date: D("2026-09-04") },
		],
		// «Сирота» — проводка непроведённого документа (до ночной чистки) — первой в журнале.
		accountingEntry: [e(1, "draft", "01"), e(2, "s1", "02"), e(3, "s2", "03")],
	};
}

test("КР-22: журнал — «сирота» в начале выборки не съедает строки и не прячет обрезку", async () => {
	const db = fakeDb(journalSeed());
	const restore = installFake(prisma, db, { pool });
	try {
		await withApp(express, accountingRouter, user, async (call) => {
			let r = await call("GET", "/accounting/journal?limit=2&organizationUuid=o");
			assert.equal(r.status, 200, JSON.stringify(r.body));
			assert.deepEqual(r.body.items.map((x) => x.documentUuid), ["s1", "s2"], "две проведённые строки, а не одна");
			assert.equal(r.body.truncated, false);
			db._tables.accountingEntry.push({ ...db._tables.accountingEntry[2], id: 4, uuid: "e-4", documentUuid: "s3", date: D("2026-09-04") });
			r = await call("GET", "/accounting/journal?limit=2&organizationUuid=o");
			assert.equal(r.body.items.length, 2);
			assert.equal(r.body.truncated, true, "за двумя строками есть ещё — обрезка сообщается");
		});
	} finally {
		restore();
	}
});

// ─── P3: проводки документа другой доступной организации ─────────────────────
test("P3: /accounting/document-entries — документ другой доступной организации (не активной) показывает проводки", async () => {
	const seed = journalSeed();
	seed.sale.push({ id: 9, uuid: "s-o2", number: "9", organizationUuid: "o2", posted: true, deletedAt: null, date: D("2026-09-05") });
	seed.sale.push({ id: 10, uuid: "s-alien", number: "10", organizationUuid: "alien", posted: true, deletedAt: null, date: D("2026-09-05") });
	seed.accountingEntry.push({ id: 9, uuid: "e-9", organizationUuid: "o2", documentType: "sale", documentUuid: "s-o2", documentId: 9, date: D("2026-09-05"), debitAccountCode: "1210", creditAccountCode: "6010", amount: 70, description: null });
	seed.accountingEntry.push({ id: 10, uuid: "e-10", organizationUuid: "alien", documentType: "sale", documentUuid: "s-alien", documentId: 10, date: D("2026-09-05"), debitAccountCode: "1210", creditAccountCode: "6010", amount: 70, description: null });
	const restore = installFake(prisma, fakeDb(seed), { pool });
	try {
		await withApp(express, accountingRouter, user, async (call) => {
			const r = await call("GET", "/accounting/document-entries?documentType=sale&documentUuid=s-o2");
			assert.equal(r.status, 200);
			assert.equal(r.body.count, 1, "o2 доступна пользователю, хоть и не активна");
			const alien = await call("GET", "/accounting/document-entries?documentType=sale&documentUuid=s-alien");
			assert.equal(alien.body.count, 0, "чужая организация — пусто");
		});
	} finally {
		restore();
	}
});
