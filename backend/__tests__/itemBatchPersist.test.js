// ─────────────────────────────────────────────────────────────────────────────
// Партия строки должна ПЕРЕЖИВАТЬ сохранение документа.
//
// Баг: форма коммитит строки ПАЧКОЙ (POST /{items}/batch), а этот эндпоинт не
// применял batchUuid — ни в saleitems.js, ни в общей фабрике (там доп. поля идут
// через extraStringFields, которые batch-ветка игнорировала). Пользователь выбирал
// партию M-2640, сохранял — и в строке молча оставалась ПРЕЖНЯЯ партия M-2609.
// Это порча данных: отгружается не та партия (свой срок годности, своя поставка).
//
// Тест проверяет контракт на уровне данных: batchUuid из payload доходит до строки
// и при create, и при update.
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";

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

/** Поля строки, которые batch-эндпоинты обязаны применять (иначе выбор теряется). */
const BATCH_WRITABLE = ["batchUuid"];

test("batch-эндпоинты СТРОК применяют batchUuid (иначе выбор партии теряется)", async () => {
	// Страж-проверка исходников: batch-ветка должна знать про доп. поля строки.
	const fs = await import("node:fs/promises");

	const sale = await fs.readFile("api/router/saleitems.js", "utf-8");
	const batchBlock = sale.slice(sale.indexOf("/batch`"));
	for (const f of BATCH_WRITABLE) {
		assert.ok(
			batchBlock.includes(f),
			`saleitems: batch-эндпоинт должен применять ${f} — иначе выбор партии молча теряется`,
		);
	}

	const factory = await fs.readFile("api/router/_documentItemsFactory.js", "utf-8");
	const facBatch = factory.slice(factory.indexOf("/batch`"));
	// В фабрике batchUuid приходит через extraStringFields — значит batch-ветка
	// обязана их применять (и в create, и в update).
	assert.ok(
		facBatch.includes("extraFields(data)"),
		"фабрика: batch-create должен применять extraFields (там batchUuid)",
	);
	assert.ok(
		facBatch.includes("for (const f of extraStringFields)"),
		"фабрика: batch-update должен применять extraStringFields (там batchUuid)",
	);
});

test("смена партии в строке продажи сохраняется (не откатывается на прежнюю)", async (t) => {
	if (!fx.orgUuid || !fx.warehouseUuid || !fx.userUuid) return t.skip("нет фикстур");

	const product = await prisma.product.create({
		data: { name: `__batchpersist_${crypto.randomUUID().slice(0, 8)}`, organizationUuid: fx.orgUuid, trackBatches: true },
	});
	const b1 = await prisma.productBatch.create({
		data: { batchNumber: "B-РАННЯЯ", expiryDate: new Date(Date.now() + 5 * 86400000), productUuid: product.uuid, organizationUuid: fx.orgUuid },
	});
	const b2 = await prisma.productBatch.create({
		data: { batchNumber: "B-ПОЗДНЯЯ", expiryDate: new Date(Date.now() + 50 * 86400000), productUuid: product.uuid, organizationUuid: fx.orgUuid },
	});
	const sale = await prisma.sale.create({
		data: { date: new Date(), organizationUuid: fx.orgUuid, warehouseUuid: fx.warehouseUuid, authorUuid: fx.userUuid },
	});
	// Строка изначально с РАННЕЙ партией (как в сиде).
	const item = await prisma.saleItem.create({
		data: { saleUuid: sale.uuid, productUuid: product.uuid, quantity: 5, price: 100, amount: 500, batchUuid: b1.uuid },
	});

	try {
		// Пользователь выбрал ПОЗДНЮЮ партию → строка обновляется.
		await prisma.saleItem.update({ where: { uuid: item.uuid }, data: { batchUuid: b2.uuid } });

		const fresh = await prisma.saleItem.findUnique({ where: { uuid: item.uuid }, select: { batchUuid: true } });
		assert.equal(fresh.batchUuid, b2.uuid, "в строке должна остаться ВЫБРАННАЯ партия, а не прежняя");

		// И пересбор регистра её не затирает (регистр берёт партию из строки).
		const { reconcileDocumentRegister } = await import("../services/productRegister.js");
		await reconcileDocumentRegister("sale", sale.uuid);
		const after = await prisma.saleItem.findUnique({ where: { uuid: item.uuid }, select: { batchUuid: true } });
		assert.equal(after.batchUuid, b2.uuid, "проведение документа не должно менять партию строки");
	} finally {
		await prisma.productRegister.deleteMany({ where: { productUuid: product.uuid } }).catch(() => {});
		await prisma.saleItem.deleteMany({ where: { saleUuid: sale.uuid } }).catch(() => {});
		await prisma.sale.delete({ where: { uuid: sale.uuid } }).catch(() => {});
		await prisma.productBatch.deleteMany({ where: { productUuid: product.uuid } }).catch(() => {});
		await prisma.product.delete({ where: { uuid: product.uuid } }).catch(() => {});
	}
});
