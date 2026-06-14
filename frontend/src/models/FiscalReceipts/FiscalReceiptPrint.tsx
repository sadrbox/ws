/**
 * Печатная форма фискального чека (узкий «чековый» макет ~72мм).
 * В stub-режиме данные ФЕЙКОВЫЕ — выводится явная пометка «ТЕСТОВЫЙ ЧЕК».
 */
import type { FC } from "react";
import { translate } from "src/i18";
import { getFormatDate } from "src/utils/datetime";

export interface FiscalReceiptItem { name: string; quantity: number; price: number }
export interface FiscalReceiptData {
  fiscalNumber?: string | null;
  fiscalSign?: string | null;
  fiscalDate?: string | null;
  createdAt?: string | null;
  amount?: number | null;
  paymentMethod?: string | null;
  provider?: string | null;
  status?: string | null;
  qrImage?: string | null;
  qrPayload?: string | null;
  organizationName?: string | null;
  bin?: string | null;
  items?: FiscalReceiptItem[];
}

const fmt = (v: number | null | undefined): string =>
  new Intl.NumberFormat("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0));

const PAY_LABEL: Record<string, string> = {
  cash: "Наличные", card: "Карта", kaspi: "Kaspi QR",
};

const FiscalReceiptPrint: FC<{ data: FiscalReceiptData }> = ({ data }) => {
  const items = data.items ?? [];
  const date = data.fiscalDate || data.createdAt || "";
  const isStub = (data.provider ?? "stub") === "stub";
  return (
    <div style={{ width: "72mm", margin: "0 auto", fontFamily: "'Courier New', monospace", fontSize: "9pt", color: "#000", lineHeight: 1.35 }}>
      <div style={{ textAlign: "center", fontWeight: 700 }}>{translate("fiscalReceiptTitle")}</div>
      {isStub && (
        <div style={{ textAlign: "center", border: "1px dashed #b00", color: "#b00", margin: "2mm 0", padding: "1mm", fontSize: "8pt" }}>
          {translate("fiscalReceiptStubWarning")}
        </div>
      )}
      <div style={{ textAlign: "center", marginTop: "1mm" }}>
        <div>{data.organizationName ?? ""}</div>
        {data.bin && <div>БИН/ИИН: {data.bin}</div>}
      </div>
      <div style={{ borderTop: "1px dashed #000", margin: "2mm 0" }} />
      {items.length > 0 && (
        <>
          {items.map((it, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", marginBottom: "1mm" }}>
              <span>{i + 1}. {it.name}</span>
              <span style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{fmt(it.quantity).replace(/,00$/, "")} × {fmt(it.price)}</span>
                <span>{fmt(it.quantity * it.price)}</span>
              </span>
            </div>
          ))}
          <div style={{ borderTop: "1px dashed #000", margin: "2mm 0" }} />
        </>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "11pt" }}>
        <span>{translate("total")}</span>
        <span>{fmt(data.amount)} ₸</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{translate("paymentMethod")}</span>
        <span>{PAY_LABEL[String(data.paymentMethod)] ?? data.paymentMethod ?? ""}</span>
      </div>
      <div style={{ borderTop: "1px dashed #000", margin: "2mm 0" }} />
      <div style={{ fontSize: "8pt" }}>
        <div>{translate("date")}: {date ? getFormatDate(String(date)) : ""}</div>
        <div>{translate("fiscalReceiptNumber")}: {data.fiscalNumber ?? "—"}</div>
        <div>{translate("fiscalReceiptSign")}: {data.fiscalSign ?? "—"}</div>
      </div>
      {data.qrImage && (
        <div style={{ textAlign: "center", marginTop: "2mm" }}>
          <img src={data.qrImage} alt="QR" style={{ width: "32mm", height: "32mm" }} />
        </div>
      )}
      <div style={{ textAlign: "center", fontSize: "7.5pt", marginTop: "2mm" }}>{translate("fiscalReceiptOfdNote")}</div>
    </div>
  );
};

export default FiscalReceiptPrint;
