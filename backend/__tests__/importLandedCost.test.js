import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateImportLandedCost } from "../services/importLandedCost.js";

const items = [
	{ uuid: "a", amount: 600, quantity: 6 },
	{ uuid: "b", amount: 400, quantity: 4 },
];

test("плательщик НДС: пошлина/сбор/акциз капитализируются, импортный НДС — отдельно (1420)", () => {
	const doc = { dutyAmount: 100, customsFeeAmount: 20, exciseAmount: 30, importVatAmount: 138 };
	const m = allocateImportLandedCost(doc, items, true);
	const a = m.get("a");
	const b = m.get("b");

	// Капитализируется 150 (100+20+30) в пропорции 60/40.
	assert.equal(a.capitalized, 90);
	assert.equal(b.capitalized, 60);
	// Импортный НДС 138 → к возмещению, НЕ в себестоимость.
	assert.equal(a.importVat, 82.8);
	assert.equal(b.importVat, 55.2);
	// landed = таможенная стоимость + капитализированное (без НДС).
	assert.equal(a.landed, 690);
	assert.equal(b.landed, 460);
	// Суммы долей точно сходятся с итогами.
	assert.equal(a.capitalized + b.capitalized, 150);
	assert.equal(a.importVat + b.importVat, 138);
});

test("НЕплательщик НДС: импортный НДС тоже капитализируется в себестоимость", () => {
	const doc = { dutyAmount: 100, customsFeeAmount: 0, exciseAmount: 0, importVatAmount: 100 };
	const m = allocateImportLandedCost(doc, items, false);
	const a = m.get("a");
	const b = m.get("b");

	assert.equal(a.importVat, 0);
	assert.equal(b.importVat, 0);
	// Капитализируется 200 (пошлина 100 + НДС 100).
	assert.equal(a.capitalized, 120);
	assert.equal(b.capitalized, 80);
	assert.equal(a.landed, 720);
	assert.equal(b.landed, 480);
});

test("копейки остатка не теряются (доли точно сходятся с итогом)", () => {
	const three = [
		{ uuid: "x", amount: 100, quantity: 1 },
		{ uuid: "y", amount: 100, quantity: 1 },
		{ uuid: "z", amount: 100, quantity: 1 },
	];
	// 10.00 / 3 = 3.3333… → доли должны дать ровно 10.00
	const m = allocateImportLandedCost({ dutyAmount: 10 }, three, true);
	const sum = ["x", "y", "z"].reduce((s, k) => s + m.get(k).capitalized, 0);
	assert.equal(Math.round(sum * 100) / 100, 10);
});

test("нулевая таможенная стоимость строк → распределение по количеству", () => {
	const byQty = [
		{ uuid: "p", amount: 0, quantity: 3 },
		{ uuid: "q", amount: 0, quantity: 1 },
	];
	const m = allocateImportLandedCost({ dutyAmount: 40 }, byQty, true);
	assert.equal(m.get("p").capitalized, 30);
	assert.equal(m.get("q").capitalized, 10);
});

test("без таможенных платежей landed == таможенная стоимость", () => {
	const m = allocateImportLandedCost({}, items, true);
	assert.equal(m.get("a").landed, 600);
	assert.equal(m.get("a").capitalized, 0);
	assert.equal(m.get("a").importVat, 0);
});
