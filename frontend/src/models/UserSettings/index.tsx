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
import { FormLookup } from "src/components/Field/FormLookup";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import ModelList from "src/components/ModelList";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateSubTableFor } from "src/utils/invalidateSubTableFor";
import { useFormStore } from "src/hooks/useFormStore";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { makePaneLabel, makePaneLabelFromData } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import { UserAccessRightsTable, MODEL_NAME_OPTIONS } from "src/models/UserAccessRights";
import { UserDefaultsTable, PERMISSION_DEFAULT_TYPE_OPTIONS } from "src/models/UserDefaults";

const ENDPOINT = "user-settings";

export const ROLE_OPTIONS = [
  { value: "member", label: translate("roleMember") },
  { value: "admin", label: translate("roleAdmin") },
];


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

const UserSettingsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useUserAccessRight("UserAccessRight");
  const queryClient = useQueryClient();

  const invalidateSubTables = useCallback(async (savedData: any) => {
    const userUuid = savedData?.userUuid ?? "";
    await Promise.all([
      invalidateSubTableFor(queryClient, "user-access-rights", "userUuid", userUuid),
      invalidateSubTableFor(queryClient, "user-defaults", "userUuid", userUuid),
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
      userAccessRights: {
        endpoint: "user-access-rights",
        parentField: "userUuid",
        label: translate("userSettings"),
        skipParentField: true,
        batchEndpoint: "user-access-rights/batch",
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
      userDefaults: {
        endpoint: "user-defaults",
        parentField: "userUuid",
        label: translate("userDefaults"),
        skipParentField: true,
        batchEndpoint: "user-defaults/batch",
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
      return makePaneLabel("UserSettingsList", translate("userAccessRight"), saved, detail || undefined);
    },
    afterSave: invalidateSubTables,
  });

  const userAccessRights = form.useTable("userAccessRights");
  const userDefaults = form.useTable("userDefaults");

  // Вычисляем доступность кнопки "Добавить" на основе allRows формы:
  // allRows содержит все строки SubTable (сервер + pending), обновляется через onAllItemsChange.
  const allModelsUsed = useMemo(
    () => MODEL_NAME_OPTIONS.length > 0 && MODEL_NAME_OPTIONS.every(o =>
      userAccessRights.allRows.some(r => (r as any).modelName === o.value && (r as any)._pendingAction !== "delete")
    ),
    [userAccessRights.allRows],
  );
  const allTypesUsed = useMemo(
    () => PERMISSION_DEFAULT_TYPE_OPTIONS.length > 0 && PERMISSION_DEFAULT_TYPE_OPTIONS.every(o =>
      userDefaults.allRows.some(r => (r as any).valueType === o.value && (r as any)._pendingAction !== "delete")
    ),
    [userDefaults.allRows],
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
                <Group>
                  <FormLookup form={form} field="organization" endpoint="organizations" nameField="orgShortName"
                    label="OrganizationsList" disabled={form.isLoading || !canWrite} />
                  <FormLookup form={form} field="user" endpoint="users" displayField="username" nameField="userDisplayName"
                    label="UsersList" disabled={form.isLoading || !canWrite} />
                </Group>
                <GroupRow>
                  <Group className={styles.w1of2}>
                    <FieldSelect label={translate("role")} name={`${form.formUid}_role`} options={ROLE_OPTIONS}
                      value={form.fields.role} onChange={e => form.setField("role", e.target.value)} disabled={form.isLoading} />
                  </Group>
                </GroupRow>
              </GroupCol>
            </div>
          </div>
        ),
      },
    ];

    if (form.isEditMode && form.fields.userUuid && form.fields.organizationUuid) {
      result.push({
        id: "userAccessRights",
        label: translate("userAccessRights"),
        component: (
          <UserAccessRightsTable
            userUuid={form.fields.userUuid}
            organizationUuid={form.fields.organizationUuid}
            deferRemoteChanges={true}
            initialPendingRows={userAccessRights.pending}
            onItemsChange={userAccessRights.onItemsChange}
            onAllItemsChange={userAccessRights.onAllItemsChange}
            disableAdd={allModelsUsed}
          />
        ),
      });

      result.push({
        id: "userDefaults",
        label: translate("userDefaults"),
        component: (
          <UserDefaultsTable
            userUuid={form.fields.userUuid}
            organizationUuid={form.fields.organizationUuid}
            disabled={!canWrite}
            deferRemoteChanges={true}
            initialPendingRows={userDefaults.pending}
            onItemsChange={userDefaults.onItemsChange}
            onAllItemsChange={userDefaults.onAllItemsChange}
            disableAdd={allTypesUsed}
          />
        ),
      });
    }

    return result;
  }, [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, userAccessRights, userDefaults, canWrite, allModelsUsed, allTypesUsed]);

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
UserSettingsForm.displayName = "UserSettingsForm";

const UserSettingsList: FC<{
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
}> = ({ variant, onSelectItem }) => (
  <ModelList
    endpoint={ENDPOINT}
    listName="UserSettingsList"
    columnsJson={listColumnsJson}
    FormComponent={UserSettingsForm}
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
UserSettingsList.displayName = "UserSettingsList";

interface UserSettingsTableProps {
  userUuid: string;
  disabled?: boolean;
  deferRemoteChanges?: boolean;
  onItemsChange?: (items: TDataItem[]) => void;
  initialPendingRows?: TDataItem[];
}

const UserSettingsTable: FC<UserSettingsTableProps> = ({
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
        : makePaneLabelFromData("UserSettingsTable", "Пользователь / Организация", null),
      component: UserSettingsForm,
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
      componentName="UserSettingsTable_part"
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
UserSettingsTable.displayName = "UserSettingsTable";

export { UserSettingsForm, UserSettingsList, UserSettingsTable };
export { UserSettingsList as UserSettingsModuleList };
