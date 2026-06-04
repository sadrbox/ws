/**
 * Документ «Установка цен номенклатуры» (периодический): шапка + табличная часть
 * с тремя ценами (продажи / закупки / оптовая). На проведении бэкенд
 * денормализует цены в Product (см. services/productPricing.js).
 */
import { FC, useMemo, useCallback } from "react";
import { translate } from "src/i18";
import type { TDataItem, TColumn } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import itemColumns from "./itemColumns.json";
import { Field, FieldNumber, FieldDateTime } from "src/components/Field";
import FieldTogglePostedDocument from "src/components/Field/FieldTogglePostedDocument";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { isoToLocalInput, localInputToIso } from "src/utils/datetime";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { invalidateSubTableFor } from "src/utils/invalidateSubTableFor";
import { useQueryClient } from "@tanstack/react-query";

const ENDPOINT = "product-price-settings";
const LIST_NAME = "ProductPriceSettingsList";
const FORM_LABEL = "Установка цен номенклатуры";

interface TFields {
  id?: number; uuid?: string;
  number: string; date: string; comment: string; posted: boolean;
  organizationUuid: string; organizationName: string;
}
const DEFAULT_FIELDS: TFields = { number: "", date: "", comment: "", posted: false, organizationUuid: "", organizationName: "" };

const ProductPriceSettingsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("Product");
  const queryClient = useQueryClient();

  const form = useFormStore<TFields>({
    endpoint: ENDPOINT, storageKey: "price-settings-form", defaultFields: DEFAULT_FIELDS, paneProps,
    tables: {
      items: {
        endpoint: "product-price-setting-items", parentField: "priceSettingUuid",
        label: translate("prices"),
        batchEndpoint: "product-price-setting-items/batch",
        createPayload: (r: any) => ({ productUuid: r.productUuid ?? null, salePrice: r.salePrice ?? null, purchasePrice: r.purchasePrice ?? null, wholesalePrice: r.wholesalePrice ?? null }),
        updatePayload: (r: any) => ({ productUuid: r.productUuid ?? null, salePrice: r.salePrice ?? null, purchasePrice: r.purchasePrice ?? null, wholesalePrice: r.wholesalePrice ?? null }),
      },
    },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      number: d.number ?? "",
      date: isoToLocalInput(d.date),
      comment: d.comment ?? "",
      posted: d.posted === true,
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.name ?? "",
    }),
    buildPayload: (fd) => ({
      number: fd.number?.trim() || null,
      date: localInputToIso(fd.date),
      comment: fd.comment?.trim() || null,
      posted: fd.posted === true,
      organizationUuid: fd.organizationUuid || null,
    }),
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved),
    afterSave: async (saved) => {
      const uuid = saved?.uuid ?? form.fields.uuid;
      if (uuid) await invalidateSubTableFor(queryClient, "product-price-setting-items", "priceSettingUuid", uuid);
    },
  });

  const items = form.useTable("items");

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <GroupRow>
                <Field label={translate("documentNumber")} name={`${form.formUid}_number`} value={form.fields.number} onChange={e => form.setField("number", e.target.value)} disabled={form.isLoading} width="150px" placeholder={translate("autoOnSave")} />
                <FieldDateTime label={translate("date")} name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="180px" />
                <FieldTogglePostedDocument name={`${form.formUid}_posted`} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} />
              </GroupRow>
              <GroupRow>
                <LookupField label={translate("organization")} name={`${form.formUid}_org`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="name"
                  onSelect={(uuid, display) => form.setFields({ organizationUuid: uuid, organizationName: display } as Partial<TFields>)}
                  onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)} disabled={form.isLoading} />
                <Field label={translate("comment")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} />
              </GroupRow>
            </GroupCol>
          </div>
        </div>
      )
    },
    {
      id: "tab-items", label: translate("prices"), component: (
        <PriceSettingItemsTable
          priceSettingUuid={form.fields.uuid ?? ""}
          disabled={form.isLoading || !canWrite}
          deferRemoteChanges
          initialPendingRows={items.pending}
          onItemsChange={items.onItemsChange}
        />
      )
    },
  ], [form.fields, form.isLoading, form.formUid, form.setField, form.setFields, items.pending, items.onItemsChange, canWrite]);

  return (
    <ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
      readonly={!canWrite} />
  );
};
ProductPriceSettingsForm.displayName = "ProductPriceSettingsForm";

// ── Табличная часть: товар + 3 цены ───────────────────────────────────────────
interface ItemsTableProps {
  priceSettingUuid: string;
  disabled?: boolean;
  deferRemoteChanges?: boolean;
  onItemsChange?: (items: TDataItem[]) => void;
  initialPendingRows?: TDataItem[];
}

const PriceSettingItemsTable: FC<ItemsTableProps> = ({ priceSettingUuid, disabled = false, deferRemoteChanges = false, onItemsChange, initialPendingRows }) => {
  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "product.name") {
      if (!ctx.inlineEditing) return <span>{(row.product as any)?.name ?? ""}</span>;
      return (
        <LookupField label="" name={`pps_product_${row.id}`}
          value={(row.productUuid as string) ?? ""} displayValue={(row.product as any)?.name ?? ""}
          endpoint="products" displayField="name"
          columns={[{ key: "name", label: "Наименование" }, { key: "sku", label: "Артикул" }]}
          onSelect={(uuid, _dv, item) => ctx.handleLookupChange(row, "productUuid", uuid, { product: item && uuid ? { uuid, name: item.name ?? "" } : null })}
          onClear={() => ctx.handleLookupChange(row, "productUuid", null, { product: null })}
          disabled={ctx.disabled} width="100%" variant="table" />
      );
    }
    if (col.identifier === "salePrice" || col.identifier === "purchasePrice" || col.identifier === "wholesalePrice") {
      const field = col.identifier;
      if (!ctx.inlineEditing) return <span>{row[field] != null ? String(row[field]) : ""}</span>;
      return <FieldNumber name={`pps_${field}_${row.id}`} value={row[field] != null ? String(row[field]) : ""} onChange={e => ctx.handleInlineChange(row, field, e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
    }
    return undefined;
  }, []);

  const defaultNewRow = useMemo(() => ({ productUuid: null, product: null, salePrice: null, purchasePrice: null, wholesalePrice: null }), []);

  return (
    <SubTable
      model="product-price-setting-items"
      componentName="ProductPriceSettingItemsList_part"
      columnsJson={itemColumns}
      parentKey="priceSettingUuid"
      parentUuid={priceSettingUuid}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      emptyMessage={translate("saveToAddItems")}
      renderCell={renderCell}
      defaultNewRow={defaultNewRow}
      onItemsChange={onItemsChange}
    />
  );
};
PriceSettingItemsTable.displayName = "PriceSettingItemsTable";

const ProductPriceSettingsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant, onSelectItem }) => (
  <ModelList endpoint={ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={ProductPriceSettingsForm}
    getLabel={(d) => (d?.number as string) || `#${d?.id ?? "?"}`} variant={variant} onSelectItem={onSelectItem} />
);
ProductPriceSettingsList.displayName = "ProductPriceSettingsList";
export { ProductPriceSettingsList, ProductPriceSettingsForm };
