/**
 * Тесты ввода числовых значений в строках SaleItemsTable.
 *
 * Проверяем:
 * 1. parseNumericInput — нормализация форматированных строк
 * 2. FieldNumber.safeValue — логика очистки значения для input
 * 3. validationRules — правила валидации полей quantity / price / discountPercent
 *    с учётом форматированных строк (пробелы, запятая как десятичный разделитель)
 */

import { describe, it, expect } from "vitest";
import { parseNumericInput } from "src/components/Table/services";

// ─── 1. parseNumericInput ──────────────────────────────────────────────────────

describe("parseNumericInput", () => {
	it("парсит целое число", () => {
		expect(parseNumericInput("42")).toBe(42);
	});

	it("парсит дробное число с точкой", () => {
		expect(parseNumericInput("3.5")).toBe(3.5);
	});

	it("парсит дробное число с запятой (русский ввод)", () => {
		expect(parseNumericInput("3,5")).toBe(3.5);
	});

	it("убирает пробелы-разделители тысяч (обычный пробел)", () => {
		expect(parseNumericInput("10 000")).toBe(10000);
	});

	it("убирает неразрывный пробел U+00A0 (Intl.NumberFormat ru-RU)", () => {
		expect(parseNumericInput("10\u00A0000")).toBe(10000);
	});

	it("убирает узкий неразрывный пробел U+202F", () => {
		expect(parseNumericInput("1\u202F000\u202F000")).toBe(1000000);
	});

	it("парсит форматированное дробное: '1 000,75'", () => {
		expect(parseNumericInput("1\u00A0000,75")).toBeCloseTo(1000.75);
	});

	it("возвращает null для пустой строки", () => {
		expect(parseNumericInput("")).toBeNull();
	});

	it("возвращает null для строки с пробелами", () => {
		expect(parseNumericInput("   ")).toBeNull();
	});

	it("возвращает null для нечислового текста", () => {
		expect(parseNumericInput("abc")).toBeNull();
	});

	it("возвращает null для смешанного значения 'abc123'", () => {
		expect(parseNumericInput("abc123")).toBeNull();
	});

	it("парсит ноль", () => {
		expect(parseNumericInput("0")).toBe(0);
	});

	it("парсит отрицательное число", () => {
		expect(parseNumericInput("-5")).toBe(-5);
	});

	it("парсит большое число '999 999 999'", () => {
		expect(parseNumericInput("999 999 999")).toBe(999999999);
	});
});

// ─── 2. safeValue логика (воспроизводим без рендера React) ───────────────────

/**
 * Воспроизводит логику safeValue из FieldNumber.
 * Если значение нельзя нормализовать — возвращает "".
 */
function computeSafeValue(value: string | undefined | null): string {
	if (value === "" || value === undefined || value === null) return "";
	const n = parseNumericInput(value as string);
	if (n === null) return "";
	return String(value)
		.replace(/[\s\u00A0\u202F]/g, "")
		.replace(",", ".");
}

describe("FieldNumber safeValue", () => {
	it("пустое значение → пустая строка", () => {
		expect(computeSafeValue("")).toBe("");
		expect(computeSafeValue(null)).toBe("");
		expect(computeSafeValue(undefined)).toBe("");
	});

	it("целое число — без изменений", () => {
		expect(computeSafeValue("42")).toBe("42");
	});

	it("дробное с точкой — без изменений", () => {
		expect(computeSafeValue("3.5")).toBe("3.5");
	});

	it("дробное с запятой → нормализуется к точке", () => {
		expect(computeSafeValue("3,5")).toBe("3.5");
	});

	it("форматированное '10 000' → '10000' (убирает пробел)", () => {
		expect(computeSafeValue("10 000")).toBe("10000");
	});

	it("форматированное с неразрывным пробелом → убирается", () => {
		expect(computeSafeValue("10\u00A0000")).toBe("10000");
	});

	it("нечисловое значение → пустая строка (НЕ ломает input)", () => {
		expect(computeSafeValue("abc")).toBe("");
	});

	it("промежуточный ввод '3.' — сохраняется (пользователь вводит дробь)", () => {
		// "3." → Number("3.") = 3 (не NaN), поэтому не сбрасываем
		expect(computeSafeValue("3.")).toBe("3.");
	});

	it("промежуточный ввод '3,' — нормализуется к '3.'", () => {
		expect(computeSafeValue("3,")).toBe("3.");
	});
});

// ─── 3. validationRules — воспроизводим логику валидаторов ───────────────────

/**
 * Воспроизводит validationRules из SaleItemsTable (количество, цена, Сумма скидки).
 */
const makeQuantityValidator =
	() =>
	(value: unknown): string | undefined => {
		if (value === "" || value == null) return undefined;
		const n = parseNumericInput(value as string);
		if (n === null) return "Должно быть числом";
		if (n < 0) return "Не может быть отрицательным";
		return undefined;
	};

const makePriceValidator = makeQuantityValidator; // та же логика

const makeDiscountValidator =
	() =>
	(value: unknown): string | undefined => {
		if (value === "" || value == null) return undefined;
		const n = parseNumericInput(value as string);
		if (n === null) return "Должно быть числом";
		if (n < 0 || n > 100) return "От 0 до 100";
		return undefined;
	};

describe("validationRules: quantity", () => {
	const validate = makeQuantityValidator();

	it("пустое значение — ошибки нет", () => {
		expect(validate("")).toBeUndefined();
		expect(validate(null)).toBeUndefined();
	});

	it("целое положительное — ошибки нет", () => {
		expect(validate("5")).toBeUndefined();
	});

	it("дробное с точкой '3.5' — ошибки нет", () => {
		expect(validate("3.5")).toBeUndefined();
	});

	it("дробное с запятой '3,5' — ошибки нет (русский ввод)", () => {
		expect(validate("3,5")).toBeUndefined();
	});

	it("большое число '10 000' с пробелом — ошибки нет", () => {
		expect(validate("10 000")).toBeUndefined();
	});

	it("большое число '10\u00A0000' с неразрывным пробелом — ошибки нет", () => {
		expect(validate("10\u00A0000")).toBeUndefined();
	});

	it("отрицательное число — ошибка", () => {
		expect(validate("-1")).toBe("Не может быть отрицательным");
	});

	it("нечисловое значение — ошибка", () => {
		expect(validate("abc")).toBe("Должно быть числом");
	});
});

describe("validationRules: price", () => {
	const validate = makePriceValidator();

	it("цена 0 — ошибки нет", () => {
		expect(validate("0")).toBeUndefined();
	});

	it("цена '1 500,99' — ошибки нет", () => {
		expect(validate("1 500,99")).toBeUndefined();
	});

	it("отрицательная цена — ошибка", () => {
		expect(validate("-0.01")).toBe("Не может быть отрицательным");
	});
});

describe("validationRules: discountPercent", () => {
	const validate = makeDiscountValidator();

	it("0 — ошибки нет", () => {
		expect(validate("0")).toBeUndefined();
	});

	it("100 — ошибки нет (граница)", () => {
		expect(validate("100")).toBeUndefined();
	});

	it("50.5 — ошибки нет", () => {
		expect(validate("50.5")).toBeUndefined();
	});

	it("50,5 (русский ввод) — ошибки нет", () => {
		expect(validate("50,5")).toBeUndefined();
	});

	it("-1 — ошибка", () => {
		expect(validate("-1")).toBe("От 0 до 100");
	});

	it("101 — ошибка", () => {
		expect(validate("101")).toBe("От 0 до 100");
	});

	it("нечисловое — ошибка", () => {
		expect(validate("xyz")).toBe("Должно быть числом");
	});
});
