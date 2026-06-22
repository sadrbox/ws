// Единые форматтеры значений отчётов. Заменяют локальные fmt/fmtZ/fmtAmt,
// которые раньше дублировались в каждом отчёте.
import { getFormatDateOnly } from "src/utils/datetime";

const RU_KZ = "ru-KZ";
const MONEY_OPTS = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

/** Денежное значение; ноль → «—» (для разреженных таблиц). */
export const fmtNum = (n: number | null | undefined): string =>
	Number(n || 0) !== 0 ? Number(n).toLocaleString(RU_KZ, MONEY_OPTS) : "—";

/** Денежное значение; ноль показывается как 0,00 (для итогов). */
export const fmtMoney = (n: number | null | undefined): string =>
	Number(n || 0).toLocaleString(RU_KZ, MONEY_OPTS);

/** Количество с переменной точностью (до 3 знаков), ноль → «—». */
export const fmtQty = (n: number | null | undefined): string =>
	Number(n || 0) !== 0 ? Number(n).toLocaleString(RU_KZ, { maximumFractionDigits: 3 }) : "—";

/** Количество; ноль показывается как 0 (для итогов). */
export const fmtQtyZero = (n: number | null | undefined): string =>
	Number(n || 0).toLocaleString(RU_KZ, { maximumFractionDigits: 3 });

/** Процент с одним знаком: «12,3%». */
export const fmtPct = (n: number | null | undefined): string =>
	`${(Number(n) || 0).toLocaleString(RU_KZ, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Дата документа (ДД.ММ.ГГГГ). */
export const fmtDate = (d: string | Date | null | undefined): string =>
	d ? getFormatDateOnly(String(d)) : "";

/** Подпись периода: «с ДД.ММ.ГГГГ по ДД.ММ.ГГГГ». */
export const fmtPeriod = (from?: string | null, to?: string | null): string => {
	const a = fmtDate(from);
	const b = fmtDate(to);
	if (a && b) return `с ${a} по ${b}`;
	if (a) return `с ${a}`;
	if (b) return `по ${b}`;
	return "";
};
