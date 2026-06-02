/**
 * Единый тулкит inline-стилей для печатных форм (А4).
 *
 * ПОЧЕМУ inline, а не CSS-модуль: печать рендерится через renderToStaticMarkup
 * в изолированный iframe (см. usePrintDocument). Хешированные классы CSS-модуля
 * туда не попадают без отдельного ?inline-инжекта, поэтому весь печатный слой
 * (A4Page и формы) использует самодостаточные inline-стили. Этот файл —
 * ЕДИНЫЙ источник повторяющихся стилей таблиц/итогов/подписей, чтобы убрать
 * дублирование локальных `cell`/`head` в каждой печатной форме.
 *
 * Использование:
 *   import * as P from "src/components/PrintLayout/printStyles";
 *   <td style={{ ...P.cell, ...P.right }}>…</td>
 */
import type { CSSProperties } from "react";

// ── Ячейки таблицы ────────────────────────────────────────────────────────
export const cell: CSSProperties = {
	border: "1px solid #000",
	padding: "3px 5px",
	fontSize: "9pt",
	verticalAlign: "middle",
};

export const head: CSSProperties = {
	...cell,
	background: "#f3f3f3",
	fontWeight: 600,
	textAlign: "center",
};

// ── Модификаторы выравнивания/типографики (спред поверх cell/head) ─────────
export const right: CSSProperties = { textAlign: "right" };
export const center: CSSProperties = { textAlign: "center" };
export const bold: CSSProperties = { fontWeight: 600 };
export const muted: CSSProperties = { color: "#555" };
export const placeholder: CSSProperties = { color: "#888" };
/** Моноширинные цифры — выравнивание разрядов в суммах. */
export const tabularNums: CSSProperties = { fontVariantNumeric: "tabular-nums" };

// ── Таблица позиций ───────────────────────────────────────────────────────
export const table: CSSProperties = {
	marginTop: "4mm",
	borderCollapse: "collapse",
	width: "100%",
};

// ── Блок итогов (прижат к правому краю) ────────────────────────────────────
export const totalsBlock: CSSProperties = {
	marginTop: "4mm",
	display: "flex",
	flexDirection: "column",
	gap: "2mm",
	fontSize: "9pt",
	alignItems: "flex-end",
};

export const totalsRow: CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	width: "220px",
	gap: 8,
};

export const grandTotalRow: CSSProperties = {
	...totalsRow,
	fontWeight: 700,
	fontSize: "11pt",
	borderTop: "1px solid #000",
	paddingTop: "2mm",
};

// ── Подписи / печать ──────────────────────────────────────────────────────
export const signaturesRow: CSSProperties = {
	marginTop: "8mm",
	display: "flex",
	justifyContent: "flex-start",
	gap: "24mm",
};

export const stampNote: CSSProperties = {
	marginTop: "4mm",
	fontSize: "8pt",
	color: "#555",
};

// ── Шапка-метаблок (Организация/Контрагент/Договор над таблицей) ───────────
export const metaBlock: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "3mm",
	fontSize: "9pt",
};
