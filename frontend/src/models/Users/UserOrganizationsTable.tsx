import { FC, useCallback, useMemo } from "react";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import columnsJson from "./userOrganizationsColumns.json";
import SubTable, { type SubTableContext } from "src/components/SubTable";

const MODEL_ENDPOINT = "user-organizations";
const COMPONENT_NAME = "UserOrganizationsList_part";

export const ROLE_OPTIONS = [
  { value: "member", label: "Участник" },
  { value: "admin", label: "Администратор" },
];

interface UserOrganizationsTableProps {
  /** UUID пользователя */
  userUuid: string;
  disabled?: boolean;
  /** Если true — не отправлять изменения на сервер, хранить локально */
  deferRemoteChanges?: boolean;
  /** Колбэк при изменении строк */
  onItemsChange?: (items: TDataItem[]) => void;
  /** Начальные pending-строки */
  initialPendingRows?: TDataItem[];
}

const UserOrganizationsTable: FC<UserOrganizationsTableProps> = ({
  userUuid,
  disabled = false,
  deferRemoteChanges = false,
  onItemsChange,
  initialPendingRows,
}) => {
  const roleMap = useMemo(
    () => Object.fromEntries(ROLE_OPTIONS.map(o => [o.value, o.label])),
    [],
  );

  // ── renderCell ──────────────────────────────────────────────────────────
  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "organization.shortName") {
      if (ctx.inlineEditing) {
        return (
          <LookupField
            label=""
            name={`uo_org_${row.id}`}
            value={(row.organizationUuid as string) ?? ""}
            displayValue={(row.organization as any)?.shortName ?? ""}
            endpoint="organizations"
            displayField="shortName"
            onSelect={(uuid, _dv, item) => {
              ctx.handleLookupChange(row, "organizationUuid", uuid, {
                organization: item && uuid
                  ? { uuid, shortName: item.shortName ?? "", bin: item.bin ?? null }
                  : null,
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
    if (col.identifier === "organization.bin") {
      return <span>{(row.organization as any)?.bin ?? ""}</span>;
    }
    if (col.identifier === "role") {
      if (ctx.inlineEditing) {
        return (
          <FieldSelect
            name={`uo_role_${row.id}`}
            options={ROLE_OPTIONS}
            value={(row.role as string) ?? "member"}
            onChange={e => ctx.handleInlineChange(row, "role", e.target.value)}
            disabled={ctx.disabled}
            variant="table"
          />
        );
      }
      return <span>{roleMap[row.role as string] ?? row.role}</span>;
    }
    return undefined;
  }, [roleMap]);

  // ── openFormFor (просмотр/редактирование через форму) ────────────────
  const openFormFor = useCallback((_data: TDataItem | undefined, _ctx: SubTableContext) => {
    // UserOrganization редактируется inline — форма не нужна
    // Оставляем заглушку для совместимости с SubTable API
  }, []);

  // ── defaultNewRow ────────────────────────────────────────────────────
  const defaultNewRow = useMemo(() => ({
    organizationUuid: null,
    organization: null,
    role: "member",
  }), []);

  return (
    <SubTable
      model={MODEL_ENDPOINT}
      componentName={COMPONENT_NAME}
      columnsJson={columnsJson}
      parentKey="userUuid"
      parentUuid={userUuid}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      onItemsChange={onItemsChange}
      emptyMessage="Сохраните пользователя для управления организациями."
      renderCell={renderCell}
      openFormFor={openFormFor}
      defaultNewRow={defaultNewRow}
    />
  );
};

UserOrganizationsTable.displayName = "UserOrganizationsTable";
export default UserOrganizationsTable;
