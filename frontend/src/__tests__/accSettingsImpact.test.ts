import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Подсказки в «Параметрах учёта» строятся из СРАВНЕНИЯ с загруженной версией и
// зависят от «Даты начала»:
//   • дата в БУДУЩЕМ/сегодня → правка безопасна: проведённые документы не пересчитаются;
//   • дата в ПРОШЛОМ        → правка накроет уже проведённые документы этого периода.
// Логика неочевидная, а цена ошибки — молча переписанная история учёта.
const SRC = readFileSync(
	resolve(__dirname, "../models/OrganizationAccountingSettings/index.tsx"),
	"utf-8",
);

describe("Параметры учёта: подсказки о последствиях", () => {
	it("сравнивается со СНИМКОМ загруженной версии, а не с дефолтами", () => {
		expect(SRC).toContain("savedRef");
		expect(SRC).toMatch(/mapServerToForm: \(d, prev\) => savedSnapshot\(/);
	});

	it("различает прошлое и будущее по «Дате начала»", () => {
		expect(SRC).toContain("startsInPast");
		expect(SRC).toMatch(/d < todayIso\(\)/);
	});

	it("дата в прошлом → ПРЕДУПРЕЖДЕНИЕ о влиянии на проведённые документы", () => {
		expect(SRC).toMatch(/startsInPast[\s\S]{0,200}type: "warning"[\s\S]{0,80}accImpactPast/);
	});

	it("дата не в прошлом → подтверждение, что учёт не затронут (пользователь боится трогать настройки)", () => {
		expect(SRC).toMatch(/type: "success"[\s\S]{0,80}accImpactSafe/);
	});

	it("отслеживаются ВСЕ влияющие параметры, включая обратное переключение", () => {
		for (const f of ["useVat", "vatRate", "vatCalculationMethod", "useDiscount", "useExcise", "costingMethod"]) {
			expect(SRC, `нет отслеживания «${f}»`).toContain(`changed("${f}")`);
		}
		// Обратное переключение говорит своё: «включили» ≠ «отключили».
		expect(SRC).toContain("accChangeDiscountOn");
		expect(SRC).toContain("accChangeDiscountOff");
	});

	it("подсказки идут в <Notice /> формы, а не в тост", () => {
		expect(SRC).toMatch(/<Notice items=\{notices\} \/>/);
		expect(SRC).toContain("styles.FormNotice");
	});
});
