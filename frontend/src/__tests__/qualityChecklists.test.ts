import { describe, it, expect } from "vitest";
import { draftsToPayload, moveDraft, toDrafts, withCheck, type TemplateItemDraft } from "src/models/ChecklistTemplates/templateItems";
import { defaultPeriod, pendingCount, progressText, runStatusTone } from "src/models/ChecklistRuns/runView";

// Чек-листы самопроверки (E17 СК3): пункты шаблона (порядок, привязка к проверке, сборка
// items[] для сервера) и период нового чек-листа по периодичности шаблона.

const draft = (p: Partial<TemplateItemDraft> = {}): TemplateItemDraft => ({ key: Math.random().toString(36), text: "Пункт", checkCode: "", standardItemNumber: "", ...p });

describe("Пункты шаблона", () => {
	it("пункты сервера → строки редактора по порядку", () => {
		const d = toDrafts([
			{ uuid: "b", position: 2, text: "Второй", checkCode: null, standardItemNumber: null },
			{ uuid: "a", position: 0, text: "Первый", checkCode: "stock.negative", standardItemNumber: 12 },
		]);
		expect(d.map((x) => [x.key, x.text, x.checkCode, x.standardItemNumber])).toEqual([
			["a", "Первый", "stock.negative", "12"],
			["b", "Второй", "", ""],
		]);
		expect(toDrafts(null)).toEqual([]);
	});

	it("перестановка вверх/вниз; за край — без изменений", () => {
		const list = ["a", "b", "c"];
		expect(moveDraft(list, 1, -1)).toEqual(["b", "a", "c"]);
		expect(moveDraft(list, 1, 1)).toEqual(["a", "c", "b"]);
		expect(moveDraft(list, 0, -1)).toEqual(["a", "b", "c"]);
		expect(moveDraft(list, 2, 1)).toEqual(["a", "b", "c"]);
		expect(list).toEqual(["a", "b", "c"]); // исходный не меняется
	});

	it("привязка к проверке подставляет пункт стандарта, если он не выбран", () => {
		expect(withCheck(draft(), "stock.negative").standardItemNumber).toBe("12");
		expect(withCheck(draft({ standardItemNumber: "26" }), "stock.negative").standardItemNumber).toBe("26");
		expect(withCheck(draft(), "classification.hints").standardItemNumber).toBe("");
		expect(withCheck(draft(), "").checkCode).toBe("");
	});

	it("items[] для сервера: позиции подряд, пустые строки отброшены, коды и номера — как есть", () => {
		const r = draftsToPayload([draft({ text: " Сверки " , checkCode: "reconciliation.status", standardItemNumber: "7" }), draft({ text: "" }), draft({ text: "Банк" })]);
		expect(r).toEqual({
			ok: true,
			items: [
				{ position: 0, text: "Сверки", checkCode: "reconciliation.status", standardItemNumber: 7 },
				{ position: 1, text: "Банк", checkCode: null, standardItemNumber: null },
			],
		});
	});

	it("ошибки с номером строки: привязка без текста, пункт стандарта вне 1…40", () => {
		expect(draftsToPayload([draft(), draft({ text: " ", checkCode: "stock.negative" })])).toEqual({ ok: false, error: "noText", row: 2 });
		expect(draftsToPayload([draft({ standardItemNumber: "41" })])).toEqual({ ok: false, error: "badNumber", row: 1 });
		expect(draftsToPayload([draft({ standardItemNumber: "2.5" })])).toEqual({ ok: false, error: "badNumber", row: 1 });
	});
});

describe("Период нового чек-листа", () => {
	it("месяц — прошедший; в январе — декабрь прошлого года", () => {
		expect(defaultPeriod("month", "2026-09-25")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
		expect(defaultPeriod("month", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
		expect(defaultPeriod("month", "2024-03-01")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
	});

	it("квартал — прошедший; в первом квартале — четвёртый прошлого года", () => {
		expect(defaultPeriod("quarter", "2026-09-25")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
		expect(defaultPeriod("quarter", "2026-02-01")).toEqual({ from: "2025-10-01", to: "2025-12-31" });
		expect(defaultPeriod("quarter", "2026-12-31")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
	});

	it("год — прошлый; разовый — текущий месяц", () => {
		expect(defaultPeriod("year", "2026-09-25")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
		expect(defaultPeriod("once", "2026-09-25")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
	});
});

describe("Прогресс чек-листа", () => {
	it("«отмечено/всего», проблемы — отдельно; без пунктов — пусто", () => {
		expect(progressText({ total: 12, done: 7, problems: 0 })).toBe("7/12");
		expect(progressText({ total: 12, done: 12, problems: 2 })).toMatch(/^12\/12 · .+: 2$/);
		expect(progressText({ total: 0, done: 0, problems: 0 })).toBe("");
		expect(progressText(undefined)).toBe("");
	});

	it("не отмечено пунктов — счётчик для «Сдать главбуху»", () => {
		expect(pendingCount([{ status: "ok" }, { status: "pending" }, { status: "na" }, { status: "pending" }])).toBe(2);
		expect(pendingCount(undefined)).toBe(0);
	});

	it("цвет состояния: открыт — ждёт исполнителя, сдан — главбуха, подписан — готово", () => {
		expect(runStatusTone("open")).toBe("warn");
		expect(runStatusTone("submitted")).toBe("info");
		expect(runStatusTone("reviewed")).toBe("ok");
	});
});
