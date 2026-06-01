import { FC, useCallback, useMemo } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TTableVariant } from "src/components/Table";
import type { TPane } from "src/app/types";
import listColumnsJson from "./listColumns.json";
import subColumnsJson from "./subColumns.json";
import { FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import ModelList from "src/components/ModelList";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateSubTableFor } from "src/utils/invalidateSubTableFor";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { useUniqueOptionRows } from "src/hooks/useUniqueOptionRows";
import { makePaneLabel, makePaneLabelFromData } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import { UserPermissionsTable, MODEL_NAME_OPTIONS } from "src/models/UserPermissions";

const ENDPOINT = "user-permissions";

export const ROLE_OPTIONS = [
  { value: "member", label: translate("roleMember") },
  { value: "admin", label: translate("roleAdmin") },
];

export const PERMISSION_DEFAULT_TYPE_OPTIONS = [
  { value: "bankAccount", label: translate("BankAccountsList") },
  { value: "contract", label: translate("ContractsList") },
  { value: "warehouse", label: translate("WarehousesList") },
  { value: "cashbox", label: translate("CashboxesList") },
  { value: "contact", label: translate("ContactsList") },
];

const PERMISSION_DEFAULT_TYPE_ENDPOINT: Record<string, string> = {
  bankAccount: "bankaccounts",
  contract: "contracts",
  warehouse: "warehouses",
  cashbox: "cashboxes",
  contact: "contacts",
};

interface PermissionDefaultsTableProps {
  userUuid: string;
  organizationUuid: string;
  disabled?: boolean;
  deferRemoteChanges?: boolean;
  initialPendingRows?: TDataItem[];
  onItemsChange?: (items: TDataItem[]) => void;
  /** Передайте из родительской формы — computed из form.useTable("...").allRows */
  disableAdd?: boolean;
  /** Передайте form.useTable("...").onAllItemsChange — обновляет allRows формы */
  onAllItemsChange?: (rows: TDataItem[]) => void;
}

const typeOptMap = Object.fromEntries(
  PERMISSION_DEFAULT_TYPE_OPTIONS.map(o => [o.value, o.label]),
);

const DEFAULTS_COLUMNS = [
  { identifier: "valueType", type: "string", width: "220px", minWidth: "160px", alignment: "left" as const, hint: translate("permDefaultValueType"), visible: true, inlist: true },
  { identifier: "valueName", type: "string", width: "1fr", minWidth: "180px", alignment: "left" as const, hint: translate("permDefaultValue"), visible: true, inlist: true },
];

const PermissionDefaultsTable: FC<PermissionDefaultsTableProps> = ({
  userUuid,
  organizationUuid,
  disabled = false,
  deferRemoteChanges = true,
  initialPendingRows,
  onItemsChange,
  disableAdd: disableAddProp,
  onAllItemsChange: onAllItemsChangeProp,
}) => {
  const { getFirstUnused, getAvailableOptions, handleRowsChange } =
    useUniqueOptionRows(PERMISSION_DEFAULT_TYPE_OPTIONS, "valueType", initialPendingRows);

  // Компонуем внутренний handleRowsChange (для getAvailableOptions/getFirstUnused)
  // с внешним onAllItemsChangeProp (для allRows в форме).
  const handleAllItemsChange = useCallback((rows: TDataItem[]) => {
    handleRowsChange(rows);
    onAllItemsChangeProp?.(rows);
  }, [handleRowsChange, onAllItemsChangeProp]);

  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "valueType") {
      if (ctx.inlineEditing) {
        const availableOptions = getAvailableOptions(ctx.rows, row.valueType as string);
        return (
          <FieldSelect
            name={`upd_type_${row.id}`}
            options={availableOptions}
            value={(row.valueType as string) ?? ""}
            onChange={e => {
              ctx.handleInlineChange(row, "valueType", e.target.value);
              ctx.handleInlineChange(row, "valueUuid", "");
              ctx.handleInlineChange(row, "valueName", "");
            }}
            disabled={ctx.disabled}
            variant="table"
          />
        );
      }
      return <span>{typeOptMap[row.valueType as string] ?? row.valueType}</span>;
    }

    if (col.identifier === "valueName") {
      const endpoint = PERMISSION_DEFAULT_TYPE_ENDPOINT[row.valueType as string] ?? "";
      let lookupParams: Record<string, string> | undefined;
      if (organizationUuid) {
        // bankAccount, cashbox, warehouse, contact используют ownerType/ownerUuid
        // (иначе фильтр по организации не применяется в Lookup)
        if (["bankAccount", "cashbox", "warehouse", "contact"].includes(row.valueType as string)) {
          lookupParams = { ownerType: "organization", ownerUuid: organizationUuid };
        } else {
          lookupParams = { organizationUuid };
        }
      }
      if (ctx.inlineEditing && endpoint) {
        return (
          <LookupField
            label=""
            name={`upd_val_${row.id}`}
            endpoint={endpoint}
            displayField="name"
            value={(row.valueUuid as string) ?? ""}
            displayValue={(row.valueName as string) ?? ""}
            extraParams={lookupParams}
            onSelect={(uuid, dv) => {
              void ctx.handleLookupChange(row, "valueUuid", uuid, { valueName: dv });
            }}
            onClear={() => {
              void ctx.handleLookupChange(row, "valueUuid", "", { valueName: "" });
            }}
            disabled={ctx.disabled || !endpoint}
            width="100%"
            variant="table"
          />
        );
      }
      return <span>{(row.valueName as string) ?? ""}</span>;
    }

    return undefined;
  }, [organizationUuid, getAvailableOptions]);

  const defaultNewRow = useMemo(() => {
    return (rows: TDataItem[]) => {
      const valueType = getFirstUnused(rows);
      if (!valueType) return null; // all types present — abort (null-veto in SubTable)
      return { userUuid, organizationUuid, valueType, valueUuid: "", valueName: "" };
    };
  }, [userUuid, organizationUuid, getFirstUnused]);

  return (
    <SubTable
      model="user-permission-defaults"
      componentName="PermissionDefaultsTable"
      columnsJson={DEFAULTS_COLUMNS}
      parentKey="userUuid"
      parentUuid={userUuid}
      extraQueryParams={{ organizationUuid }}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      onItemsChange={onItemsChange}
      onAllItemsChange={handleAllItemsChange}
      renderCell={renderCell}
      defaultNewRow={defaultNewRow}
      disableAdd={disableAddProp ?? false}
      defaultInlineEditing={true}
      showEditModeToggle={false}
    />
  );
};
PermissionDefaultsTable.displayName = "PermissionDefaultsTable";

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

const UserAccessRightsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("AccessRight");
  const queryClient = useQueryClient();

  const invalidateSubTables = useCallback(async (savedData: any) => {
    const userUuid = savedData?.userUuid ?? "";
    await Promise.all([
      invalidateSubTableFor(queryClient, "access-rights", "userUuid", userUuid),
      invalidateSubTableFor(queryClient, "user-permission-defaults", "userUuid", userUuid),
    ]);
  }, [queryClient]);

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
    storageKey: "user-access-rights-form",
    defaultFields: DEFAULT_FORM_FIELDS,
    initialFields,
    paneProps,
    tables: {
      accessRights: {
        endpoint: "access-rights",
        parentField: "userUuid",
        label: translate("userPermissions"),
        skipParentField: true,
        batchEndpoint: "access-rights/batch",
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
      permissionDefaults: {
        endpoint: "user-permission-defaults",
        parentField: "userUuid",
        label: translate("permissionDefaults"),
        skipParentField: true,
        batchEndpoint: "user-permission-defaults/batch",
        createPayload: (r: any) => ({
          userUuid: r.userUuid ?? null,
          organizationUuid: r.organizationUuid ?? null,
          valueType: r.valueType ?? "",
          valueUuid: r.valueUuid ?? "",
          valueName: r.valueName ?? "",
        }),
        updatePayload: (r: any) => ({
          valueType: r.valueType ?? "",
          valueUuid: r.valueUuid ?? "",
          valueName: r.valueName ?? "",
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
      orgShortName: d.organization?.name ?? prev?.orgShortName ?? "",
      role: d.role ?? "member",
    }),
    buildPayload: (fd) => {
      if (!fd.userUuid) return "Пользователь обязателен";
      if (!fd.organizationUuid) return "Организация обязательна";
      return { userUuid: fd.userUuid, organizationUuid: fd.organizationUuid, role: fd.role };
    },
    buildPaneLabel: (saved) => {
      const userName = saved.userDisplayName || (saved).user?.username || "";
      const orgName = saved.orgShortName || (saved).organization?.name || "";
      const detail = [userName, orgName].filter(Boolean).join(" / ");
      return makePaneLabel("UserAccessRightsList", translate("userAccessRight"), saved, detail || undefined);
    },
    afterSave: invalidateSubTables,
  });

  const accessRights = form.useTable("accessRights");
  const permissionDefaults = form.useTable("permissionDefaults");

  // Вычисляем доступность кнопки "Добавить" на основе allRows формы:
  // allRows содержит все строки SubTable (сервер + pending), обновляется через onAllItemsChange.
  const allModelsUsed = useMemo(
    () => MODEL_NAME_OPTIONS.length > 0 && MODEL_NAME_OPTIONS.every(o =>
      accessRights.allRows.some(r => (r as any).modelName === o.value && (r as any)._pendingAction !== "delete")
    ),
    [accessRights.allRows],
  );
  const allTypesUsed = useMemo(
    () => PERMISSION_DEFAULT_TYPE_OPTIONS.length > 0 && PERMISSION_DEFAULT_TYPE_OPTIONS.every(o =>
      permissionDefaults.allRows.some(r => (r as any).valueType === o.value && (r as any)._pendingAction !== "delete")
    ),
    [permissionDefaults.allRows],
  );

  const tabs = useMemo(() => {
    const result: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "tab-details",
        label: translate("general"),
        component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              <GroupCol>
                <LookupField
                  label={translate("OrganizationsList")}
                  name={`${form.formUid}_org`}
                  endpoint="organizations"
                  displayField="name"
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
        label: translate("userPermissions"),
        component: (
          <UserPermissionsTable
            userUuid={form.fields.userUuid}
            organizationUuid={form.fields.organizationUuid}
            deferRemoteChanges={true}
            initialPendingRows={accessRights.pending}
            onItemsChange={accessRights.onItemsChange}
            onAllItemsChange={accessRights.onAllItemsChange}
            disableAdd={allModelsUsed}
          />
        ),
      });

      result.push({
        id: "permissionDefaults",
        label: translate("permissionDefaults"),
        component: (
          <PermissionDefaultsTable
            userUuid={form.fields.userUuid}
            organizationUuid={form.fields.organizationUuid}
            disabled={!canWrite}
            deferRemoteChanges={true}
            initialPendingRows={permissionDefaults.pending}
            onItemsChange={permissionDefaults.onItemsChange}
            onAllItemsChange={permissionDefaults.onAllItemsChange}
            disableAdd={allTypesUsed}
          />
        ),
      });
    }

    return result;
  }, [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, accessRights, permissionDefaults, canWrite, allModelsUsed, allTypesUsed]);

  return (
    <ModelForm
      paneId={form.paneId}
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined}
      isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
      readonly={!canWrite}
    />
  );
};
UserAccessRightsForm.displayName = "UserAccessRightsForm";

