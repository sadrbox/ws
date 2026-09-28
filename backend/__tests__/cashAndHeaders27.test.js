// КР-13, КР-14 и P3 аудита 27.09 — касса под блокировкой, гонка закрытий месяца, шапка и
// проводки одной транзакцией. Headless: фейковый prisma в памяти (__tests__/_fakePrisma.js)
// с настоящими advisory-локами и откатом транзакций.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { prisma, pool } from "../prisma/prisma-client.js";
import { fakeDb, installFake, withApp } from "./_fakePrisma.js";
import cashExpenseRouter from "../api/router/cashexpenseorders.js";
import payrollPaymentsRouter from "../api/router/payrollpayments.js";
import monthClosesRouter from "../api/router/monthcloses.js";
import bankStatementsRouter from "../api/router/bankstatements.js";

const D = (s) => new Date(`${s}T10:00:00+05:00`);
const user = { uuid: "u", username: "u", organizationUuid: "o", allowedOrgUuids: ["o"], isSuperAdmin: false, operatorDataAccess: true };
const accounts = ["1010", "1030", "1210", "3310", "3350", "5610", "6010", "7010", "7210"].map((code, i) => ({ id: 400 + i, uuid: `acc-${code}`, code, name: code, organizationUuid: null, deletedAt: null }));

// Касса 1000: проведённый ПКО и его проводка Дт 1010 Кт 1210.
function cashSeed() {
	return {
		organization: [{ id: 1, uuid: "o", name: "Орг" }],
		counterparty: [{ id: 2, uuid: "cp", name: "Поставщик", organizationUuid: "o" }],
		employee: [{ id: 3, uuid: "emp", firstName: "Иван", lastName: "Тестов", fullName: "Тестов Иван", organizationUuid: "o" }],
		chartOfAccount: accounts,
		cashOrder: [{ id: 10, uuid: "pko-1", direction: "receipt", number: "1", organizationUuid: "o", counterpartyUuid: "cp", date: D("2026-09-05"), amount: 1000, operationType: "payment_from_customer", posted: true, deletedAt: null, authorUuid: "u" }],
		accountingEntry: [{ id: 11, uuid: "e-11", organizationUuid: "o", documentType: "cash_receipt_order", documentUuid: "pko-1", documentId: 10, date: D("2026-09-05"), debitAccountCode: "1010", creditAccountCode: "1210", amount: 1000, description: null }],
	};
}
const cashBalance = (db) => db._tables.accountingEntry.reduce((t, e) => t + (e.debitAccountCode === "1010" ? 1 : e.creditAccountCode === "1010" ? -1 : 0) * Number(e.amount), 0);

// ─── КР-13: касса под блокировкой ─────────────────────────────────────────────
test("КР-13: два РКО по 600 одновременно при кассе 1000 — один проходит, второй 409; касса не в минусе", async () => {
	const db = fakeDb(cashSeed(), { latency: true });
	const restore = installFake(prisma, db, { pool });
	try {
		await withApp(express, cashExpenseRouter, user, async (call) => {
			// Номера — разные (журнальный максимум фейк не считает, а 409 «номер занят» здесь ни при чём).
			const body = (number) => ({ number, date: D("2026-09-06").toISOString(), organizationUuid: "o", counterpartyUuid: "cp", amount: 600, operationType: "payment_to_supplier" });
			const res = await Promise.all([call("POST", "/cash-expense-orders", body("101")), call("POST", "/cash-expense-orders", body("102"))]);
			assert.deepEqual(res.map((r) => r.status).sort(), [201, 409], JSON.stringify(res.map((r) => r.body.message)));
			assert.match(res.find((r) => r.status === 409).body.message, /Недостаточно денег в кассе/);
		});
		assert.equal(cashBalance(db), 400, "касса 1000 − 600");
		assert.equal(db._tables.cashOrder.filter((c) => c.direction === "expense").length, 1, "отказанный ордер не записан");
	} finally {
		restore();
	}
});

