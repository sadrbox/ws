// ─────────────────────────────────────────────────────────────────────────────
// Быстрый поиск в списке Номенклатуры: штрихкод/GTIN БЕЗ шаблона, просто словом.
//
// Почему поиск серверный, а не клиентский (как у остальных списков): штрихкод у
// товара не один — основной лежит в product.barcode, дополнительные (GTIN/EAN
// поставщиков) в отдельной таблице. Колонки под них нет, и товар может лежать на
// неподгруженной странице. Клиентский фильтр по видимым колонкам такой товар не
// найдёт в принципе.
//
// Отсюда контракт: серверный OR обязан покрывать НАДМНОЖЕСТВО видимых колонок
// (name, sku, barcode, бренд, единица) — иначе, отдав поиск серверу, мы бы молча
// сломали поиск по колонке «Бренд».
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import { idSearchCondition } from "../utils/searchId.js";

let fx = {};

before(async () => {
	const org = await prisma.organization.findFirst({ select: { uuid: true } });
	fx = { orgUuid: org?.uuid };
});

after(async () => {
	await prisma.$disconnect();
});

/** Ровно то условие, что строит GET /products для свободных слов. */
const TEXT_FIELDS = ["name", "sku", "barcode"];
const searchWhere = (search) => ({
	AND: search.split(/\s+/).filter(Boolean).map((w) => {
		const like = { contains: w, mode: "insensitive" };
		const OR = TEXT_FIELDS.map((f) => ({ [f]: like }));
		OR.push({ barcodes: { some: { barcode: like } } });
		OR.push({ brand: { name: like } });
		OR.push({ unitOfMeasure: { name: like } });
		const idNum = idSearchCondition(w);
		if (idNum) OR.push(idNum);
		return { OR };
	}),
});

test("id ищется только когда число влезает в int4 (EAN-13 роняло запрос)", () => {
	// `id` — int4. Пользователь вводит в поиск EAN-13/БИН — числа заведомо больше.
	// Раньше они уходили в Postgres как id и падали там: 22003 «value out of range
	// for type integer» → весь список отвечал 500 вместо поиска по штрихкоду.
	assert.equal(idSearchCondition("4650123456789"), null, "EAN-13 не должен идти в id");
	assert.equal(idSearchCondition("123456789012"), null, "БИН (12 цифр) не должен идти в id");
	assert.equal(idSearchCondition("2147483648"), null, "int4 max + 1");
	assert.deepEqual(idSearchCondition("2147483647"), { id: { equals: 2147483647 } }, "int4 max — ещё можно");
	assert.deepEqual(idSearchCondition("42"), { id: { equals: 42 } }, "обычный id ищется как прежде");
	assert.equal(idSearchCondition("ноутбук"), null);
	assert.equal(idSearchCondition("0"), null);
});

test("товар находится по штрихкоду и GTIN просто словом, без шаблона", async (t) => {
	if (!fx.orgUuid) return t.skip("нет фикстур");

	const tag = crypto.randomUUID().slice(0, 6);
	const main = `JK2H3KH5FDS${tag}`;
	const gtin = `465012345${tag.replace(/\D/g, "") || "0"}`; // длинный числовой код

	const product = await prisma.product.create({
		data: { name: `Поиск-${tag}`, sku: `PS-${tag}`, barcode: main, organizationUuid: fx.orgUuid },
	});
	await prisma.productBarcode.create({ data: { productUuid: product.uuid, barcode: gtin } });

	const find = async (q) => {
		const rows = await prisma.product.findMany({
			where: { AND: [{ name: { contains: tag } }, searchWhere(q)] },
			select: { name: true },
		});
		return rows.map((r) => r.name);
	};

	try {
		assert.deepEqual(await find(main), [`Поиск-${tag}`], "основной штрихкод — целиком");
		assert.deepEqual(await find(main.slice(0, 6)), [`Поиск-${tag}`], "часть штрихкода");
		assert.deepEqual(await find(gtin), [`Поиск-${tag}`], "ДОПОЛНИТЕЛЬНЫЙ штрихкод (GTIN) из отдельной таблицы");
		assert.deepEqual(await find(`PS-${tag}`), [`Поиск-${tag}`], "артикул");
		assert.deepEqual(await find(`Поиск-${tag}`), [`Поиск-${tag}`], "наименование");
		assert.deepEqual(await find("zzz-нет-такого"), [], "чужое слово ничего не находит");
	} finally {
		await prisma.productBarcode.deleteMany({ where: { productUuid: product.uuid } }).catch(() => {});
		await prisma.product.delete({ where: { uuid: product.uuid } }).catch(() => {});
	}
});

test("серверный поиск покрывает видимые колонки: бренд и единица не потерялись", async (t) => {
	if (!fx.orgUuid) return t.skip("нет фикстур");

	const tag = crypto.randomUUID().slice(0, 6);
	const brand = await prisma.brand.create({ data: { name: `Бренд-${tag}` } });
	const unit = await prisma.unitOfMeasure.create({ data: { name: `Ед-${tag}` } });
	const product = await prisma.product.create({
		data: {
			name: `Колонки-${tag}`,
			organizationUuid: fx.orgUuid,
			brandUuid: brand.uuid,
			unitOfMeasureUuid: unit.uuid,
		},
	});

	const find = async (q) => {
		const rows = await prisma.product.findMany({
			where: { AND: [{ name: { contains: tag } }, searchWhere(q)] },
			select: { name: true },
		});
		return rows.map((r) => r.name);
	};

	try {
		// Раньше эти колонки фильтровал клиент. Раз поиск ушёл на сервер — он обязан
		// их знать, иначе поиск по бренду молча перестал бы работать.
		assert.deepEqual(await find(`Бренд-${tag}`), [`Колонки-${tag}`], "колонка «Бренд»");
		assert.deepEqual(await find(`Ед-${tag}`), [`Колонки-${tag}`], "колонка «Единица»");
	} finally {
		await prisma.product.delete({ where: { uuid: product.uuid } }).catch(() => {});
		await prisma.unitOfMeasure.delete({ where: { uuid: unit.uuid } }).catch(() => {});
		await prisma.brand.delete({ where: { uuid: brand.uuid } }).catch(() => {});
	}
});
