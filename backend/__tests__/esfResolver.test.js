// T7.14 — единый резолвер справочников: общий кэш на сделку (ЭСФ+СНТ+ЭАВР),
// один БИН/товар/ОС резолвится ОДИН раз и не плодит дубли.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createResolverContext } from "../services/esf/resolver.js";

/** Мини-клиент prisma: считает find/create, товары/ОС создаются пустой БД. */
function makeClient() {
	const calls = { cpFind: 0, cpCreate: 0, prodFind: 0, prodCreate: 0, faFind: 0, faCreate: 0 };
	let n = 0;
	return {
		calls,
		counterparty: {
			findFirst: async () => { calls.cpFind++; return null; },
			create: async ({ data }) => { calls.cpCreate++; return { uuid: `cp-${++n}`, ...data }; },
		},
		product: {
			findFirst: async () => { calls.prodFind++; return null; },
			create: async () => { calls.prodCreate++; return { uuid: `p-${++n}` }; },
		},
		fixedAsset: {
			findFirst: async () => { calls.faFind++; return null; },
			create: async () => { calls.faCreate++; return { uuid: `fa-${++n}` }; },
		},
	};
}

test("counterpartyByBin: один БИН резолвится один раз (кэш)", async () => {
	const client = makeClient();
	const r = createResolverContext(client, { organizationUuid: "org1" });
	const a = await r.counterpartyByBin({ bin: "123", name: "ООО А" });
	const b = await r.counterpartyByBin({ bin: "123", name: "ООО А" });
	assert.equal(a.uuid, b.uuid);
	assert.equal(client.calls.cpCreate, 1, "создание контрагента ровно раз");
	assert.equal(client.calls.cpFind, 1, "поиск ровно раз (второй — из кэша)");
});

test("counterpartyByBin: без БИН — всегда создаём, не кэшируем", async () => {
	const client = makeClient();
	const r = createResolverContext(client, {});
	await r.counterpartyByBin({ bin: null, name: "Разовый" });
	await r.counterpartyByBin({ bin: null, name: "Разовый" });
	assert.equal(client.calls.cpCreate, 2, "оба раза создаём (нет ключа кэша)");
});

test("product: одинаковый ТН ВЭД+имя из разных импортов сделки → один товар", async () => {
	const client = makeClient();
	const r = createResolverContext(client, { organizationUuid: "org1" });
	// ЭСФ
	const p1 = await r.product({ line: { name: "Гвозди", tnvedCode: "7317" } });
	// СНТ (та же сделка, тот же товар)
	const p2 = await r.product({ line: { name: "Гвозди", tnvedCode: "7317" } });
	assert.equal(p1, p2);
	assert.equal(client.calls.prodCreate, 1, "товар создан один раз на сделку");
});

test("product: адресный маппинг идёт мимо кэша", async () => {
	const client = makeClient();
	client.product.findFirst = async ({ where }) => (where.uuid === "p-map" ? { uuid: "p-map" } : null);
	const r = createResolverContext(client, {});
	const p = await r.product({ line: { name: "X" }, mapping: { productUuid: "p-map" } });
	assert.equal(p, "p-map");
	assert.equal(client.calls.prodCreate, 0);
});

test("fixedAsset: одинаковое имя → одно ОС на сделку", async () => {
	const client = makeClient();
	const r = createResolverContext(client, {});
	const a = await r.fixedAsset({ line: { name: "Станок" } });
	const b = await r.fixedAsset({ line: { name: " станок " } }); // нормализация имени
	assert.equal(a, b);
	assert.equal(client.calls.faCreate, 1);
});

test("параллельный разнос строк дедуплится (in-flight промис)", async () => {
	const client = makeClient();
	const r = createResolverContext(client, {});
	const [a, b] = await Promise.all([
		r.product({ line: { name: "Смазка", tnvedCode: "2710" } }),
		r.product({ line: { name: "Смазка", tnvedCode: "2710" } }),
	]);
	assert.equal(a, b);
	assert.equal(client.calls.prodCreate, 1, "нет гонки создания");
});
