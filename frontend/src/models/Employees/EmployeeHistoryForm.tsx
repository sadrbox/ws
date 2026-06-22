import { FC, useMemo } from "react";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import type { TPane } from "src/app/types";
import { FieldDate, FieldNumber, FieldSelect } from "src/components/Field";
import { FormLookup } from "src/components/Field/FormLookup";
import styles from "src/styles/main.module.scss";
import { translate } from "src/i18";
import { Group, GroupCol, GroupRow } from "src/components/UI";

import { useFormStore } from "src/hooks/useFormStore";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";

const MODEL_ENDPOINT = "employee-histories";

const EVENT_TYPE_OPTIONS = [
  { value: "hire", label: "Приём" },
  { value: "fire", label: "Увольнение" },
  { value: "transfer", label: "Перемещение" },
];

interface TFields {
  id?: number;
  uuid?: string;
  eventDate: string;
  eventType: string;
  organizationUuid: string;
  organizationName: string;
  positionUuid: string;
  positionName: string;
  salary: string;
  employeeUuid: string;
}

const DEFAULT_FIELDS: TFields = {
  eventDate: new Date().toISOString().slice(0, 10),
  eventType: "hire",
  organizationUuid: "",
  organizationName: "",
  positionUuid: "",
  positionName: "",
  salary: "",
  employeeUuid: "",
};

const EmployeeHistoryForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useUserAccessRight("EmployeeHistory");
  const data = paneProps.data;
  const employeeUuid = (data as any)?.employeeUuid as string | undefined;

  const initialFields: TFields | undefined = (() => {
    if (data?.uuid) return undefined;
    return { ...DEFAULT_FIELDS, employeeUuid: employeeUuid ?? "" };
  })();

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "employee-history-form",
    defaultFields: DEFAULT_FIELDS,
    initialFields,
    paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      id: d.id,
      uuid: d.uuid,
      eventDate: d.eventDate ? new Date(d.eventDate).toISOString().slice(0, 10) : "",
      eventType: d.eventType ?? "hire",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.name ?? "",
      positionUuid: d.positionUuid ?? "",
      positionName: d.position?.name ?? "",
      salary: d.salary != null ? String(Number(d.salary)) : "",
      employeeUuid: d.employeeUuid ?? employeeUuid ?? "",
    }),
    buildPayload: (fd) => {
      if (!fd.eventType?.trim()) return "Тип события обязателен";
      if (!fd.employeeUuid) return "Сотрудник не указан";
      return {
        eventDate: fd.eventDate || null,
        eventType: fd.eventType.trim(),
        organizationUuid: fd.organizationUuid || null,
        positionUuid: fd.positionUuid || null,
        salary: fd.salary ? parseFloat(fd.salary) : null,
        employeeUuid: fd.employeeUuid,
      };
    },
    buildPaneLabel: (saved) => {
      const typeLabel = EVENT_TYPE_OPTIONS.find(o => o.value === saved.eventType)?.label;
      const detail = [typeLabel, saved.eventDate].filter(Boolean).join(" - ");
      return makePaneLabel("EmployeeHistoriesList", "Кадровая история", saved, detail || undefined);
    },
  });

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <GroupRow>
                <Group className={styles.w1of2}>
                  <FieldDate label={translate("eventDate")} name={`${form.formUid}_eventDate`} width="180px"
                    value={form.fields.eventDate} onChange={e => form.setField("eventDate", e.target.value)} disabled={form.isLoading} required />
                </Group>
                <Group className={styles.w1of2}>
                  <FieldSelect label={translate("eventType")} name={`${form.formUid}_eventType`}
                    value={form.fields.eventType} onChange={e => form.setField("eventType", e.target.value)}
                    disabled={form.isLoading} options={EVENT_TYPE_OPTIONS} style={{ width: "180px" }} required />
                </Group>
              </GroupRow>
              <Group>
                <FormLookup form={form} field="organization" endpoint="organizations" width={FIELD_WIDTH.lg} />
                <FormLookup form={form} field="position" endpoint="positions" label="position.name" width={FIELD_WIDTH.lg} />
              </Group>
              <GroupRow>
                <Group className={styles.w1of2}>
                  <FieldNumber label={translate("salary")} name={`${form.formUid}_salary`} width="180px"
                    value={form.fields.salary} onChange={e => form.setField("salary", e.target.value)}
                    disabled={form.isLoading} step="0.1" decimals={2} textAlign="right" />
                </Group>
              </GroupRow>
            </GroupCol>
          </div>
        </div>
      ),
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields]);

  return (
    <ModelForm
      paneId={form.paneId}
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined}
      isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}

      readonly={!canWrite}
    />
  );
};

EmployeeHistoryForm.displayName = "EmployeeHistoryForm";
export default EmployeeHistoryForm;
