import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDateTime, FieldSelect, FieldTextarea } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "scheduled-tasks";
const LIST_NAME = "ScheduledTasksList";
const FORM_LABEL = "Регламентная задача";

const STATUS_OPTIONS = [
  { value: "active", label: "Активна" },
  { value: "paused", label: "Приостановлена" },
  { value: "completed", label: "Завершена" },
];

interface TFields {
  id?: number; uuid?: string;
  name: string; description: string; cronExpr: string; status: string;
  lastRunAt: string; nextRunAt: string;
  organizationUuid: string; organizationName: string;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  name: "", description: "", cronExpr: "", status: "active",
  lastRunAt: "", nextRunAt: "", organizationUuid: "", organizationName: "",
  authorUuid: "", authorName: "",
};

const ScheduledTasksForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("ScheduledTask");
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "scheduled-tasks-form", defaultFields: DEFAULT_FIELDS, paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      name: d.name ?? "", description: d.description ?? "",
      cronExpr: d.cronExpr ?? "", status: d.status ?? "active",
      lastRunAt: d.lastRunAt?.slice(0, 16) ?? "", nextRunAt: d.nextRunAt?.slice(0, 16) ?? "",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.name ?? "",
      authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
      authorName: d.author?.username ?? d.author?.email ?? "",
    }),
    buildPayload: (fd) => ({
      name: fd.name?.trim() || null, description: fd.description?.trim() || null,
      cronExpr: fd.cronExpr?.trim() || null, status: fd.status || "active",
      lastRunAt: fd.lastRunAt || null, nextRunAt: fd.nextRunAt || null,
      organizationUuid: fd.organizationUuid || null,
    }),
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, FORM_LABEL, saved),
  });

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <Field label={translate("name")} name={`${form.formUid}_name`} minWidth="339px" value={form.fields.name} onChange={e => form.setField("name", e.target.value)} disabled={form.isLoading} />
              <Field label="Cron выражение" name={`${form.formUid}_cron`} minWidth="339px" value={form.fields.cronExpr} onChange={e => form.setField("cronExpr", e.target.value)} disabled={form.isLoading} />
              <FieldSelect label={translate("status")} name={`${form.formUid}_status`} value={form.fields.status} options={STATUS_OPTIONS} onChange={e => form.setField("status", e.target.value)} disabled={form.isLoading} />
              <FieldDateTime label={translate("lastRunAt")} name={`${form.formUid}_lastRun`} minWidth="200px" value={form.fields.lastRunAt} onChange={e => form.setField("lastRunAt", e.target.value)} disabled={form.isLoading} />
              <Field label={translate("Author")} name={`${form.formUid}_author`} width="220px" value={form.fields.authorName || "-"} disabled />
              <FieldDateTime label={translate("nextRunAt")} name={`${form.formUid}_nextRun`} minWidth="200px" value={form.fields.nextRunAt} onChange={e => form.setField("nextRunAt", e.target.value)} disabled={form.isLoading} />
              <LookupField label={translate("organization")} name={`${form.formUid}_org`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="name" onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TFields>)} minWidth="339px" disabled={form.isLoading} />
              <FieldTextarea label={translate("description")} name={`${form.formUid}_description`} value={form.fields.description} onChange={e => form.setField("description", e.target.value)} disabled={form.isLoading} minWidth="339px" minHeight="80px" rows={4} />
            </GroupCol>
          </div>
        </div>
      )
    },
  ], [form.fields, form.isLoading, form.isEditMode, form.formUid, form.setField, form.setFields]);

  return (
    <ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
      readonly={!canWrite} />
  );
};
ScheduledTasksForm.displayName = "ScheduledTasksForm";

const ScheduledTasksList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={ScheduledTasksForm}
    getLabel={(d) => d?.name ? (d.name as string).slice(0, 50) : "?"} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }} />
);
ScheduledTasksList.displayName = "ScheduledTasksList";

export { ScheduledTasksList, ScheduledTasksForm };
