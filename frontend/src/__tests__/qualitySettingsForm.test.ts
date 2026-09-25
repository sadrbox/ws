// E17: настройки учёта качества — «настройки ↔ поля формы», частичная запись, слияние правок.
import { describe, it, expect } from "vitest";
import {
	ALL_FIELDS, fieldValue, formToSettings, isSettingsDirty, rebaseForm, settingsToForm, type SettingsWithEffective,
} from "src/models/QualitySettings/settingsForm";

/** Умолчания сервера (backend/services/quality/settingsRules.js DEFAULT_SETTINGS). */
const DEFAULTS: SettingsWithEffective = {
	effectiveFrom: "",
	tzOffsetMinutes: 300,
	workHours: { start: "09:00", end: "18:00" },
	workDays: "1,2,3,4,5",
	slaWorkingTime: true,
	sla: { reactionMinutes: { low: 240, normal: 60, high: 30, urgent: 15 }, resolveHours: { low: 72, normal: 24, high: 8, urgent: 4 } },
	escalation: { overdueToManagerDays: 2, idleDays: 3, idleToChiefDays: 5 },
	errorControl: { controlDeadlineDays: 2, reopenWindowDays: 30 },
	findings: { deadlineDays: 5, perCheckDeadlineDays: { "stock.negative": 3 } },
	violations: { systematicThreshold: 3, systematicMonths: 3 },
	attendance: { source: "button", evaluateDaysBack: 3 },
	consultation: { maxLength: 1500 },
	primaryDocs: { reportDay: 15, lateWindowDays: 5, lateShareThreshold: 0.5 },
};

const byKey = (key: string) => ALL_FIELDS.find((f) => f.key === key)!;

describe("настройки → форма", () => {
	it("каждое поле читается по своему пути; доля — процентами", () => {
		const f = settingsToForm(DEFAULTS);
		expect(f.values.reaction_normal).toBe("60");
		expect(f.values.resolve_urgent).toBe("4");
		expect(f.values.idleToChiefDays).toBe("5");
		expect(f.values.findingsDeadlineDays).toBe("5");
		expect(f.values.systematicMonths).toBe("3");
		expect(f.values.lateSharePercent).toBe("50");
		expect(f.values.tzOffsetMinutes).toBe("300");
		expect(f.attendanceSource).toBe("button");
		expect(f.effectiveFrom).toBe("");
		expect(fieldValue({ primaryDocs: { lateShareThreshold: 0.125 } }, byKey("lateSharePercent"))).toBe("12.5");
	});

	it("до загрузки — пустые поля и безопасные значения", () => {
		const f = settingsToForm(undefined);
		expect(Object.values(f.values).every((v) => v === "")).toBe(true);
		expect(f.attendanceSource).toBe("button");
	});
});

describe("форма → частичные настройки", () => {
	it("без правок — пустое изменение, форма не «грязная»", () => {
		const f = settingsToForm(DEFAULTS);
		expect(formToSettings(f, DEFAULTS)).toEqual({ settings: {} });
		expect(isSettingsDirty(f, DEFAULTS)).toBe(false);
	});

	it("только изменённое, по вложенным путям; процент — долей", () => {
		const f = settingsToForm(DEFAULTS);
		f.values.reaction_normal = "45";
		f.values.lateSharePercent = "35";
		f.attendanceSource = "both";
		f.effectiveFrom = "2026-10-01";
		expect(isSettingsDirty(f, DEFAULTS)).toBe(true);
		expect(formToSettings(f, DEFAULTS)).toEqual({
			settings: {
				sla: { reactionMinutes: { normal: 45 } },
				primaryDocs: { lateShareThreshold: 0.35 },
				attendance: { source: "both" },
				effectiveFrom: "2026-10-01",
			},
		});
	});

	it("ошибки: пусто, дробь в сроке, вне пределов, кривая дата", () => {
		const bad = (key: string, value: string) => {
			const f = settingsToForm(DEFAULTS);
			f.values[key] = value;
			return formToSettings(f, DEFAULTS);
		};
		expect(bad("idleDays", "")).toEqual({ error: { field: byKey("idleDays") } });
		expect(bad("idleDays", "2.5")).toEqual({ error: { field: byKey("idleDays") } });
		expect(bad("systematicMonths", "13")).toEqual({ error: { field: byKey("systematicMonths") } });
		expect(bad("reaction_low", "0")).toEqual({ error: { field: byKey("reaction_low") } });
		expect(bad("lateSharePercent", "12,5")).toEqual({ settings: { primaryDocs: { lateShareThreshold: 0.125 } } });
		expect(bad("tzOffsetMinutes", "-180")).toEqual({ settings: { tzOffsetMinutes: -180 } });
		const f = settingsToForm(DEFAULTS);
		f.effectiveFrom = "01.10.2026";
		expect(formToSettings(f, DEFAULTS)).toEqual({ error: { effectiveFrom: true } });
	});

	it("пустая дата начала — это выключение правил, и её можно отправить осознанно", () => {
		const saved = { ...DEFAULTS, effectiveFrom: "2026-09-25" };
		const f = settingsToForm(saved);
		f.effectiveFrom = "";
		expect(formToSettings(f, saved)).toEqual({ settings: { effectiveFrom: "" } });
	});
});

