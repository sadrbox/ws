import { FC, useCallback, useMemo } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TTableVariant } from "src/components/Table";
import type { TPane } from "src/app/types";
import listColumnsJson from "./listColumns.json";
import subColumnsJson from "./subColumns.json";
import defaultsSubColumnsJson from "./defaultsSubColumns.json";
import { FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol } from "src/components/UI/Group";
import styles from "src/styles/main.module.scss";
import ModelList from "src/components/ModelList";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateSubTableFor } from "src/utils/invalidateSubTableFor";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel, makePaneLabelFromData } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import { UserPermissionsTable } from "src/models/UserPermissions";

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
  bankAccount: "bank-accounts",
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
}

const typeOptMap = Object.fromEntries(
  PERMISSION_DEFAULT_TYPE_OPTIONS.map(o => [o.value, o.label]),
);

const PermissionDefaultsTable: FC<PermissionDefaultsTableProps> = ({
  userUuid,
  organizationUuid,
  disabled = false,
  deferRemoteChanges = true,
  initialPendingRows,
  onItemsChange,
}) => {
  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "valueType") {
      if (ctx.inlineEditing) {
        return (
          <FieldSelect
            name={`upd_type_${row.id}`}
            options={PERMISSION_DEFAULT_TYPE_OPTIONS}
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
      if (ctx.inlineEditing && endpoint) {
        return (
          <LookupField
            label=""
            name={`upd_val_${row.id}`}
            endpoint={endpoint}
            displayField="name"
            value={(row.valueUuid as string) ?? ""}
            displayValue={(row.valueName as string) ?? ""}
            extraParams={organizationUuid ? { organizationUuid } : undefined}
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
  }, [organizationUuid]);

  const defaultNewRow = useMemo(() => ({
    userUuid,
    organizationUuid,
    valueType: "",
    valueUuid: "",
    valueName: "",
  }), [userUuid, organizationUuid]);

  return (
    <SubTable
      model="user-permission-defaults"
      componentName="PermissionDefaultsTable"
      columnsJson={defaultsSubColumnsJson}
      parentKey="userUuid"
      parentUuid={userUuid}
      extraParams={{ organizationUuid }}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      onItemsChange={onItemsChange}
      renderCell={renderCell}
      defaultNewRow={defaultNewRow}
      defaultInlineEditing={true}
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
    await invalidateSubTableFor(queryClient, "access-rights", "userUuid", savedData?.userUuid ?? "");
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
    buildPaneLabel: (saved) =>
      makePaneLabel("UserAccessRightsList", translate("userAccessRight"), saved),
    afterSave: invalidateSubTables,
  });

  const accessRights = form.useTable("accessRights");
  const permissionDefaults = form.useTable("permissionDefaults");
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
          />
        ),
      });
    }

    return result;
  }, [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, accessRights, permissionDefaults, canWrite]);

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