test("КР-13: выплата зарплаты наличными одновременно с РКО — касса не уходит в минус", async () => {
	const db = fakeDb(cashSeed(), { latency: true });
	const restore = installFake(prisma, db, { pool });
	try {
		const [r1, r2] = await Promise.all([
			withApp(express, cashExpenseRouter, user, (call) => call("POST", "/cash-expense-orders", { date: D("2026-09-06").toISOString(), organizationUuid: "o", counterpartyUuid: "cp", amount: 700, operationType: "payment_to_supplier" })),
			withApp(express, payrollPaymentsRouter, user, (call) => call("POST", "/payroll-payments", { date: D("2026-09-06").toISOString(), organizationUuid: "o", employeeUuid: "emp", amount: 700, paymentMethod: "cash" })),
		]);
		assert.deepEqual([r1.status, r2.status].sort(), [201, 409], JSON.stringify([r1.body.message, r2.body.message]));
		assert.ok(cashBalance(db) >= 0);
	} finally {
		restore();
	}
});

test("P3: сбой проводок кассового ордера — ордер не остаётся записанным без проводок", async () => {
	const db = fakeDb(cashSeed(), { overrides: { "accountingEntry.create": async () => { throw new Error("сбой записи проводки"); } } });
	const restore = installFake(prisma, db, { pool });
	const origError = console.error;
	console.error = () => {};
	try {
		await withApp(express, cashExpenseRouter, user, async (call) => {
			const r = await call("POST", "/cash-expense-orders", { date: D("2026-09-06").toISOString(), organizationUuid: "o", counterpartyUuid: "cp", amount: 100, operationType: "payment_to_supplier" });
			assert.equal(r.status, 500);
		});
		assert.equal(db._tables.cashOrder.filter((c) => c.direction === "expense").length, 0, "откат: ордера нет");
	} finally {
		console.error = origError;
		restore();
	}
});

// ─── КР-14: гонка двух закрытий месяца ────────────────────────────────────────
test("КР-14: второе закрытие того же месяца, пойманное индексом (P2002), — 409 с текстом о закрытом периоде", async () => {
	const concurrent = { id: 50, uuid: "mc-other", number: "7", organizationUuid: "o", date: D("2026-10-03"), periodStart: new Date("2026-09-01T00:00:00.000Z"), periodEnd: new Date("2026-09-30T00:00:00.000Z"), posted: true, deletedAt: null, authorUuid: "u" };
	const db = fakeDb({ organization: [{ id: 1, uuid: "o", name: "Орг" }], chartOfAccount: accounts }, {
		overrides: {
			// Параллельное закрытие успело зафиксироваться между проверкой и записью.
			"monthClose.create": async (_args, fake) => {
				fake._tables.monthClose = [...(fake._tables.monthClose ?? []), concurrent];
				throw Object.assign(new Error("Unique constraint failed on the fields: (`organizationUuid`,`periodStart`)"), { code: "P2002", meta: { modelName: "MonthClose" } });
			},
		},
	});
	const restore = installFake(prisma, db, { pool });
	try {
		await withApp(express, monthClosesRouter, user, async (call) => {
			const r = await call("POST", "/month-closes", { date: D("2026-10-03").toISOString(), organizationUuid: "o", periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-09-30T00:00:00.000Z", posted: true });
			assert.equal(r.status, 409, JSON.stringify(r.body));
			assert.match(r.body.message, /Период уже закрыт документом «Закрытие месяца» № 7/);
		});
	} finally {
		restore();
	}
});

// ─── P3: шапочная фабрика — документ и проводки одной транзакцией ─────────────
test("P3: сбой проводок банковской выписки — выписка не остаётся записанной", async () => {
	const db = fakeDb({ organization: [{ id: 1, uuid: "o", name: "Орг" }], counterparty: [{ id: 2, uuid: "cp", name: "К", organizationUuid: "o" }], chartOfAccount: accounts }, {
		overrides: { "accountingEntry.create": async () => { throw new Error("сбой записи проводки"); } },
	});
	const restore = installFake(prisma, db, { pool });
	const origError = console.error;
	console.error = () => {};
	try {
		await withApp(express, bankStatementsRouter, user, async (call) => {
			const r = await call("POST", "/bank-statements", { date: D("2026-09-02").toISOString(), organizationUuid: "o", counterpartyUuid: "cp", amount: 700, direction: "bankStatementIn", posted: true });
			assert.equal(r.status, 500);
		});
		assert.equal((db._tables.bankStatement ?? []).length, 0, "откат: выписки нет");
	} finally {
		console.error = origError;
		restore();
	}
});
