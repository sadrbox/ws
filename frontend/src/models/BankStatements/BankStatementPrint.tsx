/**
 * Печатная форма банковской выписки (одна операция по расчётному счёту).
 */
import type { FC } from "react";
import { A4Page, A4DocTitle, A4Field, A4Row, A4Signature } from "src/components/PrintLayout/A4Page";
import { printDocNumber } from "src/components/PrintLayout/printStyles";
import { getFormatDateOnly } from "src/utils/datetime";

export interface BankStatementPrintData {
  documentId?: string | number;
  documentNumber?: string | number | null;
  documentDate?: string;
  direction?: string; // "in" | "out"
  amount?: number;
  organizationName?: string;
  counterpartyName?: string;
  contractName?: string;
  bankAccountName?: string;
  basisLabel?: string;
}

const fmtAmount = (v: number | undefined | null): string =>
  new Intl.NumberFormat("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0));

const fmtDate = (d?: string): string => (d ? getFormatDateOnly(d) || d : "");

const BankStatementPrint: FC<{ data: BankStatementPrintData }> = ({ data }) => {
  const isIn = data.direction !== "bankStatementOut";
  return (
    <A4Page>
      <A4DocTitle subtitle={`№ ${printDocNumber(data)} от ${fmtDate(data.documentDate)}`}>
        БАНКОВСКАЯ ВЫПИСКА
      </A4DocTitle>

      <div style={{ display: "flex", flexDirection: "column", gap: "3mm", fontSize: "9pt" }}>
        <A4Row>
          <A4Field label="Организация" width="50%">{data.organizationName ?? ""}</A4Field>
          <A4Field label="Расчётный счёт" width="50%">{data.bankAccountName ?? ""}</A4Field>
        </A4Row>
        <A4Row>
          <A4Field label="Операция" width="50%">{isIn ? "Поступление" : "Списание"}</A4Field>
          <A4Field label="Контрагент" width="50%">{data.counterpartyName ?? ""}</A4Field>
        </A4Row>
        {data.contractName && (
          <A4Row><A4Field label="Договор" width="100%">{data.contractName}</A4Field></A4Row>
        )}
        {data.basisLabel && (
          <A4Row><A4Field label="Основание" width="100%">{data.basisLabel}</A4Field></A4Row>
        )}
      </div>

      <div style={{ marginTop: "6mm", display: "flex", justifyContent: "flex-end" }}>
        <div style={{ display: "flex", justifyContent: "space-between", width: "260px", gap: 8, fontWeight: 700, fontSize: "12pt", borderTop: "1px solid #000", paddingTop: "2mm" }}>
          <span>{isIn ? "Сумма поступления:" : "Сумма списания:"}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtAmount(data.amount)} ₸</span>
        </div>
      </div>

      <div style={{ marginTop: "10mm", display: "flex", justifyContent: "flex-start", gap: "24mm" }}>
        <A4Signature role="Руководитель" />
        <A4Signature role="Гл. бухгалтер" />
      </div>
      <div style={{ marginTop: "4mm", fontSize: "8pt", color: "#555" }}>М.П.</div>
    </A4Page>
  );
};

export default BankStatementPrint;
