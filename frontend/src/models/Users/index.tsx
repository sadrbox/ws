import { FC, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import AvatarUpload from "src/components/AvatarUpload";
import { useAccessRight } from "src/hooks/useAccessRight";
import { useFormStore } from "src/hooks/useFormStore";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { UserPermissionsTable } from "src/models/UserPermissions";
import { TDataItem } from "src/components/Table/types";

const MODEL_ENDPOINT = "users";

interface TFields {
  id?: number; uuid?: string;
  username: string; password: string;
  employeeUuid: string; employeeName: string;
  avatarPath: string;
}

const DEFAULT_FIELDS: TFields = {
  username: "", password: "", employeeUuid: "", employeeName: "", avatarPath: "",
};

const UsersForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("User");
  const queryClient = useQueryClient();

  // refetchType: "active" — ждём завершение refetch смонтированной SubTable,
  // чтобы useFormStore.submit() очистил pending-строки только после
  // появления свежих серверных данных (см. useFormStore.ts → submit).
  const invalidateSubTables = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: ["user-permissions"],
      refetchType: "active",
    });
  }, [queryClient]);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "users-form", defaultFields: DEFAULT_FIELDS, paneProps,
    tables: {
      userPermissions: {
        endpoint: "user-permissions",
        parentField: "userUuid",
        label: translate("userPermissions"),
      },
    },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      username: d.username ?? "", password: "",
      employeeUuid: d.employeeUuid ?? d.employee?.uuid ?? "",
      employeeName: d.employee?.fullName ?? "",
      avatarPath: d.avatarPath ?? "",
      id: d.id, uuid: d.uuid,
    }),
    buildPayload: (fd) => {
      if (!fd.username?.trim()) return "Логин обязателен";
      const payload: Record<string, any> = {
        username: fd.username.trim(),
        employeeUuid: fd.employeeUuid || null,
      };
      if (fd.password?.trim()) payload.password = fd.password.trim();
      return payload;
    },
    buildPaneLabel: (saved) => makePaneLabel("UsersList", "Пользователи", saved),
    afterLoad: invalidateSubTables,
    afterSave: invalidateSubTables,
  });

  const userPermissions = form.useTable("userPermissions");

  const tabs = useMemo(() => {
    const result: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "tab-details", label: translate("general"), component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              <div style={{ display: "flex", flexDirection: "row", gap: "24px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: 640 }}>
                  <GroupRow>
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <GroupRow>
                        <Field label="Логин *" name={`${form.formUid}_username`} minWidth="150px" value={form.fields.username} onChange={e => form.setField("username", e.target.value)} disabled={form.isLoading} />
                        <Field label={form.isEditMode ? "Новый пароль" : "Пароль"} name={`${form.formUid}_password`} minWidth="150px" value={form.fields.password} onChange={e => form.setField("password", e.target.value)} disabled={form.isLoading} />
                      </GroupRow>
                      {form.isEditMode && form.fields.uuid && (
                        <AvatarUpload endpoint={MODEL_ENDPOINT} entityUuid={form.fields.uuid} hasAvatar={!!form.fields.avatarPath} disabled={form.isLoading} />
                      )}
                    </div>
                    <LookupField label="Сотрудник" name={`${form.formUid}_employee`} value={form.fields.employeeUuid} displayValue={form.fields.employeeName} endpoint="employees" displayField="fullName" minWidth="400px" disabled={form.isLoading}
                      onSelect={(uuid, displayValue) => form.setFields({ employeeUuid: uuid, employeeName: displayValue } as Partial<TFields>)}
                      onClear={() => form.setFields({ employeeUuid: "", employeeName: "" } as Partial<TFields>)} />
                  </GroupRow>
                </div>
              </div>
            </div>

          </div>
        )
      },
    ];
    if (form.isEditMode && form.fields.uuid) {
      result.push({
        id: "userPermissions",
        label: translate("userPermissions"),
        component: (
          <UserPermissionsTable
            userUuid={form.fields.uuid}
            deferRemoteChanges={true}
            initialPendingRows={userPermissions.pending}
            onItemsChange={userPermissions.onItemsChange}
          />
        ),
      });
    }
    return result;
  }, [form.formUid, form.fields, form.isLoading, form.isEditMode, form.setField, form.setFields, userPermissions]);

  return (
    <ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
      readonly={!canWrite} />
  );
};
UsersForm.displayName = "UsersForm";

const UsersList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant, onSelectItem }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName="UsersList" columnsJson={columnsJson} FormComponent={UsersForm}
    getLabel={(d) => d?.username ? (d.username as string) : (d?.employee as any)?.fullName || "?"} variant={variant} onSelectItem={onSelectItem} />
);
UsersList.displayName = "UsersList";

export { UsersList, UsersForm };
