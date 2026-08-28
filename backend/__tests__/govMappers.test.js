// Юнит-тесты мапперов СНТ/ЭАВР (чистые build*-функции, без сети/БД).
// Покрывают базовую структуру + корр-цепочки relatedSnt/relatedAwp (T7.11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSntV1Xml } from "../services/snt/mapper.js";
import { buildAwpV1Xml } from "../services/awp/mapper.js";

const baseSnt = {
	date: new Date("2026-08-28T00:00:00Z"),
	number: "СНТ-1",
	organization: { name: "ТОО Продавец", bin: "123456789012" },
	counterparty: { name: "ТОО Покупатель", bin: "210987654321" },
	contract: null,
	items: [],
};

const baseAwp = {
	date: new Date("2026-08-28T00:00:00Z"),
	number: "АВР-1",
	organization: { name: "ТОО Исполнитель" },
	counterparty: { name: "ТОО Заказчик" },
	contract: null,
	saleItems: [],
};

test("СНТ: корневой элемент + тип по умолчанию PRIMARY_SNT", () => {
	const xml = buildSntV1Xml({ ...baseSnt, items: [] }, {});
	assert.match(xml, /^<v1:snt xmlns:v1="v1\.snt">/);
	assert.match(xml, /<sntType>PRIMARY_SNT<\/sntType>/);
	assert.match(xml, /<number>СНТ-1<\/number>/);
});

test("СНТ: sntType переопределяется", () => {
	const xml = buildSntV1Xml({ ...baseSnt }, { sntType: "RETURNED_SNT" });
	assert.match(xml, /<sntType>RETURNED_SNT<\/sntType>/);
});

test("СНТ: без opts.related блок relatedSnt отсутствует (T7.11)", () => {
	const xml = buildSntV1Xml({ ...baseSnt }, { sntType: "PRIMARY_SNT" });
	assert.doesNotMatch(xml, /<relatedSnt>/);
});

test("СНТ: с opts.related эмитится relatedSnt с реквизитами основной СНТ (T7.11)", () => {
	const xml = buildSntV1Xml({ ...baseSnt }, {
		sntType: "FIXED_SNT",
		related: { date: new Date("2026-07-01T00:00:00Z"), number: "СНТ-orig", registrationNumber: "REG-777" },
	});
	assert.match(xml, /<relatedSnt>[\s\S]*<\/relatedSnt>/);
	assert.match(xml, /<relatedSnt>[\s\S]*<number>СНТ-orig<\/number>[\s\S]*<\/relatedSnt>/);
	assert.match(xml, /<registrationNumber>REG-777<\/registrationNumber>/);
	assert.match(xml, /<date>01\.07\.2026<\/date>/); // формат dd.MM.yyyy
});

test("ЭАВР: корневой элемент + base-поля", () => {
	const xml = buildAwpV1Xml({ ...baseAwp }, {});
	assert.match(xml, /^<v1:awp xmlns:v1="v1\.awp">/);
	assert.match(xml, /<number>АВР-1<\/number>/);
	assert.doesNotMatch(xml, /<relatedAwp>/);
});

test("ЭАВР: с opts.related эмитится relatedAwp (T7.11)", () => {
	const xml = buildAwpV1Xml({ ...baseAwp }, {
		related: { date: new Date("2026-07-01T00:00:00Z"), number: "АВР-orig", registrationNumber: "AREG-1" },
	});
	assert.match(xml, /<relatedAwp>[\s\S]*<number>АВР-orig<\/number>[\s\S]*<\/relatedAwp>/);
	assert.match(xml, /<registrationNumber>AREG-1<\/registrationNumber>/);
});
