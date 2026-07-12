import { FC, useMemo, useCallback } from "react";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import FilesPanel from "src/components/FilesPanel";
import { Field, FieldNumber, FieldDate, FieldSelect, FieldTextarea } from "src/components/Field";
import { FormLookup } from "src/components/Field/FormLookup";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useFormStore } from "src/hooks/useFormStore";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
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
  const { canWrite } = useUserAccessRight("Todo");

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data;
    if (data?.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    if (data?.organizationUuid) { init.organizationUuid = data?.organizationUuid as string; }
    else if (defaultOrg.organizationUuid) { init.organizationUuid = defaultOrg.organizationUuid; init.organizationName = defaultOrg.organizationName; }
    return init;
  })();

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "todos-form", defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      description: d.description ?? "", status: d.status ?? "new",
      organizationUuid: d.organizationUuid ?? "", organizationName: d.organization?.name ?? "",
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
    buildPaneLabel: (saved) => makePaneLabel("TodosList", "Задачи", saved, saved.description ? String(saved.description).slice(0, 60) : undefined),
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
      {
        id: "tab-details", label: translate("general"), component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              <GroupCol>
                <GroupRow>
                  <Group className={styles.w1of2}>
                    <FieldSelect label={translate("status")} name={`${form.formUid}_status`} options={STATUS_OPTIONS} value={form.fields.status} onChange={e => form.setField("status", e.target.value)} disabled={form.isLoading} style={{ minWidth: 200 }} />
                  </Group>
                </GroupRow>
                <Group>
                  <FormLookup form={form} field="organization" endpoint="organizations" minWidth={FIELD_WIDTH.lg} />
                </Group>
                <Group>
                  <FormLookup form={form} field="curator" endpoint="users" displayField="username" secondaryFields={["employee.fullName"]} minWidth={FIELD_WIDTH.lg}
                    onSelect={(uuid, display, item) => form.setFields({ curatorUuid: uuid, curatorName: item?.employee?.fullName || display } as Partial<TFields>)} />
                  <FormLookup form={form} field="executor" endpoint="users" displayField="username" secondaryFields={["employee.fullName"]} minWidth={FIELD_WIDTH.lg}
                    onSelect={(uuid, display, item) => form.setFields({ executorUuid: uuid, executorName: item?.employee?.fullName || display } as Partial<TFields>)} />
                </Group>
                <GroupRow>
                  <Group className={styles.w1of2}>
                    <FieldDate label={translate("createdAt")} name={`${form.formUid}_createdAt`} width="200px" value={form.fields.createdAt} disabled />
                    <FieldNumber label={translate("days")} name={`${form.formUid}_deadlineDays`} width="100px" value={form.fields.deadlineDays} onChange={e => handleDeadlineDaysChange(e.target.value)} disabled={form.isLoading} decimals={0} />
                  </Group>
                  <Group className={styles.w1of2}>
                    <FieldDate label={translate("deadline")} name={`${form.formUid}_deadline`} width="200px" value={form.fields.deadline} onChange={e => form.setField("deadline", e.target.value)} disabled={form.isLoading} />
                  </Group>
                </GroupRow>
                <Group>
                  <FieldTextarea label={translate("taskDescription")} name={`${form.formUid}_description`} value={form.fields.description} onChange={e => form.setField("description", e.target.value)} disabled={form.isLoading} minWidth={FIELD_WIDTH.lg} minHeight="120px" rows={6} />
                </Group>
              </GroupCol>
            </div>

          </div>
        )
      },
    ];
    if (form.isEditMode && form.fields.uuid) {
      t.push({ id: "files", label: translate("files"), component: <FilesPanel ownerType="todo" ownerUuid={form.fields.uuid} /> });
    }
    return t;
  }, [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleDeadlineDaysChange]);

  return (
    <ModelForm paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={form.fields.uuid} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
      readonly={!canWrite} />
  );
};
TodosForm.displayName = "TodosForm";

const TodosList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }> = ({ variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName="TodosList" columnsJson={columnsJson} FormComponent={TodosForm}
    getLabel={(d) => d?.description ? ((d.description as string).slice(0, 50) + ((d.description as string).length > 50 ? "..." : "")) : "?"}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField} extraQueryParams={extraQueryParams} defaultSort={{ id: "desc" }} />
);
TodosList.displayName = "TodosList";

export { TodosList, TodosForm };
