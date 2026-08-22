import { test } from "node:test";
import assert from "node:assert/strict";
import {
	normalizeNameKey, buildMatchKey, suggestAssetKind, resolveMapping, rememberMapping,
} from "../services/esf/classification.js";

test("normalizeNameKey: регистр/пробелы", () => {
	assert.equal(normalizeNameKey("  Ноутбук   HP  "), "ноутбук hp");
	assert.equal(normalizeNameKey(null), "");
});

test("buildMatchKey: детерминированный ключ", () => {
	assert.equal(buildMatchKey("123456789012", "8471", "ноутбук", "org1"), "123456789012|8471|ноутбук|org1");
	assert.equal(buildMatchKey("123", null, "x", null), "123||x|");
});

test("suggestAssetKind: дорогая позиция → ОС, дешёвая → товар", () => {
	assert.equal(suggestAssetKind({ price: 500000 }), "fixed_asset");
	assert.equal(suggestAssetKind({ price: 1000 }), "goods");
	// по amount/quantity, если price не задан
	assert.equal(suggestAssetKind({ amount: 600000, quantity: 1 }), "fixed_asset");
	assert.equal(suggestAssetKind({ amount: 600000, quantity: 10 }), "goods"); // 60000/ед
	assert.equal(suggestAssetKind({ price: 500000 }, { fixedAssetPriceThreshold: 1000000 }), "goods");
});

test("resolveMapping: ищет по matchKey", async () => {
	const calls = [];
	const client = { esfLineMapping: { findUnique: async ({ where }) => { calls.push(where.matchKey); return { assetKind: "fixed_asset", fixedAssetUuid: "fa1" }; } } };
	const m = await resolveMapping(client, { supplierBin: "123", tnvedCode: "8471", name: "Ноутбук", organizationUuid: "org1" });
	assert.equal(m.assetKind, "fixed_asset");
	assert.equal(calls[0], "123|8471|ноутбук|org1");
});

test("rememberMapping: upsert по matchKey с нормализованным именем", async () => {
	let upserted = null;
	const client = { esfLineMapping: { upsert: async (args) => { upserted = args; return {}; } } };
	await rememberMapping(client, { supplierBin: "123", tnvedCode: "8471", name: "  Ноутбук  ", organizationUuid: "org1", assetKind: "fixed_asset", fixedAssetUuid: "fa1" });
	assert.equal(upserted.where.matchKey, "123|8471|ноутбук|org1");
	assert.equal(upserted.create.nameKey, "ноутбук");
	assert.equal(upserted.create.assetKind, "fixed_asset");
	assert.equal(upserted.update.fixedAssetUuid, "fa1");
});
