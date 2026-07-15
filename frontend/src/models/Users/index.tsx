import { FC, useCallback, useMemo } from "react";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateSubTableFor } from "src/utils/invalidateSubTableFor";
import { translate } from "src/i18";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
import { FormLookup } from "src/components/Field/FormLookup";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import AvatarUpload from "src/components/AvatarUpload";
import { useAccessPermission } from "src/hooks/useAccessPermission";
import { useFormStore } from "src/hooks/useFormStore";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import { FormRequiredScope } from "src/hooks/useFormRequired";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { AccessRightsTable } from "src/models/AccessRights";
import { TDataItem } from "src/components/Table/types";
import Notice from "src/components/Notice";
import { useFormNotices } from "src/hooks/useFormNotices";

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
  const { canWrite } = useAccessPermission("User");
  const queryClient = useQueryClient();

  // refetchType: "active" — ждём завершение refetch смонтированной SubTable,
  // чтобы useFormStore.submit() очистил pending-строки только после
  // появления свежих серверных данных (см. useFormStore.ts → submit).
  const invalidateSubTables = useCallback(async (savedData: any) => {
    await invalidateSubTableFor(queryClient, "access-rights", "userUuid", savedData?.uuid ?? "");
  }, [queryClient]);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "users-form", defaultFields: DEFAULT_FIELDS, paneProps,
    tables: {
      accessRights: {
        endpoint: "access-rights",
        parentField: "userUuid",
        label: translate("accessRights"),
        batchEndpoint: "access-rights/batch",
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
    buildPaneLabel: (saved) => makePaneLabel("UsersList", "Пользователи", saved, saved.username),
    afterSave: invalidateSubTables,
  });

  // Ошибки ДАННЫХ формы → <Notice /> внутри формы (системные — в <UIToast />).
  const notices = useFormNotices(form);

  const accessRights = form.useTable("accessRights");

  const tabs = useMemo(() => {
    const result: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "tab-details", label: translate("general"), component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              <GroupCol>
                <GroupRow>
                  <Group className={styles.w1of2}>
                    <Field label={translate("loginLabel")} name={`${form.formUid}_username`} minWidth="150px" value={form.fields.username} onChange={e => form.setField("username", e.target.value)} disabled={form.isLoading} required />
                  </Group>
                  <Group className={styles.w1of2}>
                    <Field label={form.isEditMode ? translate("newPassword") : translate("password")} name={`${form.formUid}_password`} minWidth="150px" value={form.fields.password} onChange={e => form.setField("password", e.target.value)} disabled={form.isLoading} />
                  </Group>
                </GroupRow>
                <Group>
                  <FormLookup form={form} field="employee" endpoint="employees" displayField="fullName" minWidth={FIELD_WIDTH.xl} />
                </Group>
                {form.isEditMode && form.fields.uuid && (
                  <GroupRow>
                    <Group className={styles.w1of2}>
                      <AvatarUpload endpoint={MODEL_ENDPOINT} entityUuid={form.fields.uuid} hasAvatar={!!form.fields.avatarPath} disabled={form.isLoading} />
                    </Group>
                  </GroupRow>
                )}
              </GroupCol>
            </div>

            <GroupCol className={styles.FormNotice}>
              <Notice items={notices} />
            </GroupCol>
          </div>
        )
      },
    ];
    if (form.isEditMode && form.fields.uuid) {
      result.push({
        id: "accessPermissions",
        label: translate("accessPermissions"),
        component: (
          <AccessRightsTable
            userUuid={form.fields.uuid}
            deferRemoteChanges={true}
            initialPendingRows={accessRights.pending}
            onItemsChange={accessRights.onItemsChange}
          />
        ),
      });
    }
    return result;
  }, [form.formUid, form.fields, form.isLoading, form.isEditMode, form.setField, form.setFields, accessRights]);

  return (
    <FormRequiredScope requiredKeys={["username"]} active={form.meta.headerValidationFailed}>
      <ModelForm paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={form.fields.uuid} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
        onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
        readonly={!canWrite} />
    </FormRequiredScope>
  );
};
UsersForm.displayName = "UsersForm";

const UsersList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant, onSelectItem }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName="UsersList" columnsJson={columnsJson} FormComponent={UsersForm}
    getLabel={(d) => d?.username ? (d.username as string) : (d?.employee as any)?.fullName || "?"} variant={variant} onSelectItem={onSelectItem} />
);
UsersList.displayName = "UsersList";

export { UsersList, UsersForm };
