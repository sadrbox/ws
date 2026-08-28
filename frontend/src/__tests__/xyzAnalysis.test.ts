import { describe, it, expect } from "vitest";
import { abcClass, xyzClass, coeffVariation, seriesMean } from "src/models/Reports/_shared/xyz";

describe("ABC-XYZ analysis (E10)", () => {
  describe("abcClass — по накопительной доле %", () => {
    it("A до 80% включительно", () => {
      expect(abcClass(0)).toBe("A");
      expect(abcClass(80)).toBe("A");
    });
    it("B от >80% до 95% включительно", () => {
      expect(abcClass(80.01)).toBe("B");
      expect(abcClass(95)).toBe("B");
    });
    it("C свыше 95%", () => {
      expect(abcClass(95.01)).toBe("C");
      expect(abcClass(100)).toBe("C");
    });
  });

  describe("xyzClass — по коэффициенту вариации (доля)", () => {
    it("null (нет спроса) → Z", () => {
      expect(xyzClass(null)).toBe("Z");
    });
    it("X до 0.10 включительно (стабильный спрос)", () => {
      expect(xyzClass(0)).toBe("X");
      expect(xyzClass(0.10)).toBe("X");
    });
    it("Y от >0.10 до 0.25 включительно", () => {
      expect(xyzClass(0.1001)).toBe("Y");
      expect(xyzClass(0.25)).toBe("Y");
    });
    it("Z свыше 0.25 (нерегулярный спрос)", () => {
      expect(xyzClass(0.2501)).toBe("Z");
      expect(xyzClass(3)).toBe("Z");
    });
  });

  describe("coeffVariation — популяционный σ/μ", () => {
    it("пустой ряд → null", () => {
      expect(coeffVariation([])).toBeNull();
    });
    it("нулевой/отрицательный средний спрос → null (нет регулярной потребности)", () => {
      expect(coeffVariation([0, 0, 0])).toBeNull();
      expect(coeffVariation([-1, -2, 3])).toBeNull(); // среднее 0
    });
    it("константный положительный ряд → CV = 0 (идеально стабилен → X)", () => {
      const cv = coeffVariation([10, 10, 10, 10]);
      expect(cv).toBe(0);
      expect(xyzClass(cv)).toBe("X");
    });
    it("разовая продажа среди нулей → высокий CV → Z", () => {
      // [12,0,0,0,0,0]: μ=2, σ=√((100+4*5*0.2...)) — CV заведомо > 0.25.
      const cv = coeffVariation([12, 0, 0, 0, 0, 0]);
      expect(cv).not.toBeNull();
      expect(cv!).toBeGreaterThan(0.25);
      expect(xyzClass(cv)).toBe("Z");
    });
    it("известное значение: [2,4] → μ=3, σ=1 → CV=1/3", () => {
      const cv = coeffVariation([2, 4]);
      expect(cv).toBeCloseTo(1 / 3, 10);
    });
    it("умеренная вариация классифицируется как Y", () => {
      // [9,10,11,10]: μ=10, σ=√0.5≈0.707 → CV≈0.0707 → X (стабильно).
      expect(xyzClass(coeffVariation([9, 10, 11, 10]))).toBe("X");
      // [7,10,13,10]: μ=10, σ=√4.5≈2.12 → CV≈0.212 → Y.
      expect(xyzClass(coeffVariation([7, 10, 13, 10]))).toBe("Y");
    });
  });

  describe("seriesMean", () => {
    it("пустой ряд → 0", () => {
      expect(seriesMean([])).toBe(0);
    });
    it("среднее значений", () => {
      expect(seriesMean([1, 2, 3, 4])).toBe(2.5);
    });
  });
});
