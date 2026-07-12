// ─────────────────────────────────────────────────────────────────────────────
// Ввод остатков серий/партий.
//
// Задача: товар с остатком, набранным БЕЗ маркировки, после включения учёта по
// сериям/партиям становится непродаваемым (система требует серию/партию на каждую
// единицу, а их нет). Ввод остатков размечает уже имеющийся остаток.
//
// ГЛАВНЫЕ ИНВАРИАНТЫ:
//   • количество на складе НЕ меняется (это маркировка, а не приход);
//   • стоимость запаса сохраняется;
//   • нельзя разметить больше, чем лежит на складе;
//   • после ввода остатков товар снова можно продать.
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import {
	serialGap, batchGap, addOpeningSerials, addOpeningBatch, OpeningBalanceError,
} from "../services/openingBalance.js";
import { assertDocumentSerials } from "../services/serialNumbers.js";

let fx = {};

before(async () => {
	const [org, wh, user] = await Promise.all([
		prisma.organization.findFirst({ select: { uuid: true } }),
		prisma.warehouse.findFirst({ select: { uuid: true } }),
		prisma.user.findFirst({ select: { uuid: true } }),
	]);
	fx = { orgUuid: org?.uuid, warehouseUuid: wh?.uuid, userUuid: user?.uuid };
});

after(async () => {
	await prisma.$disconnect();
});

/** Товар с остатком 10, набранным БЕЗ серий/партий (как в реальной ситуации). */
async function productWithStock({ serials = false, batches = false }) {
	const product = await prisma.product.create({
		data: {
			name: `__ob_${crypto.randomUUID().slice(0, 8)}`,
			organizationUuid: fx.orgUuid,
			trackSerialNumbers: serials,
			trackBatches: batches,
			...(serials ? { serialTrackingSince: new Date(Date.now() - 3600_000) } : {}),
			...(batches ? { batchTrackingSince: new Date(Date.now() - 3600_000) } : {}),
		},
	});
	await prisma.productRegister.create({
		data: {
			date: new Date(Date.now() - 86400_000), movementType: "in", quantity: 10, amount: 1000,
			productUuid: product.uuid, warehouseUuid: fx.warehouseUuid, organizationUuid: fx.orgUuid,
			documentType: "purchase", documentUuid: crypto.randomUUID(),
		},
	});
	return product;
}

const stockOf = async (uuid) => {
	const i = await prisma.productRegister.aggregate({ where: { productUuid: uuid, movementType: "in" }, _sum: { quantity: true, amount: true } });
	const o = await prisma.productRegister.aggregate({ where: { productUuid: uuid, movementType: "out" }, _sum: { quantity: true, amount: true } });
	return {
		qty: Number(i._sum.quantity ?? 0) - Number(o._sum.quantity ?? 0),
		value: Number(i._sum.amount ?? 0) - Number(o._sum.amount ?? 0),
	};
};

test("Серии: разметка остатка не двигает склад и снимает блокировку продажи", async (t) => {
	if (!fx.orgUuid || !fx.warehouseUuid || !fx.userUuid) return t.skip("нет фикстур");
	const product = await productWithStock({ serials: true });
	const args = { productUuid: product.uuid, warehouseUuid: fx.warehouseUuid, organizationUuid: fx.orgUuid };
	try {
		// Остаток 10, серий 0 → продать нельзя, «дыра» = 10.
		const before = await serialGap(args);
		assert.deepEqual({ stock: before.stock, marked: before.marked, gap: before.gap }, { stock: 10, marked: 0, gap: 10 });

		const stockBefore = await stockOf(product.uuid);
		await addOpeningSerials({ ...args, serials: ["SN-1", "SN-2", "SN-3"] });
		const stockAfter = await stockOf(product.uuid);

		// Маркировка, а не приход: склад не изменился.
		assert.deepEqual(stockAfter, stockBefore, "ввод остатков серий не должен менять склад");

		const after = await serialGap(args);
		assert.equal(after.marked, 3);
		assert.equal(after.gap, 7, "осталось разметить 7");

		// Теперь продажа 3 шт с этими сериями проходит контроль.
		const sale = await prisma.sale.create({
			data: { date: new Date(), organizationUuid: fx.orgUuid, warehouseUuid: fx.warehouseUuid, authorUuid: fx.userUuid },
		});
		await prisma.saleItem.create({
			data: { saleUuid: sale.uuid, productUuid: product.uuid, quantity: 3, price: 100, amount: 300 },
		});
		await prisma.serialNumber.updateMany({
			where: { productUuid: product.uuid, serialNumber: { in: ["SN-1", "SN-2", "SN-3"] } },
			data: { issueDocType: "sale", issueDocUuid: sale.uuid },
		});
		await assert.doesNotReject(
			() => assertDocumentSerials({ docType: "sale", docUuid: sale.uuid, itemModel: "saleItem", parentField: "saleUuid" }),
			"после ввода остатков товар снова продаётся",
		);

		await prisma.saleItem.deleteMany({ where: { saleUuid: sale.uuid } });
		await prisma.sale.delete({ where: { uuid: sale.uuid } });
	} finally {
		await prisma.serialNumber.deleteMany({ where: { productUuid: product.uuid } }).catch(() => {});
		await prisma.productRegister.deleteMany({ where: { productUuid: product.uuid } }).catch(() => {});
		await prisma.product.delete({ where: { uuid: product.uuid } }).catch(() => {});
	}
});

