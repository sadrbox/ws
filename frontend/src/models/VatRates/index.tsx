import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
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
}
const DEFAULT_FIELDS: TFields = { shortName: "", rate: "" };

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
    }),
    buildPayload: (fd) => {
      if (!fd.shortName?.trim()) return "Наименование обязательно";
      const rateNum = parseFloat(fd.rate);
      if (isNaN(rateNum) || rateNum < 0) return "Ставка НДС должна быть числом ≥ 0";
      return {
        shortName: fd.shortName.trim(),
        rate: rateNum,
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
            {form.isEditMode && (
                <GroupRow>
                    <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
                    <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
                </GroupRow>
            )}
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
  />
);
VatRatesList.displayName = "VatRatesList";

export { VatRatesList, VatRatesForm };
