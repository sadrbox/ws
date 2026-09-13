/**
 * «Проверить базы данных» (P2): итог словами.
 *
 * Держим одно различие, которое легко потерять: проверка, которую агенту провести нечем
 * (`note`), — предупреждение с причиной, а не «Проверено: 0, нет базы данных: 0», которое
 * читается как «всё в порядке».
 */
import { describe, it, expect } from "vitest";
import { checkDbOutcome } from "src/models/OneCAdmin/checkBasesDb";
import { translate } from "src/i18";

const summary = (checked: number, missing: number) =>
	`${translate("onecBasesDbChecked")}: ${checked}, ${translate("onecBasesDbMissing")}: ${missing}`;

describe("итог проверки наличия баз данных", () => {
	it("проверено и найдены фантомы — счёт словами", () => {
		const o = checkDbOutcome({
			items: [{ key: "aibek", dbMissing: true }, { key: "abdali", dbMissing: false }, { key: "x" }],
			checked: 110, skipped: 1,
		});
		expect(o).toEqual({ severity: "success", text: summary(110, 1), checked: 110, missing: 1 });
	});

	it("проверить нечем — предупреждение с причиной, а не успех", () => {
		const o = checkDbOutcome({ items: [{ key: "aibek" }], note: "у агента нет пароля СУБД" });
		expect(o.severity).toBe("warning");
		expect(o.text).toBe(`${summary(0, 0)}. у агента нет пароля СУБД`);
	});

	it("ответ без счётчика — считаем строки с признаком", () => {
		const o = checkDbOutcome({ items: [{ key: "a", dbMissing: false }, { key: "b", dbMissing: true }, { key: "c" }] });
		expect(o.checked).toBe(2);
		expect(o.missing).toBe(1);
	});

	it("пустой ответ не падает", () => {
		expect(checkDbOutcome({})).toEqual({ severity: "success", text: summary(0, 0), checked: 0, missing: 0 });
	});
});
