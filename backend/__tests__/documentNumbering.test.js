// Юнит-тесты формата номера документа (allocateNumber/peekNextNumber) на
// мок-клиенте — без БД.
//
// Контракт: номер ХРАНИТСЯ и ОТОБРАЖАЕТСЯ без ведущих нулей (нормализованным),
// префикс остаётся инлайн («РЕАЛ-42», «42»). allocateNumber/peek/resolve
// возвращают «голые» значения (без дополнения нулями).
import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateNumber, peekNextNumber, invalidateNumberSettingsCache, renumberDraftDocuments, reformatNumber, normalizeDocNumber, docNumberDigitLength } from "../services/documentNumbering.js";
import { resolveDocumentNumber } from "../services/documentNumberAssign.js";

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
	const client = mockClient({ settings: [{ organizationUuid: "__global__", docType: "sale", prefix: "", padding: 9, enabled: true }] });
	// reformatExisting НЕ задан (как при сохранении) → позиция 3 сохраняется → «ПГРМ-3».
	assert.equal(await resolveDocumentNumber({ docType: "sale", manual: "", existingNumber: "ПГРМ-000003" }, {}, client), "ПГРМ-3");
});

test("resolveDocumentNumber: КНОПКА (reformatExisting) приводит существующий к текущим настройкам", async () => {
	invalidateNumberSettingsCache();
	const client = mockClient({ settings: [{ organizationUuid: "__global__", docType: "sale", prefix: "", padding: 9, enabled: true }] });
	assert.equal(await resolveDocumentNumber({ docType: "sale", manual: "", existingNumber: "ПГРМ-000003" }, { reformatExisting: true }, client), "3");
});

test("resolveDocumentNumber: новый (пусто, без existing) → следующий по счётчику", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await resolveDocumentNumber({ docType: "sale", manual: "", date: D }, { preview: false }, mockClient({ seq: 5 })), "5");
});

test("resolveDocumentNumber preview (кнопка): новый → следующий без инкремента", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await resolveDocumentNumber({ docType: "sale", manual: "", date: D }, { preview: true }, mockClient({ seq: 4, jmax: 0 })), "5");
});

test("без настроек → 1 (хранение без ведущих нулей, без префикса)", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await allocateNumber("sale", null, D, mockClient({ seq: 1 })), "1");
});

test("счётчик хранится без ведущих нулей", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await allocateNumber("sale", null, D, mockClient({ seq: 42 })), "42");
});

test("пустой префикс в настройках → номер без дефиса и без нулей", async () => {
	invalidateNumberSettingsCache();
	const client = mockClient({ settings: [{ organizationUuid: "__global__", docType: "sale", prefix: "", padding: 9, enabled: true }], seq: 7 });
	assert.equal(await allocateNumber("sale", null, D, client), "7");
});

test("заданный префикс → ПРЕФ-<число без нулей>", async () => {
	invalidateNumberSettingsCache();
	const client = mockClient({ settings: [{ organizationUuid: "__global__", docType: "sale", prefix: "РЕАЛ", padding: 6, enabled: true }], seq: 42 });
	assert.equal(await allocateNumber("sale", null, D, client), "РЕАЛ-42");
});

test("enabled=false игнорируется — нумерация используется всегда (номер выделяется)", async () => {
	invalidateNumberSettingsCache();
	const client = mockClient({ settings: [{ organizationUuid: "__global__", docType: "sale", prefix: "", padding: 9, enabled: false }], seq: 1, jmax: 0 });
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
			{ organizationUuid: "__global__", docType: "sale", prefix: "ГЛОБ", padding: 9, enabled: true },
			{ organizationUuid: org, docType: "sale", prefix: "ОРГ", padding: 4, enabled: true },
		],
		seq: 5,
	});
	assert.equal(await allocateNumber("sale", org, D, client), "ОРГ-5");
});

// ── peekNextNumber: единый источник с allocateNumber, без изменения счётчика ──

test("peek: следующий = счётчик + 1 (когда счётчик ≥ журнала)", async () => {
	invalidateNumberSettingsCache();
	assert.equal(await peekNextNumber("sale", null, D, mockClient({ seq: 5, jmax: 3 })), "6");
});

test("peek: самовосстановление до максимума журнала (ручной ввод/импорт)", async () => {
	invalidateNumberSettingsCache();
	// счётчик отстал (2), в журнале есть 10 → следующий 11.
	assert.equal(await peekNextNumber("sale", null, D, mockClient({ seq: 2, jmax: 10 })), "11");
});

test("peek: даже при enabled=false предлагает номер (явное действие пользователя)", async () => {
	invalidateNumberSettingsCache();
	// Автонумерация выключена, но кнопка «Присвоить номер» всё равно подсказывает.
	const client = mockClient({ settings: [{ organizationUuid: "__global__", docType: "sale", prefix: "", padding: 6, enabled: false }], seq: 4, jmax: 0 });
	assert.equal(await peekNextNumber("sale", null, D, client), "5");
});

test("reformatNumber: переприсвоение сохраняет позицию (ПГРМ-000003 → 3 после снятия префикса)", async () => {
	invalidateNumberSettingsCache();
	const client = { documentNumberSetting: { findMany: async () => [{ organizationUuid: "__global__", docType: "sale", prefix: "", padding: 6, enabled: true }] } };
	assert.equal(await reformatNumber("sale", null, "ПГРМ-000003", client), "3");
});

test("reformatNumber: смена префикса сохраняет число (000003 → НОВ-3)", async () => {
	invalidateNumberSettingsCache();
	const client = { documentNumberSetting: { findMany: async () => [{ organizationUuid: "__global__", docType: "sale", prefix: "НОВ", padding: 9, enabled: true }] } };
	assert.equal(await reformatNumber("sale", null, "000003", client), "НОВ-3");
});

test("renumberDraftDocuments: нормализует черновики под новый префикс (числовая часть сохраняется, нули срезаются)", async () => {
	invalidateNumberSettingsCache();
	const updates = [];
	const client = {
		documentNumberSetting: {
			findMany: async () => [{ organizationUuid: "__global__", docType: "sale", prefix: "РЕАЛ", padding: 9, enabled: true }],
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
