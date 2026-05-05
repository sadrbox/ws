import { FC, useMemo, useCallback } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDate, FieldSelect, Divider } from "src/components/Field";
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

const MODEL_ENDPOINT = "payroll-calculations";
const LIST_NAME = "PayrollCalculationsList";
const FORM_LABEL = "Начисление ЗП";

const STATUS_OPTIONS = [
  { value: "draft", label: "Черновик" },
  { value: "approved", label: "Утверждён" },
  { value: "cancelled", label: "Отменён" },
];

interface TFields {
  id?: number; uuid?: string;
  documentNumber: string; date: string; description: string;
  period: string;
  employeeUuid: string; employeeName: string;
  organizationUuid: string; organizationName: string;
  positionUuid: string; positionName: string;
  baseSalary: string;
  opv: string; ipn: string; socialContrib: string; socialTax: string;
  vosms: string; oosms: string;
  netSalary: string; totalExpense: string;
  status: string;
}

const DEFAULT_FIELDS: TFields = {
  documentNumber: "", date: "", description: "",
  period: "",
  employeeUuid: "", employeeName: "",
  organizationUuid: "", organizationName: "",
  positionUuid: "", positionName: "",
  baseSalary: "", opv: "", ipn: "", socialContrib: "", socialTax: "",
  vosms: "", oosms: "",
  netSalary: "", totalExpense: "",
  status: "draft",
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
  const opv = Math.round(baseSalary * 0.10 * 100) / 100;              // ОПВ 10%
  const vosms = Math.round(baseSalary * 0.02 * 100) / 100;            // ВОСМС 2%
  const taxBase = Math.max(baseSalary - opv - vosms - (14 * MRP), 0); // Налогооблагаемый доход
  const ipn = Math.round(taxBase * 0.10 * 100) / 100;                 // ИПН 10%
  const soBase = Math.max(baseSalary - opv, 0);
  const socialContrib = Math.round(soBase * 0.035 * 100) / 100;       // СО 3.5%
  const socialTax = Math.max(Math.round(soBase * 0.095 * 100) / 100 - socialContrib, 0); // СН 9.5% - СО
  const oosms = Math.round(baseSalary * 0.03 * 100) / 100;           // ООСМС 3%
  const netSalary = Math.round((baseSalary - opv - ipn - vosms) * 100) / 100; // К выдаче
  const totalExpense = Math.round((baseSalary + socialContrib + socialTax + oosms) * 100) / 100; // Расход работодателя
  return { opv, ipn, socialContrib, socialTax, vosms, oosms, netSalary, totalExpense };
}

const PayrollCalculationsForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useAccessRight("PayrollCalculation");

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
    endpoint: MODEL_ENDPOINT, storageKey: "payroll-calculations-form", defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      documentNumber: d.documentNumber ?? "", date: d.date?.slice(0, 10) ?? "",
      description: d.description ?? "", period: d.period ?? "",
      employeeUuid: d.employeeUuid ?? "",
      employeeName: d.employee?.fullName ?? "",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.shortName ?? "",
      positionUuid: d.positionUuid ?? "",
      positionName: d.position?.shortName ?? "",
      baseSalary: d.baseSalary != null ? String(d.baseSalary) : "",
      opv: d.opv != null ? String(d.opv) : "",
      ipn: d.ipn != null ? String(d.ipn) : "",
      socialContrib: d.socialContrib != null ? String(d.socialContrib) : "",
      socialTax: d.socialTax != null ? String(d.socialTax) : "",
      vosms: d.vosms != null ? String(d.vosms) : "",
      oosms: d.oosms != null ? String(d.oosms) : "",
      netSalary: d.netSalary != null ? String(d.netSalary) : "",
      totalExpense: d.totalExpense != null ? String(d.totalExpense) : "",
      status: d.status ?? "draft",
    }),
    buildPayload: (fd) => ({
      documentNumber: fd.documentNumber?.trim() || null, date: fd.date || null,
      description: fd.description?.trim() || null, period: fd.period?.trim() || null,
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
      status: fd.status || "draft",
    }),
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved, "date"),
  });

  /** При изменении оклада — автоматический пересчёт всех удержаний */
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
    { id: "tab-details", label: translate("general"), component: (
      <div className={styles.FormWrapper}>
        <div className={styles.Form}>
          {form.isEditMode && (
            <GroupRow>
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
            <LookupField label="Должность" name={`${form.formUid}_pos`} value={form.fields.positionUuid} displayValue={form.fields.positionName} endpoint="positions" displayField="shortName" onSelect={(u, d) => form.setFields({ positionUuid: u, positionName: d } as Partial<TFields>)} onClear={() => form.setFields({ positionUuid: "", positionName: "" } as Partial<TFields>)} disabled={form.isLoading} width="300px" />

            <Divider />
            <h3 style={{ margin: 0, fontSize: 13, color: "#555" }}>Расчёт заработной платы (НК РК)</h3>
            <div style={{ display: "flex", flexDirection: "row", gap: "12px", flexWrap: "wrap" }}>
              <Field label="Оклад (начислено)" name={`${form.formUid}_salary`} value={form.fields.baseSalary} onChange={e => handleSalaryChange(e.target.value)} disabled={form.isLoading} width="160px" />
              <Field label="ОПВ (10%)" name={`${form.formUid}_opv`} value={form.fields.opv} disabled width="130px" />
              <Field label="ВОСМС (2%)" name={`${form.formUid}_vosms`} value={form.fields.vosms} disabled width="130px" />
              <Field label="ИПН (10%)" name={`${form.formUid}_ipn`} value={form.fields.ipn} disabled width="130px" />
            </div>
            <div style={{ display: "flex", flexDirection: "row", gap: "12px", flexWrap: "wrap" }}>
              <Field label="СО (3.5%)" name={`${form.formUid}_so`} value={form.fields.socialContrib} disabled width="130px" />
              <Field label="Соц. налог (9.5%−СО)" name={`${form.formUid}_sn`} value={form.fields.socialTax} disabled width="160px" />
              <Field label="ООСМС (3%)" name={`${form.formUid}_oosms`} value={form.fields.oosms} disabled width="130px" />
            </div>
            <Divider />
            <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
              <Field label="К выдаче (на руки)" name={`${form.formUid}_net`} value={form.fields.netSalary} disabled width="180px" />
              <Field label="Расход работодателя" name={`${form.formUid}_total`} value={form.fields.totalExpense} disabled width="180px" />
              <FieldSelect label="Статус" name={`${form.formUid}_status`} value={form.fields.status} options={STATUS_OPTIONS} onChange={e => form.setField("status", e.target.value)} disabled={form.isLoading} />
            </div>
            <Field label="Комментарий" name={`${form.formUid}_desc`} value={form.fields.description} onChange={e => form.setField("description", e.target.value)} disabled={form.isLoading} />
          </div>
        </Group>
        </div>
      </div>
    )},
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleSalaryChange]);

  return (
    <ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined} isLoading={form.isLoading}
      readonly={!canWrite} isDirty={form.isDirty} />
  );
};
PayrollCalculationsForm.displayName = "PayrollCalculationsForm";

const PayrollCalculationsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={PayrollCalculationsForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }} />
);
PayrollCalculationsList.displayName = "PayrollCalculationsList";

export { PayrollCalculationsList, PayrollCalculationsForm };
