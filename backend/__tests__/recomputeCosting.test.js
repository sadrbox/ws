import { test } from "node:test";
import assert from "node:assert/strict";
import {
	recomputeCosting,
	unmappedDocTypes,
	scheduleRecompute,
	_setRecomputeLockRunner,
	costingFieldsChanged,
	recomputeIfRetroactive,
	recomputeLockName,
} from "../services/recomputeCosting.js";
import { REGISTER_DOC_TYPES } from "../services/productRegister.js";
import { POSTING_DOC_TYPES } from "../services/accountingPosting.js";

// Мок-клиент: все findMany возвращают [] (документов нет) → reconcile-функции не
// вызываются; проверяем КАК формируется выборка (scope) и что обе фазы прошли.
function mockClient(calls) {
	const tableNames = [
		"purchase", "sale", "inventoryTransfer", "saleReturn", "purchaseReturn",
		"importDeclaration", "writeOff", "goodsReceipt",
		"cashOrder", "bankStatement", "payrollCalculation", "payrollPayment", "monthClose",
	];
	const c = {};
	for (const t of tableNames) {
		c[t] = { findMany: async ({ where }) => { calls.push({ table: t, where }); return []; } };
	}
	// ПОЛНЫЙ пересчёт (без dateFilter) перестраивает и закрытую историю → сбрасывает
	// снапшоты себестоимости и заново материализует их на границе закрытого периода.
	// Мок обязан отражать эти модели, иначе тест падает не по существу проверки.
	c.productCostSnapshot = {
		deleteMany: async () => ({ count: 0 }),
		createMany: async () => ({ count: 0 }),
		findFirst: async () => null,
	};
	c.productRegister = { findMany: async () => [] };
	// Закрытий нет → граница null → снапшоты не строятся.
	c.monthClose.aggregate = async () => ({ _max: { periodEnd: null } });
	return c;
}

test("recomputeCosting: применяет org+dateFilter ко всем выборкам и проходит обе фазы", async () => {
	const calls = [];
	const dateFilter = { gt: new Date("2026-05-31") };
	const res = await recomputeCosting({ organizationUuid: "org1", dateFilter }, mockClient(calls));

	assert.deepEqual(res, { registers: 0, entries: 0 }, "нет документов → нули");
	assert.ok(calls.length > 0, "были выборки документов");
	for (const { table, where } of calls) {
		assert.equal(where.posted, true, "только проведённые");
		assert.equal(where.deletedAt, null, "не удалённые");
		assert.equal(where.organizationUuid, "org1", "ограничено организацией");
		// Закрытие месяца отбирается по концу периода (его проводки датированы концом
		// периода — аудит 26.09, У6), остальные — по дате документа.
		const field = table === "monthClose" ? "periodEnd" : "date";
		assert.equal(where[field], dateFilter, "применён dateFilter (не трогаем закрытый период)");
	}
	// Обе фазы: sale присутствует и в регистре, и в проводках → ≥2 выборки sale.
	assert.ok(calls.filter((x) => x.table === "sale").length >= 2, "sale обработан в обеих фазах");
});

test("recomputeCosting: без dateFilter — без ограничения по дате", async () => {
	const calls = [];
	await recomputeCosting({ organizationUuid: "org1" }, mockClient(calls));
	for (const { where } of calls) {
		assert.equal("date" in where, false, "поле date не задано");
		assert.equal("periodEnd" in where, false, "поле periodEnd не задано");
	}
});

test("ПКО и РКО делят модель cashOrder и различаются по direction", async () => {
	const calls = [];
	await recomputeCosting({}, mockClient(calls));
	const cash = calls.filter((c) => c.table === "cashOrder");
	assert.ok(cash.length >= 2, "cashOrder выбирается для ПКО и РКО");
	const directions = new Set(cash.map((c) => c.where.direction));
	assert.deepEqual([...directions].sort(), ["expense", "receipt"],
		"без фильтра direction расходный ордер пересчитался бы по правилу приходного");
});

