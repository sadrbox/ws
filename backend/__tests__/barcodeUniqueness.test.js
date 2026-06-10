// Юнит-тесты проверки уникальности штрих-кода на мок-клиенте — без БД.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findBarcodeOwner, assertBarcodeUnique } from "../utils/barcodeUniqueness.js";

function mockClient({ pb = null, pr = null, capture } = {}) {
	return {
		productBarcode: { findFirst: async (args) => { capture?.("pb", args); return pb; } },
		product: { findFirst: async (args) => { capture?.("pr", args); return pr; } },
	};
}

test("свободный штрих-код → null", async () => {
	assert.equal(await findBarcodeOwner("123", null, mockClient()), null);
});

test("пустой/пробельный штрих-код → null (без запроса)", async () => {
	let queried = false;
	const client = mockClient({ pb: { productUuid: "x" }, capture: () => { queried = true; } });
	assert.equal(await findBarcodeOwner("   ", null, client), null);
	assert.equal(queried, false);
});

test("занят доп.штрих-кодом другого товара → его productUuid", async () => {
	assert.equal(await findBarcodeOwner("123", null, mockClient({ pb: { productUuid: "owner-1" } })), "owner-1");
});

test("занят основным Product.barcode → его uuid (когда нет в ProductBarcode)", async () => {
	assert.equal(await findBarcodeOwner("123", null, mockClient({ pb: null, pr: { uuid: "owner-2" } })), "owner-2");
});

test("exceptProductUuid исключает свой товар из проверки", async () => {
	const seen = {};
	const client = mockClient({ pb: null, pr: null, capture: (m, a) => { seen[m] = a.where; } });
	await findBarcodeOwner("123", "self-uuid", client);
	assert.deepEqual(seen.pb.productUuid, { not: "self-uuid" });
	assert.deepEqual(seen.pr.uuid, { not: "self-uuid" });
});

test("assertBarcodeUnique бросает (code BARCODE_DUPLICATE) при занятом ШК", async () => {
	await assert.rejects(
		() => assertBarcodeUnique("123", null, mockClient({ pb: { productUuid: "owner" } })),
		(err) => err.code === "BARCODE_DUPLICATE" && /уже используется/.test(err.message),
	);
});

test("assertBarcodeUnique не бросает при свободном ШК", async () => {
	await assert.doesNotReject(() => assertBarcodeUnique("123", null, mockClient()));
});
