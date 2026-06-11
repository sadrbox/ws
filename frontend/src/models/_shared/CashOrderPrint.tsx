/**
 * Печатная форма кассового ордера (ПКО/РКО) — header-документ без позиций.
 */
import type { FC } from "react";
import { A4Page, A4DocTitle, A4Field, A4Row, A4Signature } from "src/components/PrintLayout/A4Page";
import { printDocNumber } from "src/components/PrintLayout/printStyles";
import { getFormatDateOnly } from "src/utils/datetime";

export interface CashOrderPrintData {
  title: string;            // «ПРИХОДНЫЙ КАССОВЫЙ ОРДЕР» | «РАСХОДНЫЙ …»
  amountLabel: string;      // «Принято» | «Выдано»
  documentId?: string | number;
  /** Ручной номер документа («Номер»). Печатается при наличии вместо id. */
  documentNumber?: string | number | null;
  documentDate?: string;
  amount?: number;
  organizationName?: string;
  counterpartyName?: string;
  contractName?: string;
  cashboxName?: string;
  operationTypeLabel?: string;   // вид кассовой операции
  basisDocumentLabel?: string;   // документ-основание
  employeeName?: string;         // подотчётное лицо (для операций по счёту 1250)
  comment?: string;
}

const fmtAmount = (v: number | undefined | null): string =>
  new Intl.NumberFormat("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0));

const fmtDate = (d?: string): string => (d ? getFormatDateOnly(d) || d : "");

const CashOrderPrint: FC<{ data: CashOrderPrintData }> = ({ data }) => (
  <A4Page>
    <A4DocTitle subtitle={`№ ${printDocNumber(data)} от ${fmtDate(data.documentDate)}`}>
      {data.title}
    </A4DocTitle>

    <div style={{ display: "flex", flexDirection: "column", gap: "3mm", fontSize: "9pt" }}>
      <A4Row>
        <A4Field label="Организация" width="50%">{data.organizationName ?? ""}</A4Field>
        <A4Field label="Касса" width="50%">{data.cashboxName ?? ""}</A4Field>
      </A4Row>
      {(data.operationTypeLabel || data.basisDocumentLabel) && (
        <A4Row>
          <A4Field label="Вид операции" width="50%">{data.operationTypeLabel ?? ""}</A4Field>
          <A4Field label="Основание" width="50%">{data.basisDocumentLabel ?? ""}</A4Field>
        </A4Row>
      )}
      {data.employeeName ? (
        <A4Row>
          <A4Field label="Подотчётное лицо" width="100%">{data.employeeName}</A4Field>
        </A4Row>
      ) : (
        <A4Row>
          <A4Field label="Контрагент" width="50%">{data.counterpartyName ?? ""}</A4Field>
          <A4Field label="Договор" width="50%">{data.contractName ?? ""}</A4Field>
        </A4Row>
      )}
      {data.comment && (
        <A4Row><A4Field label="Комментарий" width="100%">{data.comment}</A4Field></A4Row>
      )}
    </div>

    <div style={{ marginTop: "6mm", display: "flex", justifyContent: "flex-end" }}>
      <div style={{ display: "flex", justifyContent: "space-between", width: "260px", gap: 8, fontWeight: 700, fontSize: "12pt", borderTop: "1px solid #000", paddingTop: "2mm" }}>
        <span>{data.amountLabel}:</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtAmount(data.amount)} ₸</span>
      </div>
    </div>

    <div style={{ marginTop: "10mm", display: "flex", justifyContent: "flex-start", gap: "24mm" }}>
      <A4Signature role="Руководитель" />
      <A4Signature role="Гл. бухгалтер" />
      <A4Signature role="Кассир" />
    </div>
    <div style={{ marginTop: "4mm", fontSize: "8pt", color: "#555" }}>М.П.</div>
  </A4Page>
);

export default CashOrderPrint;
