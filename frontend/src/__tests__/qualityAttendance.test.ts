import { describe, it, expect } from "vitest";
import {
	absencePayload, formatWorkDays, normalizeHm, parseHm, parseWorkDays, submittedAfterStart, validateAbsence,
	validateSchedule, verdictKind, verdictTone, workDaysText, type AbsenceDraft, type ScheduleDraft,
} from "src/models/Attendance/attendanceView";

// Трудовая дисциплина (E17 СК6): рабочие дни графика ↔ флажки пн…вс, время «ЧЧ:ММ», подача
// заявки после начала дня (п. 34), вердикты и проверки форм.

describe("Рабочие дни графика ↔ флажки", () => {
	it("строка сервера → флаги пн…вс и обратно", () => {
		expect(parseWorkDays("1,2,3,4,5")).toEqual([true, true, true, true, true, false, false]);
		expect(formatWorkDays([true, true, true, true, true, false, false])).toBe("1,2,3,4,5");
		expect(formatWorkDays(parseWorkDays("6,7"))).toBe("6,7");
	});

	it("мусор, повторы и пробелы отбрасываются; порядок — по возрастанию", () => {
		expect(formatWorkDays(parseWorkDays(" 5, 1,1, 9, x, 0,3 "))).toBe("1,3,5");
		expect(parseWorkDays("")).toEqual([false, false, false, false, false, false, false]);
		expect(parseWorkDays(null)).toEqual([false, false, false, false, false, false, false]);
	});

	it("ни одного дня — пустая строка (форма её не пропустит)", () => {
		expect(formatWorkDays([false, false, false, false, false, false, false])).toBe("");
	});

	it("подпись: подряд идущие дни — диапазоном, пара — через запятую", () => {
		expect(workDaysText("1,2,3,4,5")).toBe("пн–пт");
		expect(workDaysText("1,2,3,5")).toBe("пн–ср, пт");
		expect(workDaysText("1,2")).toBe("пн, вт");
		expect(workDaysText("7")).toBe("вс");
		expect(workDaysText("")).toBe("");
	});
});

describe("Время «ЧЧ:ММ»", () => {
	it("как на сервере: час одной или двумя цифрами, 00:00…23:59", () => {
		expect(parseHm("09:00")).toBe(540);
		expect(parseHm("9:05")).toBe(545);
		expect(parseHm("23:59")).toBe(1439);
		expect(parseHm("24:00")).toBeNull();
		expect(parseHm("12:60")).toBeNull();
		expect(parseHm("9")).toBeNull();
		expect(parseHm("")).toBeNull();
	});

	it("нормализация: «9:05» → «09:05»; не время — как есть", () => {
		expect(normalizeHm("9:05")).toBe("09:05");
		expect(normalizeHm(" 18:00 ")).toBe("18:00");
		expect(normalizeHm("abc")).toBe("abc");
	});
});

describe("Заявка после начала дня (п. 34)", () => {
	// Начало дня 09:00 по UTC+5 = 04:00 UTC.
	const OFFSET = 300;
	it("до начала дня — вовремя, после — поздно", () => {
		expect(submittedAfterStart("2026-09-25T03:59:00Z", "2026-09-25", "09:00", OFFSET)).toBe(false);
		expect(submittedAfterStart("2026-09-25T04:01:00Z", "2026-09-25", "09:00", OFFSET)).toBe(true);
	});

	it("заявка накануне на завтра — вовремя; неверные данные — не «поздно»", () => {
		expect(submittedAfterStart("2026-09-24T15:00:00Z", "2026-09-25", "09:00", OFFSET)).toBe(false);
		expect(submittedAfterStart("2026-09-25T10:00:00Z", "2026-09-25", "не время", OFFSET)).toBe(false);
		expect(submittedAfterStart("мусор", "2026-09-25", "09:00", OFFSET)).toBe(false);
	});
});

