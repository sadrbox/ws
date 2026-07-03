/**
 * FiscalReceiptPane — экран фискального чека после оформления продажи.
 * Для оплаты Kaspi: показывает QR и поллит статус оплаты до фискализации.
 * Для нал/карты: чек уже фискализирован — показывает результат и печать.
 */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { useAppContext } from "src/app/context";
import type { TPane } from "src/app/types";
import { Button } from "src/components/Button";
import PrintDocumentPane from "src/components/PrintPreview/PrintDocumentPane";
import FiscalReceiptPrint, { FiscalReceiptItem } from "./FiscalReceiptPrint";

interface ReceiptShape {
  id?: number; uuid?: string;
  status?: string; provider?: string; paymentMethod?: string;
  amount?: number | null; fiscalSign?: string | null; fiscalNumber?: string | null;
  fiscalDate?: string | null; createdAt?: string | null;
  qrImage?: string | null; qrPayload?: string | null;
}

const POLL_MS = 3000;
const MAX_POLLS = 40; // ~2 минуты

const fmt = (v: number | null | undefined): string =>
  new Intl.NumberFormat("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0));

const FiscalReceiptPane: FC<Partial<TPane>> = (paneProps) => {
  const { windows: { addPane } } = useAppContext();
  const data = (paneProps.data ?? {}) as {
    receipt?: ReceiptShape; items?: FiscalReceiptItem[]; organizationName?: string; bin?: string;
  };
  const [receipt, setReceipt] = useState<ReceiptShape>(data.receipt ?? {});
  const pollsRef = useRef(0);

  const isPending = receipt.status === "payment_pending";
  const isFiscalized = receipt.status === "fiscalized";
  const isFailed = receipt.status === "failed";

  const checkPayment = useCallback(async () => {
    if (!receipt.id && !receipt.uuid) return;
    try {
      const resp = await api.post<{ item: ReceiptShape }>(`fiscal-receipts/${receipt.id ?? receipt.uuid}/check-payment`, {});
      if (resp?.item) setReceipt(resp.item);
    } catch { /* перехватчик api покажет ошибку */ }
  }, [receipt.id, receipt.uuid]);

  // Автополлинг статуса оплаты Kaspi.
  useEffect(() => {
    if (!isPending) return;
    pollsRef.current = 0;
    const t = setInterval(() => {
      pollsRef.current += 1;
      if (pollsRef.current > MAX_POLLS) { clearInterval(t); return; }
      void checkPayment();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [isPending, checkPayment]);

  const printData = useMemo(() => ({
    ...receipt,
    organizationName: data.organizationName,
    bin: data.bin,
    items: data.items,
  }), [receipt, data.organizationName, data.bin, data.items]);

  const handlePrint = useCallback(() => {
    addPane({
      component: PrintDocumentPane,
      isSelector: true,
      label: `${translate("fiscalReceiptTitle")} № ${receipt.fiscalNumber ?? "—"}`,
      data: {
        id: Number(receipt.id ?? 0),
        uuid: String(receipt.uuid ?? ""),
        columnsKey: "fiscal_receipt",
        columnDefs: [],
        buildLayout: () => <FiscalReceiptPrint data={printData} />,
        fileBaseName: `Чек_${receipt.fiscalNumber ?? "новый"}`,
        title: `${translate("fiscalReceiptTitle")} № ${receipt.fiscalNumber ?? "—"}`,
      },
    });
  }, [addPane, receipt.id, receipt.uuid, receipt.fiscalNumber, printData]);

  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "16px", display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
      <h3 style={{ margin: 0 }}>{translate("fiscalReceiptTitle")}</h3>

      {isPending && (
        <>
          <div style={{ color: "#555", textAlign: "center" }}>{translate("fiscalKaspiShowQr")}</div>
          {receipt.qrImage
            ? <img src={receipt.qrImage} alt="Kaspi QR" style={{ width: 220, height: 220 }} />
            : <div style={{ wordBreak: "break-all", fontFamily: "monospace", fontSize: 12 }}>{receipt.qrPayload}</div>}
          <div style={{ fontWeight: 700, fontSize: 22 }}>{fmt(receipt.amount)} ₸</div>
          <div style={{ color: "#888" }}>{translate("fiscalKaspiWaiting")}…</div>
          <Button variant="secondary" onClick={() => void checkPayment()}>{translate("fiscalCheckPayment")}</Button>
        </>
      )}

      {isFiscalized && (
        <>
          <div style={{ color: "#1a7f37", fontSize: 40 }}>✓</div>
          <div style={{ fontWeight: 700 }}>{translate("fiscalReceiptFiscalized")}</div>
          {receipt.qrImage && <img src={receipt.qrImage} alt="QR" style={{ width: 180, height: 180 }} />}
          <div style={{ fontSize: 13, color: "#444", textAlign: "center" }}>
            <div>{translate("fiscalReceiptNumber")}: {receipt.fiscalNumber ?? "—"}</div>
            <div>{translate("fiscalReceiptSign")}: {receipt.fiscalSign ?? "—"}</div>
            <div style={{ marginTop: 4, fontWeight: 700 }}>{fmt(receipt.amount)} ₸</div>
          </div>
          {(receipt.provider ?? "stub") === "stub" && (
            <div style={{ color: "#b00", fontSize: 12, textAlign: "center" }}>{translate("fiscalReceiptStubWarning")}</div>
          )}
          <Button onClick={handlePrint}>{translate("print")}</Button>
        </>
      )}

      {isFailed && (
        <div style={{ color: "#b00", textAlign: "center" }}>
          {translate("fiscalPaymentFailed")}
        </div>
      )}
    </div>
  );
};

FiscalReceiptPane.displayName = "FiscalReceiptPane";
export default FiscalReceiptPane;
export { FiscalReceiptPane };
