import { test } from "node:test";
import assert from "node:assert/strict";
import { recomputeCosting } from "../services/recomputeCosting.js";

// Мок-клиент: все findMany возвращают [] (документов нет) → reconcile-функции не
// вызываются; проверяем КАК формируется выборка (scope) и что обе фазы прошли.
function mockClient(calls) {
	const tableNames = [
		"purchase", "sale", "inventoryTransfer", "saleReturn", "purchaseReturn",
		"cashReceiptOrder", "cashExpenseOrder", "bankStatement", "payrollCalculation", "payrollPayment",
	];
	const c = {};
	for (const t of tableNames) {
		c[t] = { findMany: async ({ where }) => { calls.push({ table: t, where }); return []; } };
	}
	return c;
}

test("recomputeCosting: применяет org+dateFilter ко всем выборкам и проходит обе фазы", async () => {
	const calls = [];
	const dateFilter = { gt: new Date("2026-05-31") };
	const res = await recomputeCosting({ organizationUuid: "org1", dateFilter }, mockClient(calls));

	assert.deepEqual(res, { registers: 0, entries: 0 }, "нет документов → нули");
	assert.ok(calls.length > 0, "были выборки документов");
	for (const { where } of calls) {
		assert.equal(where.posted, true, "только проведённые");
		assert.equal(where.deletedAt, null, "не удалённые");
		assert.equal(where.organizationUuid, "org1", "ограничено организацией");
		assert.equal(where.date, dateFilter, "применён dateFilter (не трогаем закрытый период)");
	}
	// Обе фазы: sale присутствует и в регистре, и в проводках → ≥2 выборки sale.
	assert.ok(calls.filter((x) => x.table === "sale").length >= 2, "sale обработан в обеих фазах");
});

test("recomputeCosting: без dateFilter — без ограничения по дате", async () => {
	const calls = [];
	await recomputeCosting({ organizationUuid: "org1" }, mockClient(calls));
	for (const { where } of calls) assert.equal("date" in where, false, "поле date не задано");
});
