// ─────────────────────────────────────────────────────────────────────────────
// Контроль остатка кассы (services/cashBalance.js).
//
// Проверяем главное: защита ловит провал В ЛЮБОЙ МОМЕНТ, а не только на конец
// периода. Расход, проведённый задним числом, сдвигает вниз все последующие
// остатки — документ может выглядеть безобидно по конечному сальдо и при этом
// загонять кассу в минус в середине.
//
// Запуск: npm test (из backend). Требует БД.
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../prisma/prisma-client.js";
import { assertCashForPosting, CashShortageError } from "../services/cashBalance.js";

const TAG = `CASHTEST-${Date.now()}`;
let org = null;

const D = (iso) => new Date(`${iso}T10:00:00.000Z`);

/** Проводка по кассе: приход (in) или расход (out). */
async function entry(kind, date, amount) {
	return prisma.accountingEntry.create({
		data: {
			organizationUuid: org.uuid,
			documentType: "cash_receipt_order",
			documentUuid: `${TAG}-${kind}-${date}-${amount}`,
			date: D(date),
			debitAccountCode: kind === "in" ? "1010" : "3310",
			creditAccountCode: kind === "in" ? "3310" : "1010",
			amount,
			description: TAG,
		},
	});
}

before(async () => {
	org = await prisma.organization.create({
		data: { bin: `9993${String(Date.now()).slice(-8)}`, name: `Касса-тест ${TAG}` },
	});
	// История: 01.03 приход 1000, 20.03 приход 5000.
	await entry("in", "2026-03-01", 1000);
	await entry("in", "2026-03-20", 5000);
});

after(async () => {
	await prisma.accountingEntry.deleteMany({ where: { organizationUuid: org.uuid } });
	await prisma.organization.delete({ where: { uuid: org.uuid } });
});

test("расход в пределах остатка — проходит", async () => {
	await assertCashForPosting("cash_expense_order", null, {
		organizationUuid: org.uuid,
		date: D("2026-03-05"),
		amount: 800,
	});
});

test("расход больше остатка — 409", async () => {
	await assert.rejects(
		() => assertCashForPosting("cash_expense_order", null, {
			organizationUuid: org.uuid,
			date: D("2026-03-05"),
			amount: 1500,
		}),
		CashShortageError,
		"на 05.03 в кассе только 1000 — расход 1500 обязан быть отклонён",
	);
});

test("провал В СЕРЕДИНЕ периода ловится, хотя на конец денег хватает", async () => {
	// На конец периода остаток 6000, и расход 3000 «в целом» проходит. Но на дату
	// 05.03 в кассе всего 1000 — касса провалится в минус и вернётся в плюс 20.03.
	// Проверка конечного сальдо это пропустила бы.
	await assert.rejects(
		() => assertCashForPosting("cash_expense_order", null, {
			organizationUuid: org.uuid,
			date: D("2026-03-05"),
			amount: 3000,
		}),
		CashShortageError,
	);
	// Тот же расход ПОСЛЕ второго прихода — денег хватает, отказа быть не должно.
	await assertCashForPosting("cash_expense_order", null, {
		organizationUuid: org.uuid,
		date: D("2026-03-25"),
		amount: 3000,
	});
});

test("приходный ордер не проверяется — он кассу не уменьшает", async () => {
	await assertCashForPosting("cash_receipt_order", null, {
		organizationUuid: org.uuid,
		date: D("2026-03-05"),
		amount: 999999,
	});
});

test("выплата зарплаты через банк кассу не трогает", async () => {
	await assertCashForPosting("payroll_payment", null, {
		organizationUuid: org.uuid,
		date: D("2026-03-05"),
		amount: 999999,
		paymentMethod: "bank",
	});
	// А наличными — проверяется наравне с расходным ордером.
	await assert.rejects(
		() => assertCashForPosting("payroll_payment", null, {
			organizationUuid: org.uuid,
			date: D("2026-03-05"),
			amount: 999999,
			paymentMethod: "cash",
		}),
		CashShortageError,
	);
});

test("перепроведение не считает собственный расход дважды", async () => {
	// Документ уже проведён на 900 (в кассе было 1000). При повторном проведении
	// той же суммы его прежние проводки обязаны исключаться — иначе выйдет 1800
	// и система откажет в записи документа, который ничего не менял.
	const uuid = `${TAG}-repost`;
	await prisma.accountingEntry.create({
		data: {
			organizationUuid: org.uuid, documentType: "cash_expense_order", documentUuid: uuid,
			date: D("2026-03-05"), debitAccountCode: "3310", creditAccountCode: "1010",
			amount: 900, description: TAG,
		},
	});
	await assertCashForPosting("cash_expense_order", uuid, {
		organizationUuid: org.uuid,
		date: D("2026-03-05"),
		amount: 900,
	});
	await prisma.accountingEntry.deleteMany({ where: { documentUuid: uuid } });
});
