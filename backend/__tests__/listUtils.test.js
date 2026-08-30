// T12.2 — чистые утилиты списков: idSearchCondition (защита int4 при поиске по ID —
// на ней держится фикс бага idNum) и buildOrderBy (безопасный orderBy по СХЕМЕ).
// HEADLESS: idSearchCondition без зависимостей; buildOrderBy читает Prisma.dmmf
// (статичная схема, БЕЗ подключения к БД).
import { test } from "node:test";
import assert from "node:assert/strict";
import { idSearchCondition } from "../utils/searchId.js";
import { buildOrderBy } from "../utils/sortOrder.js";

test("idSearchCondition: обычный ID → {id:{equals}}", () => {
	assert.deepEqual(idSearchCondition("5"), { id: { equals: 5 } });
	assert.deepEqual(idSearchCondition("173"), { id: { equals: 173 } });
});

test("idSearchCondition: длинное число (EAN-13/БИН) > int4 → null (не роняем в Postgres)", () => {
	assert.equal(idSearchCondition("4650123456789"), null); // EAN-13
	assert.equal(idSearchCondition("2147483648"), null);     // INT4_MAX + 1
	assert.deepEqual(idSearchCondition("2147483647"), { id: { equals: 2147483647 } }); // ровно граница
});

test("idSearchCondition: не-ID → null", () => {
	assert.equal(idSearchCondition("abc"), null);
	assert.equal(idSearchCondition("0"), null);
	assert.equal(idSearchCondition("-3"), null);
	assert.equal(idSearchCondition("1.5"), null);
	assert.equal(idSearchCondition(""), null);
});

test("buildOrderBy: валидный скаляр + тай-брейк по id", () => {
	assert.deepEqual(buildOrderBy("sale", '{"number":"asc"}'), [{ number: "asc" }, { id: "asc" }]);
});

test("buildOrderBy: виртуальная/несуществующая колонка игнорируется → fallback", () => {
	assert.deepEqual(buildOrderBy("sale", '{"serials":"asc"}'), [{ id: "asc" }]);
	assert.deepEqual(buildOrderBy("sale", '{"serials":"asc"}', { fallback: { id: "desc" } }), [{ id: "desc" }]);
});

test("buildOrderBy: путь связь.поле выводится из схемы", () => {
	assert.deepEqual(buildOrderBy("sale", '{"counterparty.name":"desc"}'),
		[{ counterparty: { name: "desc" } }, { id: "asc" }]);
});

test("buildOrderBy: некорректное направление игнорируется", () => {
	assert.deepEqual(buildOrderBy("sale", '{"number":"боком"}'), [{ id: "asc" }]);
});

test("buildOrderBy: битый JSON → fallback", () => {
	assert.deepEqual(buildOrderBy("sale", "не json", { fallback: { id: "desc" } }), [{ id: "desc" }]);
});

test("buildOrderBy: сортировка уже по id → без двойного тай-брейка", () => {
	assert.deepEqual(buildOrderBy("sale", '{"id":"desc"}'), [{ id: "desc" }]);
});
