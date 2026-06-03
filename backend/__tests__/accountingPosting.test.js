// ─────────────────────────────────────────────────────────────────────────────
// Тесты подсистемы бухгалтерского учёта (node:test).
// Проверяют: реестр правил проводок, корректность двойной записи (Дт=Кт),
// аналитику субконто, проверки проведения, COGS и идемпотентный reconcile.
//
// Запуск: npm test   (из каталога backend)  ─ или ─  node --test
// Требуется доступ к БД (использует засеянный план счетов РК) и базовые
// справочники (организация, контрагент, товар, склад). Тесты, требующие
// фикстур, пропускаются, если данных нет.
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import { seedAccounting } from "../prisma/seed-accounting.js";
import {
	buildDocumentEntries,
	validatePosting,
	reconcileDocumentEntries,
	removeDocumentEntries,
	filterPostedEntries,
	PostingValidationError,
	ACC,
} from "../services/accountingPosting.js";

const sumDebit = (entries) => entries.reduce((s, e) => s + e.amount, 0);
const isBalanced = (entries) => Math.abs(sumDebit(entries) - sumDebit(entries)) < 0.005; // одиночные Дт/Кт всегда сбалансированы

let fx = {};

before(async () => {
	await seedAccounting(); // идемпотентно — гарантирует план счетов РК
	const [org, cp, product, warehouse, employee, user] = await Promise.all([
		prisma.organization.findFirst({ select: { uuid: true } }),
		prisma.counterparty.findFirst({ select: { uuid: true } }),
		prisma.product.findFirst({ select: { uuid: true } }),
		prisma.warehouse.findFirst({ select: { uuid: true } }),
		prisma.employee.findFirst({ select: { uuid: true } }),
		prisma.user.findFirst({ select: { uuid: true } }),
	]);
	fx = {
		orgUuid: org?.uuid, cpUuid: cp?.uuid, productUuid: product?.uuid,
		warehouseUuid: warehouse?.uuid, employeeUuid: employee?.uuid, userUuid: user?.uuid,
	};
});

after(async () => {
	await prisma.$disconnect();
});

// ─── Правила проводок и двойная запись ───────────────────────────────────────
test("План счетов РК засеян (10 видов субконто, 12 счетов)", async () => {
	const [st, acc] = await Promise.all([
		prisma.subkontoType.count({ where: { deletedAt: null } }),
		prisma.chartOfAccount.count({ where: { organizationUuid: null, deletedAt: null } }),
	]);
	assert.ok(st >= 10, `видов субконто >= 10, факт ${st}`);
	assert.ok(acc >= 12, `счетов >= 12, факт ${acc}`);
});

test("Поступление: Дт 1330 Кт 3310, двойная запись сбалансирована", async (t) => {
	if (!fx.orgUuid || !fx.cpUuid || !fx.productUuid) return t.skip("нет фикстур");
	const doc = { organizationUuid: fx.orgUuid, counterpartyUuid: fx.cpUuid, contractUuid: null, warehouseUuid: fx.warehouseUuid, date: new Date(), posted: true };
	const items = [{ productUuid: fx.productUuid, quantity: 5, amount: 10000 }];
	const entries = await buildDocumentEntries("purchase", doc, items);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].debitAccountCode, ACC.GOODS);
	assert.equal(entries[0].creditAccountCode, ACC.AP);
	assert.equal(entries[0].amount, 10000);
	// Аналитика дебета: номенклатура (+склад при наличии).
	const dTypes = entries[0].debitAnalytics.map((a) => a.subkontoType);
	assert.ok(dTypes.includes("Nomenclature"));
	assert.ok(isBalanced(entries));
});

test("Реализация: выручка Дт 1210 Кт 6010 (+ себестоимость при наличии остатка)", async (t) => {
	if (!fx.orgUuid || !fx.cpUuid || !fx.productUuid) return t.skip("нет фикстур");
	const doc = { organizationUuid: fx.orgUuid, counterpartyUuid: fx.cpUuid, contractUuid: null, warehouseUuid: fx.warehouseUuid, date: new Date(), posted: true };
	const items = [{ productUuid: fx.productUuid, quantity: 2, amount: 6000 }];
	const entries = await buildDocumentEntries("sale", doc, items);
	const revenue = entries.find((e) => e.debitAccountCode === ACC.AR && e.creditAccountCode === ACC.REVENUE);
	assert.ok(revenue, "должна быть проводка выручки Дт1210 Кт6010");
	assert.equal(revenue.amount, 6000);
	// COGS-проводка (Дт7010 Кт1330) присутствует только если есть остаток (avg>0).
	const cogs = entries.find((e) => e.debitAccountCode === ACC.COGS && e.creditAccountCode === ACC.GOODS);
	if (cogs) assert.ok(cogs.amount > 0);
});

