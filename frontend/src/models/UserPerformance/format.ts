/** Форматирование значений показателей. Общий для графиков, KPI-плиток, тултипов. */

export type ValueFormat = "money" | "int";

const nf = (max = 0) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: max, minimumFractionDigits: 0 });

/**
 * @param compact — короткая форма для осей (млн/тыс без хвоста единиц).
 */
export function fmtValue(v: number, format: ValueFormat, compact = false): string {
	const n = Number(v) || 0;
	if (format === "int") return nf(0).format(n);
	// money (₸)
	const abs = Math.abs(n);
	if (compact) {
		if (abs >= 1_000_000) return nf(1).format(n / 1_000_000) + " млн";
		if (abs >= 1_000) return nf(0).format(n / 1_000) + " тыс";
		return nf(0).format(n);
	}
	if (abs >= 1_000_000) return nf(2).format(n / 1_000_000) + " млн ₸";
	if (abs >= 1_000) return nf(1).format(n / 1_000) + " тыс ₸";
	return nf(0).format(n) + " ₸";
}
