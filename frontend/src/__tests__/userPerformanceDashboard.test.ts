import { describe, it, expect } from "vitest";
import { fmtValue } from "src/models/UserPerformance/format";
import { BLOCKS, KPI_TILES } from "src/models/UserPerformance/dashboardBlocks";

// Модели прав, которые страница дашборда реально подключает (useAccessPermission +
// enabled источников). Если блок объявит `requires` вне этого набора — он никогда не
// станет доступным (гейтинг молча спрячет его). Тест ловит такую рассинхронизацию.
const WIRED_MODELS = new Set(["Sale", "Todo"]);
const WIRED_SOURCES = new Set(["managers", "users"]);

describe("fmtValue — форматирование показателей", () => {
	it("целые — с разделителями разрядов, без единиц", () => {
		expect(fmtValue(0, "int")).toBe("0");
		// ru-RU разделяет разряды неразрывным пробелом — проверяем шаблон, не точный символ.
		expect(fmtValue(5936, "int")).toMatch(/^5\s936$/);
		expect(fmtValue(5936, "int")).not.toMatch(/₸|млн|тыс/);
	});
	it("деньги — переводит в тыс/млн ₸", () => {
		expect(fmtValue(950, "money")).toContain("₸");
		expect(fmtValue(12000, "money")).toContain("тыс ₸");
		expect(fmtValue(1_500_000, "money")).toContain("млн ₸");
	});
	it("compact — короткая форма для осей (без хвоста «₸»-единиц)", () => {
		expect(fmtValue(1_500_000, "money", true)).toContain("млн");
		expect(fmtValue(1_500_000, "money", true)).not.toContain("₸");
	});
});

describe("Реестр блоков дашборда — целостность", () => {
	it("каждый requires блока подключён страницей (иначе блок недостижим)", () => {
		for (const b of BLOCKS) expect(WIRED_MODELS.has(b.requires), b.id).toBe(true);
	});
	it("источник каждого блока известен странице", () => {
		for (const b of BLOCKS) expect(WIRED_SOURCES.has(b.source), b.id).toBe(true);
	});
	it("бар-блоки полностью описаны (valueKey + colorVar + format)", () => {
		for (const b of BLOCKS.filter((x) => x.kind === "bars")) {
			expect(b.valueKey, b.id).toBeTruthy();
			expect(b.colorVar, b.id).toMatch(/^--/);
			expect(b.format, b.id).toBeTruthy();
		}
	});
	it("id блоков уникальны", () => {
		const ids = BLOCKS.map((b) => b.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
	it("KPI-плитки ссылаются на подключённые модель и источник", () => {
		for (const t of KPI_TILES) {
			expect(WIRED_MODELS.has(t.requires), t.id).toBe(true);
			expect(WIRED_SOURCES.has(t.source), t.id).toBe(true);
		}
	});
});
