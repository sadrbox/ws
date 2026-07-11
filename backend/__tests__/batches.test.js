import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import {
	orderBatchesFEFO, findOrCreateBatch, warehouseBatchBalances, availableBatchesFEFO, assertBatchStock,
} from "../services/batches.js";

test("orderBatchesFEFO: раньше истекает — раньше; без срока — последними", () => {
	const b = [
		{ batchNumber: "C", expiryDate: null },
		{ batchNumber: "A", expiryDate: "2026-12-01" },
		{ batchNumber: "B", expiryDate: "2026-06-01" },
		{ batchNumber: "D", expiryDate: null },
	];
	const order = orderBatchesFEFO(b).map((x) => x.batchNumber);
	assert.deepEqual(order, ["B", "A", "C", "D"], "B(июнь)<A(дек)<C,D(без срока по номеру)");
});

test("orderBatchesFEFO: не мутирует исходный массив", () => {
	const src = [{ batchNumber: "X", expiryDate: "2027-01-01" }, { batchNumber: "Y", expiryDate: "2026-01-01" }];
	const copy = [...src];
	orderBatchesFEFO(src);
	assert.deepEqual(src, copy);
});

test("assertBatchStock: списание больше остатка — ошибка", () => {
	assert.deepEqual(assertBatchStock([{ batchNumber: "L1", requested: 3, available: 5 }]), { ok: true, errors: [] });
	const bad = assertBatchStock([{ batchNumber: "L1", requested: 6, available: 5 }]);
	assert.equal(bad.ok, false);
	assert.match(bad.errors[0], /L1/);
	// на границе (равно) — ок
	assert.equal(assertBatchStock([{ batchNumber: "L", requested: 5, available: 5 }]).ok, true);
});

// ── Интеграция: остатки и FEFO из регистра ───────────────────────────────────
test("остатки по партиям и availableBatchesFEFO из движений регистра", async (t) => {
	const org = await prisma.organization.findFirst({ select: { uuid: true } });
	const wh = await prisma.warehouse.findFirst({ select: { uuid: true } });
	if (!org || !wh) return t.skip("нет фикстур");
	const product = await prisma.product.create({ data: { name: `BATCH-${crypto.randomUUID().slice(0, 8)}`, trackBatches: true } });
	const mkReg = (batchUuid, type, qty) => prisma.productRegister.create({ data: {
		date: new Date(), movementType: type, quantity: qty, amount: qty * 100,
		productUuid: product.uuid, warehouseUuid: wh.uuid, organizationUuid: org.uuid,
		documentType: "goods_receipt", documentUuid: crypto.randomUUID(), batchUuid,
	} });
	try {
		// Партия L2 истекает раньше L1.
		const b1 = await findOrCreateBatch({ productUuid: product.uuid, batchNumber: "L1", expiryDate: "2026-12-01", organizationUuid: org.uuid });
		const b2 = await findOrCreateBatch({ productUuid: product.uuid, batchNumber: "L2", expiryDate: "2026-06-01", organizationUuid: org.uuid });
		// L1: +10 −3 = 7; L2: +5 = 5.
		await mkReg(b1.uuid, "in", 10);
		await mkReg(b1.uuid, "out", 3);
		await mkReg(b2.uuid, "in", 5);

		const bal = await warehouseBatchBalances({ organizationUuid: org.uuid, warehouseUuid: wh.uuid, productUuid: product.uuid });
		assert.equal(bal.get(b1.uuid), 7);
		assert.equal(bal.get(b2.uuid), 5);

		// FEFO: L2 (июнь) раньше L1 (декабрь).
		const fefo = await availableBatchesFEFO({ organizationUuid: org.uuid, warehouseUuid: wh.uuid, productUuid: product.uuid });
		assert.deepEqual(fefo.map((x) => x.batchNumber), ["L2", "L1"]);
		assert.equal(fefo[0].quantity, 5);

		// Полностью выбывшая партия в остатки не попадает.
		await mkReg(b2.uuid, "out", 5); // L2 → 0
		const bal2 = await warehouseBatchBalances({ organizationUuid: org.uuid, warehouseUuid: wh.uuid, productUuid: product.uuid });
		assert.equal(bal2.has(b2.uuid), false, "нулевая партия исключена");
		assert.equal(bal2.get(b1.uuid), 7);
	} finally {
		await prisma.productRegister.deleteMany({ where: { productUuid: product.uuid } });
		await prisma.productBatch.deleteMany({ where: { productUuid: product.uuid } });
		await prisma.product.delete({ where: { uuid: product.uuid } });
	}
});

