import { FC, useMemo } from "react";
import apiClient from "src/services/api/client";
import type { TPane } from "src/app/types";
import { Divider, Field, FieldNumber, FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import styles from "src/styles/main.module.scss";
import { translate } from "src/i18";
import { Group } from "src/components/UI";

import { useFormStore } from "src/hooks/useFormStore";
import ModelFormWrapper from "src/components/ModelFormWrapper";

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
    mapServerToForm: async (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      id: d.id,
      uuid: d.uuid,
      eventDate: d.eventDate ? new Date(d.eventDate).toISOString().slice(0, 10) : "",
      eventType: d.eventType ?? "hire",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.shortName ?? "",
      positionUuid: d.positionUuid ?? "",
      positionName: d.position?.shortName ?? "",
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
      const opt = EVENT_TYPE_OPTIONS.find(o => o.value === saved.eventType);
      const typeLabel = opt?.label ?? saved.eventType;
      return `${translate("EmployeeHistoriesList") || "Кадровая история"}: ${typeLabel} • ${saved.id ?? "?"}`;
    },
  });

  const tabs = useMemo(() => [
    {
      id: "general", label: translate("general") || "Общие сведения", component: (
        <div className={styles.FormBodyParts}>
          <Group align="row" gap="12px" className={styles.Form}>
            <div style={{ width: "180px" }}>
              <label htmlFor={`${form.formUid}_eventDate`} className={styles.FieldLabel}>Дата события *</label>
              <input type="date" id={`${form.formUid}_eventDate`} name={`${form.formUid}_eventDate`}
                value={form.fields.eventDate} onChange={e => form.setField("eventDate", e.target.value)}
                disabled={form.isLoading} style={{ width: "100%", padding: "4px 8px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }} />
            </div>
            <FieldSelect label="Тип события *" name={`${form.formUid}_eventType`}
              value={form.fields.eventType} onChange={e => form.setField("eventType", e.target.value)}
              disabled={form.isLoading} options={EVENT_TYPE_OPTIONS} style={{ width: "180px" }} />
          </Group>
          <Group align="row" gap="12px" className={styles.Form}>
            <LookupField label="Организация" name={`${form.formUid}_org`} width="339px"
              value={form.fields.organizationUuid} displayValue={form.fields.organizationName}
              endpoint="organizations" displayField="shortName"
              columns={[{ key: "shortName", label: "Наименование" }, { key: "bin", label: "БИН" }]}
              onSelect={(uuid) => {
                apiClient.get(`/organizations/${uuid}`).then(r => {
                  const o = r.data?.item ?? r.data;
                  form.setFields({ organizationUuid: o.uuid, organizationName: o.shortName ?? "" } as any);
                });
              }}
              onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as any)}
              disabled={form.isLoading} />
          </Group>
          <Group align="row" gap="12px" className={styles.Form}>
            <LookupField label="Должность" name={`${form.formUid}_pos`} width="339px"
              value={form.fields.positionUuid} displayValue={form.fields.positionName}
              endpoint="positions" displayField="shortName"
              columns={[{ key: "shortName", label: "Наименование" }]}
              onSelect={(uuid) => {
                apiClient.get(`/positions/${uuid}`).then(r => {
                  const o = r.data?.item ?? r.data;
                  form.setFields({ positionUuid: o.uuid, positionName: o.shortName ?? "" } as any);
                });
              }}
              onClear={() => form.setFields({ positionUuid: "", positionName: "" } as any)}
              disabled={form.isLoading} />
          </Group>
          <Group align="row" gap="12px" className={styles.Form}>
            <FieldNumber label="Оклад" name={`${form.formUid}_salary`} width="180px"
              value={form.fields.salary} onChange={e => form.setField("salary", e.target.value)}
              disabled={form.isLoading} step="0.01" textAlign="right" />
          </Group>
          {form.isEditMode && <><Divider /><Group align="row" gap="12px" className={styles.Form}>
            <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
              <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
              <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
            </div>
          </Group></>}
        </div>
      ),
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields]);

  return (
    <ModelFormWrapper
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined}
      isLoading={form.isLoading}
      showReload={form.isEditMode}
      error={form.error}
      errorRevision={form.errorRevision}
      onErrorDismiss={() => form.setError(null)}
    />
  );
};

EmployeeHistoryForm.displayName = "EmployeeHistoryForm";
export default EmployeeHistoryForm;
