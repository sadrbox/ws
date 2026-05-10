import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Структурный тест: проверяет порядок секций в NavList без рендеринга
 * (компонент использует тяжёлые ленивые импорты).
 */
const SRC = readFileSync(
	resolve(__dirname, "../components/UI/index.tsx"),
	"utf-8",
);

/** Возвращает индекс первого вхождения подстроки. */
const idx = (s: string) => SRC.indexOf(s);

describe("NavList structure", () => {
	it("раздел 'Торговля → Справочники' содержит только 'Номенклатура' и 'Бренды'", () => {
		const tradeStart = idx("Торговля");
		const tradeRefsStart = SRC.indexOf("Справочники", tradeStart);
		const tradeRefsEnd = SRC.indexOf("</ul>", tradeRefsStart);
		const slice = SRC.slice(tradeRefsStart, tradeRefsEnd);

		expect(slice).toContain("Номенклатура");
		expect(slice).toContain("Бренды");
		expect(slice).not.toContain("Единицы измерения");
		expect(slice).not.toContain("Ставки НДС");
		expect(slice).not.toContain("Налоги");
		expect(slice).not.toContain("Настройки учёта организации");
	});

	it("в разделе 'Настройки' есть подраздел 'Учёт' с настройками учёта/единицами/ставками НДС/налогами", () => {
		const settingsStart = idx("Настройки</h1>");
		expect(settingsStart).toBeGreaterThan(0);
		const buhStart = SRC.indexOf("Учёт</h3>", settingsStart);
		expect(buhStart).toBeGreaterThan(settingsStart);
		const buhEnd = SRC.indexOf("</ul>", buhStart);
		const slice = SRC.slice(buhStart, buhEnd);

		expect(slice).toContain("Настройки учёта организации");
		expect(slice).toContain("Единицы измерения");
		expect(slice).toContain("Налоги");
	});
});
