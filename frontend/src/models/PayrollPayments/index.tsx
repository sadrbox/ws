import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDate, FieldSelect } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import LookupField from "src/components/Field/LookupField";
import { GroupRow, Group, GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly } from "src/utils/main.module";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { validateDocumentFields, formatValidationErrors } from "src/utils/validatePostedDocument";
import { FormRequiredScope } from "src/hooks/useFormRequired";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";

const MODEL_ENDPOINT = "payroll-payments";
const LIST_NAME = "PayrollPaymentsList";
const FORM_LABEL = "Выплата ЗП";

const PAYMENT_METHOD_OPTIONS = [
  { value: "bank_transfer", label: "Перечисление на карту" },
  { value: "cash", label: "Наличные (через кассу)" },
];

interface TFields {
  id?: number; uuid?: string;
  documentNumber: string; date: string; comment: string;
  period: string;
  employeeUuid: string; employeeName: string;
  organizationUuid: string; organizationName: string;
  paymentMethod: string;
  amount: string;
  posted: boolean;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  documentNumber: "", date: "", comment: "",
  period: "",
  employeeUuid: "", employeeName: "",
  organizationUuid: "", organizationName: "",
  paymentMethod: "bank_transfer",
  amount: "",
  posted: false,
  authorUuid: "", authorName: "",
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
      comment: d.comment ?? "", period: d.period ?? "",
      employeeUuid: d.employeeUuid ?? "",
      employeeName: d.employee?.fullName ?? "",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.shortName ?? "",
      paymentMethod: d.paymentMethod ?? "bank_transfer",
      amount: d.amount != null ? String(d.amount) : "",
      posted: d.posted === true,
      authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
      authorName: d.author?.username ?? d.author?.email ?? "",
    }),
    buildPayload: (fd) => {
      const validation = validateDocumentFields("payroll_payment", fd as unknown as Record<string, unknown>);
      if (!validation.isValid) return formatValidationErrors(validation.errors);
      return {
        documentNumber: fd.documentNumber?.trim() || null, date: fd.date || null,
        comment: fd.comment?.trim() || null, period: fd.period?.trim() || null,
        employeeUuid: fd.employeeUuid || null, organizationUuid: fd.organizationUuid || null,
        paymentMethod: fd.paymentMethod || "bank_transfer",
        amount: fd.amount ? parseFloat(fd.amount) : 0,
        posted: fd.posted === true,
      };
    },
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved, "date"),
  });

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <GroupRow style={{ width: "100%", justifyContent: "space-between" }}>
                <FieldDate label="Дата документа" name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="200px" />
                <Field label="Период (ГГГГ-ММ)" name={`${form.formUid}_period`} value={form.fields.period} onChange={e => form.setField("period", e.target.value)} disabled={form.isLoading} width="140px" />
                <FieldToggle name={`${form.formUid}_posted`} label="Проведён" value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} variant="success" />
              </GroupRow>
              <Group>
                <LookupField label="Организация" name={`${form.formUid}_organizationUuid`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="shortName" onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TFields>)} onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)} disabled={form.isLoading} />
                <LookupField label="Сотрудник" name={`${form.formUid}_employeeUuid`} value={form.fields.employeeUuid} displayValue={form.fields.employeeName} endpoint="employees" displayField="fullName" onSelect={(u, d) => form.setFields({ employeeUuid: u, employeeName: d } as Partial<TFields>)} onClear={() => form.setFields({ employeeUuid: "", employeeName: "" } as Partial<TFields>)} disabled={form.isLoading} />
              </Group>
              <GroupRow>
                <Field label="Сумма выплаты" name={`${form.formUid}_amount`} value={form.fields.amount} onChange={e => form.setField("amount", e.target.value)} disabled={form.isLoading} width="180px" />
                <FieldSelect label="Способ выплаты" name={`${form.formUid}_paymentMethod`} value={form.fields.paymentMethod} options={PAYMENT_METHOD_OPTIONS} onChange={e => form.setField("paymentMethod", e.target.value)} disabled={form.isLoading} />
              </GroupRow>
            </GroupCol>
            {form.isEditMode && <><Group align="row" style={{ flex: 1, alignItems: "end", justifyContent: "end", gap: 6 }}>
              <Field label={translate("Comment")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} />
              <Field label={translate("Author")} name={`${form.formUid}_author`} value={form.fields.authorName || ""} disabled width="auto" />
            </Group></>}
          </div>
        </div>
      )
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, canWrite]);

  return (
    <FormRequiredScope docType="payroll_payment">
      <ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
        onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
        readonly={!canWrite} />
    </FormRequiredScope>
  );
};
PayrollPaymentsForm.displayName = "PayrollPaymentsForm";

const PayrollPaymentsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={PayrollPaymentsForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(String(d.date)) : ""} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }}
    renderCell={renderPostedCell}
  />
);
PayrollPaymentsList.displayName = "PayrollPaymentsList";

export { PayrollPaymentsList, PayrollPaymentsForm };
