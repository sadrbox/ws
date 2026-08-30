import { describe, it, expect, beforeEach } from "vitest";
import {
	setAppDateFormat, setAppUtcOffset,
	getFormatDateOnly, getFormatDate,
	isoToLocalInput, localInputToIso,
	monthPeriodToRange, isoToMonthPeriod,
} from "src/utils/datetime";

describe("datetime — форматирование и конвертация (чистая логика)", () => {
	beforeEach(() => {
		setAppDateFormat("DD.MM.YYYY");
		setAppUtcOffset(0);
	});

	describe("getFormatDateOnly", () => {
		it("пустое → ''", () => {
			expect(getFormatDateOnly("")).toBe("");
			expect(getFormatDateOnly(null)).toBe("");
			expect(getFormatDateOnly(undefined)).toBe("");
		});
		it("чистая дата YYYY-MM-DD → по формату, БЕЗ конвертации TZ", () => {
			setAppUtcOffset(5); // не должно влиять на чистую дату
			expect(getFormatDateOnly("2026-08-30")).toBe("30.08.2026");
		});
		it("уважает выбранный формат", () => {
			setAppDateFormat("YYYY-MM-DD");
			expect(getFormatDateOnly("2026-08-30")).toBe("2026-08-30");
			setAppDateFormat("MM/DD/YYYY");
			expect(getFormatDateOnly("2026-08-30")).toBe("08/30/2026");
			setAppDateFormat("DD/MM/YYYY");
			expect(getFormatDateOnly("2026-08-30")).toBe("30/08/2026");
		});
		it("ISO со временем — сдвигается на настроенный offset (переход через полночь)", () => {
			setAppUtcOffset(5);
			// 22:00Z + 5ч = 03:00 следующих суток → дата 31.08
			expect(getFormatDateOnly("2026-08-30T22:00:00Z")).toBe("31.08.2026");
		});
	});

	describe("getFormatDate (дата+время)", () => {
		it("ISO → 'дд.мм.гггг чч:мм' с offset", () => {
			setAppUtcOffset(5);
			expect(getFormatDate("2026-08-30T10:00:00Z")).toBe("30.08.2026 15:00");
		});
		it("пустое/невалидное → ''", () => {
			expect(getFormatDate("")).toBe("");
			expect(getFormatDate("не дата")).toBe("");
		});
	});

	describe("isoToLocalInput ↔ localInputToIso (round-trip)", () => {
		it("offset 0: datetime-local round-trip", () => {
			const iso = "2026-08-30T10:30:00.000Z";
			const local = isoToLocalInput(iso); // "2026-08-30T10:30"
			expect(local).toBe("2026-08-30T10:30");
			expect(localInputToIso(local)).toBe("2026-08-30T10:30:00.000Z");
		});
		it("offset 5: локальное время смещено, обратно в UTC — корректно", () => {
			setAppUtcOffset(5);
			expect(isoToLocalInput("2026-08-30T10:00:00.000Z")).toBe("2026-08-30T15:00");
			expect(localInputToIso("2026-08-30T15:00")).toBe("2026-08-30T10:00:00.000Z");
		});
		it("localInputToIso: только дата → полночь настроенного TZ в UTC", () => {
			setAppUtcOffset(0);
			expect(localInputToIso("2026-08-30")).toBe("2026-08-30T00:00:00.000Z");
			setAppUtcOffset(5);
			expect(localInputToIso("2026-08-30")).toBe("2026-08-29T19:00:00.000Z");
		});
		it("пустое → '' / null", () => {
			expect(isoToLocalInput(null)).toBe("");
			expect(localInputToIso("")).toBeNull();
			expect(localInputToIso(null)).toBeNull();
		});
	});

	describe("monthPeriodToRange / isoToMonthPeriod", () => {
		it("'2026-08' → границы месяца (UTC-полночь 1-го и последнего дня)", () => {
			expect(monthPeriodToRange("2026-08")).toEqual({
				start: "2026-08-01T00:00:00.000Z",
				end: "2026-08-31T00:00:00.000Z",
			});
			// февраль високосного 2024
			expect(monthPeriodToRange("2024-02").end).toBe("2024-02-29T00:00:00.000Z");
		});
		it("некорректный период → null/null", () => {
			expect(monthPeriodToRange("")).toEqual({ start: null, end: null });
			expect(monthPeriodToRange("2026-13")).toEqual({ start: null, end: null });
			expect(monthPeriodToRange("мусор")).toEqual({ start: null, end: null });
		});
		it("isoToMonthPeriod: ISO → 'YYYY-MM'", () => {
			expect(isoToMonthPeriod("2026-08-30T00:00:00Z")).toBe("2026-08");
			expect(isoToMonthPeriod("")).toBe("");
			expect(isoToMonthPeriod("не дата")).toBe("");
		});
	});
});
