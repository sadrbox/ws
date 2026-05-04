/**
 * models/UserOrganizations — управляет привязкой пользователей к организациям.
 *
 * Endpoint: user-organizations
 *
 * Экспорты:
 *   UserPermissionsForm  — форма одной записи (организация + роль + вкладка прав доступа)
 *   UserPermissionsList  — список всех записей (для страницы администрирования)
 *   UserPermissionsTable — вложенная SubTable (используется в UsersForm)
 */
import { FC, useCallback, useMemo } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TTableVariant } from "src/components/Table";
import type { TPane } from "src/app/types";
import listColumnsJson from "./listColumns.json";
import subColumnsJson from "./subColumns.json";
import { Field, FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI/Group";
import styles from "src/styles/main.module.scss";
import ModelList from "src/components/ModelList";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { useQueryClient } from "@tanstack/react-query";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel, makePaneLabelFromData } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import { AccessRightsTable } from "src/models/AccessRights";

const ENDPOINT = "user-permissions";

// ─── Shared constants ────────────────────────────────────────────────────────

export const ROLE_OPTIONS = [
  { value: "member", label: translate("roleMember") },
  { value: "admin", label: translate("roleAdmin") },
];

// ═══════════════════════════════════════════════════════════════════════════
// UserPermissionsForm
// Форма привязки пользователя к организации.
// Вкладка "Основное": выбор организации + пользователя + роли.
// Вкладка "Права доступа": таблица прав доступа к разделам (AccessRightsTable).
// ═══════════════════════════════════════════════════════════════════════════

interface TFormFields {
  id?: number;
  uuid?: string;
  userUuid: string;
  userDisplayName: string;
  organizationUuid: string;
  orgShortName: string;
  role: string;
}

const DEFAULT_FORM_FIELDS: TFormFields = {
  userUuid: "", userDisplayName: "", organizationUuid: "", orgShortName: "", role: "member",
};

const UserPermissionsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("AccessRight");

  const initialFields: TFormFields | undefined = (() => {
    const d = paneProps.data;
    if (!d || d.uuid) return undefined;
    return {
      ...DEFAULT_FORM_FIELDS,
      userUuid: (d.userUuid as string) ?? "",
      userDisplayName: (d.userDisplayName as string) ?? "",
      organizationUuid: (d.organizationUuid as string) ?? "",
      orgShortName: ((d.orgName ?? d.orgShortName) as string) ?? "",
      role: (d.role as string) ?? "member",
    };
  })();

  const form = useFormStore<TFormFields>({
    endpoint: ENDPOINT,
    storageKey: "user-permissions-form",
    defaultFields: DEFAULT_FORM_FIELDS,
    initialFields,
    paneProps,
    tables: {
      accessRights: {
        endpoint: "access-rights",
        parentField: "userUuid",
        label: translate("accessRights"),
        skipParentField: true,
        createPayload: (r: any) => ({
          userUuid: r.userUuid ?? null,
          organizationUuid: r.organizationUuid ?? null,
          modelName: r.modelName ?? "",
          accessLevel: r.accessLevel || "none",
        }),
        updatePayload: (r: any) => ({
          modelName: r.modelName ?? "",
          accessLevel: r.accessLevel || "none",
        }),
      },
    },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FORM_FIELDS),
      id: d.id,
      uuid: d.uuid ?? String(d.id),
      userUuid: d.userUuid ?? "",
      userDisplayName: d.user?.username ?? prev?.userDisplayName ?? "",
      organizationUuid: d.organizationUuid ?? "",
      orgShortName: (d.organization as any)?.shortName ?? prev?.orgShortName ?? "",
      role: d.role ?? "member",
    }),
    buildPayload: (fd) => {
      if (!fd.userUuid) return "Пользователь обязателен";
      if (!fd.organizationUuid) return "Организация обязательна";
      return { userUuid: fd.userUuid, organizationUuid: fd.organizationUuid, role: fd.role };
    },
    buildPaneLabel: (saved) =>
      makePaneLabel("UserPermissionsList", translate("userPermission"), saved),
  });

  const accessRights = form.useTable("accessRights");
  const tabs = useMemo(() => {
    const result: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "general",
        label: translate("general"),
        component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              {form.isEditMode && (
                <GroupRow>
                </GroupRow>
              )}
              <GroupCol>
                <LookupField
                  label={translate("OrganizationsList")}
                  name={`${form.formUid}_org`}
                  endpoint="organizations"
                  displayField="shortName"
                  value={form.fields.organizationUuid}
                  displayValue={form.fields.orgShortName}
                  onSelect={(uuid, dv) => form.setFields({ organizationUuid: uuid, orgShortName: dv })}
                  onClear={() => form.setFields({ organizationUuid: "", orgShortName: "" })}
                  disabled={form.isLoading || !canWrite}
                />
                <LookupField
                  label={translate("UsersList")}
                  name={`${form.formUid}_user`}
                  endpoint="users"
                  displayField="username"
                  value={form.fields.userUuid}
                  displayValue={form.fields.userDisplayName}
                  onSelect={(uuid, dv) => form.setFields({ userUuid: uuid, userDisplayName: dv })}
                  onClear={() => form.setFields({ userUuid: "", userDisplayName: "" })}
                  disabled={form.isLoading || !canWrite}
                />
                <FieldSelect
                  label={translate("role")}
                  name={`${form.formUid}_role`}
                  options={ROLE_OPTIONS}
                  value={form.fields.role}
                  onChange={e => form.setField("role", e.target.value)}
                  disabled={form.isLoading}
                />
              </GroupCol>
            </div>
          </div>
        ),
      },
    ];

    if (form.isEditMode && form.fields.userUuid && form.fields.organizationUuid) {
      result.push({
        id: "accessRights",
        label: translate("accessRights"),
        component: (
          <AccessRightsTable
            userUuid={form.fields.userUuid}
            organizationUuid={form.fields.organizationUuid}
            deferRemoteChanges={true}
            initialPendingRows={accessRights.pending}
            onItemsChange={accessRights.onItemsChange}
          />
        ),
      });
    }

    return result;
  }, [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields]);

  return (
    <ModelForm
      paneId={form.paneId}
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined}
      isLoading={form.isLoading}
      readonly={!canWrite}
      isDirty={form.isDirty}
    />
  );
};
UserPermissionsForm.displayName = "UserPermissionsForm";

