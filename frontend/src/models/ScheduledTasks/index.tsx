import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Divider, Field, FieldDateTime, FieldSelect, FieldTextarea } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import ModelFormWrapper from "src/components/ModelFormWrapper";
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
  shortName: string; description: string; cronExpr: string; status: string;
  lastRunAt: string; nextRunAt: string;
  organizationUuid: string; organizationName: string;
}

const DEFAULT_FIELDS: TFields = {
  shortName: "", description: "", cronExpr: "", status: "active",
  lastRunAt: "", nextRunAt: "", organizationUuid: "", organizationName: "",
};

const ScheduledTasksForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("ScheduledTask");
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "scheduled-tasks-form", defaultFields: DEFAULT_FIELDS, paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      shortName: d.shortName ?? "", description: d.description ?? "",
      cronExpr: d.cronExpr ?? "", status: d.status ?? "active",
      lastRunAt: d.lastRunAt?.slice(0, 16) ?? "", nextRunAt: d.nextRunAt?.slice(0, 16) ?? "",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.shortName ?? "",
    }),
    buildPayload: (fd) => ({
      shortName: fd.shortName?.trim() || null, description: fd.description?.trim() || null,
      cronExpr: fd.cronExpr?.trim() || null, status: fd.status || "active",
      lastRunAt: fd.lastRunAt || null, nextRunAt: fd.nextRunAt || null,
      organizationUuid: fd.organizationUuid || null,
    }),
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, FORM_LABEL, saved),
  });

  const tabs = useMemo(() => [
    { id: "general", label: translate("general") || "Основное", component: (
      <div className={styles.FormBodyParts}>
        <Group align="row" gap="12px" className={styles.Form}><div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
          <Field label="Наименование" name={`${form.formUid}_shortName`} minWidth="339px" value={form.fields.shortName} onChange={e => form.setField("shortName", e.target.value)} disabled={form.isLoading} />
          <Field label="Cron выражение" name={`${form.formUid}_cron`} minWidth="339px" value={form.fields.cronExpr} onChange={e => form.setField("cronExpr", e.target.value)} disabled={form.isLoading} />
          <FieldSelect label="Статус" name={`${form.formUid}_status`} value={form.fields.status} options={STATUS_OPTIONS} onChange={e => form.setField("status", e.target.value)} disabled={form.isLoading} />
          <FieldDateTime label="Последний запуск" name={`${form.formUid}_lastRun`} minWidth="200px" value={form.fields.lastRunAt} onChange={e => form.setField("lastRunAt", e.target.value)} disabled={form.isLoading} />
          <FieldDateTime label="Следующий запуск" name={`${form.formUid}_nextRun`} minWidth="200px" value={form.fields.nextRunAt} onChange={e => form.setField("nextRunAt", e.target.value)} disabled={form.isLoading} />
          <LookupField label="Организация" name={`${form.formUid}_org`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="shortName" onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TFields>)} minWidth="339px" disabled={form.isLoading} />
          <FieldTextarea label="Описание" name={`${form.formUid}_description`} value={form.fields.description} onChange={e => form.setField("description", e.target.value)} disabled={form.isLoading} minWidth="339px" minHeight="80px" rows={4} />
        </div></Group>
        {form.isEditMode && <><Divider /><Group align="row" gap="12px" className={styles.Form}><div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
          <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
          <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
        </div></Group></>}
      </div>
    )},
  ], [form.fields, form.isLoading, form.isEditMode, form.formUid, form.setField, form.setFields]);

  return (
    <ModelFormWrapper paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined} isLoading={form.isLoading} showReload={form.isEditMode}
      readonly={!canWrite} isDirty={form.isDirty} />
  );
};
ScheduledTasksForm.displayName = "ScheduledTasksForm";

const ScheduledTasksList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={ScheduledTasksForm}
    getLabel={(d) => d?.shortName ? String(d.shortName).slice(0, 50) : "?"} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }} />
);
ScheduledTasksList.displayName = "ScheduledTasksList";

export { ScheduledTasksList, ScheduledTasksForm };
