// Проверка БИН РК (И1 плана PLAN_INSTALL_MODES_2026-09-24.md).
import test from "node:test";
import assert from "node:assert/strict";
import { isValidBin, binChecksum } from "../utils/bin.js";

test("настоящие БИН проходят строгую проверку", () => {
	// Взяты из живой базы: если алгоритм сломается, форма регистрации начнёт отвергать
	// реальные организации — а это худший исход из возможных.
	for (const b of ["001040001278", "500210402594", "831111302342"]) {
		assert.ok(isValidBin(b, { strict: true }), b);
	}
});

test("выдуманные номера строгую проверку не проходят", () => {
	for (const b of ["999000000002", "231231231235", "123456789012"]) {
		assert.equal(isValidBin(b, { strict: true }), false, b);
	}
});

test("мягкая проверка пропускает всё, что похоже на БИН", () => {
	// Данные ИЗВНЕ (1С, гос-системы, старые записи) ужесточать задним числом нельзя:
	// получим отказ на том, что уже живёт в учёте.
	assert.ok(isValidBin("999000000002"));
	assert.ok(isValidBin("123456789012"));
	assert.equal(isValidBin("12345"), false, "не 12 цифр");
	assert.equal(isValidBin("abcdefghijkl"), false);
	assert.equal(isValidBin("111111111111"), false, "все цифры одинаковые — номер бессмысленный");
});

test("контрольный разряд считается по второй схеме, когда первая даёт 10", () => {
	const c = binChecksum([..."00104000127"]);
	assert.equal(c, 8);
});
