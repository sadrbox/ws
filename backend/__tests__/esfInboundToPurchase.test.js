import { test } from "node:test";
import assert from "node:assert/strict";
import {
	decideAssetKind, resolveCounterpartyByBin, resolveOrCreateProduct, resolveOrCreateFixedAsset,
} from "../services/esf/inboundToPurchase.js";

test("decideAssetKind: приоритет override → строка → память → подсказка", () => {
	// override побеждает всё
	assert.equal(decideAssetKind({ price: 1000, assetKind: "goods" }, { assetKind: "fixed_asset" }, { assetKind: "material" }), "fixed_asset");
	// нет override → поле строки
	assert.equal(decideAssetKind({ price: 1000, assetKind: "material" }, {}, { assetKind: "goods" }), "material");
	// нет override/строки → память
	assert.equal(decideAssetKind({ price: 1000 }, {}, { assetKind: "fixed_asset" }), "fixed_asset");
	// ничего нет → подсказка (дёшево → goods)
	assert.equal(decideAssetKind({ price: 1000 }, {}, null), "goods");
	// ничего нет, дорого → подсказка fixed_asset
	assert.equal(decideAssetKind({ price: 500000 }, {}, null), "fixed_asset");
});

test("resolveCounterpartyByBin: находит по БИН, иначе создаёт", async () => {
	const created = [];
	const found = { uuid: "cp-exist", bin: "111" };
	const client = {
		counterparty: {
			findFirst: async ({ where }) => (where.bin === "111" ? found : null),
			create: async ({ data }) => { created.push(data); return { uuid: "cp-new", ...data }; },
		},
	};
	assert.equal((await resolveCounterpartyByBin(client, { bin: "111" })).uuid, "cp-exist");
	const c = await resolveCounterpartyByBin(client, { bin: "222", name: "ООО Ромашка", organizationUuid: "org1" });
	assert.equal(c.uuid, "cp-new");
	assert.equal(created[0].bin, "222");
	assert.equal(created[0].name, "ООО Ромашка");
});

test("resolveOrCreateProduct: маппинг → поиск → создание", async () => {
	const created = [];
	const client = {
		product: {
			findFirst: async ({ where }) => {
				if (where.uuid === "p-map") return { uuid: "p-map" };            // по маппингу
				if (where.name === "Гвозди") return { uuid: "p-find" };          // по имени
				return null;
			},
			create: async ({ data }) => { created.push(data); return { uuid: "p-new", ...data }; },
		},
	};
	// 1) по маппингу
	assert.equal(await resolveOrCreateProduct(client, { line: { name: "X" }, mapping: { productUuid: "p-map" } }), "p-map");
	// 2) по имени/ТН ВЭД
	assert.equal(await resolveOrCreateProduct(client, { line: { name: "Гвозди" }, mapping: null }), "p-find");
	// 3) создание (материал → assetKind material)
	const uuid = await resolveOrCreateProduct(client, { line: { name: "Смазка", tnvedCode: "2710", assetKind: "material" }, mapping: null, organizationUuid: "org1" });
	assert.equal(uuid, "p-new");
	assert.equal(created[0].name, "Смазка");
	assert.equal(created[0].tnvedCode, "2710");
	assert.equal(created[0].assetKind, "material");
});

test("resolveOrCreateFixedAsset: маппинг → поиск → создание", async () => {
	const created = [];
	const client = {
		fixedAsset: {
			findFirst: async ({ where }) => {
				if (where.uuid === "fa-map") return { uuid: "fa-map" };
				if (where.name === "Станок") return { uuid: "fa-find" };
				return null;
			},
			create: async ({ data }) => { created.push(data); return { uuid: "fa-new", ...data }; },
		},
	};
	assert.equal(await resolveOrCreateFixedAsset(client, { line: { name: "X" }, mapping: { fixedAssetUuid: "fa-map" } }), "fa-map");
	assert.equal(await resolveOrCreateFixedAsset(client, { line: { name: "Станок" }, mapping: null }), "fa-find");
	const uuid = await resolveOrCreateFixedAsset(client, { line: { name: "Автопогрузчик" }, mapping: null, organizationUuid: "org1" });
	assert.equal(uuid, "fa-new");
	assert.equal(created[0].name, "Автопогрузчик");
	assert.equal(created[0].organizationUuid, "org1");
});
