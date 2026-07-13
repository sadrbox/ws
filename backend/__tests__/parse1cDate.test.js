// ─────────────────────────────────────────────────────────────────────────────
// Разбор даты события 1С.
//
// Симптом: 1С получала HTTP 500 «Ошибка сервера при приёме события» и ретраила
// (3 попытки на событие). Причина — actionDate «13.07.2026 23:22:04»: new Date()
// такое не парсит, получался Invalid Date, и Prisma отвергала весь запрос.
// Событие терялось целиком из-за формата ОДНОГО реквизита.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse1cDate } from "../utils/parse1cDate.js";

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;

test("русский формат 1С — то, что реально прислала 1С", () => {
	assert.equal(iso(parse1cDate("13.07.2026 23:22:04")), "2026-07-13 23:22:04");
	assert.equal(iso(parse1cDate("01.01.2026")), "2026-01-01 00:00:00");
	// Именно на этом значении раньше падал POST /pipe.
	assert.ok(parse1cDate("13.07.2026 23:22:04") instanceof Date);
});

test("ISO и компактный формат тоже понимаем", () => {
	assert.equal(iso(parse1cDate("2026-07-13T23:22:04")), "2026-07-13 23:22:04");
	assert.equal(iso(parse1cDate("20260713232204")), "2026-07-13 23:22:04");
	assert.equal(iso(parse1cDate("20260713")), "2026-07-13 00:00:00");
});

test("день и месяц не путаются местами (13.07 — это 13 июля, а не 7 декабря)", () => {
	const d = parse1cDate("13.07.2026 10:00:00");
	assert.equal(d.getDate(), 13);
	assert.equal(d.getMonth(), 6); // июль
});

test("нераспознанное → null: событие сохраняем, дату подставляем сами", () => {
	assert.equal(parse1cDate("что-то не то"), null);
	assert.equal(parse1cDate(""), null);
	assert.equal(parse1cDate(null), null);
	assert.equal(parse1cDate(undefined), null);
	assert.equal(parse1cDate("32.13.2026"), null, "несуществующая дата не должна стать «валидной»");
});