// ═══════════════════════════════════════════════════════════════════════════
// UserPermissionsList
// Список всех записей user-organizations для страницы администрирования.
// ═══════════════════════════════════════════════════════════════════════════

const UserPermissionsList: FC<{
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
}> = ({ variant, onSelectItem }) => (
  <ModelList
    endpoint={ENDPOINT}
    listName="UserPermissionsList"
    columnsJson={listColumnsJson}
    FormComponent={UserPermissionsForm}
    getLabel={(d) => {
      const item = d as any;
      return item?.user?.username
        ? `${String(item.user.username)} / ${String(item.organization?.shortName ?? "")}`
        : "";
    }}
    variant={variant}
    onSelectItem={onSelectItem}
    defaultSort={{ id: "desc" }}
  />
);
UserPermissionsList.displayName = "UserPermissionsList";

// ═══════════════════════════════════════════════════════════════════════════
// UserPermissionsTable
// Вложенная SubTable для UsersForm.
// Показывает организации пользователя + роль.
// Expand → вложенная AccessRightsTable с правами по моделям.
// ═══════════════════════════════════════════════════════════════════════════

interface UserPermissionsTableProps {
  userUuid: string;
  disabled?: boolean;
  deferRemoteChanges?: boolean;
  onItemsChange?: (items: TDataItem[]) => void;
  initialPendingRows?: TDataItem[];
}

const UserPermissionsTable: FC<UserPermissionsTableProps> = ({
  userUuid,
  disabled = false,
  deferRemoteChanges = true,
  onItemsChange,
  initialPendingRows,
}) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();

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

  // ── openFormFor — открыть UserPermissionsForm ──────────────────────
  const openFormFor = useCallback((data: TDataItem | undefined, ctx: SubTableContext) => {
    const orgUuid = data?.organizationUuid as string | undefined;
    const orgName = (data?.organization as any)?.shortName as string | undefined;
    const isEdit = !!data?.uuid;

    const newData = !isEdit && userUuid
      ? { userUuid } as unknown as TDataItem
      : data;

    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: [ENDPOINT] });
      ctx.refetch();
    };

    addPane({
      label: isEdit
        ? `${orgName ?? orgUuid ?? "Организация"}`
        : makePaneLabelFromData("UserPermissionsTable", "Пользователь / Организация", null),
      component: UserPermissionsForm,
      data: isEdit ? data : newData,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, userUuid, queryClient]);

  const defaultNewRow = useMemo(() => ({
    organizationUuid: null,
    organization: null,
    role: "member",
  }), []);

  return (
    <SubTable
      model={ENDPOINT}
      componentName="UserPermissionsTable_part"
      columnsJson={subColumnsJson}
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
      // showEditModeToggle={false}
      defaultInlineEditing={false}
    />
  );
};
UserPermissionsTable.displayName = "UserPermissionsTable";

export { UserPermissionsForm, UserPermissionsList, UserPermissionsTable };
// Алиас для navbar (динамический импорт)
export { UserPermissionsList as UserPermissionsModuleList };
