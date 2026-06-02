/**
 * Универсальная печатная форма торгового документа с позициями (А4).
 * Используется для КП, заказов покупателя/поставщику, резерва — параметризуется
 * заголовком и подписью стороны-контрагента. Зеркалит PurchaseRequisitionPrint.
 */
import type { FC } from "react";
import { A4Page, A4DocTitle, A4Field, A4Row, A4Signature } from "src/components/PrintLayout/A4Page";
import * as P from "src/components/PrintLayout/printStyles";
import { getFormatDateOnly } from "src/utils/datetime";

export interface TradeDocPrintRow {
  number: number;
  name: string;
  unit?: string;
  quantity: number;
  price: number;
  vatRate?: number;
  vatAmount?: number;
  amount: number;
}

export interface TradeDocPrintData {
  documentId?: string | number;
  documentDate?: string;
  organizationName?: string;
  organizationBin?: string;
  counterpartyName?: string;
  counterpartyBin?: string;
  contractName?: string;
  items: TradeDocPrintRow[];
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

export interface TradeDocumentPrintProps {
  /** Заголовок документа, напр. «КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ». */
  title: string;
  /** Подпись стороны-контрагента: «Покупатель» | «Поставщик». */
  counterpartyLabel: string;
  /** Подпись итоговой строки, напр. «Итого к заказу». */
  totalLabel?: string;
  data: TradeDocPrintData;
}

const TradeDocumentPrint: FC<TradeDocumentPrintProps> = ({ title, counterpartyLabel, totalLabel = "Итого", data }) => {
  const docNumber = data.documentId ?? "—";
  const docDate = fmtDate(data.documentDate);
  const cols = data.columns ?? {};

  const hasVat = data.isVatPayer !== false && (
    Number(data.totalVatAmount ?? 0) > 0 || data.items.some((r) => Number(r.vatRate ?? 0) > 0)
  );
  const showVatRate = hasVat && cols.vatRate !== false;
  const showVatAmt = hasVat && cols.vatAmount !== false;
  const totalCols = 5 + (showVatRate ? 1 : 0) + (showVatAmt ? 1 : 0) + 1;

  return (
    <A4Page>
      <A4DocTitle subtitle={`№ ${docNumber} от ${docDate}`}>{title}</A4DocTitle>

      <div style={P.metaBlock}>
        <A4Row>
          <A4Field label="Организация" width="50%">
            {data.organizationName ?? ""}
            {data.organizationBin ? `, БИН ${data.organizationBin}` : ""}
          </A4Field>
          <A4Field label={counterpartyLabel} width="50%">
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

      <table style={P.table}>
        <thead>
          <tr>
            <th style={{ ...P.head, width: "8mm" }}>№</th>
            <th style={P.head}>Наименование товаров (работ, услуг)</th>
            <th style={{ ...P.head, width: "14mm" }}>Ед. изм.</th>
            <th style={{ ...P.head, width: "16mm" }}>Кол-во</th>
            <th style={{ ...P.head, width: "22mm" }}>Цена</th>
            {showVatRate && <th style={{ ...P.head, width: "12mm" }}>НДС, %</th>}
            {showVatAmt && <th style={{ ...P.head, width: "22mm" }}>Сумма НДС</th>}
            <th style={{ ...P.head, width: "24mm" }}>Итого</th>
          </tr>
        </thead>
        <tbody>
          {data.items.length === 0 && (
            <tr>
              <td style={{ ...P.cell, ...P.center, ...P.placeholder }} colSpan={totalCols}>Нет товарных позиций</td>
            </tr>
          )}
          {data.items.map((it) => (
            <tr key={it.number}>
              <td style={{ ...P.cell, ...P.center }}>{it.number}</td>
              <td style={P.cell}>{it.name}</td>
              <td style={{ ...P.cell, ...P.center }}>{it.unit ?? ""}</td>
              <td style={{ ...P.cell, ...P.right }}>{fmt(it.quantity)}</td>
              <td style={{ ...P.cell, ...P.right }}>{fmt(it.price)}</td>
              {showVatRate && <td style={{ ...P.cell, ...P.center }}>{it.vatRate ?? ""}</td>}
              {showVatAmt && <td style={{ ...P.cell, ...P.right }}>{fmt(it.vatAmount)}</td>}
              <td style={{ ...P.cell, ...P.right, fontWeight: 500 }}>{fmt(it.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={P.totalsBlock}>
        {showVatAmt && (
          <div style={P.totalsRow}>
            <span style={P.muted}>В том числе НДС:</span>
            <span style={{ ...P.tabularNums, fontWeight: 500 }}>{fmt(data.totalVatAmount)}</span>
          </div>
        )}
        <div style={P.grandTotalRow}>
          <span>{totalLabel}:</span>
          <span style={P.tabularNums}>{fmt(data.totalAmount)}</span>
        </div>
      </div>

      <div style={P.signaturesRow}>
        <A4Signature role="Руководитель" />
        <A4Signature role="Гл. бухгалтер" />
      </div>
      <div style={P.stampNote}>М.П.</div>
    </A4Page>
  );
};

export default TradeDocumentPrint;
