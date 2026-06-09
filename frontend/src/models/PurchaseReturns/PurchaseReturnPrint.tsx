import type { FC } from "react";
import { A4Page, A4DocTitle, A4Field, A4Row, A4Signature } from "src/components/PrintLayout/A4Page";
import * as P from "src/components/PrintLayout/printStyles";
import { getFormatDateOnly } from "src/utils/datetime";
import type { SaleInvoicePrintData, SaleItemPrintRow } from "src/models/Sales/SaleInvoicePrint";

const fmt = (v: number | undefined | null): string => {
  if (v === undefined || v === null || v === 0) return "—";
  return new Intl.NumberFormat("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
};

const fmtDate = (d?: string): string => d ? (getFormatDateOnly(d) || d) : "";

// Единый источник стилей ячеек печати (плотный вариант) — printStyles.
const cellStyle = P.cellCompact;
const headCellStyle = P.headCompact;

const PurchaseReturnPrint: FC<{ data: SaleInvoicePrintData }> = ({ data }) => {
  const docNumber = P.printDocNumber(data);
  const docDate = fmtDate(data.documentDate);

  const items: SaleItemPrintRow[] = data.items;
  const cols = data.columns ?? {};
  const has = (getter: (r: SaleItemPrintRow) => number | undefined | null) =>
    items.some((r) => Number(getter(r) ?? 0) > 0);

  const hasVat = has((r) => r.vatRate) || has((r) => r.vatAmount) || Number(data.totalVatAmount ?? 0) > 0;
  const hasExcise = has((r) => r.exciseRate) || has((r) => r.exciseAmount) || Number(data.totalExciseAmount ?? 0) > 0;
  const hasIndirectTaxes = hasVat || hasExcise;

  const showDiscPct = cols.discountPercent !== false && (cols.discountPercent === true || has((r) => r.discountPercent) || has((r) => r.discountAmount));
  const showDiscAmt = cols.discountAmount !== false && (cols.discountAmount === true || has((r) => r.discountAmount) || Number(data.totalDiscountAmount ?? 0) > 0);
  const showNetOfIndirectTaxes = hasIndirectTaxes && cols.amountNetOfIndirectTaxes !== false && (cols.amountNetOfIndirectTaxes === true || has((r) => r.amountNetOfIndirectTaxes));
  const showAmtNoVat = hasIndirectTaxes && cols.amountWithoutVat !== false;
  const showExciseRate = hasExcise && cols.exciseRate !== false && (cols.exciseRate === true || has((r) => r.exciseRate));
  const showExciseAmt = hasExcise && cols.exciseAmount !== false && (cols.exciseAmount === true || has((r) => r.exciseAmount) || Number(data.totalExciseAmount ?? 0) > 0);
  const showVatRate = hasVat && cols.vatRate !== false;
  const showVatAmt = hasVat && cols.vatAmount !== false && (cols.vatAmount === true || has((r) => r.vatAmount) || Number(data.totalVatAmount ?? 0) > 0);

  const itogoSpan = 5 + (showDiscPct ? 1 : 0);
  const totalCols = itogoSpan
    + (showDiscAmt ? 1 : 0)
    + (showNetOfIndirectTaxes ? 1 : 0)
    + (showAmtNoVat ? 1 : 0)
    + (showExciseRate ? 1 : 0)
    + (showExciseAmt ? 1 : 0)
    + (showVatRate ? 1 : 0)
    + (showVatAmt ? 1 : 0)
    + 1;

  const totalAmount = items.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const totalVatAmount = items.reduce((s, r) => s + Number(r.vatAmount ?? 0), 0);
  const totalExciseAmount = items.reduce((s, r) => s + Number(r.exciseAmount ?? 0), 0);
  const totalAmountWithoutVat = items.reduce((s, r) => s + Number(r.amountWithoutVat ?? 0), 0);
  const totalDiscountAmount = items.reduce((s, r) => s + Number(r.discountAmount ?? 0), 0);

  return (
    <A4Page>
      <A4DocTitle subtitle={`№ ${docNumber} от ${docDate}`}>
        АКТ ВОЗВРАТА ТОВАРОВ ПОСТАВЩИКУ
      </A4DocTitle>

      <div style={{ display: "flex", flexDirection: "column", gap: "3mm", fontSize: "9pt" }}>
        <A4Row>
          <A4Field label="Покупатель (возвращает)" width="50%">
            {data.organizationName ?? ""}
            {data.organizationBin ? `, БИН ${data.organizationBin}` : ""}
          </A4Field>
          <A4Field label="Поставщик (получает возврат)" width="50%">
            {data.counterpartyName ?? ""}
            {data.counterpartyBin ? `, БИН ${data.counterpartyBin}` : ""}
          </A4Field>
        </A4Row>
        {data.contractName && (
          <A4Row>
            <A4Field label="Договор / основание" width="100%">{data.contractName}</A4Field>
          </A4Row>
        )}
      </div>

      <table style={{ marginTop: "3mm", borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...headCellStyle, width: "8mm" }}>№</th>
            <th style={headCellStyle}>Наименование товара</th>
            <th style={{ ...headCellStyle, width: "14mm" }}>Ед. изм.</th>
            <th style={{ ...headCellStyle, width: "16mm" }}>Кол-во</th>
            <th style={{ ...headCellStyle, width: "20mm" }}>Цена</th>
            {showDiscPct && <th style={{ ...headCellStyle, width: "12mm" }}>Скидка, %</th>}
            {showDiscAmt && <th style={{ ...headCellStyle, width: "20mm" }}>Сумма скидки</th>}
            {showNetOfIndirectTaxes && <th style={{ ...headCellStyle, width: "22mm" }}>Сумма без налогов</th>}
            {showAmtNoVat && <th style={{ ...headCellStyle, width: "22mm" }}>Облагаемый оборот</th>}
            {showExciseRate && <th style={{ ...headCellStyle, width: "14mm" }}>Ставка акциза, %</th>}
            {showExciseAmt && <th style={{ ...headCellStyle, width: "20mm" }}>Сумма акциза</th>}
            {showVatRate && <th style={{ ...headCellStyle, width: "12mm" }}>Ставка НДС, %</th>}
            {showVatAmt && <th style={{ ...headCellStyle, width: "20mm" }}>Сумма НДС</th>}
            <th style={{ ...headCellStyle, width: "24mm" }}>Сумма</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td style={{ ...cellStyle, textAlign: "center", color: "#888" }} colSpan={totalCols}>
                Нет товарных позиций
              </td>
            </tr>
          )}
          {items.map((it) => (
            <tr key={it.number}>
              <td style={{ ...cellStyle, textAlign: "center" }}>{it.number}</td>
              <td style={cellStyle}>{it.name}</td>
              <td style={{ ...cellStyle, textAlign: "center" }}>{it.unit ?? ""}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(it.quantity)}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(it.price)}</td>
              {showDiscPct && (
                <td style={{ ...cellStyle, textAlign: "right" }}>
                  {it.discountPercent != null && it.discountPercent !== 0 ? it.discountPercent : "—"}
                </td>
              )}
              {showDiscAmt && <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(it.discountAmount)}</td>}
              {showNetOfIndirectTaxes && <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(it.amountNetOfIndirectTaxes)}</td>}
              {showAmtNoVat && <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(it.amountWithoutVat)}</td>}
              {showExciseRate && (
                <td style={{ ...cellStyle, textAlign: "right" }}>
                  {it.exciseRate != null && it.exciseRate !== 0 ? `${it.exciseRate}%` : "—"}
                </td>
              )}
              {showExciseAmt && <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(it.exciseAmount)}</td>}
              {showVatRate && (
                <td style={{ ...cellStyle, textAlign: "center" }}>
                  {it.vatRate != null ? `${it.vatRate}%` : ""}
                </td>
              )}
              {showVatAmt && <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(it.vatAmount)}</td>}
              <td style={{ ...cellStyle, textAlign: "right", fontWeight: 500 }}>{fmt(it.amount)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...cellStyle, fontWeight: 700, textAlign: "right" }} colSpan={itogoSpan}>Итого:</td>
            {showDiscAmt && <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }}>{fmt(totalDiscountAmount)}</td>}
            {showNetOfIndirectTaxes && <td style={cellStyle} />}
            {showAmtNoVat && <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }}>{fmt(totalAmountWithoutVat)}</td>}
            {showExciseRate && <td style={cellStyle} />}
            {showExciseAmt && <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }}>{fmt(totalExciseAmount)}</td>}
            {showVatRate && <td style={cellStyle} />}
            {showVatAmt && <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }}>{fmt(totalVatAmount)}</td>}
            <td style={{ ...cellStyle, textAlign: "right", fontWeight: 700 }}>{fmt(totalAmount)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: "4mm", fontSize: "9pt" }}>
        Всего наименований: <b>{items.length}</b>, на сумму: <b>{fmt(totalAmount)} тенге</b>
        {showVatAmt && <>, в т.ч. НДС: <b>{fmt(totalVatAmount)} тенге</b></>}
      </div>

      <div style={{ marginTop: "8mm", display: "flex", justifyContent: "space-between", gap: "12mm" }}>
        <A4Signature role="Покупатель (сдал)" />
        <A4Signature role="Поставщик (принял)" />
      </div>
      <div style={{ marginTop: "6mm", fontSize: "8pt", color: "#555" }}>М.П.</div>
    </A4Page>
  );
};

export default PurchaseReturnPrint;
