// Чистая логика ABC-XYZ анализа (E10). Вынесена из XYZReport для тестируемости.
//   ABC — классы по накопительной доле в выручке: A ≤80%, B ≤95%, C — остальное.
//   XYZ — классы по коэффициенту вариации помесячного спроса: X ≤10%, Y ≤25%, Z >25%.

export type ABC = "A" | "B" | "C";
export type XYZ = "X" | "Y" | "Z";

/** ABC-класс по накопительной доле (%). */
export const abcClass = (cumPercent: number): ABC =>
  cumPercent <= 80 ? "A" : cumPercent <= 95 ? "B" : "C";

/** XYZ-класс по коэффициенту вариации (доля, не %). null (нет спроса) → Z. */
export const xyzClass = (cv: number | null): XYZ =>
  cv === null ? "Z" : cv <= 0.10 ? "X" : cv <= 0.25 ? "Y" : "Z";

/**
 * Коэффициент вариации популяции (σ/μ) по ряду помесячного спроса.
 * null — когда средний спрос ≤ 0 (регулярной потребности нет → Z) или ряд пуст.
 */
export function coeffVariation(series: number[]): number | null {
  const n = series.length;
  if (n === 0) return null;
  const mean = series.reduce((s, x) => s + x, 0) / n;
  if (mean <= 0) return null;
  const variance = series.reduce((s, x) => s + (x - mean) * (x - mean), 0) / n;
  return Math.sqrt(variance) / mean;
}

/** Среднее ряда (0 для пустого). */
export const seriesMean = (series: number[]): number =>
  series.length ? series.reduce((s, x) => s + x, 0) / series.length : 0;
