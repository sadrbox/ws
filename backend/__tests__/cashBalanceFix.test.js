// Касса (У8 аудита 26.09): старый провал не блокирует РКО навсегда; распроведение и
// уменьшение ПКО проверяются — на мок-клиенте, без БД.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCashForPosting, CashShortageError } from "../services/cashBalance.js";

const D = (s) => new Date(`${s}T12:00:00+05:00`);
// Проводка по кассе: amount > 0 — Дт 1010 (поступление), < 0 — Кт 1010 (выдача).
const E = (documentUuid, date, amount) => ({
	organizationUuid: "o", documentUuid, date: D(date), amount: Math.abs(amount),
	debitAccountCode: amount > 0 ? "1010" : "3310", creditAccountCode: amount > 0 ? "1210" : "1010",
});

function match(e, w) {
	for (const [k, v] of Object.entries(w ?? {})) {
		if (k === "OR") { if (!v.some((x) => match(e, x))) return false; continue; }
		if (v && typeof v === "object" && !(v instanceof Date)) {
			if ("not" in v && e[k] === v.not) return false;
			if ("lt" in v && !(e[k] < v.lt)) return false;
			if ("gte" in v && !(e[k] >= v.gte)) return false;
			continue;
		}
		if (e[k] !== v) return false;
	}
	return true;
}
const mock = (entries) => ({
	accountingEntry: {
		findMany: async ({ where }) => entries.filter((e) => match(e, where)),
		aggregate: async ({ where }) => ({ _sum: { amount: entries.filter((e) => match(e, where)).reduce((s, e) => s + e.amount, 0) } }),
	},
});

test("старый провал кассы до даты РКО больше не блокирует (остаток 999 500, РКО на 10)", async () => {
	const entries = [
		E("rko-old", "2026-01-05", -500), // ушли в минус до ввода остатков
		E("pko-1", "2026-01-10", 1_000_000),
	];
	await assert.doesNotReject(() => assertCashForPosting("cash_expense_order", null, { organizationUuid: "o", date: D("2026-06-01"), amount: 10 }, mock(entries)));
});

test("РКО больше остатка — отказ", async () => {
	const entries = [E("pko-1", "2026-06-01", 100)];
	await assert.rejects(
		() => assertCashForPosting("cash_expense_order", null, { organizationUuid: "o", date: D("2026-06-02"), amount: 150 }, mock(entries)),
		(e) => e instanceof CashShortageError && e.shortage === -50,
	);
});

test("распроведение ПКО, из которого уже выдано, — отказ (раньше не проверялось)", async () => {
	const entries = [E("pko-1", "2026-06-01", 100), E("rko-1", "2026-06-05", -80)];
	await assert.rejects(
		() => assertCashForPosting("cash_receipt_order", "pko-1", { organizationUuid: "o", date: D("2026-06-01"), amount: 100, posted: false }, mock(entries)),
		(e) => e instanceof CashShortageError && /без этого поступления/.test(e.message),
	);
	// Уменьшение ПКО до 90 — ещё хватает; до 50 — нет.
	await assert.doesNotReject(() => assertCashForPosting("cash_receipt_order", "pko-1", { organizationUuid: "o", date: D("2026-06-01"), amount: 90 }, mock(entries)));
	await assert.rejects(() => assertCashForPosting("cash_receipt_order", "pko-1", { organizationUuid: "o", date: D("2026-06-01"), amount: 50 }, mock(entries)));
});

test("выплата зарплаты наличными проверяет кассу, через банк — нет", async () => {
	const entries = [E("pko-1", "2026-06-01", 100)];
	await assert.rejects(() => assertCashForPosting("payroll_payment", null, { organizationUuid: "o", date: D("2026-06-02"), amount: 500, paymentMethod: "cash" }, mock(entries)));
	await assert.doesNotReject(() => assertCashForPosting("payroll_payment", null, { organizationUuid: "o", date: D("2026-06-02"), amount: 500, paymentMethod: "bank_transfer" }, mock(entries)));
});

test("перепроведение РКО без изменений при уже отрицательной кассе после него — не блокирует", async () => {
	const entries = [E("pko-1", "2026-06-01", 100), E("rko-1", "2026-06-02", -80), E("rko-2", "2026-06-03", -70)];
	await assert.doesNotReject(() => assertCashForPosting("cash_expense_order", "rko-1", { organizationUuid: "o", date: D("2026-06-02"), amount: 80 }, mock(entries)));
});
