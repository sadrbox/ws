/** Форматирование значений показателей. Общий для графиков, KPI-плиток, тултипов. */
import { translate } from "src/i18";

/**
 * money — деньги (₸), int — штуки, percent — доля в процентах (0–100), minutes — длительность
 * в минутах (время реакции), rating — средняя оценка с одним знаком (1–5).
 */
export type ValueFormat = "money" | "int" | "percent" | "minutes" | "rating";

const nf = (max = 0) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: max, minimumFractionDigits: 0 });

/** «45 мин», «2 ч 5 мин»: время реакции больше часа читают в часах, а не в сотнях минут. */
function fmtMinutes(v: number): string {
	const total = Math.round(v);
	const min = translate("perfUnitMin");
	if (Math.abs(total) < 60) return `${total} ${min}`;
	const hours = `${nf(0).format(Math.trunc(total / 60))} ${translate("perfUnitHour")}`;
	const rest = Math.abs(total % 60);
	return rest ? `${hours} ${rest} ${min}` : hours;
}

/**
 * @param compact — короткая форма для осей (млн/тыс без хвоста единиц).
 */
export function fmtValue(v: number, format: ValueFormat, compact = false): string {
	const n = Number(v) || 0;
	if (format === "int") return nf(0).format(n);
	if (format === "percent") return `${nf(0).format(n)} %`;
	if (format === "rating") return nf(1).format(n);
	// На оси — голое число: единицы стоят в заголовке блока, а «ч»/«мин» у каждой отметки — шум.
	if (format === "minutes") return compact ? nf(0).format(n) : fmtMinutes(n);
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

/** Значение, которого может не быть (среднее без данных — null): «—» вместо ложного нуля. */
export const fmtMaybe = (v: number | null | undefined, format: ValueFormat): string =>
	v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : fmtValue(Number(v), format);