describe("Вердикт дня", () => {
	it("нарушение различается по пункту стандарта", () => {
		expect(verdictKind({ verdict: "violation", item: 32 })).toBe("late");
		expect(verdictKind({ verdict: "violation", item: 33 })).toBe("absent");
		expect(verdictKind({ verdict: "violation", item: 34 })).toBe("notice");
		expect(verdictKind({ verdict: "violation" })).toBe("unknown");
	});

	it("остальные вердикты — как есть; неизвестное — unknown", () => {
		for (const v of ["ok", "pending", "not_workday", "too_early"]) expect(verdictKind({ verdict: v })).toBe(v);
		expect(verdictKind({ verdict: "strange" })).toBe("unknown");
		expect(verdictKind(null)).toBe("unknown");
	});

	it("цвет: нарушения — красный, ожидание решения — оранжевый, выходной и «рано судить» — серый", () => {
		expect(verdictTone("ok")).toBe("ok");
		expect(verdictTone("late")).toBe("bad");
		expect(verdictTone("notice")).toBe("bad");
		expect(verdictTone("pending")).toBe("warn");
		expect(verdictTone("not_workday")).toBe("muted");
		expect(verdictTone("too_early")).toBe("muted");
	});
});

describe("Проверка заявки и графика", () => {
	const draft = (p: Partial<AbsenceDraft> = {}): AbsenceDraft => ({ kind: "absence", dateFrom: "2026-09-25", dateTo: "", timeFrom: "", timeTo: "", reason: "К врачу, запись", ...p });

	it("правильная заявка — без ошибок", () => {
		expect(validateAbsence(draft())).toEqual([]);
	});

	it("вид, дата, порядок дат, время и причина не короче 5 знаков", () => {
		expect(validateAbsence(draft({ kind: "vacation" }))).toContain("attendanceErrKind");
		expect(validateAbsence(draft({ dateFrom: "" }))).toContain("attendanceErrDate");
		expect(validateAbsence(draft({ dateTo: "2026-09-20" }))).toContain("attendanceErrDateOrder");
		expect(validateAbsence(draft({ timeFrom: "25:00" }))).toContain("attendanceErrTime");
		expect(validateAbsence(draft({ reason: " врач " }))).toContain("attendanceErrReason");
	});

	it("тело запроса: у опоздания конец периода не отправляется, время нормализуется", () => {
		expect(absencePayload(draft({ kind: "late", dateTo: "2026-09-27", timeFrom: "9:30" }))).toEqual({
			kind: "late", dateFrom: "2026-09-25", timeFrom: "09:30", reason: "К врачу, запись",
		});
		expect(absencePayload(draft({ dateTo: "2026-09-27" }))).toEqual({
			kind: "absence", dateFrom: "2026-09-25", dateTo: "2026-09-27", reason: "К врачу, запись",
		});
	});

	const schedule = (p: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
		userUuid: "u1", startTime: "09:00", endTime: "18:00", workDays: parseWorkDays("1,2,3,4,5"), graceMinutes: "10", isActive: true, ...p,
	});

	it("график: сотрудник, время, конец позже начала, хотя бы один день, допуск 0…240", () => {
		expect(validateSchedule(schedule())).toEqual([]);
		expect(validateSchedule(schedule({ userUuid: "" }))).toContain("workScheduleErrUser");
		expect(validateSchedule(schedule({ startTime: "9-00" }))).toContain("workScheduleErrTime");
		expect(validateSchedule(schedule({ endTime: "08:00" }))).toContain("workScheduleErrTimeOrder");
		expect(validateSchedule(schedule({ workDays: parseWorkDays("") }))).toContain("workScheduleErrDays");
		expect(validateSchedule(schedule({ graceMinutes: "241" }))).toContain("workScheduleErrGrace");
		expect(validateSchedule(schedule({ graceMinutes: "" }))).toContain("workScheduleErrGrace");
		expect(validateSchedule(schedule({ graceMinutes: "0" }))).toEqual([]);
	});
});
