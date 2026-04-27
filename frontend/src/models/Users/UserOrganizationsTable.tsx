import { FC, useCallback, useMemo } from "react";
import { useAppContext } from "src/app";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import columnsJson from "./userOrganizationsColumns.json";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import OrgRightsPanel, { ROLE_OPTIONS } from "./OrgRightsPanel";
import { AccessRightsTable } from "src/models/AccessRights";

const MODEL_ENDPOINT = "user-organizations";
const COMPONENT_NAME = "UserOrganizationsList_part";

interface UserOrganizationsTableProps {
  /** UUID пользователя (нужен для открытия прав доступа в дочерней панели) */
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
  deferRemoteChanges = true,
  onItemsChange,
  initialPendingRows,
}) => {
  const { addPane } = useAppContext().windows;

  const roleMap = useMemo(
    () => Object.fromEntries(ROLE_OPTIONS.map(o => [o.value, o.label])),
    [],
  );

  // ── renderCell ──────────────────────────────────────────────────────────
  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    // Expand toggle button
    if (col.identifier === "_expand") {
      const rowId = String((row as any).uuid || (row as any).id);
      const orgUuid = row.organizationUuid as string | undefined;
      if (!orgUuid) return <span style={{ color: "#ccc", fontSize: 12, display: "block", textAlign: "center" }}>—</span>;
      const isExpanded = ctx.expandedRowIds?.has(rowId);
      return (
        <button
          title={isExpanded ? "Свернуть" : "Доступ к разделам"}
          onClick={e => { e.stopPropagation(); ctx.toggleExpandRow(rowId); }}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 14, width: 28, height: 28,
            color: isExpanded ? "var(--color-primary, #1976d2)" : "#888",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {isExpanded ? "▼" : "▶"}
        </button>
      );
    }
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

  // ── openFormFor — открыть форму прав доступа для орг ────────────────
  const openFormFor = useCallback((data: TDataItem | undefined, _ctx: SubTableContext) => {
    const orgUuid = data?.organizationUuid as string | undefined;
    const orgName = (data?.organization as any)?.shortName as string | undefined;
    if (!orgUuid || !userUuid) return;
    addPane({
      label: `Права доступа: ${orgName ?? orgUuid}`,
      component: OrgRightsPanel,
      // Передаём полные данные строки (uuid нужен для useFormStore — режим edit)
      data: {
        uuid:             data?.uuid,           // synthetic uuid = String(id) из бэкенда
        id:               data?.id,
        userUuid,
        organizationUuid: orgUuid,
        orgName,
        role:             data?.role ?? "member",
      } as any,
    });
  }, [addPane, userUuid]);

  // ── renderExpandedRow — AccessRightsTable вложенная под строкой ───────
  const renderExpandedRow = useCallback((row: TDataItem, _ctx: SubTableContext) => {
    const orgUuid = row.organizationUuid as string | undefined;
    if (!orgUuid || !userUuid) return null;
    return (
      <div style={{ padding: "8px 16px 12px", background: "var(--bg-secondary, #f5f7fa)" }}>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 6, fontWeight: 500 }}>
          Доступ к разделам
        </div>
        <AccessRightsTable
          userUuid={userUuid}
          organizationUuid={orgUuid}
          deferRemoteChanges={false}
        />
      </div>
    );
  }, [userUuid]);

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
      showEditModeToggle={false}
      defaultInlineEditing={true}
      renderExpandedRow={renderExpandedRow}
    />
  );
};

UserOrganizationsTable.displayName = "UserOrganizationsTable";
export default UserOrganizationsTable;
