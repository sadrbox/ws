import { FC, useMemo, useCallback } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import FilesPanel from "src/components/FilesPanel";
import PrintPreview from "src/components/PrintPreview";
import { Divider, Field, FieldDate, FieldSelect, FieldTextarea } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import ModelFormWrapper from "src/components/ModelFormWrapper";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "todos";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "new", label: "Новая" },
  { value: "in_progress", label: "В работе" },
  { value: "done", label: "Выполнена" },
  { value: "cancelled", label: "Отменена" },
];

interface TFields {
  id?: number; uuid?: string;
  description: string; status: string;
  organizationUuid: string; organizationName: string;
  curatorUuid: string; curatorName: string;
  executorUuid: string; executorName: string;
  createdAt: string; deadline: string; deadlineDays: string;
}

const DEFAULT_FIELDS: TFields = {
  description: "", status: "new",
  organizationUuid: "", organizationName: "",
  curatorUuid: "", curatorName: "",
  executorUuid: "", executorName: "",
  createdAt: "", deadline: "", deadlineDays: "",
};

const TodosForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useAccessRight("Todo");

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data;
    if (!data || data.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    if (data.organizationUuid) { init.organizationUuid = data.organizationUuid as string; }
    else if (defaultOrg.organizationUuid) { init.organizationUuid = defaultOrg.organizationUuid; init.organizationName = defaultOrg.organizationName; }
    return init;
  })();

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "todos-form", defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      description: d.description ?? "", status: d.status ?? "new",
      organizationUuid: d.organizationUuid ?? "", organizationName: d.organization?.shortName ?? "",
      curatorUuid: d.curatorUuid ?? "", curatorName: d.curator?.employee?.fullName || d.curator?.username || "",
      executorUuid: d.executorUuid ?? "", executorName: d.executor?.employee?.fullName || d.executor?.username || "",
      createdAt: d.createdAt?.slice(0, 10) ?? "",
      deadline: d.deadline?.slice(0, 10) ?? "", deadlineDays: d.deadlineDays?.toString() ?? "",
      id: d.id, uuid: d.uuid,
    }),
    buildPayload: (fd) => ({
      description: fd.description?.trim() || null, status: fd.status || "new",
      organizationUuid: fd.organizationUuid || null, counterpartyUuid: null,
      curatorUuid: fd.curatorUuid || null, executorUuid: fd.executorUuid || null,
      deadline: fd.deadline || null, deadlineDays: fd.deadlineDays || null,
    }),
    buildPaneLabel: (saved) => makePaneLabel("TodosList", "Задачи", saved),
  });

  const handleDeadlineDaysChange = useCallback((value: string) => {
    const days = parseInt(value);
    const snap = form.store.getSnapshot().fields;
    const base = snap.createdAt ? new Date(snap.createdAt) : new Date();
    const deadline = !isNaN(days) && days > 0
      ? new Date(base.getTime() + days * 86400000).toISOString().substring(0, 10)
      : snap.deadline;
    form.setFields({ deadlineDays: value, deadline } as Partial<TFields>);
  }, [form.store, form.setFields]);

  const tabs = useMemo(() => {
    const t: { id: string; label: string; component: React.ReactNode }[] = [
      { id: "general", label: translate("general") || "Основное", component: (
        <div className={styles.FormBodyParts}>
          <Group align="row" gap="12px" className={styles.Form}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
              <FieldSelect label="Статус" name={`${form.formUid}_status`} options={STATUS_OPTIONS} value={form.fields.status} onChange={e => form.setField("status", e.target.value)} disabled={form.isLoading} style={{ minWidth: 200 }} />
              <LookupField label="Организация" name={`${form.formUid}_organization`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="shortName"
                onSelect={(uuid, display) => form.setFields({ organizationUuid: uuid, organizationName: display } as Partial<TFields>)}
                onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)} minWidth="339px" disabled={form.isLoading} />
              <LookupField label="Куратор" name={`${form.formUid}_curator`} value={form.fields.curatorUuid} displayValue={form.fields.curatorName} endpoint="users" displayField="username" secondaryFields={["employee.fullName"]}
                onSelect={(uuid, display, item) => form.setFields({ curatorUuid: uuid, curatorName: item?.employee?.fullName || display } as Partial<TFields>)}
                onClear={() => form.setFields({ curatorUuid: "", curatorName: "" } as Partial<TFields>)} minWidth="339px" disabled={form.isLoading} />
              <LookupField label="Исполнитель" name={`${form.formUid}_executor`} value={form.fields.executorUuid} displayValue={form.fields.executorName} endpoint="users" displayField="username" secondaryFields={["employee.fullName"]}
                onSelect={(uuid, display, item) => form.setFields({ executorUuid: uuid, executorName: item?.employee?.fullName || display } as Partial<TFields>)}
                onClear={() => form.setFields({ executorUuid: "", executorName: "" } as Partial<TFields>)} minWidth="339px" disabled={form.isLoading} />
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <FieldDate label="Дата создания" name={`${form.formUid}_createdAt`} width="200px" value={form.fields.createdAt} disabled />
                <Field label="Дней" name={`${form.formUid}_deadlineDays`} width="100px" value={form.fields.deadlineDays} onChange={e => handleDeadlineDaysChange(e.target.value)} disabled={form.isLoading} />
                <FieldDate label="Дедлайн" name={`${form.formUid}_deadline`} width="200px" value={form.fields.deadline} onChange={e => form.setField("deadline", e.target.value)} disabled={form.isLoading} />
              </div>
              <FieldTextarea label="Описание задачи" name={`${form.formUid}_description`} value={form.fields.description} onChange={e => form.setField("description", e.target.value)} disabled={form.isLoading} minWidth="339px" minHeight="120px" rows={6} />
            </div>
          </Group>
          {form.isEditMode && <><Divider /><Group align="row" gap="12px" className={styles.Form}><div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
            <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
            <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
          </div></Group></>}
        </div>
      )},
    ];
    if (form.isEditMode && form.fields.uuid) {
      t.push({ id: "files", label: translate("files") || "Файлы", component: <FilesPanel ownerType="todo" ownerUuid={form.fields.uuid} /> });
      t.push({ id: "print", label: "Печать", component: <PrintPreview ownerUuid={form.fields.uuid} ownerType="todo" /> });
    }
    return t;
  }, [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleDeadlineDaysChange]);

  return (
    <ModelFormWrapper paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined} isLoading={form.isLoading} showReload={form.isEditMode}
      readonly={!canWrite} isDirty={form.isDirty} />
  );
};
TodosForm.displayName = "TodosForm";

const TodosList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName="TodosList" columnsJson={columnsJson} FormComponent={TodosForm}
    getLabel={(d) => d?.description ? (String(d.description).slice(0, 50) + (String(d.description).length > 50 ? "..." : "")) : "?"}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }} />
);
TodosList.displayName = "TodosList";

export { TodosList, TodosForm };
