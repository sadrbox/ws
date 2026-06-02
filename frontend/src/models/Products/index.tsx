import { FC, useMemo, useCallback } from "react";
import { translate } from "src/i18";
import type { TDataItem, TColumn } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import barcodeColumns from "./barcodeColumns.json";
import { Field } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import { FormRequiredScope } from "src/hooks/useFormRequired";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import SubTable, { type SubTableContext, type TCellValidator } from "src/components/SubTable";
import { invalidateSubTableFor } from "src/utils/invalidateSubTableFor";
import { useQueryClient } from "@tanstack/react-query";

const MODEL_ENDPOINT = "products";
const LIST_NAME = "ProductsList";

interface TFields { id?: number; uuid?: string; name: string; sku: string; barcode: string; isService: boolean; brandUuid: string; brandName: string; unitOfMeasureUuid: string; unitOfMeasureName: string; }
const DEFAULT_FIELDS: TFields = { name: "", sku: "", barcode: "", isService: false, brandUuid: "", brandName: "", unitOfMeasureUuid: "", unitOfMeasureName: "" };

const ProductsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("Product");
  const queryClient = useQueryClient();
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "products-form", defaultFields: DEFAULT_FIELDS, paneProps,
    tables: {
      barcodes: {
        endpoint: "productbarcodes", parentField: "productUuid",
        label: translate("barcodes"),
        batchEndpoint: "productbarcodes/batch",
        createPayload: (r: any) => ({ barcode: r.barcode ?? "", comment: r.comment ?? null }),
        updatePayload: (r: any) => ({ barcode: r.barcode ?? "", comment: r.comment ?? null }),
      },
    },
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
    afterSave: async (saved) => {
      const uuid = saved?.uuid ?? form.fields.uuid;
      if (uuid) await invalidateSubTableFor(queryClient, "productbarcodes", "productUuid", uuid);
    },
  });

  const barcodes = form.useTable("barcodes");

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <Field label={translate("name")} name={`${form.formUid}_name`} minWidth="339px" value={form.fields.name} onChange={e => form.setField("name", e.target.value)} disabled={form.isLoading} />
              <GroupRow>
                <Field label={translate("sku")} name={`${form.formUid}_sku`} minWidth="200px" value={form.fields.sku} onChange={e => form.setField("sku", e.target.value)} disabled={form.isLoading} />
                <LookupField label={translate("brand")} name={`${form.formUid}_brand`} minWidth="339px" value={form.fields.brandUuid} displayValue={form.fields.brandName} endpoint="brands" displayField="name"
                  columns={[{ key: "name", label: "Наименование" }]}
                  onSelect={(uuid, display) => form.setFields({ brandUuid: uuid, brandName: display } as Partial<TFields>)}
                  onClear={() => form.setFields({ brandUuid: "", brandName: "" } as Partial<TFields>)} disabled={form.isLoading} />
              </GroupRow>

              <LookupField label={translate("unitOfMeasure")} name={`${form.formUid}_unitOfMeasure`} minWidth="200px" value={form.fields.unitOfMeasureUuid} displayValue={form.fields.unitOfMeasureName} endpoint="unit-of-measures" displayField="name"
                columns={[{ key: "name", label: "Наименование" }, { key: "code", label: "Код" }]}
                onSelect={(uuid, display) => form.setFields({ unitOfMeasureUuid: uuid, unitOfMeasureName: display } as Partial<TFields>)}
                onClear={() => form.setFields({ unitOfMeasureUuid: "", unitOfMeasureName: "" } as Partial<TFields>)} disabled={form.isLoading} />
              <FieldToggle label={translate("isService")} value={form.fields.isService} onChange={(v) => form.setField("isService", v)} disabled={form.isLoading} />
            </GroupCol>
          </div>
        </div>
      )
    },
    {
      id: "tab-barcodes", label: translate("barcodes"), component: (
        <ProductBarcodesTable
          productUuid={form.fields.uuid ?? ""}
          disabled={form.isLoading || !canWrite}
          deferRemoteChanges
          initialPendingRows={barcodes.pending}
          onItemsChange={barcodes.onItemsChange}
        />
      )
    },
  ], [form.fields, form.isLoading, form.isEditMode, form.formUid, form.setField, form.setFields, barcodes.pending, barcodes.onItemsChange, canWrite]);

  return (
    <FormRequiredScope requiredKeys={["name"]} active={form.meta.headerValidationFailed}>
      <ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
        onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
        readonly={!canWrite} />
    </FormRequiredScope>
  );
};
ProductsForm.displayName = "ProductsForm";

// ═══════════════════════════════════════════════════════════════════════════
// Штрих-коды номенклатуры — SubTable (один товар → много штрих-кодов)
// ═══════════════════════════════════════════════════════════════════════════

const PB_MODEL = "productbarcodes";
const PB_COMPONENT = "ProductBarcodesList_part";

interface ProductBarcodesTableProps {
  productUuid: string;
  disabled?: boolean;
  deferRemoteChanges?: boolean;
  onItemsChange?: (items: TDataItem[]) => void;
  initialPendingRows?: TDataItem[];
}

const ProductBarcodesTable: FC<ProductBarcodesTableProps> = ({
  productUuid, disabled = false, deferRemoteChanges = false, onItemsChange, initialPendingRows,
}) => {
  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "barcode") {
      if (ctx.inlineEditing) return <Field label="" name={`pb_barcode_${row.id}`} value={(row.barcode as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "barcode", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.barcode as string) ?? ""}</span>;
    }
    if (col.identifier === "comment") {
      if (ctx.inlineEditing) return <Field label="" name={`pb_comment_${row.id}`} value={(row.comment as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "comment", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.comment as string) ?? ""}</span>;
    }
    return undefined;
  }, []);

  const validationRules = useMemo<Record<string, TCellValidator>>(() => ({
    barcode: (value) => (!value || String(value).trim() === "" ? "Штрих-код обязателен" : undefined),
  }), []);

  const defaultNewRow = useMemo(() => ({ barcode: "", comment: null }), []);

  return (
    <SubTable
      model={PB_MODEL}
      componentName={PB_COMPONENT}
      columnsJson={barcodeColumns}
      parentKey="productUuid"
      parentUuid={productUuid}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      emptyMessage={translate("saveToBarcodes")}
      renderCell={renderCell}
      validationRules={validationRules}
      defaultNewRow={defaultNewRow}
      onItemsChange={onItemsChange}
    />
  );
};
ProductBarcodesTable.displayName = "ProductBarcodesTable";

const ProductsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant, onSelectItem }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={ProductsForm}
    getLabel={(d) => d?.name as string || "?"} variant={variant} onSelectItem={onSelectItem} />
);
ProductsList.displayName = "ProductsList";
export { ProductsList, ProductsForm, ProductBarcodesTable };
