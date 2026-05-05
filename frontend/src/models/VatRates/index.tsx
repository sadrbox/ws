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

const MODEL_ENDPOINT = "vat-rates";
const LIST_NAME = "VatRatesList";

interface TFields {
  id?: number;
  uuid?: string;
  shortName: string;
  rate: string;
  calculationMethod: "INCLUDED" | "ADDED";
}
const DEFAULT_FIELDS: TFields = { shortName: "", rate: "", calculationMethod: "INCLUDED" };

const VatRatesForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("VatRate");
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "vat-rates-form",
    defaultFields: DEFAULT_FIELDS,
    paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      ...d,
      shortName: d.shortName ?? "",
      rate: d.rate !== undefined && d.rate !== null ? String(d.rate) : "",
      calculationMethod: d.calculationMethod === "ADDED" ? "ADDED" : "INCLUDED",
    }),
    buildPayload: (fd) => {
      if (!fd.shortName?.trim()) return "Наименование обязательно";
      const rateNum = parseFloat(fd.rate);
      if (isNaN(rateNum) || rateNum < 0) return "Ставка НДС должна быть числом ≥ 0";
      return {
        shortName: fd.shortName.trim(),
        rate: rateNum,
        calculationMethod: fd.calculationMethod === "ADDED" ? "ADDED" : "INCLUDED",
      };
    },
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, "Ставки НДС", saved),
  });

  const tabs = useMemo(() => [
    {
      id: "general",
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
                label="Ставка, %"
                name={`${form.formUid}_rate`}
                minWidth="150px"
                value={form.fields.rate}
                onChange={(e) => form.setField("rate", e.target.value)}
                disabled={form.isLoading}
              />
              <FieldSelect
                label="Способ расчёта"
                name={`${form.formUid}_calcMethod`}
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
                disabled={form.isLoading}
                style={{ minWidth: 280 }}
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
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined}
      isLoading={form.isLoading}

      readonly={!canWrite}
      isDirty={form.isDirty}
    />
  );
};
VatRatesForm.displayName = "VatRatesForm";

const VatRatesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({
  variant,
  onSelectItem,
}) => (
  <ModelList
    endpoint={MODEL_ENDPOINT}
    listName={LIST_NAME}
    columnsJson={columnsJson}
    FormComponent={VatRatesForm}
    getLabel={(d) => (d?.shortName as string) || "?"}
    variant={variant}
    onSelectItem={onSelectItem}
    renderCell={(row, col) => {
      if (col.identifier === "calculationMethod") {
        const v = String(row.calculationMethod ?? "INCLUDED").toUpperCase();
        return (<span>{v === "ADDED" ? "Сверху" : "В сумме"}</span>);
      }
      return undefined;
    }}
  />
);
VatRatesList.displayName = "VatRatesList";

export { VatRatesList, VatRatesForm };
