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
import { GroupCol } from "src/components/UI/Group";
import styles from "src/styles/main.module.scss";
import ModelList from "src/components/ModelList";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { useQueryClient } from "@tanstack/react-query";
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

  const invalidateSubTables = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: ["access-rights"],
      refetchType: "active",
    });
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
    afterLoad: invalidateSubTables,
    afterSave: invalidateSubTables,
  });

  const accessRights = form.useTable("accessRights");
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
    }

    return result;
  }, [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, accessRights, canWrite]);

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
