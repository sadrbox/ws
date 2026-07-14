import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldNumber, FieldSelect } from "src/components/Field";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import Notice from "src/components/Notice";
import { useFormNotices } from "src/hooks/useFormNotices";

const MODEL_ENDPOINT = "taxes";
const LIST_NAME = "TaxesList";

interface TFields {
  id?: number;
  uuid?: string;
  name: string;
  code: string;
  rate: string;
  /** "INCLUDED" — налог в стоимости; "ADDED" — начисляется сверху. */
  calculationMethod: "INCLUDED" | "ADDED";
}
const DEFAULT_FIELDS: TFields = { name: "", code: "", rate: "", calculationMethod: "INCLUDED" };

const TaxesForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useUserAccessRight("Tax");
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "taxes-form",
    defaultFields: DEFAULT_FIELDS,
    paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      ...d,
      name: d.name ?? "",
      code: d.code ?? "",
      rate: d.rate !== undefined && d.rate !== null ? String(d.rate) : "",
      calculationMethod:
        String(d.calculationMethod ?? "INCLUDED").toUpperCase() === "ADDED"
          ? "ADDED"
          : "INCLUDED",
    }),
    buildPayload: (fd) => {
      if (!fd.name?.trim()) return "Наименование обязательно";
      let rateNum: number | null = null;
      if (fd.rate !== "" && fd.rate != null) {
        const n = parseFloat(fd.rate);
        if (isNaN(n) || n < 0) return "Ставка должна быть числом ≥ 0";
        rateNum = n;
      }
      return {
        name: fd.name.trim(),
        code: fd.code?.trim() || null,
        rate: rateNum,
        calculationMethod: fd.calculationMethod === "ADDED" ? "ADDED" : "INCLUDED",
      };
    },
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, "Налоги", saved),
  });

  // Ошибки ДАННЫХ формы → <Notice /> внутри формы (системные — в <UIToast />).
  const notices = useFormNotices(form);

  const tabs = useMemo(() => [
    {
      id: "tab-details",
      label: translate("general"),
      component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <Group>
                <Field label={translate("name")} name={`${form.formUid}_name`} minWidth="280px" value={form.fields.name} onChange={(e) => form.setField("name", e.target.value)} disabled={form.isLoading} />
              </Group>
              <GroupRow>
                <Group className={styles.w1of2}>
                  <Field label={translate("code")} name={`${form.formUid}_code`} minWidth="160px" value={form.fields.code} onChange={(e) => form.setField("code", e.target.value)} disabled={form.isLoading} />
                  <FieldNumber label={translate("rate")} name={`${form.formUid}_rate`} minWidth="150px" value={form.fields.rate} onChange={(e) => form.setField("rate", e.target.value)} disabled={form.isLoading} decimals={2} />
                </Group>
                <Group className={styles.w1of2}>
                  <FieldSelect label={translate("taxMethod")} name={`${form.formUid}_method`} value={form.fields.calculationMethod}
                    options={[{ value: "INCLUDED", label: "В сумме (в т.ч.)" }, { value: "ADDED", label: "Сверху (начисляется к стоимости)" }]}
                    onChange={(e) => form.setField("calculationMethod", e.target.value === "ADDED" ? "ADDED" : "INCLUDED")}
                    disabled={form.isLoading || !canWrite} style={{ minWidth: 240 }} />
                </Group>
              </GroupRow>
            </GroupCol>
          </div>
          <GroupCol className={styles.FormNotice}>
            <Notice items={notices} />
          </GroupCol>
        </div>
      ),
    },
  ], [form.fields, form.isLoading, form.isEditMode, form.formUid, form.setField, notices]);

  return (
    <ModelForm
      paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={form.fields.uuid}
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
TaxesForm.displayName = "TaxesForm";

const TaxesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({
  variant,
  onSelectItem,
}) => (
  <ModelList
    endpoint={MODEL_ENDPOINT}
    listName={LIST_NAME}
    columnsJson={columnsJson}
    FormComponent={TaxesForm}
    getLabel={(d) => (d?.name as string) || "?"}
    variant={variant}
    onSelectItem={onSelectItem}
  />
);
TaxesList.displayName = "TaxesList";

export { TaxesList, TaxesForm };
