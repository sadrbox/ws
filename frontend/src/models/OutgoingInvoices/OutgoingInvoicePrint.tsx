/**
 * Счёт-фактура (ЭСФ) — печатная форма по НК РК ст. 412.
 * direction="outgoing" — Счёт-фактура исходящая (ЭСФ на реализацию)
 * direction="incoming" — Счёт-фактура входящая (ЭСФ полученный)
 *
 * Структура идентична SaleInvoicePrint, но с заголовком «Счёт-фактура»
 * вместо «Накладная З-2».
 */
import type { FC } from "react";
import * as P from "src/components/PrintLayout/printStyles";
import { A4Page, A4DocTitle, A4Field, A4Row, A4Signature } from "src/components/PrintLayout/A4Page";
import { getFormatDateOnly } from "src/utils/datetime";
import type { SaleItemPrintRow, SaleInvoicePrintColumns } from "src/models/Sales/SaleInvoicePrint";

export interface OutgoingInvoicePrintData {
  direction: "outgoing" | "incoming";
  documentId?: string | number;
  documentDate?: string;
  organizationName?: string;
  organizationBin?: string;
  organizationAddress?: string;
  counterpartyName?: string;
  counterpartyBin?: string;
  counterpartyAddress?: string;
  contractName?: string;
  items: SaleItemPrintRow[];
  totalAmount: number;
  totalAmountWithoutVat?: number;
  totalVatAmount?: number;
  totalDiscountAmount?: number;
  totalExciseAmount?: number;
  isVatPayer?: boolean;
  columns?: SaleInvoicePrintColumns;
}

