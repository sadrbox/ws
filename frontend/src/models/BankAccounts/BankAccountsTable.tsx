import { FC, useCallback, useMemo } from "react";
import { useAppContext } from "src/app";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { Field } from "src/components/Field";
import { BankAccountsForm } from "./index";
import { translate } from "src/i18";
import columnsJson from "./columns.json";
import SubTable, { type SubTableContext } from "src/components/SubTable";

const MODEL_ENDPOINT = "bankaccounts";
const COMPONENT_NAME = "BankAccountsList_part";

interface BankAccountsTableProps {
  /** FK-поле владельца, например "organizationUuid", "counterpartyUuid" */
  parentField: string;
  /** UUID владельца */
  parentUuid: string;
  /** Имя владельца (для передачи в форму) */
  parentName?: string;
  disabled?: boolean;
  /** Если true — не отправлять изменения на сервер, хранить их локально */
  deferRemoteChanges?: boolean;
  /** Колбэк при изменении строк */
  onItemsChange?: (items: TDataItem[]) => void;
  /** Начальные pending-строки */
  initialPendingRows?: TDataItem[];
}

const BankAccountsTable: FC<BankAccountsTableProps> = ({
  parentField, parentUuid, parentName = "", disabled = false,
  deferRemoteChanges = false, onItemsChange, initialPendingRows,
}) => {
  const { addPane } = useAppContext().windows;
  const t = translate;

  // ── renderCell ─────────────────────────────────────────────────────────
  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "shortName") {
      if (ctx.inlineEditing) {
        return (
          <Field
            label=""
            name={`ba_shortName_${row.id}`}
            value={(row.shortName as string) ?? ""}
            onChange={e => ctx.handleInlineChange(row, "shortName", e.target.value)}
            disabled={ctx.disabled}
            width="100%"
            variant="table"
          />
        );
      }
      return <span>{(row.shortName as string) ?? ""}</span>;
    }
    if (col.identifier === "iban") {
      if (ctx.inlineEditing) {
        return (
          <Field
            label=""
            name={`ba_iban_${row.id}`}
            value={(row.iban as string) ?? ""}
            onChange={e => ctx.handleInlineChange(row, "iban", e.target.value)}
            disabled={ctx.disabled}
            width="100%"
            variant="table"
          />
        );
      }
      return <span>{(row.iban as string) ?? ""}</span>;
    }
    if (col.identifier === "bankName") {
      if (ctx.inlineEditing) {
        return (
          <Field
            label=""
            name={`ba_bankName_${row.id}`}
            value={(row.bankName as string) ?? ""}
            onChange={e => ctx.handleInlineChange(row, "bankName", e.target.value)}
            disabled={ctx.disabled}
            width="100%"
            variant="table"
          />
        );
      }
      return <span>{(row.bankName as string) ?? ""}</span>;
    }
    if (col.identifier === "bik") {
      if (ctx.inlineEditing) {
        return (
          <Field
            label=""
            name={`ba_bik_${row.id}`}
            value={(row.bik as string) ?? ""}
            onChange={e => ctx.handleInlineChange(row, "bik", e.target.value)}
            disabled={ctx.disabled}
            width="100%"
            variant="table"
          />
        );
      }
      return <span>{(row.bik as string) ?? ""}</span>;
    }
    return undefined;
  }, []);

  // ── openFormFor ────────────────────────────────────────────────────────
  const openFormFor = useCallback((data: TDataItem | undefined, ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    addPane({
      label: isEdit
        ? `${t("BankAccountsList")}: ${data?.shortName || data?.iban || t("noName")} • ${data?.id ?? "?"}`
        : `${t("BankAccountsList")}: ${t("new")}`,
      component: BankAccountsForm,
      data: isEdit ? data : { [parentField]: parentUuid, ownerName: parentName } as any,
      onSave: () => ctx.refetch(),
      onClose: () => ctx.refetch(),
    });
  }, [addPane, t, parentField, parentUuid, parentName]);

  // ── defaultNewRow ─────────────────────────────────────────────────────
  const defaultNewRow = useMemo(() => ({
    shortName: "",
    iban: "",
    bik: "",
    bankName: "",
    currencyUuid: null,
  }), []);

  return (
    <SubTable
      model={MODEL_ENDPOINT}
      componentName={COMPONENT_NAME}
      columnsJson={columnsJson}
      parentKey={parentField}
      parentUuid={parentUuid}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      onItemsChange={onItemsChange}
      emptyMessage="Сохраните запись для управления банковскими счетами."
      renderCell={renderCell}
      openFormFor={openFormFor}
      defaultNewRow={defaultNewRow}
    />
  );
};

BankAccountsTable.displayName = "BankAccountsTable";
export default BankAccountsTable;
