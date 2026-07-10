import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSerials, assertSerialCount } from "../services/serialNumbers.js";

test("normalizeSerials: строка по разделителям → уникальные непустые, порядок сохранён", () => {
	assert.deepEqual(normalizeSerials("A1\nA2, A3; A1"), ["A1", "A2", "A3"]);
	assert.deepEqual(normalizeSerials("  SN-1  \n\n SN-2 "), ["SN-1", "SN-2"]);
	assert.deepEqual(normalizeSerials(["X", "X", "Y", ""]), ["X", "Y"]);
	assert.deepEqual(normalizeSerials(""), []);
	assert.deepEqual(normalizeSerials(null), []);
	assert.deepEqual(normalizeSerials(undefined), []);
});

test("assertSerialCount: число серий должно равняться целому количеству", () => {
	// tracked, совпадает
	assert.deepEqual(assertSerialCount([{ productName: "Ноутбук", quantity: 3, serialCount: 3, tracked: true }]), { ok: true, errors: [] });
	// tracked, не совпадает
	const bad = assertSerialCount([{ productName: "Ноутбук", quantity: 3, serialCount: 2, tracked: true }]);
	assert.equal(bad.ok, false);
	assert.match(bad.errors[0], /Ноутбук/);
	// нецелое количество для штучного учёта — ошибка
	assert.equal(assertSerialCount([{ productName: "X", quantity: 2.5, serialCount: 2, tracked: true }]).ok, false);
	// не tracked — пропускается
	assert.deepEqual(assertSerialCount([{ quantity: 5, serialCount: 0, tracked: false }]), { ok: true, errors: [] });
});

test("assertSerialCount: несколько строк — все ошибки собираются", () => {
	const r = assertSerialCount([
		{ productName: "A", quantity: 1, serialCount: 1, tracked: true },
		{ productName: "B", quantity: 2, serialCount: 1, tracked: true },
		{ productName: "C", quantity: 4, serialCount: 0, tracked: true },
	]);
	assert.equal(r.ok, false);
	assert.equal(r.errors.length, 2, "две несовпадающие строки");
});

// ── Интеграция: жизненный цикл серий (реальная БД, с очисткой) ───────────────
import { prisma } from "../prisma/prisma-client.js";
import crypto from "node:crypto";
import {
	setReceiptSerials, countReceiptSerials, issueSerials,
	releaseIssuedSerials, removeReceiptSerials, SERIAL_STATUS,
} from "../services/serialNumbers.js";

test("жизненный цикл: приёмка → выбытие → откат → удаление", async (t) => {
	const org = await prisma.organization.findFirst({ select: { uuid: true } });
	if (!org) return t.skip("нет организации");
	const product = await prisma.product.create({ data: { name: `SN-ТЕСТ-${crypto.randomUUID().slice(0, 8)}`, trackSerialNumbers: true } });
	const rcUuid = crypto.randomUUID();
	const issUuid = crypto.randomUUID();
	try {
		// Приёмка 3 серий.
		const r1 = await setReceiptSerials({ docType: "goods_receipt", docUuid: rcUuid, productUuid: product.uuid, organizationUuid: org.uuid, serials: "SN1\nSN2\nSN3" });
		assert.equal(r1.created, 3);
		assert.equal((await countReceiptSerials("goods_receipt", rcUuid)).get(product.uuid), 3);

		// Идемпотентность + удаление одной: список из 2 → одна удаляется.
		const r2 = await setReceiptSerials({ docType: "goods_receipt", docUuid: rcUuid, productUuid: product.uuid, organizationUuid: org.uuid, serials: ["SN1", "SN2"] });
		assert.equal(r2.created, 0);
		assert.equal(r2.removed, 1);
		assert.equal((await countReceiptSerials("goods_receipt", rcUuid)).get(product.uuid), 2);

		// Выбытие: помечаем одну серию issued.
		const inStock = await prisma.serialNumber.findMany({ where: { receiptDocUuid: rcUuid, status: SERIAL_STATUS.IN_STOCK } });
		const issued = await issueSerials({ docType: "sale", docUuid: issUuid, serialUuids: [inStock[0].uuid] });
		assert.equal(issued, 1);
		assert.equal((await prisma.serialNumber.findUnique({ where: { uuid: inStock[0].uuid } })).status, SERIAL_STATUS.ISSUED);

		// Откат выбытия → снова in_stock.
		assert.equal(await releaseIssuedSerials("sale", issUuid), 1);
		assert.equal((await prisma.serialNumber.findUnique({ where: { uuid: inStock[0].uuid } })).status, SERIAL_STATUS.IN_STOCK);

		// Удаление приёмки → серии убраны.
		assert.equal(await removeReceiptSerials("goods_receipt", rcUuid), 2);
		assert.equal((await prisma.serialNumber.count({ where: { receiptDocUuid: rcUuid } })), 0);
	} finally {
		await prisma.serialNumber.deleteMany({ where: { productUuid: product.uuid } });
		await prisma.product.delete({ where: { uuid: product.uuid } });
	}
});

test("конфликт: серия, принятая другим документом, не переназначается", async (t) => {
	const org = await prisma.organization.findFirst({ select: { uuid: true } });
	if (!org) return t.skip("нет организации");
	const product = await prisma.product.create({ data: { name: `SN-CF-${crypto.randomUUID().slice(0, 8)}`, trackSerialNumbers: true } });
	const docA = crypto.randomUUID(), docB = crypto.randomUUID();
	try {
		await setReceiptSerials({ docType: "goods_receipt", docUuid: docA, productUuid: product.uuid, organizationUuid: org.uuid, serials: ["DUP"] });
		const r = await setReceiptSerials({ docType: "goods_receipt", docUuid: docB, productUuid: product.uuid, organizationUuid: org.uuid, serials: ["DUP", "NEW"] });
		assert.deepEqual(r.conflicts, ["DUP"], "DUP уже принята docA → конфликт");
		assert.equal(r.created, 1, "создана только NEW");
	} finally {
		await prisma.serialNumber.deleteMany({ where: { productUuid: product.uuid } });
		await prisma.product.delete({ where: { uuid: product.uuid } });
	}
});