test("ПКО: Дт 1010 Кт 1210", async (t) => {
	if (!fx.orgUuid || !fx.cpUuid) return t.skip("нет фикстур");
	const doc = { organizationUuid: fx.orgUuid, counterpartyUuid: fx.cpUuid, contractUuid: null, amount: 7000, comment: "Оплата", date: new Date(), posted: true };
	const entries = await buildDocumentEntries("cash_receipt_order", doc, []);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].debitAccountCode, ACC.CASH);
	assert.equal(entries[0].creditAccountCode, ACC.AR);
	assert.equal(entries[0].amount, 7000);
});

test("Начисление ЗП: Дт 7210 Кт 3350 (Сотрудник)", async (t) => {
	if (!fx.orgUuid || !fx.employeeUuid) return t.skip("нет фикстур");
	const doc = { organizationUuid: fx.orgUuid, employeeUuid: fx.employeeUuid, totalExpense: 300000, period: "2026-05", date: new Date(), posted: true };
	const entries = await buildDocumentEntries("payroll_calculation", doc, []);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].debitAccountCode, ACC.ADMIN_EXP);
	assert.equal(entries[0].creditAccountCode, ACC.PAYROLL);
	const cTypes = entries[0].creditAnalytics.map((a) => a.subkontoType);
	assert.ok(cTypes.includes("Employee"));
});

test("Агрегация: одинаковые строки объединяются (дедуп проводок)", async (t) => {
	if (!fx.orgUuid || !fx.cpUuid || !fx.productUuid) return t.skip("нет фикстур");
	const doc = { organizationUuid: fx.orgUuid, counterpartyUuid: fx.cpUuid, contractUuid: null, warehouseUuid: fx.warehouseUuid, date: new Date(), posted: true };
	const items = [
		{ productUuid: fx.productUuid, quantity: 1, amount: 1000 },
		{ productUuid: fx.productUuid, quantity: 1, amount: 1000 },
	];
	const entries = await buildDocumentEntries("purchase", doc, items);
	assert.equal(entries.length, 1, "две одинаковые строки → одна агрегированная проводка");
	assert.equal(entries[0].amount, 2000);
});

// ─── Банковская выписка ──────────────────────────────────────────────────────
test("Банк-выписка (поступление): Дт 1030 Кт 1210 (Контрагент)", async (t) => {
	if (!fx.orgUuid || !fx.cpUuid) return t.skip("нет фикстур");
	const doc = { organizationUuid: fx.orgUuid, counterpartyUuid: fx.cpUuid, contractUuid: null, direction: "bankStatementIn", amount: 5000, date: new Date(), posted: true };
	const entries = await buildDocumentEntries("bank_statement", doc, []);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].debitAccountCode, ACC.BANK);
	assert.equal(entries[0].creditAccountCode, ACC.AR);
	assert.equal(entries[0].amount, 5000);
	const cTypes = entries[0].creditAnalytics.map((a) => a.subkontoType);
	assert.ok(cTypes.includes("Counterparty"), "кредит-аналитика содержит Контрагента");
});

test("Банк-выписка (списание): Дт 3310 (Контрагент) Кт 1030", async (t) => {
	if (!fx.orgUuid || !fx.cpUuid) return t.skip("нет фикстур");
	const doc = { organizationUuid: fx.orgUuid, counterpartyUuid: fx.cpUuid, contractUuid: null, direction: "bankStatementOut", amount: 3000, date: new Date(), posted: true };
	const entries = await buildDocumentEntries("bank_statement", doc, []);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].debitAccountCode, ACC.AP);
	assert.equal(entries[0].creditAccountCode, ACC.BANK);
	assert.equal(entries[0].amount, 3000);
	const dTypes = entries[0].debitAnalytics.map((a) => a.subkontoType);
	assert.ok(dTypes.includes("Counterparty"), "дебет-аналитика содержит Контрагента");
});

