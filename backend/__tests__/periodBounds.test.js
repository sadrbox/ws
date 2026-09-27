// Границы суток/месяца в поясе организации (У5 аудита 26.09) — без БД.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	tzOffsetMinutes,
	calendarDateOf,
	startOfLocalDay,
	endOfLocalDay,
	periodBounds,
	localMonthIndex,
	yearBounds,
	dateRangeWhere,
	BadDateError,
	orgTimeZone,
} from "../services/periodBounds.js";

const TZ = "Asia/Almaty";

test("смещение Алматы: +6 до 01.03.2024, +5 после", () => {
	assert.equal(tzOffsetMinutes(new Date("2023-06-01T00:00:00Z"), TZ), 360);
	assert.equal(tzOffsetMinutes(new Date("2026-06-01T00:00:00Z"), TZ), 300);
});

test("пояс по умолчанию — Asia/Almaty, переопределяется ACCOUNTING_TIME_ZONE", () => {
	const prev = process.env.ACCOUNTING_TIME_ZONE;
	delete process.env.ACCOUNTING_TIME_ZONE;
	assert.equal(orgTimeZone("org"), "Asia/Almaty");
	process.env.ACCOUNTING_TIME_ZONE = "Asia/Aqtobe";
	assert.equal(orgTimeZone("org"), "Asia/Aqtobe");
	if (prev === undefined) delete process.env.ACCOUNTING_TIME_ZONE;
	else process.env.ACCOUNTING_TIME_ZONE = prev;
});

test("календарная дата: полночь UTC, местная полночь и строка дают один день", () => {
	const want = { y: 2026, m: 6, d: 1 };
	assert.deepEqual(calendarDateOf("2026-06-01T00:00:00.000Z", TZ), want); // форма «Закрытие месяца»
	assert.deepEqual(calendarDateOf("2026-05-31T19:00:00.000Z", TZ), want); // местная полночь
	assert.deepEqual(calendarDateOf("2026-06-01", TZ), want); // фильтр отчёта
	assert.equal(calendarDateOf("мусор", TZ), null);
	assert.equal(calendarDateOf(null, TZ), null);
});

test("сутки — местные: начало 00:00 и конец 23:59:59.999 по Алматы", () => {
	assert.equal(startOfLocalDay("2026-06-01", TZ).toISOString(), "2026-05-31T19:00:00.000Z");
	assert.equal(endOfLocalDay("2026-06-30", TZ).toISOString(), "2026-06-30T18:59:59.999Z");
});

test("документ 01.06 00:30 по Алматы попадает в июнь, а не в май и не в «щель» между ними", () => {
	const doc = new Date("2026-06-01T00:30:00+05:00"); // = 2026-05-31T19:30Z
	// Периоды — так, как их хранит форма: полночь UTC первого и последнего дня.
	const may = periodBounds("2026-05-01T00:00:00.000Z", "2026-05-31T00:00:00.000Z", TZ);
	const june = periodBounds("2026-06-01T00:00:00.000Z", "2026-06-30T00:00:00.000Z", TZ);
	const inside = (b) => doc >= b.start && doc <= b.end;
	assert.equal(inside(may), false, "не май");
	assert.equal(inside(june), true, "июнь");
	// Границы стыкуются без щели: конец мая + 1 мс = начало июня.
	assert.equal(may.end.getTime() + 1, june.start.getTime());
});

test("месяц ввода ОС — местный: 01.06 00:00 по Алматы — это июнь", () => {
	const put = new Date("2026-06-01T00:00:00+05:00");
	assert.equal(localMonthIndex(put, TZ), 2026 * 12 + 5);
	// По UTC тот же момент — ещё май (старое поведение).
	assert.equal(put.getUTCMonth(), 4);
});

test("год — местный: [01.01 00:00, 01.01 следующего) по Алматы", () => {
	const b = yearBounds(2026, TZ);
	assert.equal(b.start.toISOString(), "2025-12-31T19:00:00.000Z");
	assert.equal(b.end.toISOString(), "2026-12-31T19:00:00.000Z");
});

test("фильтр отчёта: обе даты включительно, мусор → BadDateError", () => {
	const r = dateRangeWhere("2026-06-01", "2026-06-30", TZ);
	assert.equal(r.gte.toISOString(), "2026-05-31T19:00:00.000Z");
	assert.equal(r.lte.toISOString(), "2026-06-30T18:59:59.999Z");
	assert.equal(dateRangeWhere("", "", TZ), null);
	assert.throws(() => dateRangeWhere("2026-13-45x", null, TZ), (e) => e instanceof BadDateError);
	assert.throws(() => dateRangeWhere(null, "2026-13-01", TZ), (e) => e instanceof BadDateError);
});
