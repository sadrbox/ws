import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldNumber, FieldDateTime, FieldSelect, FieldPeriod } from "src/components/Field";
import HeaderTogglePosted from "src/components/PaneHeader/HeaderTogglePosted";
import { FormLookup } from "src/components/Field/FormLookup";
import { GroupRow, Group, GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useFormStore } from "src/hooks/useFormStore";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import DocumentEntriesButton from "src/components/AccountingEntries/DocumentEntriesButton";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { useAssignNumber } from "src/hooks/useAssignNumber";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly, isoToLocalInput, localInputToIso } from "src/utils/datetime";
import Notice from "src/components/Notice";
import { useDocumentNotices } from "src/hooks/useDocumentNotices";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { validateDocumentFields, formatValidationErrors } from "src/utils/validatePostedDocument";
import { FormRequiredScope, FormDirtyScope } from "src/hooks/useFormRequired";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";

const MODEL_ENDPOINT = "payroll-payments";
const LIST_NAME = "PayrollPaymentsList";
const FORM_LABEL = "Выплата заработной платы";

const PAYMENT_METHOD_OPTIONS = [
  { value: "bank_transfer", label: translate("paymentMethodBankTransfer") },
  { value: "cash", label: translate("paymentMethodCash") },
];

interface TFields {
  id?: number; uuid?: string;
  number: string;
  date: string; comment: string;
  period: string;
  employeeUuid: string; employeeName: string;
  organizationUuid: string; organizationName: string;
  paymentMethod: string;
  amount: string;
  posted: boolean;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  number: "",
  date: "", comment: "",
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
  const { canWrite } = useUserAccessRight("PayrollPayment");
  const assignNumber = useAssignNumber();

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data;
    if (data?.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    init.date = isoToLocalInput(new Date().toISOString());
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
      number: d.number ?? "",
      date: isoToLocalInput(d.date),
      comment: d.comment ?? "", period: d.period ?? "",
      employeeUuid: d.employeeUuid ?? "",
      employeeName: d.employee?.fullName ?? "",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.name ?? "",
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
        number: fd.number?.trim() || null,
        date: localInputToIso(fd.date),
        comment: fd.comment?.trim() || null, period: fd.period?.trim() || null,
        employeeUuid: fd.employeeUuid || null, organizationUuid: fd.organizationUuid || null,
        paymentMethod: fd.paymentMethod || "bank_transfer",
        amount: fd.amount ? parseFloat(fd.amount) : 0,
        posted: fd.posted === true,
      };
    },
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved, "date"),
  });

  const notices = useDocumentNotices({ docType: "payroll_payment", fields: form.fields as unknown as Record<string, unknown> });

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormContainer}>
          <div className={styles.FormWrapper}>
            <GroupCol className={styles.Form}>
              <GroupRow className={styles.FormHeaderRow}>
                <FieldDateTime label={translate("documentDate")} name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="200px" />
                <Field label={translate("documentNumber")} name={`${form.formUid}_number`} value={form.fields.number} onChange={e => form.setField("number", e.target.value)} disabled={form.isLoading} width="200px" maxLength={9}
                  actions={[
                    { type: "assignNumber", onClick: () => void assignNumber(MODEL_ENDPOINT, form.fields.organizationUuid, form.fields.number, (n) => form.setField("number", n), form.fields.date, form.fields.uuid) },
                  ]} />
                <FieldPeriod label={translate("periodYYYYMM")} name={`${form.formUid}_period`} value={form.fields.period} onChange={e => form.setField("period", e.target.value)} disabled={form.isLoading} />
              </GroupRow>
              <Group>
                <FormLookup form={form} field="organization" endpoint="organizations" />
                <FormLookup form={form} field="employee" endpoint="employees" displayField="fullName" extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
              </Group>
              <GroupRow>
                <Group className={styles.w1of2}>
                  <FieldNumber label={translate("paymentAmount")} name={`${form.formUid}_amount`} value={form.fields.amount} onChange={e => form.setField("amount", e.target.value)} disabled={form.isLoading} width="180px" decimals={2} />
                </Group>
                <Group className={styles.w1of2}>
                  <FieldSelect label={translate("paymentMethod")} name={`${form.formUid}_paymentMethod`} value={form.fields.paymentMethod} options={PAYMENT_METHOD_OPTIONS} onChange={e => form.setField("paymentMethod", e.target.value)} disabled={form.isLoading} />
                </Group>
              </GroupRow>
            </GroupCol>
            <GroupCol className={styles.FormNotice}>
              <Notice items={notices} />
            </GroupCol>
          </div>
          <GroupRow>
            <Field label={translate("Comment")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} />
            <Field label={translate("Author")} name={`${form.formUid}_author`} value={form.fields.authorName || ""} disabled width="auto" />
          </GroupRow>
        </div>
      )
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, assignNumber, canWrite, notices]);

  const isSavedDoc = form.isEditMode && !!form.fields.uuid;
  const headerActionsPortal = usePaneHeaderActions(
    form.paneId,
    (
      <>
        <HeaderTogglePosted name={`${form.formUid}_posted`} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} />
        {isSavedDoc && <DocumentEntriesButton documentType="payroll_payment" documentUuid={form.fields.uuid} />}
      </>
    ),
  );

  return (
    <FormRequiredScope docType="payroll_payment" active>
      <FormDirtyScope dirtyKeys={form.unsavedFields}>
        <ModelForm paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={form.fields.uuid} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
          onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
          readonly={!canWrite} />
        {headerActionsPortal}
      </FormDirtyScope>
    </FormRequiredScope>
  );
};
PayrollPaymentsForm.displayName = "PayrollPaymentsForm";

const PayrollPaymentsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={PayrollPaymentsForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(String(d.date)) : ""} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
PayrollPaymentsList.displayName = "PayrollPaymentsList";

export { PayrollPaymentsList, PayrollPaymentsForm };
