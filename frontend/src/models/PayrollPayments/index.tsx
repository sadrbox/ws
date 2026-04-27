import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDate, FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupRow, Group } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly } from "src/utils/main.module";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "payroll-payments";
const LIST_NAME = "PayrollPaymentsList";
const FORM_LABEL = "Выплата ЗП";

const STATUS_OPTIONS = [
  { value: "draft", label: "Черновик" },
  { value: "approved", label: "Утверждён" },
  { value: "cancelled", label: "Отменён" },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: "bank_transfer", label: "Перечисление на карту" },
  { value: "cash", label: "Наличные (через кассу)" },
];

interface TFields {
  id?: number; uuid?: string;
  documentNumber: string; date: string; description: string;
  period: string;
  employeeUuid: string; employeeName: string;
  organizationUuid: string; organizationName: string;
  paymentMethod: string;
  amount: string;
  status: string;
}

const DEFAULT_FIELDS: TFields = {
  documentNumber: "", date: "", description: "",
  period: "",
  employeeUuid: "", employeeName: "",
  organizationUuid: "", organizationName: "",
  paymentMethod: "bank_transfer",
  amount: "",
  status: "draft",
};

const PayrollPaymentsForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useAccessRight("PayrollPayment");

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data;
    if (!data || data.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    if (defaultOrg.organizationUuid) {
      init.organizationUuid = defaultOrg.organizationUuid;
      init.organizationName = defaultOrg.organizationName;
    }
    return init;
  })();

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "payroll-payments-form", defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      documentNumber: d.documentNumber ?? "", date: d.date?.slice(0, 10) ?? "",
      description: d.description ?? "", period: d.period ?? "",
      employeeUuid: d.employeeUuid ?? "",
      employeeName: d.employee?.fullName ?? "",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.shortName ?? "",
      paymentMethod: d.paymentMethod ?? "bank_transfer",
      amount: d.amount != null ? String(d.amount) : "",
      status: d.status ?? "draft",
    }),
    buildPayload: (fd) => ({
      documentNumber: fd.documentNumber?.trim() || null, date: fd.date || null,
      description: fd.description?.trim() || null, period: fd.period?.trim() || null,
      employeeUuid: fd.employeeUuid || null, organizationUuid: fd.organizationUuid || null,
      paymentMethod: fd.paymentMethod || "bank_transfer",
      amount: fd.amount ? parseFloat(fd.amount) : 0,
      status: fd.status || "draft",
    }),
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved, "date"),
  });

  const tabs = useMemo(() => [
    { id: "tab-details", label: translate("general") || "Основное", component: (
      <div className={styles.FormWrapper}>
        <div className={styles.Form}>
          {form.isEditMode && (
            <GroupRow>
              <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
              <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
            </GroupRow>
          )}
        <Group align="row" gap="12px">
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: 700 }}>
            <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
              <FieldDate label="Дата документа" name={`${form.formUid}_docDate`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="200px" />
              <Field label="Период (ГГГГ-ММ)" name={`${form.formUid}_period`} value={form.fields.period} onChange={e => form.setField("period", e.target.value)} disabled={form.isLoading} width="140px" />
            </div>
            <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
              <LookupField label="Организация" name={`${form.formUid}_org`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="shortName" onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TFields>)} onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)} disabled={form.isLoading} width="300px" />
              <LookupField label="Сотрудник" name={`${form.formUid}_emp`} value={form.fields.employeeUuid} displayValue={form.fields.employeeName} endpoint="employees" displayField="fullName" onSelect={(u, d) => form.setFields({ employeeUuid: u, employeeName: d } as Partial<TFields>)} onClear={() => form.setFields({ employeeUuid: "", employeeName: "" } as Partial<TFields>)} disabled={form.isLoading} width="300px" />
            </div>
            <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
              <Field label="Сумма выплаты" name={`${form.formUid}_amount`} value={form.fields.amount} onChange={e => form.setField("amount", e.target.value)} disabled={form.isLoading} width="180px" />
              <FieldSelect label="Способ выплаты" name={`${form.formUid}_method`} value={form.fields.paymentMethod} options={PAYMENT_METHOD_OPTIONS} onChange={e => form.setField("paymentMethod", e.target.value)} disabled={form.isLoading} />
              <FieldSelect label="Статус" name={`${form.formUid}_status`} value={form.fields.status} options={STATUS_OPTIONS} onChange={e => form.setField("status", e.target.value)} disabled={form.isLoading} />
            </div>
            <Field label="Комментарий" name={`${form.formUid}_desc`} value={form.fields.description} onChange={e => form.setField("description", e.target.value)} disabled={form.isLoading} />
          </div>
        </Group>
        </div>
      </div>
    )},
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields]);

  return (
    <ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined} isLoading={form.isLoading}
      readonly={!canWrite} isDirty={form.isDirty} />
  );
};
PayrollPaymentsForm.displayName = "PayrollPaymentsForm";

const PayrollPaymentsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={PayrollPaymentsForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(String(d.date)) : ""} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }} />
);
PayrollPaymentsList.displayName = "PayrollPaymentsList";

export { PayrollPaymentsList, PayrollPaymentsForm };
