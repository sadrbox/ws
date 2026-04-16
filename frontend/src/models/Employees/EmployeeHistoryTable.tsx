import { FC, useCallback, useMemo } from "react";
import { useAppContext } from "src/app";
import { useQueryClient } from "@tanstack/react-query";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { FieldNumber, FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import EmployeeHistoryForm from "./EmployeeHistoryForm";
import { translate } from "src/i18";
import columnsJson from "./historyColumns.json";
import SubTable, { type SubTableContext, type TCellValidator } from "src/components/SubTable";
import { makePaneLabelFromData } from "src/utils/buildPaneLabel";

const MODEL_ENDPOINT = "employee-histories";
const COMPONENT_NAME = "EmployeeHistoryList_part";

const EVENT_TYPE_OPTIONS = [
  { value: "hire", label: "Приём" },
  { value: "fire", label: "Увольнение" },
  { value: "transfer", label: "Перемещение" },
];

interface EmployeeHistoryTableProps {
  employeeUuid: string;
  disabled?: boolean;
  /** Если true — не отправлять изменения на сервер, хранить локально */
  deferRemoteChanges?: boolean;
  /** Колбэк при изменении строк */
  onItemsChange?: (items: TDataItem[]) => void;
  /** Начальные pending-строки */
  initialPendingRows?: TDataItem[];
}

const EmployeeHistoryTable: FC<EmployeeHistoryTableProps> = ({ employeeUuid, disabled = false, deferRemoteChanges = false, onItemsChange, initialPendingRows }) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();
  const t = translate;

  const eventTypeMap = useMemo(() => Object.fromEntries(EVENT_TYPE_OPTIONS.map(o => [o.value, o.label])), []);

  // ── renderCell ─────────────────────────────────────────────────────────
  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "eventDate") {
      if (ctx.inlineEditing) {
        const val = typeof row.eventDate === "string" ? row.eventDate.slice(0, 10) : "";
        return (
          <input
            type="date"
            value={val}
            onChange={e => ctx.handleInlineChange(row, "eventDate", e.target.value)}
            disabled={ctx.disabled}
            style={{ border: "none", background: "transparent", padding: "2px 4px", width: "100%", fontSize: 13 }}
          />
        );
      }
      const val = typeof row.eventDate === "string" ? row.eventDate.slice(0, 10) : "";
      return <span>{val}</span>;
    }
    if (col.identifier === "eventType") {
      if (ctx.inlineEditing) {
        return (
          <FieldSelect
            name={`hist_event_${row.id}`}
            options={EVENT_TYPE_OPTIONS}
            value={(row.eventType as string) ?? ""}
            onChange={e => ctx.handleInlineChange(row, "eventType", e.target.value)}
            disabled={ctx.disabled}
            variant="table"
          />
        );
      }
      return <span>{eventTypeMap[row.eventType as string] ?? row.eventType}</span>;
    }
    if (col.identifier === "organization.shortName") {
      if (ctx.inlineEditing) {
        return (
          <LookupField
            label=""
            name={`hist_org_${row.id}`}
            value={(row.organizationUuid as string) ?? ""}
            displayValue={(row.organization as any)?.shortName ?? ""}
            endpoint="organizations"
            displayField="shortName"
            onSelect={(uuid, _dv, item) => {
              ctx.handleLookupChange(row, "organizationUuid", uuid, {
                organization: item && uuid ? { uuid, shortName: item.shortName ?? "" } : null,
              });
            }}
            onClear={() => {
              ctx.handleLookupChange(row, "organizationUuid", null, { organization: null });
            }}
            disabled={ctx.disabled}
            width="100%"
            variant="table"
          />
        );
      }
      return <span>{(row.organization as any)?.shortName ?? ""}</span>;
    }
    if (col.identifier === "position.shortName") {
      if (ctx.inlineEditing) {
        return (
          <LookupField
            label=""
            name={`hist_pos_${row.id}`}
            value={(row.positionUuid as string) ?? ""}
            displayValue={(row.position as any)?.shortName ?? ""}
            endpoint="positions"
            displayField="shortName"
            onSelect={(uuid, _dv, item) => {
              ctx.handleLookupChange(row, "positionUuid", uuid, {
                position: item && uuid ? { uuid, shortName: item.shortName ?? "" } : null,
              });
            }}
            onClear={() => {
              ctx.handleLookupChange(row, "positionUuid", null, { position: null });
            }}
            disabled={ctx.disabled}
            width="100%"
            variant="table"
          />
        );
      }
      return <span>{(row.position as any)?.shortName ?? ""}</span>;
    }
    if (col.identifier === "salary") {
      if (ctx.inlineEditing) {
        return (
          <FieldNumber
            name={`hist_salary_${row.id}`}
            value={row.salary != null ? String(Number(row.salary)) : ""}
            onChange={e => ctx.handleInlineChange(row, "salary", e.target.value)}
            disabled={ctx.disabled}
            step="0.01"
            textAlign="right"
            width="100%"
            actions={[]}
            variant="table"
          />
        );
      }
      return <span>{row.salary != null ? String(Number(row.salary)) : ""}</span>;
    }
    return undefined;
  }, [eventTypeMap]);

  // ── Правила валидации ячеек ────────────────────────────────────────────
  const validationRules = useMemo<Record<string, TCellValidator>>(() => ({
    salary: (value) => {
      if (value === "" || value == null) return undefined;
      const n = Number(value);
      if (isNaN(n)) return "Должно быть числом";
      if (n < 0) return "Не может быть отрицательным";
      return undefined;
    },
    eventDate: (value) => {
      if (!value) return "Дата обязательна";
      return undefined;
    },
  }), []);

  // ── openFormFor ────────────────────────────────────────────────────────
  const openFormFor = useCallback((data: TDataItem | undefined, _ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: [MODEL_ENDPOINT] });
      _ctx.refetch();
    };
    addPane({
      label: makePaneLabelFromData("EmployeeHistoriesList", "Кадровая история", isEdit ? data as any : null),
      component: EmployeeHistoryForm,
      data: { ...(data ?? {}), employeeUuid } as any,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, t, employeeUuid, eventTypeMap, queryClient]);

  // ── defaultNewRow ───────────────────────────────────────────────────────
  const defaultNewRow = useMemo(() => ({
    eventDate: new Date().toISOString().slice(0, 10),
    eventType: "hire",
    salary: null,
    positionUuid: null,
    organizationUuid: null,
  }), []);

  return (
    <SubTable
      model={MODEL_ENDPOINT}
      componentName={COMPONENT_NAME}
      columnsJson={columnsJson}
      parentKey="employeeUuid"
      parentUuid={employeeUuid}
      defaultSort={{ eventDate: "desc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      emptyMessage="Сохраните сотрудника для управления кадровой историей."
      renderCell={renderCell}
      openFormFor={openFormFor}
      defaultNewRow={defaultNewRow}
      onItemsChange={onItemsChange}
      validationRules={validationRules}
    />
  );
};

EmployeeHistoryTable.displayName = "EmployeeHistoryTable";
export default EmployeeHistoryTable;