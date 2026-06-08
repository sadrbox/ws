import { FC, useMemo, useCallback } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDateTime, FieldPeriod, Divider } from "src/components/Field";
import FieldTogglePostedDocument from "src/components/Field/FieldTogglePostedDocument";
import LookupField from "src/components/Field/LookupField";
import { GroupRow, Group, GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useFormStore } from "src/hooks/useFormStore";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import DocumentEntriesButton from "src/components/AccountingEntries/DocumentEntriesButton";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly, isoToLocalInput, localInputToIso } from "src/utils/datetime";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { validateDocumentFields, formatValidationErrors } from "src/utils/validatePostedDocument";
import { FormRequiredScope, FormDirtyScope } from "src/hooks/useFormRequired";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";

const MODEL_ENDPOINT = "payroll-calculations";
const LIST_NAME = "PayrollCalculationsList";
const FORM_LABEL = "Начисление заработной платы";

interface TFields {
  id?: number; uuid?: string;
  date: string; comment: string;
  period: string;
  employeeUuid: string; employeeName: string;
  organizationUuid: string; organizationName: string;
  positionUuid: string; positionName: string;
  baseSalary: string;
  opv: string; ipn: string; socialContrib: string; socialTax: string;
  vosms: string; oosms: string;
  netSalary: string; totalExpense: string;
  posted: boolean;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  date: "", comment: "",
  period: "",
  employeeUuid: "", employeeName: "",
  organizationUuid: "", organizationName: "",
  positionUuid: "", positionName: "",
  baseSalary: "", opv: "", ipn: "", socialContrib: "", socialTax: "",
  vosms: "", oosms: "",
  netSalary: "", totalExpense: "",
  posted: false,
  authorUuid: "", authorName: "",
};

/**
 * Расчёт удержаний и начислений по Налоговому кодексу РК:
 * - ОПВ (обязательные пенсионные взносы) = 10% от оклада (удержание с работника)
 * - ИПН (индивидуальный подоходный налог) = 10% от (оклад - ОПВ - ВОСМС - 14 МРП вычет)
 * - СО (социальные отчисления) = 3.5% от (оклад - ОПВ) (за счёт работодателя)
 * - Социальный налог = 9.5% от (оклад - ОПВ) - СО (за счёт работодателя)
 * - ВОСМС (взносы ОСМС) = 2% от оклада (удержание с работника)
 * - ООСМС (отчисления ОСМС) = 3% от оклада (за счёт работодателя)
 */
function calcDeductions(baseSalary: number) {
  const MRP = 3932; // МРП на 2025 год
  const opv = Math.round(baseSalary * 0.10 * 100) / 100;
  const vosms = Math.round(baseSalary * 0.02 * 100) / 100;
  const taxBase = Math.max(baseSalary - opv - vosms - (14 * MRP), 0);
  const ipn = Math.round(taxBase * 0.10 * 100) / 100;
  const soBase = Math.max(baseSalary - opv, 0);
  const socialContrib = Math.round(soBase * 0.035 * 100) / 100;
  const socialTax = Math.max(Math.round(soBase * 0.095 * 100) / 100 - socialContrib, 0);
  const oosms = Math.round(baseSalary * 0.03 * 100) / 100;
  const netSalary = Math.round((baseSalary - opv - ipn - vosms) * 100) / 100;
  const totalExpense = Math.round((baseSalary + socialContrib + socialTax + oosms) * 100) / 100;
  return { opv, ipn, socialContrib, socialTax, vosms, oosms, netSalary, totalExpense };
}

const PayrollCalculationsForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useUserAccessRight("PayrollCalculation");

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
    endpoint: MODEL_ENDPOINT, storageKey: "payroll-calculations-form", defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      date: isoToLocalInput(d.date),
      comment: d.comment ?? "", period: d.period ?? "",
      employeeUuid: d.employeeUuid ?? "",
      employeeName: d.employee?.fullName ?? "",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.name ?? "",
      positionUuid: d.positionUuid ?? "",
      positionName: d.position?.name ?? "",
      baseSalary: d.baseSalary != null ? String(d.baseSalary) : "",
      opv: d.opv != null ? String(d.opv) : "",
      ipn: d.ipn != null ? String(d.ipn) : "",
      socialContrib: d.socialContrib != null ? String(d.socialContrib) : "",
      socialTax: d.socialTax != null ? String(d.socialTax) : "",
      vosms: d.vosms != null ? String(d.vosms) : "",
      oosms: d.oosms != null ? String(d.oosms) : "",
      netSalary: d.netSalary != null ? String(d.netSalary) : "",
      totalExpense: d.totalExpense != null ? String(d.totalExpense) : "",
      posted: d.posted === true,
      authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
      authorName: d.author?.username ?? d.author?.email ?? "",
    }),
    buildPayload: (fd) => {
      const validation = validateDocumentFields("payroll_calculation", fd as unknown as Record<string, unknown>);
      if (!validation.isValid) return formatValidationErrors(validation.errors);
      return {
        date: localInputToIso(fd.date),
        comment: fd.comment?.trim() || null, period: fd.period?.trim() || null,
        employeeUuid: fd.employeeUuid || null, organizationUuid: fd.organizationUuid || null,
        positionUuid: fd.positionUuid || null,
        baseSalary: fd.baseSalary ? parseFloat(fd.baseSalary) : 0,
        opv: fd.opv ? parseFloat(fd.opv) : 0,
        ipn: fd.ipn ? parseFloat(fd.ipn) : 0,
        socialContrib: fd.socialContrib ? parseFloat(fd.socialContrib) : 0,
        socialTax: fd.socialTax ? parseFloat(fd.socialTax) : 0,
        vosms: fd.vosms ? parseFloat(fd.vosms) : 0,
        oosms: fd.oosms ? parseFloat(fd.oosms) : 0,
        netSalary: fd.netSalary ? parseFloat(fd.netSalary) : 0,
        totalExpense: fd.totalExpense ? parseFloat(fd.totalExpense) : 0,
        posted: fd.posted === true,
      };
    },
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved, "date"),
  });

  const handleSalaryChange = useCallback((value: string) => {
    const salary = parseFloat(value) || 0;
    const d = calcDeductions(salary);
    form.setFields({
      baseSalary: value,
      opv: String(d.opv), ipn: String(d.ipn),
      socialContrib: String(d.socialContrib), socialTax: String(d.socialTax),
      vosms: String(d.vosms), oosms: String(d.oosms),
      netSalary: String(d.netSalary), totalExpense: String(d.totalExpense),
    } as Partial<TFields>);
  }, [form.setFields]);

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <GroupRow className={styles.FormHeaderRow}>
                <FieldDateTime label={translate("documentDate")} name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="200px" />
                <FieldPeriod label={translate("periodYYYYMM")} name={`${form.formUid}_period`} value={form.fields.period} onChange={e => form.setField("period", e.target.value)} disabled={form.isLoading} />
                <FieldTogglePostedDocument name={`${form.formUid}_posted`} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} />
              </GroupRow>
              <Group>
                <LookupField label={translate("organization")} name={`${form.formUid}_organizationUuid`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="name" onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TFields>)} onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)} disabled={form.isLoading} />
                <LookupField label={translate("employee")} name={`${form.formUid}_employeeUuid`} value={form.fields.employeeUuid} displayValue={form.fields.employeeName} endpoint="employees" displayField="fullName" onSelect={(u, d) => form.setFields({ employeeUuid: u, employeeName: d } as Partial<TFields>)} onClear={() => form.setFields({ employeeUuid: "", employeeName: "" } as Partial<TFields>)} disabled={form.isLoading} extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
              </Group>
              <Group>
                <LookupField label={translate("position.name")} name={`${form.formUid}_positionUuid`} value={form.fields.positionUuid} displayValue={form.fields.positionName} endpoint="positions" displayField="name" onSelect={(u, d) => form.setFields({ positionUuid: u, positionName: d } as Partial<TFields>)} onClear={() => form.setFields({ positionUuid: "", positionName: "" } as Partial<TFields>)} disabled={form.isLoading} />
              </Group>
              <Divider />
              <h3 className={styles.FormSectionTitle}>{translate("payrollCalcTitle")}</h3>
              <GroupRow>
                <Field label={translate("baseSalaryCharged")} name={`${form.formUid}_baseSalary`} value={form.fields.baseSalary} onChange={e => handleSalaryChange(e.target.value)} disabled={form.isLoading} width="160px" />
                <Field label={translate("opv")} name={`${form.formUid}_opv`} value={form.fields.opv} disabled width="130px" />
                <Field label={translate("vosms")} name={`${form.formUid}_vosms`} value={form.fields.vosms} disabled width="130px" />
                <Field label={translate("ipn")} name={`${form.formUid}_ipn`} value={form.fields.ipn} disabled width="130px" />
              </GroupRow>
              <GroupRow>
                <Field label={translate("socialContrib")} name={`${form.formUid}_socialContrib`} value={form.fields.socialContrib} disabled width="130px" />
                <Field label={translate("socialTax")} name={`${form.formUid}_socialTax`} value={form.fields.socialTax} disabled width="160px" />
                <Field label={translate("oosms")} name={`${form.formUid}_oosms`} value={form.fields.oosms} disabled width="130px" />
              </GroupRow>
              <Divider />
              <GroupRow>
                <Field label={translate("netSalaryHands")} name={`${form.formUid}_netSalary`} value={form.fields.netSalary} disabled width="180px" />
                <Field label={translate("totalExpenseLabel")} name={`${form.formUid}_totalExpense`} value={form.fields.totalExpense} disabled width="180px" />
              </GroupRow>
            </GroupCol>

          </div>
          {form.isEditMode && <Group className={styles.FormFooterRow}>
            <Field label={translate("Comment")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} />
            <Field label={translate("Author")} name={`${form.formUid}_author`} value={form.fields.authorName || ""} disabled width="auto" />
          </Group>}
        </div>
      )
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleSalaryChange, canWrite]);

  const isSavedDoc = form.isEditMode && !!form.fields.uuid;
  const headerActionsPortal = usePaneHeaderActions(
    form.paneId,
    isSavedDoc ? <DocumentEntriesButton documentType="payroll_calculation" documentUuid={form.fields.uuid} /> : null,
  );

  return (
    <FormRequiredScope docType="payroll_calculation" active={form.meta.headerValidationFailed}>
      <FormDirtyScope dirtyKeys={form.unsavedFields}>
        <ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
          onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
          readonly={!canWrite} />
        {headerActionsPortal}
      </FormDirtyScope>
    </FormRequiredScope>
  );
};
PayrollCalculationsForm.displayName = "PayrollCalculationsForm";

const PayrollCalculationsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={PayrollCalculationsForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(String(d.date)) : ""} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
PayrollCalculationsList.displayName = "PayrollCalculationsList";

export { PayrollCalculationsList, PayrollCalculationsForm };
