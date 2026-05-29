/**
 * Счёт на оплату — печатная форма для PaymentInvoice.
 */
import type { CSSProperties, FC } from "react";
import { A4Page, A4DocTitle, A4Field, A4Row, A4Signature } from "src/components/PrintLayout/A4Page";
import { getFormatDateOnly } from "src/utils/datetime";

export interface PaymentInvoicePrintRow {
  number: number;
  name: string;
  unit?: string;
  quantity: number;
  price: number;
  vatRate?: number;
  vatAmount?: number;
  amount: number;
}

export interface PaymentInvoicePrintData {
  documentId?: string | number;
  documentDate?: string;
  organizationName?: string;
  organizationBin?: string;
  counterpartyName?: string;
  counterpartyBin?: string;
  contractName?: string;
  items: PaymentInvoicePrintRow[];
  totalAmount: number;
  totalVatAmount?: number;
  isVatPayer?: boolean;
  columns?: Record<string, boolean>;
}

const fmt = (v: number | undefined | null): string => {
  if (v === undefined || v === null || v === 0) return "—";
  return new Intl.NumberFormat("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
};

const fmtDate = (d?: string): string => {
  if (!d) return "";
  return getFormatDateOnly(d) || d;
};

const cell: CSSProperties = {
  border: "1px solid #000", padding: "3px 5px", fontSize: "9pt", verticalAlign: "middle",
};
const head: CSSProperties = {
  ...cell, background: "#f3f3f3", fontWeight: 600, textAlign: "center",
};

const PaymentInvoicePrint: FC<{ data: PaymentInvoicePrintData }> = ({ data }) => {
  const docNumber = data.documentId ?? "—";
  const docDate = fmtDate(data.documentDate);
  const cols = data.columns ?? {};

  const hasVat = data.isVatPayer !== false && (
    Number(data.totalVatAmount ?? 0) > 0 ||
    data.items.some((r) => Number(r.vatRate ?? 0) > 0)
  );
  const showVatRate = hasVat && cols.vatRate !== false;
  const showVatAmt = hasVat && cols.vatAmount !== false;
  const totalCols = 5 + (showVatRate ? 1 : 0) + (showVatAmt ? 1 : 0) + 1;

  return (
    <A4Page>
      <A4DocTitle subtitle={`№ ${docNumber} от ${docDate}`}>
        СЧЁТ НА ОПЛАТУ
      </A4DocTitle>

      <div style={{ display: "flex", flexDirection: "column", gap: "3mm", fontSize: "9pt" }}>
        <A4Row>
          <A4Field label="Получатель (поставщик)" width="50%">
            {data.organizationName ?? ""}
            {data.organizationBin ? `, БИН ${data.organizationBin}` : ""}
          </A4Field>
          <A4Field label="Плательщик (покупатель)" width="50%">
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

      <table style={{ marginTop: "4mm", borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...head, width: "8mm" }}>№</th>
            <th style={head}>Наименование товаров (работ, услуг)</th>
            <th style={{ ...head, width: "14mm" }}>Ед. изм.</th>
            <th style={{ ...head, width: "16mm" }}>Кол-во</th>
            <th style={{ ...head, width: "22mm" }}>Цена</th>
            {showVatRate && <th style={{ ...head, width: "12mm" }}>НДС, %</th>}
            {showVatAmt && <th style={{ ...head, width: "22mm" }}>Сумма НДС</th>}
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
              {showVatRate && <td style={{ ...cell, textAlign: "center" }}>{it.vatRate ?? ""}</td>}
              {showVatAmt && <td style={{ ...cell, textAlign: "right" }}>{fmt(it.vatAmount)}</td>}
              <td style={{ ...cell, textAlign: "right", fontWeight: 500 }}>{fmt(it.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: "4mm", display: "flex", flexDirection: "column", gap: "2mm", fontSize: "9pt", alignItems: "flex-end" }}>
        {showVatAmt && (
          <div style={{ display: "flex", justifyContent: "space-between", width: "220px", gap: 8 }}>
            <span style={{ color: "#555" }}>В том числе НДС:</span>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{fmt(data.totalVatAmount)}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", width: "220px", gap: 8, fontWeight: 700, fontSize: "11pt", borderTop: "1px solid #000", paddingTop: "2mm" }}>
          <span>Всего к оплате:</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(data.totalAmount)}</span>
        </div>
      </div>

      <div style={{ marginTop: "8mm", display: "flex", justifyContent: "flex-start", gap: "24mm" }}>
        <A4Signature role="Руководитель" />
        <A4Signature role="Гл. бухгалтер" />
      </div>
      <div style={{ marginTop: "4mm", fontSize: "8pt", color: "#555" }}>М.П.</div>
    </A4Page>
  );
};

export default PaymentInvoicePrint;
