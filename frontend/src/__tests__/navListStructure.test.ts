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

// NavList интернационализирован: пункты заданы через translate(ключ) и
// компоненты-списки (напр. ProductsList), а не русскими литералами. Поэтому
// проверяем таксономию по СТАБИЛЬНЫМ якорям блоков секций и идентификаторам
// компонентов, а не по подписям.
const tradeBlock = idx('"Trade".toLocaleLowerCase()');
const accountingBlock = idx('"Accounting".toLocaleLowerCase()');
const settingsBlock = idx('"Settings".toLocaleLowerCase()');

describe("NavList structure", () => {
	it("блоки секций присутствуют в ожидаемом порядке", () => {
		expect(tradeBlock).toBeGreaterThan(0);
		expect(accountingBlock).toBeGreaterThan(tradeBlock);
		expect(settingsBlock).toBeGreaterThan(accountingBlock);
	});

	it("Торговля → Справочники: только Номенклатура и Бренды (без единиц/НДС/налогов)", () => {
		// Блок «Торговля» — от его маркера до начала блока «Бухгалтерия».
		const slice = SRC.slice(tradeBlock, accountingBlock);
		expect(slice).toContain("ProductsList");
		expect(slice).toContain("BrandsList");
		expect(slice).not.toContain("UnitOfMeasuresList");
		expect(slice).not.toContain("TaxesList");
		expect(slice).not.toContain("OrganizationAccountingSettingsList");
	});

	it("Настройки → Учёт: настройки учёта/единицы/налоги", () => {
		// Блок «Настройки» — от его маркера до конца файла.
		const slice = SRC.slice(settingsBlock);
		expect(slice).toContain("OrganizationAccountingSettingsList");
		expect(slice).toContain("UnitOfMeasuresList");
		expect(slice).toContain("TaxesList");
	});
});
