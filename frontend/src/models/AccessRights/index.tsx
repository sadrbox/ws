import { FC, useMemo, useCallback } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TTableVariant } from "src/components/Table";
import type { TPane } from "src/app/types";
import moduleColumnsJson from "./moduleColumns.json";
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
import { ModelRightsTable } from "src/models/ModelRights";

const USER_ORG_ENDPOINT = "user-organizations";

export const ROLE_OPTIONS = [
  { value: "member", label: translate("roleMember") || "Участник" },
  { value: "admin",  label: translate("roleAdmin")  || "Администратор" },
];

// ═══════════════════════════════════════════════════════════════════════════
// ACCESS RIGHTS FORM — форма user-organizations
// Вкладка "Основное": Организация + Пользователь + Роль
// Вкладка "Разрешения": ModelRightsTable (access-rights)
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

const AccessRightsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("AccessRight");

  const initialFields: TFormFields | undefined = (() => {
    const d = paneProps.data;
    if (!d || d.uuid) return undefined;
    return {
      ...DEFAULT_FORM_FIELDS,
      userUuid:         (d.userUuid         as string) ?? "",
      userDisplayName:  (d.userDisplayName  as string) ?? "",
      organizationUuid: (d.organizationUuid as string) ?? "",
      orgShortName:     (d.orgShortName     as string) ?? "",
      role:             (d.role             as string) ?? "member",
    };
  })();

  const form = useFormStore<TFormFields>({
    endpoint: USER_ORG_ENDPOINT,
    storageKey: "access-rights-form",
    defaultFields: DEFAULT_FORM_FIELDS,
    initialFields,
    paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FORM_FIELDS),
      id:               d.id,
      uuid:             d.uuid ?? String(d.id),
      userUuid:         d.userUuid                ?? "",
      userDisplayName:  d.user?.username          ?? prev?.userDisplayName ?? "",
      organizationUuid: d.organizationUuid        ?? "",
      orgShortName:     d.organization?.shortName ?? prev?.orgShortName ?? "",
      role:             d.role ?? "member",
    }),
    buildPayload: (fd) => {
      if (!fd.userUuid)         return "Пользователь обязателен";
      if (!fd.organizationUuid) return "Организация обязательна";
      return { userUuid: fd.userUuid, organizationUuid: fd.organizationUuid, role: fd.role };
    },
    buildPaneLabel: (saved) =>
      makePaneLabel("AccessRightsList", translate("accessRight") || "Права доступа", saved),
  });

  const tabs = useMemo(() => {
    const result: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "general",
        label: translate("general") || "Основное",
        component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              {form.isEditMode && (
                <GroupRow>
                  <Field label="ID"   name={`${form.formUid}_id`}   width="80px"  value={String(form.fields.id ?? "-")}   disabled />
                  <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
                </GroupRow>
              )}
              <GroupCol>
                <LookupField
                  label={translate("OrganizationsList") || "Организация"}
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
                  label={translate("UsersList") || "Пользователь"}
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
                  label={translate("role") || "Роль"}
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
        id: "modelRights",
        label: translate("modelRights") || "Разрешения",
        component: (
          <ModelRightsTable
            userUuid={form.fields.userUuid}
            organizationUuid={form.fields.organizationUuid}
            deferRemoteChanges={false}
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
AccessRightsForm.displayName = "AccessRightsForm";

// ═══════════════════════════════════════════════════════════════════════════
// ACCESS RIGHTS LIST — список user-organizations для NavList / ModelList
// ═══════════════════════════════════════════════════════════════════════════

const AccessRightsList: FC<{
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
}> = ({ variant, onSelectItem }) => (
  <ModelList
    endpoint={USER_ORG_ENDPOINT}
    listName="AccessRightsList"
    columnsJson={moduleColumnsJson}
    FormComponent={AccessRightsForm}
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
AccessRightsList.displayName = "AccessRightsList";

// ═══════════════════════════════════════════════════════════════════════════
// ACCESS RIGHTS TABLE — SubTable user-organizations, вложенная в UsersForm
// Показывает организации пользователя + роль (inline editing)
// ═══════════════════════════════════════════════════════════════════════════

interface AccessRightsTableProps {
  userUuid?: string;
  deferRemoteChanges?: boolean;
  onItemsChange?: (items: TDataItem[]) => void;
  initialPendingRows?: TDataItem[];
}

const AccessRightsTable: FC<AccessRightsTableProps> = ({
  userUuid,
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
    if (col.identifier === "role") {
      if (ctx.inlineEditing) {
        return (
          <FieldSelect
            name={`inline_role_${row.id}`}
            options={ROLE_OPTIONS}
            value={(row.role as string) ?? "member"}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              ctx.handleInlineChange(row, "role", e.target.value)
            }
            variant="table"
          />
        );
      }
      return <span>{roleMap[row.role as string] ?? row.role}</span>;
    }
    return undefined;
  }, [roleMap]);

  const openFormFor = useCallback((data: TDataItem | undefined, _ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    const newData = !isEdit && userUuid
      ? { userUuid } as unknown as TDataItem
      : data;
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: [USER_ORG_ENDPOINT] });
      _ctx.refetch();
    };
    addPane({
      label: makePaneLabelFromData("AccessRightsTable", "Права доступа", isEdit ? data as any : null),
      component: AccessRightsForm,
      data: newData,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, userUuid, queryClient]);

  const onInlineAdd = useCallback(async (ctx: SubTableContext) => {
    openFormFor(undefined, ctx);
  }, [openFormFor]);

  return (
    <SubTable
      model={USER_ORG_ENDPOINT}
      componentName="AccessRightsTable_part"
      columnsJson={subColumnsJson}
      parentKey="userUuid"
      parentUuid={userUuid ?? ""}
      defaultSort={{ id: "asc" }}
      defaultInlineEditing={true}
      showEditModeToggle={true}
      disabled={!userUuid}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      onItemsChange={onItemsChange}
      emptyMessage={
        userUuid
          ? (translate("noAccessRights") || "Нет организаций с правами доступа.")
          : (translate("saveUserFirst") || "Сохраните пользователя, чтобы управлять правами доступа.")
      }
      renderCell={renderCell}
      openFormFor={openFormFor}
      onInlineAdd={onInlineAdd}
    />
  );
};
AccessRightsTable.displayName = "AccessRightsTable";

export { AccessRightsForm, AccessRightsList, AccessRightsTable };
// alias для NavList (UI/index.tsx)
export { AccessRightsList as AccessRightsModuleList };
