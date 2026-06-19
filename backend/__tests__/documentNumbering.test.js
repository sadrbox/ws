// Юнит-тесты формата номера документа (allocateNumber/peekNextNumber) на
// мок-клиенте — без БД.
//
// Контракт: следующий номер = max(числовых частей ФАКТИЧЕСКИХ номеров ряда за
// год) + 1 (журнал — единственный источник истины, без хранимого счётчика).
// Номер хранится и отображается без ведущих нулей, префикс инлайн («РЕАЛ-42»).
import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateNumber, peekNextNumber, invalidateNumberSettingsCache, renumberDraftDocuments, reformatNumber, normalizeDocNumber, docNumberDigitLength } from "../services/documentNumbering.js";
import { resolveDocumentNumber } from "../services/documentNumberAssign.js";

// Мок prisma:
//  • documentNumberSetting.findMany → настройки нумерации (префикс/enabled);
//  • $queryRawUnsafe("...maxnum...") → max числовой части номеров за год (jmax).
function mockClient({ settings = [], jmax = 0 } = {}) {
	return {
		documentNumberSetting: { findMany: async () => settings },
		$queryRawUnsafe: async (sql) => {
			if (/maxnum/i.test(sql)) return [{ maxnum: jmax }];
			return [];
		},
	};
}

const D = new Date("2026-01-01");

// ── Нормализация / отображение ──────────────────────────────────────────────
test("normalizeDocNumber: срезает ведущие нули числовой части", () => {
	assert.equal(normalizeDocNumber("74"), "74");
	assert.equal(normalizeDocNumber("00074"), "74");
	assert.equal(normalizeDocNumber("000000074"), "74");
	assert.equal(normalizeDocNumber("РЕАЛ-000042"), "РЕАЛ-42");
	assert.equal(normalizeDocNumber("000"), "0");
	assert.equal(normalizeDocNumber("  РЕАЛ-007  "), "РЕАЛ-7");
	assert.equal(normalizeDocNumber(""), "");
});

test("docNumberDigitLength: длина нормализованной числовой части", () => {
	assert.equal(docNumberDigitLength("РЕАЛ-000042"), 2);
	assert.equal(docNumberDigitLength("000000074"), 2);
	assert.equal(docNumberDigitLength("123456789"), 9);
	assert.equal(docNumberDigitLength("РЕАЛ-"), 0);
});

// ── Единый алгоритм присвоения номера (кнопка + сохранение) ──
test("resolveDocumentNumber: ручной ввод нормализуется (срезаются ведущие нули)", async () => {
	assert.equal(await resolveDocumentNumber({ docType: "sale", manual: "РЕАЛ-000007", existingNumber: "000003" }), "РЕАЛ-7");
});

test("resolveDocumentNumber: при СОХРАНЕНИИ существующий номер не «прыгает» (нормализуется по позиции)", async () => {
	invalidateNumberSettingsCache();
	const client = mockClient({ settings: [{ organizationUuid: "__global__", docType: "sale", prefix: "", enabled: true }] });
	// reformatExisting НЕ задан (как при сохранении) → позиция 3 сохраняется → «ПГРМ-3».
	assert.equal(await resolveDocumentNumber({ docType: "sale", manual: "", existingNumber: "ПГРМ-000003" }, {}, client), "ПГРМ-3");
});

test("resolveDocumentNumber: КНОПКА (reformatExisting) приводит существующий к текущим настройкам", async () => {
	invalidateNumberSettingsCache();
	const client = mockClient({ settings: [{ organizationUuid: "__global__", docType: "sale", prefix: "", enabled: true }] });
	assert.equal(await resolveDocumentNumber({ docType: "sale", manual: "", existingNumber: "ПГРМ-000003" }, { reformatExisting: true }, client), "3");
});

test("resolveDocumentNumber: новый (пусто, без existing) → max(факт.) + 1", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await resolveDocumentNumber({ docType: "sale", manual: "", date: D }, { preview: false }, mockClient({ jmax: 4 })), "5");
});

test("resolveDocumentNumber preview (кнопка): новый → max(факт.) + 1", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await resolveDocumentNumber({ docType: "sale", manual: "", date: D }, { preview: true }, mockClient({ jmax: 4 })), "5");
});

test("пустой журнал → 1 (без префикса)", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await allocateNumber("sale", null, D, mockClient({ jmax: 0 })), "1");
});

test("номер = max(факт.) + 1, без ведущих нулей", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await allocateNumber("sale", null, D, mockClient({ jmax: 41 })), "42");
});