const UserAccessRightsList: FC<{
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
}> = ({ variant, onSelectItem }) => (
  <ModelList
    endpoint={ENDPOINT}
    listName="UserAccessRightsList"
    columnsJson={listColumnsJson}
    FormComponent={UserAccessRightsForm}
    getLabel={(d) => {
      const item = d as any;
      return item?.user?.username
        ? `${String(item.user.username)} / ${String(item.organization?.name ?? "")}`
        : "";
    }}
    variant={variant}
    onSelectItem={onSelectItem}
    defaultSort={{ id: "desc" }}
  />
);
UserAccessRightsList.displayName = "UserAccessRightsList";

interface UserAccessRightsTableProps {
  userUuid: string;
  disabled?: boolean;
  deferRemoteChanges?: boolean;
  onItemsChange?: (items: TDataItem[]) => void;
  initialPendingRows?: TDataItem[];
}

const UserAccessRightsTable: FC<UserAccessRightsTableProps> = ({
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

  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "organization.name") {
      if (ctx.inlineEditing) {
        return (
          <LookupField
            label=""
            name={`uo_org_${row.id}`}
            value={(row.organizationUuid as string) ?? ""}
            displayValue={(row.organization as any)?.name ?? ""}
            endpoint="organizations"
            displayField="name"
            onSelect={(uuid, _dv, item) => {
              void ctx.handleLookupChange(row, "organizationUuid", uuid, {
                organization: item && uuid
                  ? { uuid, name: item.name ?? "", bin: item.bin ?? null }
                  : null,
              });
            }}
            onClear={() => {
              void ctx.handleLookupChange(row, "organizationUuid", null, { organization: null });
            }}
            disabled={ctx.disabled}
            width="100%"
            variant="table"
          />
        );
      }
      return <span>{(row.organization as any)?.name ?? ""}</span>;
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

  const openFormFor = useCallback((data: TDataItem | undefined, ctx: SubTableContext) => {
    const orgName = (data?.organization as any)?.name as string | undefined;
    const orgUuid = data?.organizationUuid as string | undefined;
    const isEdit = !!data?.uuid;

    const newData = !isEdit && userUuid
      ? { userUuid } as unknown as TDataItem
      : data;

    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: [ENDPOINT] });
      ctx.refetch();
    };

    addPane({
      label: isEdit
        ? `${orgName ?? orgUuid ?? "Организация"}`
        : makePaneLabelFromData("UserAccessRightsTable", "Пользователь / Организация", null),
      component: UserAccessRightsForm,
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
      componentName="UserAccessRightsTable_part"
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
      defaultInlineEditing={false}
    />
  );
};
UserAccessRightsTable.displayName = "UserAccessRightsTable";

export { UserAccessRightsForm, UserAccessRightsList, UserAccessRightsTable };
export { UserAccessRightsList as UserAccessRightsModuleList };