test("findOrCreateBatch: идемпотентность + уточнение срока годности", async (t) => {
	const org = await prisma.organization.findFirst({ select: { uuid: true } });
	if (!org) return t.skip("нет организации");
	const product = await prisma.product.create({ data: { name: `BATCH2-${crypto.randomUUID().slice(0, 8)}`, trackBatches: true } });
	try {
		const b1 = await findOrCreateBatch({ productUuid: product.uuid, batchNumber: "P1", organizationUuid: org.uuid });
		const b2 = await findOrCreateBatch({ productUuid: product.uuid, batchNumber: "P1", expiryDate: "2027-01-01", organizationUuid: org.uuid });
		assert.equal(b1.uuid, b2.uuid, "тот же номер → та же партия");
		assert.ok(b2.expiryDate, "срок годности уточнён при повторной приёмке");
		assert.equal(await prisma.productBatch.count({ where: { productUuid: product.uuid } }), 1);
	} finally {
		await prisma.productBatch.deleteMany({ where: { productUuid: product.uuid } });
		await prisma.product.delete({ where: { uuid: product.uuid } });
	}
});

import { assertDocumentBatches, BatchValidationError, findOrCreateBatch as foc } from "../services/batches.js";

test("assertDocumentBatches: приёмка требует назначенную партию", async (t) => {
	const org = await prisma.organization.findFirst({ select: { uuid: true } });
	const user = await prisma.user.findFirst({ select: { uuid: true } });
	const wh = await prisma.warehouse.findFirst({ select: { uuid: true } });
	if (!org || !user || !wh) return t.skip("нет фикстур");
	const product = await prisma.product.create({ data: { name: `BV-${crypto.randomUUID().slice(0, 8)}`, trackBatches: true } });
	const gr = await prisma.goodsReceipt.create({ data: { number: `ОПРХ-BV-${Date.now()}`, date: new Date(), organizationUuid: org.uuid, warehouseUuid: wh.uuid, authorUuid: user.uuid, posted: false } });
	const item = await prisma.goodsReceiptItem.create({ data: { goodsReceiptUuid: gr.uuid, productUuid: product.uuid, quantity: 5, price: 100, amount: 500, organizationUuid: org.uuid } });
	try {
		const args = { docType: "goods_receipt", docUuid: gr.uuid, itemModel: "goodsReceiptItem", parentField: "goodsReceiptUuid" };
		// без партии — ошибка
		await assert.rejects(() => assertDocumentBatches(args), (e) => e instanceof BatchValidationError);
		// с партией — ок
		const b = await foc({ productUuid: product.uuid, batchNumber: "LOT-1", expiryDate: "2027-01-01", organizationUuid: org.uuid });
		await prisma.goodsReceiptItem.update({ where: { uuid: item.uuid }, data: { batchUuid: b.uuid } });
		await assert.doesNotReject(() => assertDocumentBatches(args));
	} finally {
		await prisma.goodsReceiptItem.deleteMany({ where: { goodsReceiptUuid: gr.uuid } });
		await prisma.goodsReceipt.delete({ where: { uuid: gr.uuid } });
		await prisma.productBatch.deleteMany({ where: { productUuid: product.uuid } });
		await prisma.product.delete({ where: { uuid: product.uuid } });
	}
});

test("assertDocumentBatches: выбытие сверх остатка партии — 422", async (t) => {
	const org = await prisma.organization.findFirst({ select: { uuid: true } });
	const user = await prisma.user.findFirst({ select: { uuid: true } });
	const wh = await prisma.warehouse.findFirst({ select: { uuid: true } });
	if (!org || !user || !wh) return t.skip("нет фикстур");
	const product = await prisma.product.create({ data: { name: `BV2-${crypto.randomUUID().slice(0, 8)}`, trackBatches: true } });
	const b = await foc({ productUuid: product.uuid, batchNumber: "LOT-X", organizationUuid: org.uuid });
	// приход партии 3 шт
	await prisma.productRegister.create({ data: { date: new Date(), movementType: "in", quantity: 3, amount: 300, productUuid: product.uuid, warehouseUuid: wh.uuid, organizationUuid: org.uuid, documentType: "goods_receipt", documentUuid: crypto.randomUUID(), batchUuid: b.uuid } });
	// списание 5 шт этой партии
	const wo = await prisma.writeOff.create({ data: { number: `СПИС-BV-${Date.now()}`, date: new Date(), organizationUuid: org.uuid, warehouseUuid: wh.uuid, authorUuid: user.uuid, posted: false } });
	await prisma.writeOffItem.create({ data: { writeOffUuid: wo.uuid, productUuid: product.uuid, quantity: 5, batchUuid: b.uuid, organizationUuid: org.uuid } });
	try {
		await assert.rejects(
			() => assertDocumentBatches({ docType: "write_off", docUuid: wo.uuid, itemModel: "writeOffItem", parentField: "writeOffUuid" }),
			(e) => e instanceof BatchValidationError && /LOT-X/.test(e.message),
		);
	} finally {
		await prisma.writeOffItem.deleteMany({ where: { writeOffUuid: wo.uuid } });
		await prisma.writeOff.delete({ where: { uuid: wo.uuid } });
		await prisma.productRegister.deleteMany({ where: { productUuid: product.uuid } });
		await prisma.productBatch.deleteMany({ where: { productUuid: product.uuid } });
		await prisma.product.delete({ where: { uuid: product.uuid } });
	}
});
