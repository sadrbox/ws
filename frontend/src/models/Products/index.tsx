import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "products";
const LIST_NAME = "ProductsList";

interface TFields { id?: number; uuid?: string; shortName: string; sku: string; brandUuid: string; brandName: string; unitOfMeasureUuid: string; unitOfMeasureName: string; }
const DEFAULT_FIELDS: TFields = { shortName: "", sku: "", brandUuid: "", brandName: "", unitOfMeasureUuid: "", unitOfMeasureName: "" };

const ProductsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("Product");
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "products-form", defaultFields: DEFAULT_FIELDS, paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      shortName: d.shortName ?? "", sku: d.sku ?? "",
      brandUuid: d.brandUuid ?? "", brandName: d.brand?.shortName ?? "",
      unitOfMeasureUuid: d.unitOfMeasureUuid ?? "", unitOfMeasureName: d.unitOfMeasure?.shortName ?? "",
    }),
    buildPayload: (fd) => {
      if (!fd.shortName?.trim()) return "Наименование обязательно";
      return { shortName: fd.shortName.trim(), sku: fd.sku?.trim() || null, brandUuid: fd.brandUuid || null, unitOfMeasureUuid: fd.unitOfMeasureUuid || null };
    },
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, "Номенклатура", saved),
  });

  const tabs = useMemo(() => [
    { id: "general", label: translate("general"), component: (
      <div className={styles.FormWrapper}>
        <div className={styles.Form}>
          {form.isEditMode && (
            <GroupRow>
            </GroupRow>
          )}
          <GroupCol>
            <Field label="Наименование *" name={`${form.formUid}_shortName`} minWidth="339px" value={form.fields.shortName} onChange={e => form.setField("shortName", e.target.value)} disabled={form.isLoading} />
            <Field label="Артикул" name={`${form.formUid}_sku`} minWidth="200px" value={form.fields.sku} onChange={e => form.setField("sku", e.target.value)} disabled={form.isLoading} />
            <LookupField label="Бренд" name={`${form.formUid}_brand`} minWidth="339px" value={form.fields.brandUuid} displayValue={form.fields.brandName} endpoint="brands" displayField="shortName"
              columns={[{ key: "shortName", label: "Наименование" }]}
              onSelect={(uuid, display) => form.setFields({ brandUuid: uuid, brandName: display } as Partial<TFields>)}
              onClear={() => form.setFields({ brandUuid: "", brandName: "" } as Partial<TFields>)} disabled={form.isLoading} />
            <LookupField label="Ед. изм." name={`${form.formUid}_unitOfMeasure`} minWidth="200px" value={form.fields.unitOfMeasureUuid} displayValue={form.fields.unitOfMeasureName} endpoint="unit-of-measures" displayField="shortName"
              columns={[{ key: "shortName", label: "Наименование" }, { key: "code", label: "Код" }]}
              onSelect={(uuid, display) => form.setFields({ unitOfMeasureUuid: uuid, unitOfMeasureName: display } as Partial<TFields>)}
              onClear={() => form.setFields({ unitOfMeasureUuid: "", unitOfMeasureName: "" } as Partial<TFields>)} disabled={form.isLoading} />
          </GroupCol>
        </div>
      </div>
    )},
  ], [form.fields, form.isLoading, form.isEditMode, form.formUid, form.setField, form.setFields]);

  return (
    <ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined} isLoading={form.isLoading}
      readonly={!canWrite} isDirty={form.isDirty} />
  );
};
ProductsForm.displayName = "ProductsForm";

const ProductsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant, onSelectItem }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={ProductsForm}
    getLabel={(d) => d?.shortName as string || "?"} variant={variant} onSelectItem={onSelectItem} />
);
ProductsList.displayName = "ProductsList";
export { ProductsList, ProductsForm };
