import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { AccessRightsList } from "src/models/AccessRights";
import AvatarUpload from "src/components/AvatarUpload";
import { useAccessRight } from "src/hooks/useAccessRight";
import { useFormStore } from "src/hooks/useFormStore";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";

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

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "users-form", defaultFields: DEFAULT_FIELDS, paneProps,
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
  });

  const tabs = useMemo(() => {
    const result: { id: string; label: string; component: React.ReactNode }[] = [
      { id: "general", label: translate("general") || "Основное", component: (
        <div className={styles.Form}>
          {form.isEditMode && (
            <GroupRow>
              <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
              <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
            </GroupRow>
          )}
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
      )},
    ];
    if (form.isEditMode && form.fields.uuid) {
      result.push({ id: "access", label: translate("accessLevel") || "Права доступа", component: <AccessRightsList userUuid={form.fields.uuid} /> });
    }
    return result;
  }, [form.formUid, form.fields, form.isLoading, form.isEditMode, form.setField, form.setFields]);

  return (
    <ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined} isLoading={form.isLoading} showReload={form.isEditMode}
      readonly={!canWrite} isDirty={form.isDirty} />
  );
};
UsersForm.displayName = "UsersForm";

const UsersList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant, onSelectItem }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName="UsersList" columnsJson={columnsJson} FormComponent={UsersForm}
    getLabel={(d) => d?.username ? String(d.username) : (d?.employee as any)?.fullName || "?"} variant={variant} onSelectItem={onSelectItem} />
);
UsersList.displayName = "UsersList";

export { UsersList, UsersForm };
