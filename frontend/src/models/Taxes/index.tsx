import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldSelect } from "src/components/Field";
import { GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "taxes";
const LIST_NAME = "TaxesList";

interface TFields {
  id?: number;
  uuid?: string;
  shortName: string;
  code: string;
  rate: string;
  /** "INCLUDED" — налог в стоимости; "ADDED" — начисляется сверху. */
  calculationMethod: "INCLUDED" | "ADDED";
}
const DEFAULT_FIELDS: TFields = { shortName: "", code: "", rate: "", calculationMethod: "INCLUDED" };

const TaxesForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("Tax");
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "taxes-form",
    defaultFields: DEFAULT_FIELDS,
    paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      ...d,
      shortName: d.shortName ?? "",
      code: d.code ?? "",
      rate: d.rate !== undefined && d.rate !== null ? String(d.rate) : "",
      calculationMethod:
        String(d.calculationMethod ?? "INCLUDED").toUpperCase() === "ADDED"
          ? "ADDED"
          : "INCLUDED",
    }),
    buildPayload: (fd) => {
      if (!fd.shortName?.trim()) return "Наименование обязательно";
      let rateNum: number | null = null;
      if (fd.rate !== "" && fd.rate != null) {
        const n = parseFloat(fd.rate);
        if (isNaN(n) || n < 0) return "Ставка должна быть числом ≥ 0";
        rateNum = n;
      }
      return {
        shortName: fd.shortName.trim(),
        code: fd.code?.trim() || null,
        rate: rateNum,
        calculationMethod: fd.calculationMethod === "ADDED" ? "ADDED" : "INCLUDED",
      };
    },
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, "Налоги", saved),
  });

  const tabs = useMemo(() => [
    {
      id: "tab-details",
      label: translate("general"),
      component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupRow>
              <Field
                label="Наименование *"
                name={`${form.formUid}_shortName`}
                minWidth="280px"
                value={form.fields.shortName}
                onChange={(e) => form.setField("shortName", e.target.value)}
                disabled={form.isLoading}
              />
              <Field
                label="Код"
                name={`${form.formUid}_code`}
                minWidth="160px"
                value={form.fields.code}
                onChange={(e) => form.setField("code", e.target.value)}
                disabled={form.isLoading}
              />
              <Field
                label="Ставка, %"
                name={`${form.formUid}_rate`}
                minWidth="150px"
                value={form.fields.rate}
                onChange={(e) => form.setField("rate", e.target.value)}
                disabled={form.isLoading}
              />
              <FieldSelect
                label="Способ расчёта налога"
                name={`${form.formUid}_method`}
                value={form.fields.calculationMethod}
                options={[
                  { value: "INCLUDED", label: "В сумме (в т.ч.)" },
                  { value: "ADDED", label: "Сверху (начисляется к стоимости)" },
                ]}
                onChange={(e) =>
                  form.setField(
                    "calculationMethod",
                    e.target.value === "ADDED" ? "ADDED" : "INCLUDED",
                  )
                }
                disabled={form.isLoading || !canWrite}
                style={{ minWidth: 240 }}
              />
            </GroupRow>
          </div>
        </div>
      ),
    },
  ], [form.fields, form.isLoading, form.isEditMode, form.formUid, form.setField]);

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
    getLabel={(d) => (d?.shortName as string) || "?"}
    variant={variant}
    onSelectItem={onSelectItem}
  />
);
TaxesList.displayName = "TaxesList";

export { TaxesList, TaxesForm };
