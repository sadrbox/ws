// ─────────────────────────────────────────────────────────────────────────────
// «Сделать основным» для штрих-кода номенклатуры.
//
// Особенность: «основной» — это НЕ флаг строки таблицы, а СКАЛЯР `Product.barcode`
// (на нём partial-unique индекс, по нему товар подбирается в документах). Строки
// `ProductBarcode` — дополнительные коды. Поэтому:
//   • isPrimary у строки ВЫЧИСЛЯЕМЫЙ (barcode === Product.barcode) — второго
//     источника истины нет;
//   • «сделать основным» меняет ТОВАР, а прежний основной НЕ теряется: если его нет
//     среди строк — он туда добавляется, иначе просто исчез бы из карточки.
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";

let fx = {};

before(async () => {
	const org = await prisma.organization.findFirst({ select: { uuid: true } });
	fx = { orgUuid: org?.uuid };
});

after(async () => {
	await prisma.$disconnect();
});

/** Ровно та логика, что в PUT /productbarcodes/:id при isPrimary=true. */
async function makePrimary(productUuid, barcode) {
	const product = await prisma.product.findUnique({ where: { uuid: productUuid }, select: { barcode: true } });
	const prevMain = product?.barcode ?? null;
	await prisma.$transaction(async (tx) => {
		if (prevMain && prevMain !== barcode) {
			const kept = await tx.productBarcode.findFirst({
				where: { productUuid, barcode: prevMain, deletedAt: null },
				select: { uuid: true },
			});
			if (!kept) await tx.productBarcode.create({ data: { productUuid, barcode: prevMain } });
		}
		await tx.product.update({ where: { uuid: productUuid }, data: { barcode } });
	});
}

const state = async (productUuid) => {
	const p = await prisma.product.findUnique({ where: { uuid: productUuid }, select: { barcode: true } });
	const rows = await prisma.productBarcode.findMany({
		where: { productUuid, deletedAt: null }, select: { barcode: true }, orderBy: { id: "asc" },
	});
	return { main: p?.barcode ?? null, rows: rows.map((r) => r.barcode).sort() };
};

test("«Сделать основным»: новый код становится основным, прежний НЕ теряется", async (t) => {
	if (!fx.orgUuid) return t.skip("нет фикстур");

	const tag = crypto.randomUUID().slice(0, 6);
	const first = `111${tag}`;
	const second = `222${tag}`;

	const product = await prisma.product.create({
		data: { name: `ШК-осн-${tag}`, barcode: first, organizationUuid: fx.orgUuid },
	});
	await prisma.productBarcode.create({ data: { productUuid: product.uuid, barcode: second } });

	try {
		const before = await state(product.uuid);
		assert.equal(before.main, first);
		assert.deepEqual(before.rows, [second], "в таблице пока только дополнительный код");

		await makePrimary(product.uuid, second);

		const after = await state(product.uuid);
		assert.equal(after.main, second, "выбранный код стал основным");
		assert.deepEqual(
			after.rows, [first, second].sort(),
			"прежний основной сохранён в таблице — иначе он бы просто исчез из карточки",
		);

		// Вычисляемый isPrimary: основная строка — та, что совпадает с Product.barcode.
		const rows = await prisma.productBarcode.findMany({ where: { productUuid: product.uuid }, select: { barcode: true } });
		const primary = rows.filter((r) => r.barcode === after.main);
		assert.equal(primary.length, 1, "основной ровно один");
	} finally {
		await prisma.productBarcode.deleteMany({ where: { productUuid: product.uuid } }).catch(() => {});
		await prisma.product.delete({ where: { uuid: product.uuid } }).catch(() => {});
	}
});

test("Повторное «сделать основным» тем же кодом ничего не ломает (идемпотентно)", async (t) => {
	if (!fx.orgUuid) return t.skip("нет фикстур");

	const tag = crypto.randomUUID().slice(0, 6);
	const code = `333${tag}`;
	const product = await prisma.product.create({
		data: { name: `ШК-идем-${tag}`, barcode: code, organizationUuid: fx.orgUuid },
	});
	await prisma.productBarcode.create({ data: { productUuid: product.uuid, barcode: code } });

	try {
		await makePrimary(product.uuid, code);
		const after = await state(product.uuid);
		assert.equal(after.main, code);
		assert.deepEqual(after.rows, [code], "дубль строки не создался");
	} finally {
		await prisma.productBarcode.deleteMany({ where: { productUuid: product.uuid } }).catch(() => {});
		await prisma.product.delete({ where: { uuid: product.uuid } }).catch(() => {});
	}
});