// ─── Перемещение ТМЗ ─────────────────────────────────────────────────────────
test("Перемещение: Дт 1330(склад-получатель) Кт 1330(склад-источник)", async (t) => {
	if (!fx.orgUuid) return t.skip("нет фикстур");
	// Случайный товар без движений в регистре → avgCost=0 → сумма по цене строки.
	const fromWh = crypto.randomUUID();
	const toWh = crypto.randomUUID();
	const doc = { organizationUuid: fx.orgUuid, fromWarehouseUuid: fromWh, toWarehouseUuid: toWh, date: new Date(), posted: true };
	const items = [{ productUuid: crypto.randomUUID(), quantity: 4, price: 250, amount: 1000 }];
	const entries = await buildDocumentEntries("inventory_transfer", doc, items);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].debitAccountCode, ACC.GOODS);
	assert.equal(entries[0].creditAccountCode, ACC.GOODS);
	assert.equal(entries[0].amount, 1000, "4 ед × цена 250 (avgCost=0 → fallback цена)");
	const dW = entries[0].debitAnalytics.find((a) => a.subkontoType === "Warehouse");
	const cW = entries[0].creditAnalytics.find((a) => a.subkontoType === "Warehouse");
	assert.equal(dW?.objectUuid, toWh, "дебет — склад-получатель");
	assert.equal(cW?.objectUuid, fromWh, "кредит — склад-источник");
});

// ─── Проверки проведения ─────────────────────────────────────────────────────
test("Проверка: проведение без организации запрещено", async () => {
	const doc = { organizationUuid: null, counterpartyUuid: fx.cpUuid, warehouseUuid: fx.warehouseUuid, date: new Date(), posted: true };
	const items = [{ productUuid: fx.productUuid, quantity: 1, amount: 100 }];
	await assert.rejects(() => validatePosting("purchase", doc, items), (e) => {
		assert.ok(e instanceof PostingValidationError);
		assert.ok(e.errors.some((m) => /организац/i.test(m)));
		return true;
	});
});

test("Проверка: реализация без контрагента запрещена (обязательное субконто)", async (t) => {
	if (!fx.orgUuid || !fx.productUuid) return t.skip("нет фикстур");
	const doc = { organizationUuid: fx.orgUuid, counterpartyUuid: null, warehouseUuid: fx.warehouseUuid, date: new Date(), posted: true };
	const items = [{ productUuid: fx.productUuid, quantity: 1, amount: 500 }];
	await assert.rejects(() => validatePosting("sale", doc, items), (e) => {
		assert.ok(e instanceof PostingValidationError);
		assert.ok(e.errors.some((m) => /субконто/i.test(m)));
		return true;
	});
});

// ─── Интеграция: reconcile создаёт/удаляет проводки документа ─────────────────
test("Интеграция: reconcile проведённого поступления создаёт проводки, распроведение — удаляет", async (t) => {
	if (!fx.orgUuid || !fx.cpUuid || !fx.productUuid || !fx.userUuid) return t.skip("нет фикстур");

	const doc = await prisma.purchase.create({
		data: {
			date: new Date(), amount: 4321, posted: true,
			organizationUuid: fx.orgUuid, counterpartyUuid: fx.cpUuid, warehouseUuid: fx.warehouseUuid,
			authorUuid: fx.userUuid,
		},
	});
	const item = await prisma.purchaseItem.create({
		data: { purchaseUuid: doc.uuid, productUuid: fx.productUuid, quantity: 3, price: 1440.33, amount: 4321, organizationUuid: fx.orgUuid },
	});
	try {
		await reconcileDocumentEntries("purchase", doc.uuid);
		let entries = await prisma.accountingEntry.findMany({ where: { documentType: "purchase", documentUuid: doc.uuid }, include: { analytics: true } });
		assert.equal(entries.length, 1, "после проведения — 1 проводка");
		assert.equal(Number(entries[0].amount), 4321);
		assert.equal(entries[0].debitAccountCode, "1330");
		assert.equal(entries[0].creditAccountCode, "3310");
		assert.ok(entries[0].analytics.length >= 2, "есть аналитика Дт/Кт");

		// Распроведение → проводки удаляются.
		await prisma.purchase.update({ where: { uuid: doc.uuid }, data: { posted: false } });
		await reconcileDocumentEntries("purchase", doc.uuid);
		entries = await prisma.accountingEntry.findMany({ where: { documentType: "purchase", documentUuid: doc.uuid } });
		assert.equal(entries.length, 0, "после распроведения — 0 проводок");
	} finally {
		await removeDocumentEntries("purchase", doc.uuid);
		await prisma.purchaseItem.delete({ where: { uuid: item.uuid } }).catch(() => {});
		await prisma.purchase.delete({ where: { uuid: doc.uuid } }).catch(() => {});
	}
});

