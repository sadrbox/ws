/**
 * Кнопка «Бухгалтерские проводки» для шапки документа (PaneItemHeaderActionsSlot).
 * Открывает модальное окно со списком проводок документа: счёт Дт/Кт, сумма,
 * аналитика Дт/Кт, описание + итог (количество и общая сумма).
 */
import { FC, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import Modal from "src/components/Modal";
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

const th: React.CSSProperties = { textAlign: "left", padding: "4px 8px", borderBottom: "1px solid var(--border-color, #ccc)", fontWeight: 600, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "4px 8px", borderBottom: "1px solid var(--border-color-light, #eee)", verticalAlign: "top" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };

const DocumentEntriesButton: FC<Props> = ({ documentType, documentUuid, disabled }) => {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<{ items: EntryRow[]; count: number; total: number }>({
    queryKey: ["document-entries", documentType, documentUuid],
    queryFn: async () => {
      const resp = await api.get<any>("accounting/document-entries", {
        params: { documentType, documentUuid: documentUuid! },
      });
      return { items: resp?.items ?? [], count: resp?.count ?? 0, total: resp?.total ?? 0 };
    },
    enabled: open && !!documentUuid,
  });

  const rows = data?.items ?? [];

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
          <div style={{ maxHeight: "60vh", overflow: "auto" }}>
            {isLoading ? (
              <div style={{ padding: 16 }}>{translate("loading")}</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: 16 }}>{translate("documentEntriesEmpty")}</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={th}>{translate("accountDebit")}</th>
                    <th style={th}>{translate("accountCredit")}</th>
                    <th style={{ ...th, textAlign: "right" }}>{translate("amount")}</th>
                    <th style={th}>{translate("analyticsDebit")}</th>
                    <th style={th}>{translate("analyticsCredit")}</th>
                    <th style={th}>{translate("description")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.uuid}>
                      <td style={td}>{r.debitAccountCode} {r.debitAccountName}</td>
                      <td style={td}>{r.creditAccountCode} {r.creditAccountName}</td>
                      <td style={tdNum}>{fmt(r.amount)}</td>
                      <td style={td}>{r.debitAnalytics || "—"}</td>
                      <td style={td}>{r.creditAnalytics || "—"}</td>
                      <td style={td}>{r.description || "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ ...td, fontWeight: 600 }} colSpan={2}>
                      {translate("documentEntriesCount")}: {data?.count ?? rows.length}
                    </td>
                    <td style={{ ...tdNum, fontWeight: 600 }}>{fmt(data?.total ?? 0)}</td>
                    <td style={td} colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </Modal>
      )}
    </>
  );
};

DocumentEntriesButton.displayName = "DocumentEntriesButton";
export default DocumentEntriesButton;
