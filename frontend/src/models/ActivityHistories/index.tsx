import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import { getFormatDate } from "src/utils/datetime";
import styles from "src/styles/main.module.scss";
import auditStyles from "./ActivityHistories.module.scss";

import { useFormStore } from "src/hooks/useFormStore";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { renderAuditCell, summarizeDiff } from "./renderAuditCell";
import { makePaneLabel } from "src/utils/buildPaneLabel";

const MODEL_ENDPOINT = "activityhistories";

/** actionType → i18-ключ (тот же набор, что в renderAuditCell). */
const ACTION_LABEL_KEYS: Record<string, string> = {
  create: "auditCreate", update: "auditUpdate", delete: "auditDelete", batch_delete: "auditBatchDelete",
};

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFields {
  id?: number;
  uuid?: string;
  actionDate?: string;
  actionType: string;
  organizationUuid: string;
  organizationShortName: string;
  bin: string;
  userName: string;
  host: string;
  ip: string;
  city: string;
  objectId: string;
  objectType: string;
  objectName: string;
  diff?: any;
  props?: any;
}

const DEFAULT_FIELDS: TFields = {
  actionType: "", organizationUuid: "", organizationShortName: "", bin: "",
  userName: "", host: "", ip: "", city: "",
  objectId: "", objectType: "", objectName: "",
};

const ActivityHistoriesForm: FC<Partial<TPane>> = (paneProps) => {
  // Форма — только просмотр записи журнала: у роутера нет PUT, редактировать нечем
  // (и не нужно — журнал аудита, который правят руками, перестаёт быть журналом).
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "activity-histories-form",
    defaultFields: DEFAULT_FIELDS,
    paneProps,
    mapServerToForm: (d) => ({
      ...DEFAULT_FIELDS,
      actionType: d.actionType ?? "",
      organizationUuid: d.organizationUuid ?? "",
      organizationShortName: d.organizationShortName ?? d.organization?.name ?? "",
      bin: d.bin ?? "",
      userName: d.userName ?? "",
      host: d.host ?? "",
      ip: d.ip ?? "",
      city: d.city ?? "",
      objectId: d.objectId ?? "",
      objectType: d.objectType ?? "",
      objectName: d.objectName ?? "",
      diff: d.diff,
      props: d.props,
      id: d.id,
      uuid: d.uuid,
      actionDate: d.actionDate,
    }),
    buildPayload: (fd) => ({
      actionType: fd.actionType, objectId: fd.objectId,
      objectType: fd.objectType, objectName: fd.objectName,
    }),
    buildPaneLabel: (saved) => makePaneLabel("ActivityHistoriesList", "Журнал", saved, saved.userName || undefined),
  });

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <GroupRow>
                <Group className={styles.w1of2}>
                  <Field label={translate("actionType")} name={`${form.formUid}_actionType`} minWidth="200px" value={form.fields.actionType ? translate(ACTION_LABEL_KEYS[form.fields.actionType] ?? form.fields.actionType) : ""} disabled />
                </Group>
                <Group className={styles.w1of2}>
                  <Field label={translate("actionDate")} name={`${form.formUid}_actionDate`} minWidth="200px" value={getFormatDate(form.fields.actionDate)} disabled />
                </Group>
              </GroupRow>
              <Group>
                <Field label={translate("objectType")} name={`${form.formUid}_objectType`} minWidth="200px" value={form.fields.objectType} disabled />
                <Field label={translate("objectName")} name={`${form.formUid}_objectName`} minWidth="200px" value={form.fields.objectName} disabled />
                <Field label={translate("objectId")} name={`${form.formUid}_objectId`} minWidth="120px" value={form.fields.objectId} disabled />
              </Group>
              <Group>
                <Field label={translate("organization")} name={`${form.formUid}_organizationShortName`} minWidth="200px" value={form.fields.organizationShortName} disabled />
                <Field label={translate("bin")} name={`${form.formUid}_bin`} minWidth="150px" value={form.fields.bin} disabled />
              </Group>
              <Group>
                {/* Сводка изменений: «поле: было → стало». Полный JSON — в props ниже. */}
                <Field label={translate("diff")} name={`${form.formUid}_diff`}
                  value={form.fields.diff ? summarizeDiff(form.fields.diff, form.fields.actionType) : ""} disabled />
              </Group>
              <Group>
                <Field label={translate("user")} name={`${form.formUid}_userName`} minWidth="200px" value={form.fields.userName} disabled />
                <Field label={translate("host")} name={`${form.formUid}_host`} minWidth="200px" value={form.fields.host} disabled />
                <Field label={translate("ip")} name={`${form.formUid}_ip`} minWidth="120px" value={form.fields.ip || ""} disabled />
                <Field label={translate("city")} name={`${form.formUid}_city`} minWidth="120px" value={form.fields.city || ""} disabled />
              </Group>
            </GroupCol>

            {form.fields.props && (
              <div className={auditStyles.PropsBlock}>
                <details className={auditStyles.PropsDetails}>
                  <summary className={auditStyles.PropsSummary}>
                    {translate("auditProps")}
                  </summary>
                  <pre className={auditStyles.PropsPre}>
                    {JSON.stringify(form.fields.props, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </div>
      )
    },
  ], [form.fields, form.isLoading, form.isEditMode, form.formUid]);

  return (
    <ModelForm paneId={form.paneId} tabs={tabs} readonly
      onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined}
      isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}/>
  );
};
ActivityHistoriesForm.displayName = "ActivityHistoriesForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

interface ActivityHistoriesListProps {
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
  ownerUuid?: string;
  ownerField?: string;
}

const ActivityHistoriesList: FC<ActivityHistoriesListProps> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList
    endpoint={MODEL_ENDPOINT}
    listName="ActivityHistoriesList"
    columnsJson={columnsJson}
    FormComponent={ActivityHistoriesForm}
    getLabel={(d) => (d?.actionType as string | undefined) || ""}
    variant={variant}
    onSelectItem={onSelectItem}
    ownerUuid={ownerUuid}
    ownerField={ownerField}
    defaultSort={{ id: "desc" }}
    enableDateRange
    renderCell={renderAuditCell}
    // Записи журнала порождает аудит-middleware, а не пользователь: POST-роут создания
    // из UI отсутствует (POST /activityhistories — это приём событий 1С), поэтому
    // «Добавить» просто падала. Удаление админу оставляем (роут DELETE /:id есть).
    hideAdd
  />
);

ActivityHistoriesList.displayName = "ActivityHistoriesList";
export { ActivityHistoriesList, ActivityHistoriesForm };
