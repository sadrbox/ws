// E17 СК5.4–СК5.5: «Итоги месяца» — строки таблицы, сводка нарушений, меры, отказ закрытия.
import { describe, it, expect } from "vitest";
import { translate } from "src/i18";
import type { BonusRow } from "src/services/quality/api";
import {
	bonusExportAoa, bonusExportFileName, bonusRows, isMonthOver, measureDateIso, measureKindLabel, measureKindOptions, needsConfirmation, roleLabel, validateMeasure, violationsSummary,
} from "src/models/QualityBonus/bonus";

const row = (userUuid: string, extra: Partial<BonusRow> = {}): BonusRow => ({
	userUuid, userName: userUuid, groupName: "Группа 1", role: "member", bonus: true, confirmedCount: 0, violations: [],
	pendingCandidates: 0, disputed: 0, windowCount: 0, systematic: false, noMeasure: false, ...extra,
});

describe("строки итогов", () => {
	it("номер строки — из uuid сотрудника: тот же сотрудник — тот же номер после перечитывания", () => {
		const a = bonusRows([row("u-1"), row("u-2")]);
		const b = bonusRows([row("u-2"), row("u-1")]);
		expect(a[0].uuid).toBe("u-1");
		expect(a.find((r) => r.uuid === "u-1")?.id).toBe(b.find((r) => r.uuid === "u-1")?.id);
		expect(new Set(a.map((r) => r.id)).size).toBe(2);
		expect(bonusRows(null)).toEqual([]);
	});

	it("сводка нарушений: пункты без повторов, по порядку", () => {
		const short = translate("violationItemShort");
		expect(violationsSummary([
			{ uuid: "1", itemNumber: 12, description: "", detectedAt: "" },
			{ uuid: "2", itemNumber: 3, description: "", detectedAt: "" },
			{ uuid: "3", itemNumber: 12, description: "", detectedAt: "" },
		])).toBe(`${short} 3, ${short} 12`);
		expect(violationsSummary([])).toBe("");
		expect(violationsSummary(undefined)).toBe("");
	});

	it("роль в группе", () => {
		expect(roleLabel("chief")).toBe(translate("bonusRoleChief"));
		expect(roleLabel("member")).toBe(translate("bonusRoleMember"));
		expect(roleLabel(null)).toBe("");
		expect(roleLabel("owner")).toBe("");
	});
});

describe("меры руководителя", () => {
	it("виды мер — те, что принимает сервер", () => {
		expect(measureKindOptions().map((o) => o.value)).toEqual(["talk", "training", "warning", "other"]);
		expect(measureKindLabel("warning")).toBe(translate("measureKindWarning"));
		expect(measureKindLabel("fine")).toBe("fine");
	});

	it("мера без описания не принимается (сервер: не короче 5 знаков)", () => {
		expect(validateMeasure("  да ")).toBe("measureNeedNote");
		expect(validateMeasure("Беседа о сроках сверок")).toBeNull();
	});
});

describe("закрытие месяца", () => {
	it("409 NEEDS_CONFIRMATION — число нерешённых; прочие отказы — null", () => {
		expect(needsConfirmation({ response: { status: 409, data: { code: "NEEDS_CONFIRMATION", pending: 4 } } })).toBe(4);
		expect(needsConfirmation({ response: { status: 409, data: { code: "NEEDS_CONFIRMATION" } } })).toBe(1);
		expect(needsConfirmation({ response: { status: 409, data: { message: "Месяц закрыт" } } })).toBeNull();
		expect(needsConfirmation({ response: { status: 403, data: { code: "NEEDS_CONFIRMATION", pending: 2 } } })).toBeNull();
		expect(needsConfirmation(new Error("Network Error"))).toBeNull();
		expect(needsConfirmation(null)).toBeNull();
	});
});

describe("выгрузка в Excel", () => {
	it("заголовок и строка на сотрудника; числа — числами, нарушения — пунктом, датой и сутью", () => {
		const aoa = bonusExportAoa({
			items: [
				row("u-1", { userName: "Иванова", bonus: false, confirmedCount: 1, windowCount: 3, systematic: true,
					violations: [{ uuid: "v", itemNumber: 20, description: "Просрочен срок", detectedAt: "2026-09-10" }] }),
				row("u-2", { userName: "Петров" }),
			],
		});
		expect(aoa).toHaveLength(3);
		expect(aoa[0]).toHaveLength(11);
		expect(aoa[0][0]).toBe(translate("userName"));
		const [, first, second] = aoa;
		expect(first[0]).toBe("Иванова");
		expect(first[3]).toBe(translate("bonusNo"));
		expect(first[4]).toBe(1);
		expect(String(first[5])).toContain("20");
		expect(String(first[5])).toContain("Просрочен срок");
		expect(first[8]).toBe(3);
		expect(first[9]).toBe(translate("bonusYes"));
		expect(second[3]).toBe(translate("bonusYes"));
		expect(second[9]).toBe("");
		expect(bonusExportAoa(null)).toHaveLength(1);
	});

	it("имя файла: открытый месяц — «предварительно»", () => {
		expect(bonusExportFileName("2026-09", true)).toBe("bonus_2026-09.xlsx");
		expect(bonusExportFileName("2026-09", false)).toBe("bonus_2026-09_preliminary.xlsx");
	});
});

describe("закрытие месяца — только прошедшего (И23)", () => {
	it("текущий и будущие месяцы закрыть нельзя, прошедшие — можно", () => {
		expect(isMonthOver("2026-09", "2026-09")).toBe(false);
		expect(isMonthOver("2026-10", "2026-09")).toBe(false);
		expect(isMonthOver("2027-01", "2026-12")).toBe(false);
		expect(isMonthOver("2026-08", "2026-09")).toBe(true);
		expect(isMonthOver("2025-12", "2026-01")).toBe(true);
	});

	it("неразобранный месяц не закрывается", () => {
		expect(isMonthOver("", "2026-09")).toBe(false);
		expect(isMonthOver("2026-08", "")).toBe(false);
	});
});

describe("дата меры — конец местного дня (И24, «мер нет»)", () => {
	it("мера в день нарушения не раньше самого нарушения", () => {
		const at = measureDateIso("2026-09-02", 5);
		expect(at).toBe("2026-09-02T18:59:59.999Z");
		// Выявлено 02.09 в 14:00 по Алматы — сервер сравнивает моменты «мера ≥ первое нарушение».
		expect(new Date(at as string) >= new Date("2026-09-02T09:00:00Z")).toBe(true);
	});

	it("мера накануне нарушения — раньше него", () => {
		expect(new Date(measureDateIso("2026-09-01", 5) as string) < new Date("2026-09-02T00:30:00+05:00")).toBe(true);
	});

	it("мусор — не дата", () => {
		expect(measureDateIso("", 5)).toBeNull();
		expect(measureDateIso("02.09.2026", 5)).toBeNull();
	});
});
