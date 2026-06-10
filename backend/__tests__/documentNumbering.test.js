// Юнит-тесты формата номера документа (allocateNumber) на мок-клиенте — без БД.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateNumber, invalidateNumberSettingsCache } from "../services/documentNumbering.js";

// Мок prisma: настройки нумерации + счётчик последовательности.
function mockClient({ settings = [], seq = 1 } = {}) {
	return {
		documentNumberSetting: { findMany: async () => settings },
		documentSequence: { upsert: async () => ({ lastValue: seq }) },
	};
}

const D = new Date("2026-01-01");

test("без настроек → 000000001 (9 разрядов, без префикса)", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await allocateNumber("sale", null, D, mockClient({ seq: 1 })), "000000001");
});

test("счётчик дополняется нулями до 9 разрядов", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await allocateNumber("sale", null, D, mockClient({ seq: 42 })), "000000042");
});

test("пустой префикс в настройках → номер без дефиса", async () => {
	invalidateNumberSettingsCache();
	const client = mockClient({ settings: [{ organizationUuid: "__global__", docType: "sale", prefix: "", padding: 9, enabled: true }], seq: 7 });
	assert.equal(await allocateNumber("sale", null, D, client), "000000007");
});

test("заданный префикс → ПРЕФ-<padded>", async () => {
	invalidateNumberSettingsCache();
	const client = mockClient({ settings: [{ organizationUuid: "__global__", docType: "sale", prefix: "РЕАЛ", padding: 6, enabled: true }], seq: 42 });
	assert.equal(await allocateNumber("sale", null, D, client), "РЕАЛ-000042");
});

test("enabled=false → null (номер не присваивается)", async () => {
	invalidateNumberSettingsCache();
	const client = mockClient({ settings: [{ organizationUuid: "__global__", docType: "sale", prefix: "", padding: 9, enabled: false }] });
	assert.equal(await allocateNumber("sale", null, D, client), null);
});

test("неизвестный вид документа → null", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await allocateNumber("not_a_doc_type", null, D, mockClient()), null);
});

test("настройка организации переопределяет глобальную", async () => {
	invalidateNumberSettingsCache();
	const org = "org-uuid-1";
	const client = mockClient({
		settings: [
			{ organizationUuid: "__global__", docType: "sale", prefix: "ГЛОБ", padding: 9, enabled: true },
			{ organizationUuid: org, docType: "sale", prefix: "ОРГ", padding: 4, enabled: true },
		],
		seq: 5,
	});
	assert.equal(await allocateNumber("sale", org, D, client), "ОРГ-0005");
});
