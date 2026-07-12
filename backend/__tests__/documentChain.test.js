// ─────────────────────────────────────────────────────────────────────────────
// Тесты цепочки связанных документов (services/documentChain.js).
//
// Фокус — денежное звено: кассовые ордера (ПКО/РКО) хранятся в ОДНОЙ таблице
// cash_orders и различаются полем `direction`. Проверяем, что оба docType
// (cash_receipt_order/cash_expense_order) попадают в дерево ровно один раз и с
// правильным типом, а обход ВВЕРХ от кассового ордера доходит до основания.
//
// Запуск: npm test  (из backend). Требует доступ к БД и базовые справочники.
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../prisma/prisma-client.js";
import { buildDocumentChain, DOC_REGISTRY } from "../services/documentChain.js";

let fx = {};

before(async () => {
	const [org, user] = await Promise.all([
		prisma.organization.findFirst({ select: { uuid: true } }),
		prisma.user.findFirst({ select: { uuid: true } }),
	]);
	fx = { orgUuid: org?.uuid, userUuid: user?.uuid };
});

after(async () => {
	await prisma.$disconnect();
});

test("Кассовые ордера присутствуют в реестре цепочки", () => {
	assert.ok(DOC_REGISTRY.cash_receipt_order, "ПКО зарегистрирован");
	assert.ok(DOC_REGISTRY.cash_expense_order, "РКО зарегистрирован");
	assert.equal(DOC_REGISTRY.cash_receipt_order.model, "cashOrder");
	assert.equal(DOC_REGISTRY.cash_expense_order.model, "cashOrder");
	// Дискриминатор direction обязателен — иначе одна модель попадёт дважды.
	assert.deepEqual(DOC_REGISTRY.cash_receipt_order.where, { direction: "receipt" });
	assert.deepEqual(DOC_REGISTRY.cash_expense_order.where, { direction: "expense" });
});

test("Цепочка: денежное звено (ПКО/РКО) — дети продажи, без дублей", async (t) => {
	if (!fx.orgUuid || !fx.userUuid) return t.skip("нет фикстур");

	const sale = await prisma.sale.create({
		data: { date: new Date(), organizationUuid: fx.orgUuid, authorUuid: fx.userUuid },
	});
	const receipt = await prisma.cashOrder.create({
		data: {
			direction: "receipt", date: new Date(), amount: 1000, authorUuid: fx.userUuid,
			organizationUuid: fx.orgUuid,
			basisDocumentType: "sale", basisDocumentUuid: sale.uuid, basisDocumentLabel: "Реализация",
		},
	});
	const expense = await prisma.cashOrder.create({
		data: {
			direction: "expense", date: new Date(), amount: 200, authorUuid: fx.userUuid,
			organizationUuid: fx.orgUuid,
			basisDocumentType: "sale", basisDocumentUuid: sale.uuid, basisDocumentLabel: "Реализация (возврат)",
		},
	});

	try {
		const chain = await buildDocumentChain("sale", sale.uuid);
		assert.ok(chain, "цепочка построена");
		assert.equal(chain.root.type, "sale", "продажа — корень (у неё нет основания)");

		const kids = chain.root.children;
		const receiptKids = kids.filter((c) => c.type === "cash_receipt_order");
		const expenseKids = kids.filter((c) => c.type === "cash_expense_order");

		// Каждый ордер ровно один раз — дискриминатор direction не даёт дублей.
		assert.equal(receiptKids.length, 1, "ровно один ПКО-ребёнок (без дубля)");
		assert.equal(expenseKids.length, 1, "ровно один РКО-ребёнок (без дубля)");
		assert.equal(receiptKids[0].uuid, receipt.uuid);
		assert.equal(expenseKids[0].uuid, expense.uuid);
		assert.equal(receiptKids[0].typeLabel, "Приходный кассовый ордер");
		assert.equal(expenseKids[0].typeLabel, "Расходный кассовый ордер");
		// У кассового ордера нет табличной части → сумма берётся из поля amount.
		assert.equal(receiptKids[0].amount, 1000);

		// Обход ВВЕРХ от кассового ордера доходит до продажи-основания.
		const fromCash = await buildDocumentChain("cash_receipt_order", receipt.uuid);
		assert.equal(fromCash.root.type, "sale", "от ПКО поднялись до продажи");
		assert.equal(fromCash.root.uuid, sale.uuid);
		assert.deepEqual(fromCash.target, { type: "cash_receipt_order", uuid: receipt.uuid });
	} finally {
		await prisma.cashOrder.delete({ where: { uuid: receipt.uuid } }).catch(() => {});
		await prisma.cashOrder.delete({ where: { uuid: expense.uuid } }).catch(() => {});
		await prisma.sale.delete({ where: { uuid: sale.uuid } }).catch(() => {});
	}
});
