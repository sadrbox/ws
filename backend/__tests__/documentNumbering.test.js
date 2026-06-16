// Юнит-тесты формата номера документа (allocateNumber/peekNextNumber) на
// мок-клиенте — без БД.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateNumber, peekNextNumber, invalidateNumberSettingsCache } from "../services/documentNumbering.js";

// Мок prisma: настройки нумерации + счётчик + raw-запросы.
//  • $queryRawUnsafe("...maxnum...") → максимум журнала за год (jmax);
//  • $queryRawUnsafe("INSERT ... RETURNING lastValue") → итоговый lastValue (seq);
//  • documentSequence.findUnique → текущий счётчик (для peek).
function mockClient({ settings = [], seq = 1, jmax = 0 } = {}) {
	return {
		documentNumberSetting: { findMany: async () => settings },
		documentSequence: { findUnique: async () => ({ lastValue: seq }) },
		$queryRawUnsafe: async (sql) => {
			if (/maxnum/i.test(sql)) return [{ maxnum: jmax }];
			return [{ lastValue: seq }]; // INSERT ... RETURNING "lastValue"
		},
	};
}

const D = new Date("2026-01-01");

test("без настроек → 000001 (6 разрядов по умолчанию, без префикса)", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await allocateNumber("sale", null, D, mockClient({ seq: 1 })), "000001");
});

test("счётчик дополняется нулями до 6 разрядов (умолч.)", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await allocateNumber("sale", null, D, mockClient({ seq: 42 })), "000042");
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

test("enabled=false → null (нумерация выключена — документ без номера, по ID)", async () => {
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

// ── peekNextNumber: единый источник с allocateNumber, без изменения счётчика ──

test("peek: следующий = счётчик + 1 (когда счётчик ≥ журнала)", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await peekNextNumber("sale", null, D, mockClient({ seq: 5, jmax: 3 })), "000006");
});

test("peek: самовосстановление до максимума журнала (ручной ввод/импорт)", async () => {
	invalidateNumberSettingsCache();
	// счётчик отстал (2), в журнале есть 10 → следующий 11.
	assert.equal(await peekNextNumber("sale", null, D, mockClient({ seq: 2, jmax: 10 })), "000011");
});

test("peek: даже при enabled=false предлагает номер (явное действие пользователя)", async () => {
	invalidateNumberSettingsCache();
	// Автонумерация выключена, но кнопка «Присвоить номер» всё равно подсказывает.
	const client = mockClient({ settings: [{ organizationUuid: "__global__", docType: "sale", prefix: "", padding: 6, enabled: false }], seq: 4, jmax: 0 });
	assert.equal(await peekNextNumber("sale", null, D, client), "000005");
});