test("следующий считается от ФАКТИЧЕСКОГО максимума (удалили верхний 3 → max=2 → следующий 3)", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await allocateNumber("sale", null, D, mockClient({ jmax: 2 })), "3");
});

test("ручная правка номеров отражается сразу (факт. max=5 → следующий 6, без дрейфа счётчика)", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await allocateNumber("sale", null, D, mockClient({ jmax: 5 })), "6");
});

test("пустой префикс в настройках → номер без дефиса и без нулей", async () => {
	invalidateNumberSettingsCache();
	const client = mockClient({ settings: [{ organizationUuid: "__global__", docType: "sale", prefix: "", enabled: true }], jmax: 6 });
	assert.equal(await allocateNumber("sale", null, D, client), "7");
});

test("заданный префикс → ПРЕФ-<число без нулей>", async () => {
	invalidateNumberSettingsCache();
	const client = mockClient({ settings: [{ organizationUuid: "__global__", docType: "sale", prefix: "РЕАЛ", enabled: true }], jmax: 41 });
	assert.equal(await allocateNumber("sale", null, D, client), "РЕАЛ-42");
});

test("enabled=false игнорируется — номер всё равно выделяется", async () => {
	invalidateNumberSettingsCache();
	const client = mockClient({ settings: [{ organizationUuid: "__global__", docType: "sale", prefix: "", enabled: false }], jmax: 0 });
	assert.equal(await allocateNumber("sale", null, D, client), "1");
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
			{ organizationUuid: "__global__", docType: "sale", prefix: "ГЛОБ", enabled: true },
			{ organizationUuid: org, docType: "sale", prefix: "ОРГ", enabled: true },
		],
		jmax: 4,
	});
	assert.equal(await allocateNumber("sale", org, D, client), "ОРГ-5");
});

// ── peekNextNumber: тот же источник, что allocateNumber (max(факт.)+1) ──

test("peek: следующий = max(факт.) + 1", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await peekNextNumber("sale", null, D, mockClient({ jmax: 5 })), "6");
});

test("peek: совпадает с allocate (тот же jmax → тот же номер)", async () => {
	invalidateNumberSettingsCache();
	const client = mockClient({ jmax: 10 });
	assert.equal(await peekNextNumber("sale", null, D, client), "11");
});

test("peek: даже при enabled=false предлагает номер (явное действие пользователя)", async () => {
	invalidateNumberSettingsCache();
	const client = mockClient({ settings: [{ organizationUuid: "__global__", docType: "sale", prefix: "", enabled: false }], jmax: 4 });
	assert.equal(await peekNextNumber("sale", null, D, client), "5");
});

test("reformatNumber: переприсвоение сохраняет позицию (ПГРМ-000003 → 3 после снятия префикса)", async () => {
	invalidateNumberSettingsCache();
	const client = { documentNumberSetting: { findMany: async () => [{ organizationUuid: "__global__", docType: "sale", prefix: "", enabled: true }] } };
	assert.equal(await reformatNumber("sale", null, "ПГРМ-000003", client), "3");
});

test("reformatNumber: смена префикса сохраняет число (000003 → НОВ-3)", async () => {
	invalidateNumberSettingsCache();
	const client = { documentNumberSetting: { findMany: async () => [{ organizationUuid: "__global__", docType: "sale", prefix: "НОВ", enabled: true }] } };
	assert.equal(await reformatNumber("sale", null, "000003", client), "НОВ-3");
});

test("renumberDraftDocuments: нормализует черновики под новый префикс (числовая часть сохраняется, нули срезаются)", async () => {
	invalidateNumberSettingsCache();
	const updates = [];
	const client = {
		documentNumberSetting: {
			findMany: async () => [{ organizationUuid: "__global__", docType: "sale", prefix: "РЕАЛ", enabled: true }],
		},
		$queryRawUnsafe: async (sql, ...params) => {
			if (/^SELECT/.test(sql)) return [
				{ uuid: "u1", number: "000001", date: D, organizationUuid: null },        // старый формат → нормализация «РЕАЛ-1»
				{ uuid: "u2", number: "РЕАЛ-000000002", date: D, organizationUuid: null }, // легаси-паддинг → «РЕАЛ-2»
			];
			if (/^UPDATE/.test(sql)) { updates.push({ number: params[0], uuid: params[1] }); return []; }
			return [];
		},
	};
	const r = await renumberDraftDocuments("sale", null, client);
	assert.equal(r.updated, 2);
	assert.equal(r.skipped, 0);
	assert.deepEqual(updates, [{ number: "РЕАЛ-1", uuid: "u1" }, { number: "РЕАЛ-2", uuid: "u2" }]);
});
