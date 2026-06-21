/**
 * Кнопка «Бухгалтерские проводки» для шапки документа (PaneItemHeaderActionsSlot).
 * Открывает модальное окно со списком проводок документа: счёт Дт/Кт, сумма,
 * аналитика Дт/Кт, описание + итог (количество и общая сумма).
 *
 * Таблица проводок выводится через SubTableSheets (read-only «простыня»: авто-
 * высота строк, перенос длинного текста в аналитике/описании, без чекбоксов).
 * Данные грузятся запросом к accounting/document-entries.
 */
import { FC, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import Modal from "src/components/Modal";
import SubTableSheets from "src/components/SubTableSheets";
import type { TColumn, TDataItem } from "src/components/Table/types";
import toolbarStyles from "src/components/Toolbar/Toolbar.module.scss";

interface EntryRow {
  uuid: string;
  debitAccountCode: string; debitAccountName: string;
  creditAccountCode: string; creditAccountName: string;
  amount: number;
  description: string;
  debitAnalytics: string;
  creditAnalytics: string;
}

interface Props {
  documentType: string;
  documentUuid?: string;
  disabled?: boolean;
}

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Колонки проводок. identifier совпадает с i18-ключами (заголовки переводятся
// через getTranslateColumn). Значения собираются в renderCell.
const ENTRY_COLUMNS = [
  { identifier: "accountDebit", type: "string", width: "200px", minWidth: "140px", alignment: "left", visible: true, inlist: true, sortable: false },
  { identifier: "accountCredit", type: "string", width: "200px", minWidth: "140px", alignment: "left", visible: true, inlist: true, sortable: false },
  { identifier: "amount", type: "number", width: "120px", minWidth: "90px", alignment: "right", visible: true, inlist: true, sortable: false },
  { identifier: "analyticsDebit", type: "string", width: "200px", minWidth: "130px", alignment: "left", visible: true, inlist: true, sortable: false },
  { identifier: "analyticsCredit", type: "string", width: "200px", minWidth: "130px", alignment: "left", visible: true, inlist: true, sortable: false },
  { identifier: "description", type: "string", width: "260px", minWidth: "150px", alignment: "left", visible: true, inlist: true, sortable: false },
] as unknown as TColumn[];

const join = (...xs: (string | undefined)[]) => xs.map((x) => (x ?? "").trim()).filter(Boolean).join(" ");

const entryCellRenderer = (row: TDataItem, col: TColumn): React.ReactNode | undefined => {
  const r = row as unknown as EntryRow;
  switch (col.identifier) {
    case "accountDebit": return <span>{join(r.debitAccountCode, r.debitAccountName) || "—"}</span>;
    case "accountCredit": return <span>{join(r.creditAccountCode, r.creditAccountName) || "—"}</span>;
    case "amount": return <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(r.amount)}</span>;
    case "analyticsDebit": return <span>{r.debitAnalytics || "—"}</span>;
    case "analyticsCredit": return <span>{r.creditAnalytics || "—"}</span>;
    case "description": return <span>{r.description || "—"}</span>;
    default: return undefined;
  }
};

const DocumentEntriesButton: FC<Props> = ({ documentType, documentUuid, disabled }) => {
  const [open, setOpen] = useState(false);

  // staleTime:0 + refetchOnMount — при каждом открытии модалки тянем актуальные
  // проводки с сервера. Сервер сам соблюдает инвариант «проводки ⇔ Проведён»
  // (filterPostedEntries), поэтому после отмены «Проведён» вернётся пусто. Без
  // этого React Query отдавал бы закэшированные проводки (staleTime по умолчанию
  // 2 мин) — и они «висели» бы после распроведения.
  const { data, isFetching } = useQuery<{ items: EntryRow[]; count: number; total: number }>({
    queryKey: ["document-entries", documentType, documentUuid],
    queryFn: async () => {
      const resp = await api.get<any>("accounting/document-entries", {
        params: { documentType, documentUuid: documentUuid! },
      });
      return { items: resp?.items ?? [], count: resp?.count ?? 0, total: resp?.total ?? 0 };
    },
    enabled: open && !!documentUuid,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const rows = useMemo<TDataItem[]>(
    () => (data?.items ?? []) as unknown as TDataItem[],
    [data],
  );

  return (
    <>
      <IconButton
        size="md"
        className={toolbarStyles.DropdownToggleButton}
        title={translate("documentEntries")}
        aria-label={translate("documentEntries")}
        disabled={disabled || !documentUuid}
        onClick={() => setOpen(true)}
      >
        <Icon name="ledger" />
      </IconButton>
      {open && (
        <Modal
          title={translate("documentEntries")}
          onClose={() => setOpen(false)}
          buttons={[{ label: translate("close"), onClick: () => setOpen(false), variant: "secondary" }]}
          style={{ minWidth: 720, maxWidth: "90vw" }}
        >
          <div>
            {isFetching ? (
              <div style={{ padding: 16 }}>{translate("loading")}</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: 16 }}>{translate("documentEntriesEmpty")}</div>
            ) : (
              <>
                <SubTableSheets
                  columns={ENTRY_COLUMNS}
                  rows={rows}
                  renderCell={entryCellRenderer}
                  emptyMessage={translate("documentEntriesEmpty")}
                  maxHeight="60vh"
                  footerRender={(col, frows) => {
                    // Итоги в футере: количество проводок (слева) + сумма (справа).
                    if (col.identifier === "accountDebit") {
                      return <span>{translate("documentEntriesCount")}: {data?.count ?? frows.length}</span>;
                    }
                    if (col.identifier === "amount") {
                      const sum = frows.reduce((s, r) => s + (Number((r as unknown as EntryRow).amount) || 0), 0);
                      return <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(sum)}</span>;
                    }
                    return undefined;
                  }}
                />
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
};

DocumentEntriesButton.displayName = "DocumentEntriesButton";
export default DocumentEntriesButton;