// Пересчёт молча пропускает типы, которых нет в его карте моделей. Именно так
// кассовые ордера не пересчитывались: карта ссылалась на несуществующие модели
// cashReceiptOrder/cashExpenseOrder вместо cashOrder. Страж ловит рассинхрон при
// добавлении нового документа-регистратора.
test("recomputeCosting знает про ВСЕ документы-регистраторы и все правила проводок", () => {
	const missing = unmappedDocTypes();
	assert.deepEqual(missing, [],
		`Типы без модели в recomputeCosting (их себестоимость/проводки не пересчитываются): ${missing.join(", ")}`);
});

test("складские документы зарегистрированы в регистре и в проводках", () => {
	for (const t of ["write_off", "goods_receipt", "import_declaration", "inventory_transfer"]) {
		assert.ok(REGISTER_DOC_TYPES.includes(t), `${t} нет в REGISTER_DOC_TYPES`);
		assert.ok(POSTING_DOC_TYPES.includes(t), `${t} нет в POSTING_DOC_TYPES`);
	}
});

// ─── Аудит 26.09: пересчёт по организации, в фоне, с объединением запросов ─────


test("фоновый пересчёт: запросы объединяются от самой ранней даты, организации не мешают друг другу", async () => {
	const runs = [];
	_setRecomputeLockRunner(async (name, run) => { runs.push(name); return run(); });
	try {
		const calls = [];
		const client = mockClient(calls);
		const pA = scheduleRecompute("orgA", new Date("2026-06-10"), client);
		scheduleRecompute("orgA", new Date("2026-06-05"), client); // слился с первым
		const pB = scheduleRecompute("orgB", new Date("2026-06-07"), client);
		await Promise.all([pA, pB]);
		assert.ok(runs.includes(recomputeLockName("orgA")) && runs.includes(recomputeLockName("orgB")), "B не отменён пересчётом A");
		const aDates = calls.filter((c) => c.where.organizationUuid === "orgA" && c.table === "sale").map((c) => c.where.date.gte.toISOString());
		assert.ok(aDates.includes(new Date("2026-06-05").toISOString()), "проход A — от самой ранней даты");
	} finally {
		_setRecomputeLockRunner(null);
	}
});

test("фоновый пересчёт: лок занят другим воркером — повтор, а не потеря запроса", async () => {
	let attempts = 0;
	_setRecomputeLockRunner(async (_name, run) => { attempts++; return attempts === 1 ? undefined : run(); });
	const orig = globalThis.setTimeout;
	globalThis.setTimeout = (fn) => orig(fn, 0); // не ждать RETRY_MS в тесте
	try {
		await scheduleRecompute("orgC", new Date("2026-06-01"), mockClient([]));
		assert.equal(attempts, 2);
	} finally {
		globalThis.setTimeout = orig;
		_setRecomputeLockRunner(null);
	}
});

test("costingFieldsChanged: комментарий и номер не запускают пересчёт, дата и склад — запускают", () => {
	const ex = { date: new Date("2026-06-01"), posted: true, warehouseUuid: "w1", comment: "a" };
	assert.equal(costingFieldsChanged(ex, { comment: "b", number: "7" }), false);
	assert.equal(costingFieldsChanged(ex, { date: new Date("2026-06-01") }), false);
	assert.equal(costingFieldsChanged(ex, { date: new Date("2026-06-02") }), true);
	assert.equal(costingFieldsChanged(ex, { warehouseUuid: "w2" }), true);
});

test("recomputeIfRetroactive: не ретроактив — пересчёта нет; changed=false — даже без запроса", async () => {
	const client = { productRegister: { findFirst: async () => null } };
	assert.equal((await recomputeIfRetroactive({ organizationUuid: "o", date: new Date() }, client)).reason, "not_retroactive");
	assert.equal((await recomputeIfRetroactive({ organizationUuid: "o", date: new Date(), changed: false }, client)).reason, "not_changed");
});
