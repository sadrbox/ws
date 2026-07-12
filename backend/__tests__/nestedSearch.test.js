// ─────────────────────────────────────────────────────────────────────────────
// Поиск по вложенным строкам документа: «[номенклатура: ноут]».
//
// Смысл шаблона: в списке ДОКУМЕНТОВ пользователь ищет не по колонкам списка, а по
// ПОЗИЦИЯМ — «покажи реализации, в которых есть ноутбук». Колонки «Номенклатура» в
// списке Реализаций нет и быть не может: товаров в документе много. Значит фильтр
// только серверный (Prisma `some`).
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import { buildNestedItemsConditions, nestedScopes } from "../utils/nestedSearch.js";

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

test("связь строк находится по схеме для любого документа с табличной частью", () => {
	assert.deepEqual(
		buildNestedItemsConditions("sale", { номенклатура: "x" }).map((c) => Object.keys(c)[0]),
		["saleItems"],
	);
	assert.deepEqual(
		buildNestedItemsConditions("purchase", { товар: "x" }).map((c) => Object.keys(c)[0]),
		["purchaseItems"],
	);
	// У документа без позиций (кассовый ордер) фильтровать нечего.
	assert.deepEqual(buildNestedItemsConditions("cashOrder", { номенклатура: "x" }), []);

	// Связь позиций берём строго по типу `<Модель>Item`. У Product тоже есть
	// saleItems/purchaseItems (ОБРАТНЫЕ ссылки) — «первая попавшаяся *Item-связь»
	// давала для него saleItems, и шаблон «работал» только в списке Реализаций.
	const productConds = buildNestedItemsConditions("product", { штрихкод: "333" });
	assert.equal(productConds.length, 1);
	assert.ok(
		!Object.keys(productConds[0]).some((k) => /Items$/.test(k)),
		"справочник должен искать по СВОИМ вложенным таблицам, а не через позиции документов",
	);
	assert.ok(productConds[0].OR, "у товара — прямое условие по его штрихкодам");
});

test("справочник Номенклатуры ищет по СВОИМ штрихкодам (основному и дополнительным)", async (t) => {
	if (!fx.orgUuid) return t.skip("нет фикстур");
	const tag = crypto.randomUUID().slice(0, 6);
	const product = await prisma.product.create({
		data: { name: `Товар-${tag}`, barcode: `555${tag}`, organizationUuid: fx.orgUuid },
	});
	await prisma.productBarcode.create({ data: { productUuid: product.uuid, barcode: `666${tag}` } });

	const find = async (scope, text) => {
		const conds = buildNestedItemsConditions("product", { [scope]: text });
		const rows = await prisma.product.findMany({
			where: { AND: [{ name: { contains: tag } }, ...conds] },
			select: { name: true },
		});
		return rows.map((r) => r.name);
	};

	try {
		assert.deepEqual(await find("штрихкод", `555${tag}`), [`Товар-${tag}`], "основной штрихкод");
		assert.deepEqual(await find("gtin", `666${tag}`), [`Товар-${tag}`], "дополнительный штрихкод");
		assert.deepEqual(await find("номенклатура", `Товар-${tag}`), [`Товар-${tag}`], "по наименованию");
		assert.deepEqual(await find("штрихкод", "999999999"), [], "чужой код не находит");
	} finally {
		await prisma.productBarcode.deleteMany({ where: { productUuid: product.uuid } }).catch(() => {});
		await prisma.product.delete({ where: { uuid: product.uuid } }).catch(() => {});
	}
});

test("неизвестная область молча игнорируется (список не обнуляется из-за опечатки)", () => {
	assert.deepEqual(buildNestedItemsConditions("sale", { выдуманное: "x" }), []);
	assert.ok(nestedScopes().includes("номенклатура"));
});

