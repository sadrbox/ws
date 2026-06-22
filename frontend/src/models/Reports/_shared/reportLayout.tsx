// Тонкие переиспользуемые примитивы макета отчёта поверх report.module.scss.
// Не вводят новых стилей — только убирают повтор разметки/классов в отчётах.
import { FC, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";
import styles from "../report.module.scss";
import { fmtNum, fmtMoney, fmtQty } from "./reportFormat";

// Классы колонок: <Th col="num"> / <Td col="name">.
const COL: Record<string, string> = {
	n: styles.ColN, name: styles.ColName, uom: styles.ColUom,
	date: styles.ColDate, num: styles.ColNum, tag: styles.ColTag,
};
// Цветовые акценты значения (себестоимость/цена/прибыль/убыток/минус).
const VARIANT: Record<string, string> = {
	neg: styles.Negative, cost: styles.Cost, sale: styles.SalePrice,
	profit: styles.Profit, loss: styles.Loss,
};
const cx = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(" ");

// ── Лист отчёта: шапка (орг/заголовок/подзаголовок/сортировка/сводка) + тело ──
export const ReportSheet: FC<{
	org?: ReactNode; title: ReactNode; subTitle?: ReactNode;
	sortLine?: ReactNode; summary?: ReactNode; children: ReactNode;
}> = ({ org, title, subTitle, sortLine, summary, children }) => (
	<div className={styles.Report}>
		{org ? <div className={styles.OrgName}>{org}</div> : null}
		<div className={styles.Title}>{title}</div>
		{subTitle ? <div className={styles.SubTitle}>{subTitle}</div> : null}
		{sortLine ? <div className={styles.SortLine}>{sortLine}</div> : null}
		{summary ? <div className={styles.Summary}>{summary}</div> : null}
		{children}
	</div>
);

export const ReportTable: FC<{ children: ReactNode }> = ({ children }) => (
	<table className={styles.Table}>{children}</table>
);

type ThProps = ThHTMLAttributes<HTMLTableCellElement> & { col?: keyof typeof COL };
export const Th: FC<ThProps> = ({ col, className, children, ...rest }) => (
	<th className={cx(col && COL[col], className)} {...rest}>{children}</th>
);

type TdProps = TdHTMLAttributes<HTMLTableCellElement> & { col?: keyof typeof COL; variant?: keyof typeof VARIANT };
export const Td: FC<TdProps> = ({ col, variant, className, children, ...rest }) => (
	<td className={cx(col && COL[col], variant && VARIANT[variant], className)} {...rest}>{children}</td>
);

// ── Строки итогов/группировки ─────────────────────────────────────────────────
export const TotalRow: FC<{ children: ReactNode }> = ({ children }) => (
	<tr className={styles.TotalRow}>{children}</tr>
);
export const SectionHeader: FC<{ children: ReactNode }> = ({ children }) => (
	<tr className={styles.SectionHeader}>{children}</tr>
);
export const SubtotalRow: FC<{ children: ReactNode }> = ({ children }) => (
	<tr className={styles.SubtotalRow}>{children}</tr>
);

// ── Денежное/количественное значение с раскраской ────────────────────────────
export const Money: FC<{
	value: number | null | undefined;
	/** money — деньги (ноль «—»); zeroMoney — деньги (ноль 0,00); qty — количество. */
	as?: "money" | "zeroMoney" | "qty";
	/** Цветовой акцент (себестоимость/цена/прибыль/убыток/красный для минуса). */
	variant?: keyof typeof VARIANT;
	/** Авто-красный для отрицательных значений. */
	autoNeg?: boolean;
}> = ({ value, as = "money", variant, autoNeg }) => {
	const text = as === "qty" ? fmtQty(value) : as === "zeroMoney" ? fmtMoney(value) : fmtNum(value);
	const v = variant ?? (autoNeg && Number(value || 0) < 0 ? "neg" : undefined);
	return v ? <span className={VARIANT[v]}>{text}</span> : <>{text}</>;
};

// ── Бейдж направления (приход/расход) ─────────────────────────────────────────
export const DirectionTag: FC<{ dir: "receipt" | "expense"; children: ReactNode }> = ({ dir, children }) => (
	<span className={dir === "receipt" ? styles.TagReceipt : styles.TagExpense}>{children}</span>
);