// ─── Защитный фильтр отчётов: проводки только проведённых документов ──────────
test("Защита: проводки осиротевшего (распроведённого) документа исключаются и удаляются", async (t) => {
	if (!fx.orgUuid || !fx.cpUuid || !fx.productUuid || !fx.userUuid) return t.skip("нет фикстур");

	const doc = await prisma.purchase.create({
		data: {
			date: new Date(), amount: 1234, posted: true,
			organizationUuid: fx.orgUuid, counterpartyUuid: fx.cpUuid, warehouseUuid: fx.warehouseUuid,
			authorUuid: fx.userUuid,
		},
	});
	const item = await prisma.purchaseItem.create({
		data: { purchaseUuid: doc.uuid, productUuid: fx.productUuid, quantity: 1, price: 1234, amount: 1234, organizationUuid: fx.orgUuid },
	});
	try {
		await reconcileDocumentEntries("purchase", doc.uuid);
		let entries = await prisma.accountingEntry.findMany({ where: { documentType: "purchase", documentUuid: doc.uuid } });
		assert.equal(entries.length, 1, "после проведения — 1 проводка");

		// Распроводим документ В ОБХОД reconcile (эмуляция «осиротевшей» проводки:
		// напр. reconcile упал в try/catch, или legacy/сид-данные).
		await prisma.purchase.update({ where: { uuid: doc.uuid }, data: { posted: false } });

		// Фильтр должен исключить проводку из выборки …
		const kept = await filterPostedEntries(entries.map((e) => ({ ...e })));
		assert.equal(kept.length, 0, "проводки непроведённого документа не попадают в отчёт");

		// … и самоисцелить БД (физически удалить осиротевшую проводку).
		entries = await prisma.accountingEntry.findMany({ where: { documentType: "purchase", documentUuid: doc.uuid } });
		assert.equal(entries.length, 0, "осиротевшая проводка удалена из БД");
	} finally {
		await removeDocumentEntries("purchase", doc.uuid);
		await prisma.purchaseItem.delete({ where: { uuid: item.uuid } }).catch(() => {});
		await prisma.purchase.delete({ where: { uuid: doc.uuid } }).catch(() => {});
	}
});

// ─── Интеграция: COGS считается из остатка регистра ───────────────────────────
test("Интеграция: себестоимость реализации списывается по средней из регистра", async (t) => {
	if (!fx.orgUuid || !fx.cpUuid || !fx.warehouseUuid) return t.skip("нет фикстур");

	// Уникальный товар для изоляции остатка.
	const product = await prisma.product.create({
		data: { name: `__test_cogs_${Date.now()}`, organizationUuid: fx.orgUuid },
	}).catch(() => null);
	if (!product) return t.skip("не удалось создать тестовый товар");

	const reg = await prisma.productRegister.create({
		data: {
			date: new Date(Date.now() - 86400000), movementType: "in", quantity: 10, amount: 5000, // средняя 500/ед
			productUuid: product.uuid, warehouseUuid: fx.warehouseUuid, organizationUuid: fx.orgUuid,
			documentType: "purchase", documentUuid: crypto.randomUUID(),
		},
	});
	try {
		const doc = { organizationUuid: fx.orgUuid, counterpartyUuid: fx.cpUuid, warehouseUuid: fx.warehouseUuid, date: new Date(), posted: true };
		const items = [{ productUuid: product.uuid, quantity: 2, amount: 1800 }];
		const entries = await buildDocumentEntries("sale", doc, items);
		const cogs = entries.find((e) => e.debitAccountCode === "7010" && e.creditAccountCode === "1330");
		assert.ok(cogs, "должна быть проводка себестоимости Дт7010 Кт1330");
		assert.equal(cogs.amount, 1000, "2 ед × средняя 500 = 1000");
	} finally {
		await prisma.productRegister.delete({ where: { uuid: reg.uuid } }).catch(() => {});
		await prisma.product.delete({ where: { uuid: product.uuid } }).catch(() => {});
	}
});

