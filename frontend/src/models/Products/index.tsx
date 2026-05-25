import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import LookupField from "src/components/Field/LookupField";
import { GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import { FormRequiredScope } from "src/hooks/useFormRequired";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "products";
const LIST_NAME = "ProductsList";

interface TFields { id?: number; uuid?: string; name: string; sku: string; barcode: string; isService: boolean; brandUuid: string; brandName: string; unitOfMeasureUuid: string; unitOfMeasureName: string; }
const DEFAULT_FIELDS: TFields = { name: "", sku: "", barcode: "", isService: false, brandUuid: "", brandName: "", unitOfMeasureUuid: "", unitOfMeasureName: "" };

const ProductsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("Product");
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "products-form", defaultFields: DEFAULT_FIELDS, paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      name: d.name ?? "", sku: d.sku ?? "", barcode: d.barcode ?? "",
      isService: d.isService === true,
      brandUuid: d.brandUuid ?? "", brandName: d.brand?.name ?? "",
      unitOfMeasureUuid: d.unitOfMeasureUuid ?? "", unitOfMeasureName: d.unitOfMeasure?.name ?? "",
    }),
    buildPayload: (fd) => {
      if (!fd.name?.trim()) return "Наименование обязательно";
      return { name: fd.name.trim(), sku: fd.sku?.trim() || null, barcode: fd.barcode?.trim() || null, isService: fd.isService === true, brandUuid: fd.brandUuid || null, unitOfMeasureUuid: fd.unitOfMeasureUuid || null };
    },
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, "Номенклатура", saved),
  });

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <Field label={translate("name")} name={`${form.formUid}_name`} minWidth="339px" value={form.fields.name} onChange={e => form.setField("name", e.target.value)} disabled={form.isLoading} />
              <Field label={translate("sku")} name={`${form.formUid}_sku`} minWidth="200px" value={form.fields.sku} onChange={e => form.setField("sku", e.target.value)} disabled={form.isLoading} />
              <Field label={translate("barcode")} name={`${form.formUid}_barcode`} minWidth="200px" value={form.fields.barcode} onChange={e => form.setField("barcode", e.target.value)} disabled={form.isLoading} />
              <FieldToggle label={translate("isService")} value={form.fields.isService} onChange={(v) => form.setField("isService", v)} disabled={form.isLoading} />
              <LookupField label={translate("brand")} name={`${form.formUid}_brand`} minWidth="339px" value={form.fields.brandUuid} displayValue={form.fields.brandName} endpoint="brands" displayField="name"
                columns={[{ key: "name", label: "Наименование" }]}
                onSelect={(uuid, display) => form.setFields({ brandUuid: uuid, brandName: display } as Partial<TFields>)}
                onClear={() => form.setFields({ brandUuid: "", brandName: "" } as Partial<TFields>)} disabled={form.isLoading} />
              <LookupField label={translate("unitOfMeasure")} name={`${form.formUid}_unitOfMeasure`} minWidth="200px" value={form.fields.unitOfMeasureUuid} displayValue={form.fields.unitOfMeasureName} endpoint="unit-of-measures" displayField="name"
                columns={[{ key: "name", label: "Наименование" }, { key: "code", label: "Код" }]}
                onSelect={(uuid, display) => form.setFields({ unitOfMeasureUuid: uuid, unitOfMeasureName: display } as Partial<TFields>)}
                onClear={() => form.setFields({ unitOfMeasureUuid: "", unitOfMeasureName: "" } as Partial<TFields>)} disabled={form.isLoading} />
            </GroupCol>
          </div>
        </div>
      )
    },
  ], [form.fields, form.isLoading, form.isEditMode, form.formUid, form.setField, form.setFields]);

  return (
    <FormRequiredScope requiredKeys={["name"]} active={form.meta.headerValidationFailed}>
      <ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
        onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
        readonly={!canWrite} />
    </FormRequiredScope>
  );
};
ProductsForm.displayName = "ProductsForm";

const ProductsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant, onSelectItem }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={ProductsForm}
    getLabel={(d) => d?.name as string || "?"} variant={variant} onSelectItem={onSelectItem} />
);
ProductsList.displayName = "ProductsList";
export { ProductsList, ProductsForm };