test("[номенклатура: ноут] находит документ по товару в ПОЗИЦИЯХ", async (t) => {
	if (!fx.orgUuid || !fx.userUuid) return t.skip("нет фикстур");

	const tag = crypto.randomUUID().slice(0, 8);
	const laptop = await prisma.product.create({
		data: { name: `Ноутбук-${tag}`, sku: `NB-${tag}`, organizationUuid: fx.orgUuid },
	});
	const milk = await prisma.product.create({
		data: { name: `Молоко-${tag}`, sku: `ML-${tag}`, organizationUuid: fx.orgUuid },
	});
	const withLaptop = await prisma.sale.create({
		data: { number: `Н-${tag}`, date: new Date(), organizationUuid: fx.orgUuid, authorUuid: fx.userUuid },
	});
	const withMilk = await prisma.sale.create({
		data: { number: `М-${tag}`, date: new Date(), organizationUuid: fx.orgUuid, authorUuid: fx.userUuid },
	});
	await prisma.saleItem.create({ data: { saleUuid: withLaptop.uuid, productUuid: laptop.uuid, quantity: 1, price: 1, amount: 1 } });
	await prisma.saleItem.create({ data: { saleUuid: withMilk.uuid, productUuid: milk.uuid, quantity: 1, price: 1, amount: 1 } });

	const find = async (nested) => {
		const conds = buildNestedItemsConditions("sale", nested);
		const rows = await prisma.sale.findMany({
			where: { AND: [{ number: { contains: tag } }, ...conds] },
			select: { number: true },
		});
		return rows.map((r) => r.number).sort();
	};

	try {
		// Ищем по товару В ПОЗИЦИЯХ — в самом документе такого поля нет.
		assert.deepEqual(await find({ номенклатура: "ноут" }), [`Н-${tag}`]);
		// Регистр не важен.
		assert.deepEqual(await find({ номенКлатура: "НОУТ" }), [`Н-${tag}`]);
		// Синоним области.
		assert.deepEqual(await find({ товар: "молоко" }), [`М-${tag}`]);
		// По артикулу строки.
		assert.deepEqual(await find({ артикул: `NB-${tag}` }), [`Н-${tag}`]);
		// Без области — оба документа (фильтра нет).
		assert.deepEqual(await find({}), [`М-${tag}`, `Н-${tag}`].sort());
	} finally {
		await prisma.saleItem.deleteMany({ where: { saleUuid: { in: [withLaptop.uuid, withMilk.uuid] } } }).catch(() => {});
		await prisma.sale.deleteMany({ where: { uuid: { in: [withLaptop.uuid, withMilk.uuid] } } }).catch(() => {});
		await prisma.product.deleteMany({ where: { uuid: { in: [laptop.uuid, milk.uuid] } } }).catch(() => {});
	}
});

test("штрихкод: все алиасы + ОСНОВНОЙ и ДОПОЛНИТЕЛЬНЫЕ штрихкоды товара", async (t) => {
	if (!fx.orgUuid || !fx.userUuid) return t.skip("нет фикстур");

	const tag = crypto.randomUUID().slice(0, 6);
	const main = `3333333${tag}`;
	const extra = `4444444${tag}`;

	const product = await prisma.product.create({
		data: { name: `ШК-${tag}`, barcode: main, organizationUuid: fx.orgUuid },
	});
	// У товара может быть НЕСКОЛЬКО штрихкодов — доп. лежат в отдельной таблице.
	// Поиск только по product.barcode пропускал бы их.
	await prisma.productBarcode.create({ data: { productUuid: product.uuid, barcode: extra } });

	const sale = await prisma.sale.create({
		data: { number: `ШК-${tag}`, date: new Date(), organizationUuid: fx.orgUuid, authorUuid: fx.userUuid },
	});
	await prisma.saleItem.create({
		data: { saleUuid: sale.uuid, productUuid: product.uuid, quantity: 1, price: 1, amount: 1 },
	});

	const find = async (scope, text) => {
		const conds = buildNestedItemsConditions("sale", { [scope]: text });
		const rows = await prisma.sale.findMany({
			where: { AND: [{ number: { contains: tag } }, ...conds] },
			select: { number: true },
		});
		return rows.map((r) => r.number);
	};

	try {
		// Все синонимы области ведут к одному результату (регистр не важен).
		for (const scope of ["штрихкод", "штрих-код", "gTIn", "ean", "barcode"]) {
			assert.deepEqual(await find(scope, main), [`ШК-${tag}`], `алиас «${scope}» должен искать по штрихкоду`);
		}
		// Дополнительный штрихкод тоже находится.
		assert.deepEqual(await find("gtin", extra), [`ШК-${tag}`], "доп. штрихкоды товара тоже должны искаться");
		// Частичное совпадение (пользователь ввёл начало кода).
		assert.deepEqual(await find("штрихкод", "3333333"), [`ШК-${tag}`]);
		// Чужой код — не находит.
		assert.deepEqual(await find("штрихкод", "9999999999999"), []);
	} finally {
		await prisma.saleItem.deleteMany({ where: { saleUuid: sale.uuid } }).catch(() => {});
		await prisma.sale.delete({ where: { uuid: sale.uuid } }).catch(() => {});
		await prisma.productBarcode.deleteMany({ where: { productUuid: product.uuid } }).catch(() => {});
		await prisma.product.delete({ where: { uuid: product.uuid } }).catch(() => {});
	}
});
