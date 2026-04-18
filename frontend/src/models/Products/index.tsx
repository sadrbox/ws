import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Divider, Field } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import ModelFormWrapper from "src/components/ModelFormWrapper";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "products";
const LIST_NAME = "ProductsList";

interface TFields { id?: number; uuid?: string; shortName: string; sku: string; brandUuid: string; brandName: string; }
const DEFAULT_FIELDS: TFields = { shortName: "", sku: "", brandUuid: "", brandName: "" };

const ProductsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("Product");
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "products-form", defaultFields: DEFAULT_FIELDS, paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      shortName: d.shortName ?? "", sku: d.sku ?? "",
      brandUuid: d.brandUuid ?? "", brandName: d.brand?.shortName ?? "",
    }),
    buildPayload: (fd) => {
      if (!fd.shortName?.trim()) return "Наименование обязательно";
      return { shortName: fd.shortName.trim(), sku: fd.sku?.trim() || null, brandUuid: fd.brandUuid || null };
    },
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, "Номенклатура", saved),
  });

  const tabs = useMemo(() => [
    { id: "general", label: translate("general") || "Основное", component: (
      <div className={styles.FormBodyParts}>
        <Group align="row" gap="12px" className={styles.Form}><div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
          <Field label="Наименование *" name={`${form.formUid}_shortName`} minWidth="339px" value={form.fields.shortName} onChange={e => form.setField("shortName", e.target.value)} disabled={form.isLoading} />
          <Field label="Артикул" name={`${form.formUid}_sku`} minWidth="200px" value={form.fields.sku} onChange={e => form.setField("sku", e.target.value)} disabled={form.isLoading} />
          <LookupField label="Бренд" name={`${form.formUid}_brand`} minWidth="339px" value={form.fields.brandUuid} displayValue={form.fields.brandName} endpoint="brands" displayField="shortName"
            columns={[{ key: "shortName", label: "Наименование" }]}
            onSelect={(uuid, display) => form.setFields({ brandUuid: uuid, brandName: display } as Partial<TFields>)}
            onClear={() => form.setFields({ brandUuid: "", brandName: "" } as Partial<TFields>)} disabled={form.isLoading} />
        </div></Group>
        {form.isEditMode && <><Divider /><Group align="row" gap="12px" className={styles.Form}><div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
          <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
          <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
        </div></Group></>}
      </div>
    )},
  ], [form.fields, form.isLoading, form.isEditMode, form.formUid, form.setField, form.setFields]);

  return (
    <ModelFormWrapper paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined} isLoading={form.isLoading} showReload={form.isEditMode}
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
