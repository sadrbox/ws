/**
 * Журнал фискальных чеков (ОФД/Kaspi). Просмотр + повторный показ/печать чека
 * через FiscalReceiptPane. Чеки создаются из терминала (см. SalesTerminal).
 */
import { FC, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import type { TDataItem, TColumn } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import ModelList from "src/components/ModelList";
import { getFormatDate } from "src/utils/datetime";
import FiscalReceiptPane from "./FiscalReceiptPane";

const ENDPOINT = "fiscal-receipts";
const LIST_NAME = "FiscalReceiptsList";

const STATUS_LABEL: Record<string, string> = {
  created: "Создан",
  payment_pending: "Ожидание оплаты",
  paid: "Оплачен",
  fiscalized: "Фискализирован",
  failed: "Ошибка",
  refunded: "Возврат",
};
const PAY_LABEL: Record<string, string> = { cash: "Наличные", card: "Карта", kaspi: "Kaspi QR" };
const DOC_LABEL: Record<string, string> = { sale: "Реализация", sale_return: "Возврат от покупателя" };

// Просмотр одного чека: дозагружаем (для qrImage) и показываем FiscalReceiptPane.
const FiscalReceiptsForm: FC<Partial<TPane>> = (paneProps) => {
  const row = (paneProps.data ?? {}) as Record<string, unknown>;
  const [receipt, setReceipt] = useState<Record<string, unknown>>(row);
  useEffect(() => {
    const id = (row.id as number) ?? (row.uuid as string);
    if (!id) return;
    api.get<{ item: Record<string, unknown> }>(`${ENDPOINT}/${id}`)
      .then((r) => { if (r?.item) setReceipt(r.item); })
      .catch(() => {});
  }, [row.id, row.uuid]);
  return <FiscalReceiptPane data={{ receipt }} />;
};
FiscalReceiptsForm.displayName = "FiscalReceiptsForm";

function renderCell(row: TDataItem, col: TColumn): ReactNode | undefined {
  if (col.identifier === "status") return <span>{STATUS_LABEL[String(row.status)] ?? String(row.status ?? "")}</span>;
  if (col.identifier === "paymentMethod") return <span>{PAY_LABEL[String(row.paymentMethod)] ?? String(row.paymentMethod ?? "")}</span>;
  if (col.identifier === "documentType") return <span>{DOC_LABEL[String(row.documentType)] ?? String(row.documentType ?? "")}</span>;
  if (col.identifier === "createdAt") return <span>{row.createdAt ? getFormatDate(String(row.createdAt)) : ""}</span>;
  return undefined;
}

const FiscalReceiptsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }> = (
  { variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }
) => (
  <ModelList
    endpoint={ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={FiscalReceiptsForm}
    getLabel={(d) => (d?.fiscalNumber ? `№ ${d.fiscalNumber as string}` : translate("fiscalReceiptTitle"))}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField} extraQueryParams={extraQueryParams}
    defaultSort={{ id: "desc" }}
    renderCell={renderCell}
  />
);
FiscalReceiptsList.displayName = LIST_NAME;

export { FiscalReceiptsForm, FiscalReceiptsList };