test("Серии: нельзя разметить больше, чем лежит на складе", async (t) => {
	if (!fx.orgUuid || !fx.warehouseUuid) return t.skip("нет фикстур");
	const product = await productWithStock({ serials: true });
	const args = { productUuid: product.uuid, warehouseUuid: fx.warehouseUuid, organizationUuid: fx.orgUuid };
	try {
		const serials = Array.from({ length: 11 }, (_, i) => `X-${i}`); // остаток 10
		await assert.rejects(
			() => addOpeningSerials({ ...args, serials }),
			(e) => e instanceof OpeningBalanceError && /Можно ввести ещё 10/.test(e.message),
		);
		assert.equal((await serialGap(args)).marked, 0, "при отказе ничего не создалось");
	} finally {
		await prisma.serialNumber.deleteMany({ where: { productUuid: product.uuid } }).catch(() => {});
		await prisma.productRegister.deleteMany({ where: { productUuid: product.uuid } }).catch(() => {});
		await prisma.product.delete({ where: { uuid: product.uuid } }).catch(() => {});
	}
});

test("Партии: перемаркировка сохраняет и количество, и стоимость запаса", async (t) => {
	if (!fx.orgUuid || !fx.warehouseUuid) return t.skip("нет фикстур");
	const product = await productWithStock({ batches: true });
	const args = { productUuid: product.uuid, warehouseUuid: fx.warehouseUuid, organizationUuid: fx.orgUuid };
	try {
		const before = await batchGap(args);
		assert.deepEqual({ stock: before.stock, marked: before.marked }, { stock: 10, marked: 0 });
		const stockBefore = await stockOf(product.uuid); // 10 шт, 1000 ₸

		const r = await addOpeningBatch({ ...args, batchNumber: "П-001", expiryDate: "2027-01-01", quantity: 4 });
		assert.equal(r.quantity, 4);

		const stockAfter = await stockOf(product.uuid);
		assert.equal(stockAfter.qty, stockBefore.qty, "количество на складе не изменилось");
		assert.equal(stockAfter.value, stockBefore.value, "стоимость запаса не изменилась");

		const after = await batchGap(args);
		assert.equal(after.marked, 4, "4 шт теперь в партии");
		assert.equal(after.gap, 6, "осталось разметить 6");
	} finally {
		await prisma.productRegister.deleteMany({ where: { productUuid: product.uuid } }).catch(() => {});
		await prisma.productBatch.deleteMany({ where: { productUuid: product.uuid } }).catch(() => {});
		await prisma.product.delete({ where: { uuid: product.uuid } }).catch(() => {});
	}
});

test("Ввод остатков отклоняется, если учёт по сериям/партиям выключен", async (t) => {
	if (!fx.orgUuid || !fx.warehouseUuid) return t.skip("нет фикстур");
	const product = await productWithStock({});
	const args = { productUuid: product.uuid, warehouseUuid: fx.warehouseUuid, organizationUuid: fx.orgUuid };
	try {
		await assert.rejects(
			() => addOpeningSerials({ ...args, serials: ["A"] }),
			(e) => e instanceof OpeningBalanceError && /выключен/.test(e.message),
		);
		await assert.rejects(
			() => addOpeningBatch({ ...args, batchNumber: "П-1", quantity: 1 }),
			(e) => e instanceof OpeningBalanceError && /выключен/.test(e.message),
		);
	} finally {
		await prisma.productRegister.deleteMany({ where: { productUuid: product.uuid } }).catch(() => {});
		await prisma.product.delete({ where: { uuid: product.uuid } }).catch(() => {});
	}
});
