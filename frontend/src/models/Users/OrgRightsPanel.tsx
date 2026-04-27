/**
 * OrgRightsPanel — форма управления доступом пользователя к организации.
 *
 * Открывается из UserOrganizationsTable при клике на строку.
 *
 * Вкладка "Основное":
 *   - Организация (read-only lookup)
 *   - Роль / Уровень доступа (select)
 *
 * Вкладка "Права доступа":
 *   - Таблица прав доступа по моделям (AccessRightsList)
 */
import { FC, useMemo } from "react";
import type { TPane } from "src/app/types";
import { AccessRightsTable } from "src/models/AccessRights";
import { translate } from "src/i18";
import { Field, FieldSelect } from "src/components/Field";
import { GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import ModelForm from "src/components/ModelForm";
import { makePaneLabel } from "src/utils/buildPaneLabel";

const MODEL_ENDPOINT = "user-organizations";

export const ROLE_OPTIONS = [
  { value: "member", label: translate("roleMember") || "Участник" },
  { value: "admin",  label: translate("roleAdmin")  || "Администратор" },
];

interface TFields {
  id?: number;
  uuid?: string;
  userUuid: string;
  organizationUuid: string;
  orgShortName: string;
  role: string;
}

const DEFAULT_FIELDS: TFields = {
  userUuid: "", organizationUuid: "", orgShortName: "", role: "member",
};

const OrgRightsPanel: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("AccessRight");

  // Если в data нет uuid (новая запись из SubTable) — инициализируем из data
  const initialFields: TFields | undefined = (() => {
    const d = paneProps.data;
    if (!d || d.uuid) return undefined;
    return {
      ...DEFAULT_FIELDS,
      userUuid:         (d.userUuid         as string) ?? "",
      organizationUuid: (d.organizationUuid as string) ?? "",
      orgShortName:     (d.orgName          as string) ?? "",
      role:             (d.role             as string) ?? "member",
    };
  })();

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "org-rights-form",
    defaultFields: DEFAULT_FIELDS,
    initialFields,
    paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      id:               d.id,
      uuid:             d.uuid ?? String(d.id),
      userUuid:         d.userUuid         ?? "",
      organizationUuid: d.organizationUuid ?? "",
      orgShortName:     (d.organization as any)?.shortName ?? prev?.orgShortName ?? "",
      role:             d.role ?? "member",
    }),
    buildPayload: (fd) => {
      if (!fd.userUuid)         return "userUuid обязателен";
      if (!fd.organizationUuid) return "Организация обязательна";
      return { role: fd.role || "member" };
    },
    buildPaneLabel: (saved) => makePaneLabel("OrgRightsPanel", "Права к разделам", saved),
  });

  const tabs = useMemo(() => {
    const result: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "general",
        label: translate("general") || "Основное",
        component: (
          <div className={styles.Form}>
            {form.isEditMode && (
              <GroupRow>
                <Field
                  label="ID"
                  name={`${form.formUid}_id`}
                  width="80px"
                  value={String(form.fields.id ?? "-")}
                  disabled
                />
              </GroupRow>
            )}
            <GroupCol>
              <Field
                label={translate("OrganizationsList") || "Организация"}
                name={`${form.formUid}_org`}
                value={form.fields.orgShortName || form.fields.organizationUuid}
                disabled
              />
              <FieldSelect
                label={translate("accessLevel") || "Уровень доступа"}
                name={`${form.formUid}_role`}
                options={ROLE_OPTIONS}
                value={form.fields.role}
                onChange={e => form.setField("role", e.target.value)}
                disabled={form.isLoading}
              />
            </GroupCol>
          </div>
        ),
      },
    ];

    // Вкладку "Права доступа" показываем только когда запись существует
    if (form.isEditMode && form.fields.userUuid && form.fields.organizationUuid) {
      result.push({
        id: "modelRights",
        label: translate("modelRights") || "Права к разделам",
        component: (
          <AccessRightsTable
            userUuid={form.fields.userUuid}
            organizationUuid={form.fields.organizationUuid}
          />
        ),
      });
    }

    return result;
  }, [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField]);

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

OrgRightsPanel.displayName = "OrgRightsPanel";
export default OrgRightsPanel;