const fmt = (v: number | undefined | null): string => {
  if (v === undefined || v === null || v === 0) return "—";
  return new Intl.NumberFormat("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
};

const fmtDate = (d?: string): string => {
  if (!d) return "";
  return getFormatDateOnly(d) || d;
};

// Единый источник стилей ячеек печати (плотный вариант) — printStyles.
const cell = P.cellCompact;
const head = P.headCompact;

const OutgoingInvoicePrint: FC<{ data: OutgoingInvoicePrintData }> = ({ data }) => {
  const docNumber = data.documentId ?? "—";
  const docDate = fmtDate(data.documentDate);

  const cols = data.columns ?? {};
  const has = (getter: (r: SaleItemPrintRow) => number | undefined | null): boolean =>
    data.items.some((r) => Number(getter(r) ?? 0) > 0);

  const hasVat = has((r) => r.vatRate) || has((r) => r.vatAmount) || Number(data.totalVatAmount ?? 0) > 0;
  const hasExcise = has((r) => r.exciseRate) || has((r) => r.exciseAmount) || Number(data.totalExciseAmount ?? 0) > 0;
  const hasIndirectTaxes = hasVat || hasExcise;

  const showDiscPct = cols.discountPercent !== false && (cols.discountPercent === true || has((r) => r.discountPercent) || has((r) => r.discountAmount));
  const showDiscAmt = cols.discountAmount !== false && (cols.discountAmount === true || has((r) => r.discountAmount) || Number(data.totalDiscountAmount ?? 0) > 0);
  const showNetOfTax = hasIndirectTaxes && cols.amountNetOfIndirectTaxes !== false && (cols.amountNetOfIndirectTaxes === true || has((r) => r.amountNetOfIndirectTaxes));
  const showAmtNoVat = hasIndirectTaxes && cols.amountWithoutVat !== false;
  const showExcRate = hasExcise && cols.exciseRate !== false && (cols.exciseRate === true || has((r) => r.exciseRate));
  const showExcAmt = hasExcise && cols.exciseAmount !== false && (cols.exciseAmount === true || has((r) => r.exciseAmount) || Number(data.totalExciseAmount ?? 0) > 0);
  const showVatRate = cols.vatRate !== false;
  const showVatAmt = data.isVatPayer !== false && hasVat && cols.vatAmount !== false && (cols.vatAmount === true || has((r) => r.vatAmount) || Number(data.totalVatAmount ?? 0) > 0);

  const itogoSpan = 5 + (showDiscPct ? 1 : 0);
  const totalCols = itogoSpan
    + (showDiscAmt ? 1 : 0) + (showNetOfTax ? 1 : 0) + (showAmtNoVat ? 1 : 0)
    + (showExcRate ? 1 : 0) + (showExcAmt ? 1 : 0)
    + (showVatRate ? 1 : 0) + (showVatAmt ? 1 : 0) + 1;

  const isOutgoing = data.direction === "outgoing";
  const titleText = isOutgoing ? "Счёт-фактура" : "Счёт-фактура входящая";
  const subtitle = `№ ${docNumber} от ${docDate}`;

  return (
    <A4Page>
      <A4DocTitle subtitle={subtitle}>{titleText}</A4DocTitle>

      <div style={{ display: "flex", flexDirection: "column", gap: "3mm", fontSize: "9pt" }}>
        <A4Row>
          <A4Field label={isOutgoing ? "Поставщик (продавец)" : "Поставщик"} width="50%">
            {isOutgoing ? (data.organizationName ?? "") : (data.counterpartyName ?? "")}
            {isOutgoing && data.organizationBin ? `, БИН ${data.organizationBin}` : ""}
            {!isOutgoing && data.counterpartyBin ? `, БИН ${data.counterpartyBin}` : ""}
          </A4Field>
          <A4Field label="Адрес поставщика" width="50%">
            {isOutgoing ? (data.organizationAddress ?? "") : (data.counterpartyAddress ?? "")}
          </A4Field>
        </A4Row>
        <A4Row>
          <A4Field label={isOutgoing ? "Покупатель" : "Покупатель (получатель)"} width="50%">
            {isOutgoing ? (data.counterpartyName ?? "") : (data.organizationName ?? "")}
            {isOutgoing && data.counterpartyBin ? `, БИН ${data.counterpartyBin}` : ""}
            {!isOutgoing && data.organizationBin ? `, БИН ${data.organizationBin}` : ""}
          </A4Field>
          <A4Field label="Адрес покупателя" width="50%">
            {isOutgoing ? (data.counterpartyAddress ?? "") : (data.organizationAddress ?? "")}
          </A4Field>
        </A4Row>
        <A4Row>
          <A4Field label="Договор / основание" width="60%">{data.contractName ?? ""}</A4Field>
        </A4Row>
      </div>

      <table style={{ marginTop: "3mm", borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...head, width: "8mm" }}>№</th>
            <th style={head}>Наименование товаров (работ, услуг)</th>
            <th style={{ ...head, width: "14mm" }}>Ед. изм.</th>
            <th style={{ ...head, width: "16mm" }}>Кол-во</th>
            <th style={{ ...head, width: "20mm" }}>Цена</th>
            {showDiscPct && <th style={{ ...head, width: "12mm" }}>Скидка, %</th>}
            {showDiscAmt && <th style={{ ...head, width: "20mm" }}>Сумма скидки</th>}
            {showNetOfTax && <th style={{ ...head, width: "22mm" }}>Сумма без налогов</th>}
            {showAmtNoVat && <th style={{ ...head, width: "22mm" }}>Облагаемый оборот по НДС</th>}
            {showExcRate && <th style={{ ...head, width: "14mm" }}>Ставка акциза, %</th>}
            {showExcAmt && <th style={{ ...head, width: "20mm" }}>Сумма акциза</th>}
            {showVatRate && <th style={{ ...head, width: "12mm" }}>Ставка НДС, %</th>}
            {showVatAmt && <th style={{ ...head, width: "20mm" }}>Сумма НДС</th>}
            <th style={{ ...head, width: "24mm" }}>Сумма</th>
          </tr>
        </thead>
        <tbody>
          {data.items.length === 0 && (
            <tr>
              <td style={{ ...cell, textAlign: "center", color: "#888" }} colSpan={totalCols}>
                Нет товарных позиций
              </td>
            </tr>
          )}
          {data.items.map((it) => (
            <tr key={it.number}>
              <td style={{ ...cell, textAlign: "center" }}>{it.number}</td>
              <td style={cell}>{it.name}</td>
              <td style={{ ...cell, textAlign: "center" }}>{it.unit ?? ""}</td>
              <td style={{ ...cell, textAlign: "right" }}>{fmt(it.quantity)}</td>
              <td style={{ ...cell, textAlign: "right" }}>{fmt(it.price)}</td>
              {showDiscPct && <td style={{ ...cell, textAlign: "right" }}>{it.discountPercent != null && it.discountPercent !== 0 ? it.discountPercent : "—"}</td>}
              {showDiscAmt && <td style={{ ...cell, textAlign: "right" }}>{fmt(it.discountAmount)}</td>}
              {showNetOfTax && <td style={{ ...cell, textAlign: "right" }}>{fmt(it.amountNetOfIndirectTaxes)}</td>}
              {showAmtNoVat && <td style={{ ...cell, textAlign: "right" }}>{fmt(it.amountWithoutVat)}</td>}
              {showExcRate && <td style={{ ...cell, textAlign: "right" }}>{it.exciseRate != null && it.exciseRate !== 0 ? it.exciseRate : "—"}</td>}
              {showExcAmt && <td style={{ ...cell, textAlign: "right" }}>{fmt(it.exciseAmount)}</td>}
              {showVatRate && <td style={{ ...cell, textAlign: "center" }}>{data.isVatPayer === false ? "Без НДС" : (it.vatRate != null ? it.vatRate : "")}</td>}
              {showVatAmt && <td style={{ ...cell, textAlign: "right" }}>{fmt(it.vatAmount)}</td>}
              <td style={{ ...cell, textAlign: "right", fontWeight: 500 }}>{fmt(it.amount)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...cell, textAlign: "right", fontWeight: 700 }} colSpan={itogoSpan}>Итого:</td>
            {showDiscAmt && <td style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{fmt(data.totalDiscountAmount)}</td>}
            {showNetOfTax && <td style={cell} />}
            {showAmtNoVat && <td style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{fmt(data.totalAmountWithoutVat)}</td>}
            {showExcRate && <td style={cell} />}
            {showExcAmt && <td style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{fmt(data.totalExciseAmount)}</td>}
            {showVatRate && <td style={cell} />}
            {showVatAmt && <td style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{fmt(data.totalVatAmount)}</td>}
            <td style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{fmt(data.totalAmount)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: "4mm", fontSize: "9pt" }}>
        <div>
          Всего наименований <b>{data.items.length}</b>, на сумму:&nbsp;
          <b>{fmt(data.totalAmount)} тенге</b>
        </div>
        {hasVat && (
          <div style={{ marginTop: "1mm" }}>
            В том числе НДС:&nbsp;<b>{fmt(data.totalVatAmount)} тенге</b>
          </div>
        )}
      </div>

      <div style={{ marginTop: "8mm", display: "flex", justifyContent: "space-between", gap: "8mm" }}>
        <A4Signature role="Руководитель" />
        <A4Signature role="Главный бухгалтер" />
      </div>
      <div style={{ marginTop: "4mm", fontSize: "8pt", color: "#555" }}>М.П.</div>
    </A4Page>
  );
};

export default OutgoingInvoicePrint;
