import { FC, useCallback, useMemo } from "react";
import { useAppContext } from "src/app";
import { useQueryClient } from "@tanstack/react-query";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { Field } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { ContractsForm } from "./index";
import { translate } from "src/i18";
import columnsJson from "./columns.json";
import SubTable, { type SubTableContext } from "src/components/SubTable";

const MODEL_ENDPOINT = "contracts";
const COMPONENT_NAME = "ContractsList_part";

interface ContractsTableProps {
  /** Тип владельца: "organization", "counterparty" */
  ownerType: string;
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

const ContractsTable: FC<ContractsTableProps> = ({
  ownerType, parentUuid, parentName = "", disabled = false,
  deferRemoteChanges = false, onItemsChange, initialPendingRows,
}) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();
  const t = translate;

  // ── renderCell ─────────────────────────────────────────────────────────
  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "shortName") {
      if (ctx.inlineEditing) {
        return (
          <Field
            label=""
            name={`ct_shortName_${row.id}`}
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
    if (col.identifier === "contractNumber") {
      if (ctx.inlineEditing) {
        return (
          <Field
            label=""
            name={`ct_contractNumber_${row.id}`}
            value={(row.contractNumber as string) ?? ""}
            onChange={e => ctx.handleInlineChange(row, "contractNumber", e.target.value)}
            disabled={ctx.disabled}
            width="100%"
            variant="table"
          />
        );
      }
      return <span>{(row.contractNumber as string) ?? ""}</span>;
    }
    if (col.identifier === "startDate") {
      if (ctx.inlineEditing) {
        const val = typeof row.startDate === "string" ? row.startDate.slice(0, 10) : "";
        return (
          <input
            type="date"
            value={val}
            onChange={e => ctx.handleInlineChange(row, "startDate", e.target.value)}
            disabled={ctx.disabled}
            style={{ border: "none", background: "transparent", padding: "2px 4px", width: "100%", fontSize: 13 }}
          />
        );
      }
      return <span>{typeof row.startDate === "string" ? row.startDate.slice(0, 10) : ""}</span>;
    }
    if (col.identifier === "endDate") {
      if (ctx.inlineEditing) {
        const val = typeof row.endDate === "string" ? row.endDate.slice(0, 10) : "";
        return (
          <input
            type="date"
            value={val}
            onChange={e => ctx.handleInlineChange(row, "endDate", e.target.value)}
            disabled={ctx.disabled}
            style={{ border: "none", background: "transparent", padding: "2px 4px", width: "100%", fontSize: 13 }}
          />
        );
      }
      return <span>{typeof row.endDate === "string" ? row.endDate.slice(0, 10) : ""}</span>;
    }
    if (col.identifier === "counterparty.shortName") {
      if (ctx.inlineEditing) {
        return (
          <LookupField
            label=""
            name={`ct_counterparty_${row.id}`}
            value={(row.counterpartyUuid as string) ?? ""}
            displayValue={(row.counterparty as any)?.shortName ?? ""}
            endpoint="counterparties"
            displayField="shortName"
            onSelect={(uuid, _dv, item) => {
              ctx.handleLookupChange(row, "counterpartyUuid", uuid, {
                counterparty: item && uuid ? { uuid, shortName: item.shortName ?? "" } : null,
              });
            }}
            onClear={() => {
              ctx.handleLookupChange(row, "counterpartyUuid", null, { counterparty: null });
            }}
            disabled={ctx.disabled}
            width="100%"
            variant="table"
          />
        );
      }
      return <span>{(row.counterparty as any)?.shortName ?? ""}</span>;
    }
    return undefined;
  }, []);

  // ── openFormFor ────────────────────────────────────────────────────────
  const openFormFor = useCallback((data: TDataItem | undefined, _ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: [MODEL_ENDPOINT] });
      _ctx.refetch();
    };
    addPane({
      label: isEdit
        ? `${t("ContractsList")}: ${data?.shortName || data?.contractNumber || t("noName")} • ${data?.id ?? "?"}`
        : `${t("ContractsList")}: ${t("new")}`,
      component: ContractsForm,
      data: isEdit ? data : { ownerType, ownerUuid: parentUuid, ownerName: parentName } as any,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, t, ownerType, parentUuid, parentName, queryClient]);

  // ── defaultNewRow ─────────────────────────────────────────────────────
  const defaultNewRow = useMemo(() => ({
    shortName: "",
    contractNumber: "",
    startDate: null,
    endDate: null,
    counterpartyUuid: null,
  }), []);

  return (
    <SubTable
      model={MODEL_ENDPOINT}
      componentName={COMPONENT_NAME}
      columnsJson={columnsJson}
      parentKey="ownerUuid"
      parentUuid={parentUuid}
      extraQueryParams={{ ownerType }}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      onItemsChange={onItemsChange}
      emptyMessage="Сохраните запись для управления договорами."
      renderCell={renderCell}
      openFormFor={openFormFor}
      defaultNewRow={defaultNewRow}
    />
  );
};

ContractsTable.displayName = "ContractsTable";
export default ContractsTable;
