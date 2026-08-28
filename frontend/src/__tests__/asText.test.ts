import { describe, it, expect } from "vitest";
import { asText } from "src/utils/asText";

describe("asText — безопасное превращение unknown в строку", () => {
  it("null/undefined → пустая строка", () => {
    expect(asText(null)).toBe("");
    expect(asText(undefined)).toBe("");
  });
  it("строки — как есть (в т.ч. пустая)", () => {
    expect(asText("привет")).toBe("привет");
    expect(asText("")).toBe("");
  });
  it("числа (включая 0 и отрицательные) → строка", () => {
    expect(asText(0)).toBe("0");
    expect(asText(42)).toBe("42");
    expect(asText(-3.5)).toBe("-3.5");
  });
  it("boolean → 'true'/'false'", () => {
    expect(asText(true)).toBe("true");
    expect(asText(false)).toBe("false");
  });
  it("bigint → строка", () => {
    expect(asText(10n)).toBe("10");
  });
  it("Date → ISO", () => {
    const d = new Date("2026-08-28T00:00:00.000Z");
    expect(asText(d)).toBe("2026-08-28T00:00:00.000Z");
  });
  it("объекты/массивы → пустая строка (НЕ «[object Object]»)", () => {
    expect(asText({ a: 1 })).toBe("");
    expect(asText([1, 2, 3])).toBe("");
    expect(asText({ toString: () => "x" })).toBe("");
  });
});