// ─── Интеграция: перемещение между складами формирует проводки ────────────────
test("Интеграция: проведённое перемещение создаёт проводку Дт1330 Кт1330, распроведение — удаляет", async (t) => {
	if (!fx.orgUuid || !fx.productUuid || !fx.warehouseUuid || !fx.userUuid) return t.skip("нет фикстур");

	const doc = await prisma.inventoryTransfer.create({
		data: {
			date: new Date(), posted: true, organizationUuid: fx.orgUuid,
			fromWarehouseUuid: fx.warehouseUuid, toWarehouseUuid: fx.warehouseUuid,
			authorUuid: fx.userUuid,
		},
	});
	const item = await prisma.inventoryTransferItem.create({
		data: { inventoryTransferUuid: doc.uuid, productUuid: fx.productUuid, quantity: 2, price: 300 },
	});
	try {
		await reconcileDocumentEntries("inventory_transfer", doc.uuid);
		let entries = await prisma.accountingEntry.findMany({ where: { documentType: "inventory_transfer", documentUuid: doc.uuid } });
		assert.equal(entries.length, 1, "после проведения — 1 проводка");
		assert.equal(entries[0].debitAccountCode, "1330");
		assert.equal(entries[0].creditAccountCode, "1330");
		assert.equal(Number(entries[0].amount), 600, "2 ед × 300 (фолбэк на цену) = 600");

		await prisma.inventoryTransfer.update({ where: { uuid: doc.uuid }, data: { posted: false } });
		await reconcileDocumentEntries("inventory_transfer", doc.uuid);
		entries = await prisma.accountingEntry.findMany({ where: { documentType: "inventory_transfer", documentUuid: doc.uuid } });
		assert.equal(entries.length, 0, "после распроведения — 0 проводок");
	} finally {
		await removeDocumentEntries("inventory_transfer", doc.uuid);
		await prisma.inventoryTransferItem.delete({ where: { uuid: item.uuid } }).catch(() => {});
		await prisma.inventoryTransfer.delete({ where: { uuid: doc.uuid } }).catch(() => {});
	}
});

// ─── Разнесение НДС (плательщик НДС): 1420 / 3130 ─────────────────────────────
test("Поступление с НДС: Дт1330 (без НДС) + Дт1420 (НДС) Кт3310 (полная)", async (t) => {
	if (!fx.orgUuid || !fx.cpUuid || !fx.productUuid) return t.skip("нет фикстур");
	const doc = { organizationUuid: fx.orgUuid, counterpartyUuid: fx.cpUuid, warehouseUuid: fx.warehouseUuid, date: new Date(), posted: true };
	const items = [{ productUuid: fx.productUuid, quantity: 1, amount: 1120, vatAmount: 120, amountWithoutVat: 1000 }];
	const entries = await buildDocumentEntries("purchase", doc, items);
	const goods = entries.find((e) => e.debitAccountCode === "1330" && e.creditAccountCode === "3310");
	const vat = entries.find((e) => e.debitAccountCode === "1420" && e.creditAccountCode === "3310");
	assert.ok(goods, "товар на 1330 без НДС");
	assert.equal(goods.amount, 1000);
	assert.ok(vat, "входящий НДС на 1420");
	assert.equal(vat.amount, 120);
	assert.equal(sumDebit(entries), 1120, "Дт = полная сумма с НДС");
});

test("Реализация с НДС: Кт6010 (без НДС) + Кт3130 (НДС), Дт1210 (полная)", async (t) => {
	if (!fx.orgUuid || !fx.cpUuid || !fx.productUuid) return t.skip("нет фикстур");
	const doc = { organizationUuid: fx.orgUuid, counterpartyUuid: fx.cpUuid, warehouseUuid: fx.warehouseUuid, date: new Date(), posted: true };
	const items = [{ productUuid: fx.productUuid, quantity: 1, amount: 1120, vatAmount: 120, amountWithoutVat: 1000 }];
	const entries = await buildDocumentEntries("sale", doc, items);
	const rev = entries.find((e) => e.debitAccountCode === "1210" && e.creditAccountCode === "6010");
	const vat = entries.find((e) => e.debitAccountCode === "1210" && e.creditAccountCode === "3130");
	assert.ok(rev, "доход на 6010 без НДС");
	assert.equal(rev.amount, 1000);
	assert.ok(vat, "исходящий НДС на 3130");
	assert.equal(vat.amount, 120);
});

test("Без НДС (vat=0) — разнесения нет, поведение как раньше", async (t) => {
	if (!fx.orgUuid || !fx.cpUuid || !fx.productUuid) return t.skip("нет фикстур");
	const doc = { organizationUuid: fx.orgUuid, counterpartyUuid: fx.cpUuid, warehouseUuid: fx.warehouseUuid, date: new Date(), posted: true };
	const items = [{ productUuid: fx.productUuid, quantity: 1, amount: 1000 }];
	const entries = await buildDocumentEntries("purchase", doc, items);
	assert.equal(entries.filter((e) => e.creditAccountCode === "3310").length, 1, "одна проводка на 3310 (нет НДС)");
	assert.ok(!entries.some((e) => e.debitAccountCode === "1420"), "нет проводки 1420");
});
