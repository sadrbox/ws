// E17: производственный календарь — сетка месяца, рабочие дни, сверка с законом.
import { describe, it, expect } from "vitest";
import {
	calendarEntries, indexCalendar, isoWeekday, isWorkingDay, monthGrid, toCalendarRows, validateDay,
	workingDaysInMonth, workingDaysInYear,
} from "src/models/WorkCalendar/calendarView";
import type { CalendarDay } from "src/services/quality/api";

/** Март 2026 по закону РК: 8 марта — воскресенье, Наурыз 21–23 — сб, вс, пн; переносы 9, 24, 25 марта. */
const MARCH_2026: CalendarDay[] = [
	{ date: "2026-03-08", kind: "holiday", name: "Международный женский день" },
	{ date: "2026-03-09", kind: "dayoff", name: "Перенос выходного" },
	{ date: "2026-03-21", kind: "holiday", name: "Наурыз мейрамы" },
	{ date: "2026-03-22", kind: "holiday", name: "Наурыз мейрамы" },
	{ date: "2026-03-23", kind: "holiday", name: "Наурыз мейрамы" },
	{ date: "2026-03-24", kind: "dayoff", name: "Перенос выходного" },
	{ date: "2026-03-25", kind: "dayoff", name: "Перенос выходного" },
];
const FIVE_DAYS = "1,2,3,4,5";

describe("сетка месяца", () => {
	it("день недели по дате, без пояса браузера", () => {
		expect(isoWeekday("2026-03-01")).toBe(7);
		expect(isoWeekday("2026-03-02")).toBe(1);
		expect(isoWeekday("2026-09-25")).toBe(5);
	});

	it("недели с понедельника; пустые клетки до 1-го и после последнего числа", () => {
		const weeks = monthGrid(2026, 3, indexCalendar(MARCH_2026), FIVE_DAYS);
		expect(weeks.every((w) => w.length === 7)).toBe(true);
		// 1 марта 2026 — воскресенье: шесть пустых клеток перед ним.
		expect(weeks[0].slice(0, 6)).toEqual([null, null, null, null, null, null]);
		expect(weeks[0][6]?.day).toBe(1);
		const days = weeks.flat().filter(Boolean);
		expect(days).toHaveLength(31);
		expect(weeks.flat().at(-1)).toBeNull(); // 31 марта — вторник, дальше пусто
	});

	it("праздник и перенос — не рабочие; рабочий день-перенос в субботу — рабочий", () => {
		const idx = indexCalendar([...MARCH_2026, { date: "2026-03-28", kind: "workday", name: "Перенос рабочего дня" }]);
		const cells = new Map(monthGrid(2026, 3, idx, FIVE_DAYS, "2026-03-10").flat().filter((c) => c).map((c) => [c!.ymd, c!]));
		expect(cells.get("2026-03-09")?.working).toBe(false);
		expect(cells.get("2026-03-23")?.working).toBe(false);
		expect(cells.get("2026-03-28")?.working).toBe(true);
		expect(cells.get("2026-03-10")?.working).toBe(true);
		expect(cells.get("2026-03-10")?.today).toBe(true);
		expect(cells.get("2026-03-14")?.working).toBe(false); // обычная суббота
	});

	it("рабочие дни месяца и года: как у сервера (неделя фирмы + календарь)", () => {
		const idx = indexCalendar(MARCH_2026);
		// 22 будних дня марта 2026 минус 9, 23, 24, 25 марта.
		expect(workingDaysInMonth(2026, 3, idx, FIVE_DAYS)).toBe(18);
		// Шестидневка: субботы 7, 14, 28 — рабочие; 21 — праздник.
		expect(workingDaysInMonth(2026, 3, idx, "1,2,3,4,5,6")).toBe(21);
		expect(workingDaysInYear(2025, indexCalendar([]), FIVE_DAYS)).toBe(261);
		expect(isWorkingDay(6, null, [true, true, true, true, true, false, false])).toBe(false);
	});
});

describe("сверка с законом", () => {
	it("как по закону, изменено, внесено дополнительно, нет в календаре", () => {
		const byLaw = MARCH_2026;
		// 25 марта убрали, 24-е сделали рабочим, 31-е внесли по постановлению.
		const stored: CalendarDay[] = [
			...MARCH_2026.filter((d) => d.date !== "2026-03-25" && d.date !== "2026-03-24"),
			{ date: "2026-03-24", kind: "workday", name: "Сделали рабочим", source: "manual" },
			{ date: "2026-03-31", kind: "dayoff", name: "По постановлению", source: "manual" },
		];
		const entries = calendarEntries(stored, byLaw);
		const state = new Map(entries.map((e) => [e.date, e.lawState]));
		expect(state.get("2026-03-08")).toBe("same");
		expect(state.get("2026-03-24")).toBe("changed");
		expect(state.get("2026-03-31")).toBe("extra");
		expect(state.get("2026-03-25")).toBe("missing");
		expect(entries.find((e) => e.date === "2026-03-25")?.stored).toBe(false);
		expect(entries.map((e) => e.date)).toEqual([...entries.map((e) => e.date)].sort());
	});

	it("строки таблицы: сырая дата для сортировки, источник словом, у отсутствующего — прочерк", () => {
		const rows = toCalendarRows(calendarEntries([{ date: "2026-03-31", kind: "dayoff", name: "X", source: "manual" }], [{ date: "2026-03-08", kind: "holiday", name: "8 марта" }]));
		expect(rows.map((r) => r.wcDate)).toEqual(["2026-03-08", "2026-03-31"]);
		expect(rows[0].wcSource).toBe("—");
		expect(rows[1].wcSource).not.toBe("—");
		expect(new Set(rows.map((r) => r.id)).size).toBe(2);
	});

	it("проверка дня до записи: дата и вид", () => {
		expect(validateDay({ date: "2026-03-09", kind: "dayoff" })).toEqual([]);
		expect(validateDay({ date: "2026-02-30", kind: "dayoff" })).toEqual(["workCalendarErrDate"]);
		expect(validateDay({ date: "", kind: "x" })).toEqual(["workCalendarErrDate", "workCalendarErrKind"]);
	});
});
