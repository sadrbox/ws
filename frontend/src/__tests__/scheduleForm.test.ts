import { describe, it, expect } from "vitest";
import { translate } from "src/i18";
import {
	deadlineDaysError, deadlineDaysValue, scheduleStatusLabel, scheduleStatusOptions, tzLabel,
} from "src/models/ScheduledTasks/scheduleForm";

describe("регламентные задачи — срок задачи в днях (как на сервере: целое 0–365)", () => {
	it("пусто — без срока, не ошибка", () => {
		expect(deadlineDaysError("")).toBeNull();
		expect(deadlineDaysError("  ")).toBeNull();
		expect(deadlineDaysValue("")).toBeNull();
	});
	it("целое от 0 до 365 — годится", () => {
		for (const v of ["0", "5", "365"]) expect(deadlineDaysError(v), v).toBeNull();
		expect(deadlineDaysValue(" 7 ")).toBe(7);
	});
	it("дробное, отрицательное, больше года, не число — ошибка", () => {
		for (const v of ["1.5", "-1", "366", "abc"]) expect(deadlineDaysError(v), v).toBe(translate("scheduleDeadlineDaysInvalid"));
	});
});

describe("регламентные задачи — часовой пояс расписаний", () => {
	it("UTC+5 по умолчанию, с минутами и со знаком минус", () => {
		expect(tzLabel(300)).toBe("UTC+5");
		expect(tzLabel(330)).toBe("UTC+5:30");
		expect(tzLabel(-180)).toBe("UTC−3");
		expect(tzLabel(0)).toBe("UTC+0");
	});
});

describe("регламентные задачи — статус подписью", () => {
	it("известный статус — из словаря, неизвестный — как есть", () => {
		expect(scheduleStatusLabel("active")).toBe(translate("scheduleStatusActive"));
		expect(scheduleStatusLabel("archived")).toBe("archived");
		expect(scheduleStatusOptions().map((o) => o.value)).toEqual(["active", "paused", "completed"]);
	});
});