describe("слияние: пришли новые настройки при несохранённых правках", () => {
	it("правки человека остаются, нетронутые поля берут новое (дата начала не затирается)", () => {
		const f = settingsToForm(DEFAULTS);
		f.values.idleDays = "4";
		// Пока человек правил, администратор назначил фирму: сервер поставил дату начала.
		const next = { ...DEFAULTS, effectiveFrom: "2026-09-25", escalation: { ...DEFAULTS.escalation, idleToChiefDays: 6 } };
		const merged = rebaseForm(f, DEFAULTS, next);
		expect(merged.values.idleDays).toBe("4");
		expect(merged.values.idleToChiefDays).toBe("6");
		expect(merged.effectiveFrom).toBe("2026-09-25");
		expect(formToSettings(merged, next)).toEqual({ settings: { escalation: { idleDays: 4 } } });
	});

	it("первая загрузка: форма из пустой берёт всё с сервера", () => {
		const merged = rebaseForm(settingsToForm(undefined), undefined, DEFAULTS);
		expect(merged).toEqual(settingsToForm(DEFAULTS));
	});
});

describe("рабочее время фирмы", () => {
	it("читается из настроек; неделя — без повторов и по возрастанию", () => {
		const f = settingsToForm({ ...DEFAULTS, workDays: "5,1,1,3" });
		expect(f.workStart).toBe("09:00");
		expect(f.workEnd).toBe("18:00");
		expect(f.workDays).toBe("1,3,5");
		expect(f.slaWorkingTime).toBe(true);
		expect(settingsToForm(undefined).slaWorkingTime).toBe(true);
	});

	it("часы уходят парой, «9:00» приводится к «09:00»; неделя и признак — только изменённые", () => {
		const f = settingsToForm(DEFAULTS);
		f.workStart = "9:30";
		expect(formToSettings(f, DEFAULTS)).toEqual({ settings: { workHours: { start: "09:30", end: "18:00" } } });
		const g = settingsToForm(DEFAULTS);
		g.workDays = "1,2,3,4,5,6";
		g.slaWorkingTime = false;
		expect(isSettingsDirty(g, DEFAULTS)).toBe(true);
		expect(formToSettings(g, DEFAULTS)).toEqual({ settings: { workDays: "1,2,3,4,5,6", slaWorkingTime: false } });
	});

	it("ошибки: не время, конец раньше начала, пустая неделя", () => {
		const bad = (patch: Partial<ReturnType<typeof settingsToForm>>) => formToSettings({ ...settingsToForm(DEFAULTS), ...patch }, DEFAULTS);
		expect(bad({ workStart: "9.00" })).toEqual({ error: { workHours: true } });
		expect(bad({ workStart: "19:00" })).toEqual({ error: { workHours: true } });
		expect(bad({ workDays: "" })).toEqual({ error: { workDays: true } });
	});

	it("слияние: правка недели остаётся, новое время с сервера приходит", () => {
		const f = settingsToForm(DEFAULTS);
		f.workDays = "1,2,3,4";
		const next = { ...DEFAULTS, workHours: { start: "08:00", end: "17:00" } };
		const merged = rebaseForm(f, DEFAULTS, next);
		expect(merged.workDays).toBe("1,2,3,4");
		expect(merged.workStart).toBe("08:00");
		expect(formToSettings(merged, next)).toEqual({ settings: { workDays: "1,2,3,4" } });
	});
});
