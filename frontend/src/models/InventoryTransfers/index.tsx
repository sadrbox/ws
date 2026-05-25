/* eslint-disable @typescript-eslint/no-explicit-any */
// ─────────────────────────────────────────────────────────────────────────────
// InventoryTransfersForm — Перемещение ТМЗ.
// НК РК ст. 372 п.2 пп.3: внутреннее перемещение ТМЗ между складами одной
// организации НЕ является облагаемым оборотом, поэтому в строках нет НДС/
// акциза/скидки — таблица использует TradeDocumentItemsTable hasTaxes=false.
// ─────────────────────────────────────────────────────────────────────────────
import { FC, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDate } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly } from "src/utils/main.module";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import TradeDocumentItemsTable from "src/components/DocumentItemsTable/TradeDocumentItemsTable";
import { validateDocumentFields, formatValidationErrors } from "src/utils/validatePostedDocument";
import { FormRequiredScope, FormDirtyScope } from "src/hooks/useFormRequired";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";

const MODEL_ENDPOINT = "inventory-transfers";
const LIST_NAME = "InventoryTransfersList";
const FORM_LABEL = "Перемещение ТМЗ";

interface TFields {
  id?: number; uuid?: string;
  date: string; comment: string;
  amount: number; posted: boolean;
  fromWarehouseUuid: string; fromWarehouseName: string;
  toWarehouseUuid: string; toWarehouseName: string;
  organizationUuid: string; organizationName: string;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  date: "", comment: "",
  amount: 0, posted: false,
  fromWarehouseUuid: "", fromWarehouseName: "",
  toWarehouseUuid: "", toWarehouseName: "",
  organizationUuid: "", organizationName: "",
  authorUuid: "", authorName: "",
};

const InventoryTransfersForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const queryClient = useQueryClient();
  const { canWrite } = useAccessRight("InventoryTransfer");

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data;
    if (data?.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    init.date = new Date().toISOString().slice(0, 10);
    if (data?.organizationUuid) { init.organizationUuid = data?.organizationUuid as string; }
    else if (defaultOrg.organizationUuid) { init.organizationUuid = defaultOrg.organizationUuid; init.organizationName = defaultOrg.organizationName; }
    return init;
  })();

  const invalidateSubTables = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["inventorytransferitems"], refetchType: "active" });
  }, [queryClient]);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "inventory-transfers-form",
    defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
    derivedFields: ["amount"],
    tables: {
      items: {
        endpoint: "inventorytransferitems", parentField: "inventoryTransferUuid",
        label: "Товары перемещения",
        requiredItemFields: ["productUuid", "unitOfMeasureUuid", "quantity"],
        requiredItemFieldLabels: { productUuid: "Номенклатура", unitOfMeasureUuid: "Ед. изм.", quantity: "Количество" },
        createPayload: (r: any) => ({
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          price: r.price ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
        }),
        updatePayload: (r: any) => ({
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          price: r.price ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
        }),
        extraSkipFields: ["inventoryTransferUuid"],
      },
    },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      date: d.date?.slice(0, 10) ?? "",
      comment: d.comment ?? "",
      amount: d.amount != null ? Number(d.amount) : 0,
      posted: d.posted === true,
      fromWarehouseUuid: d.fromWarehouseUuid ?? "",
      fromWarehouseName: d.fromWarehouse?.name ?? "",
      toWarehouseUuid: d.toWarehouseUuid ?? "",
      toWarehouseName: d.toWarehouse?.name ?? "",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.name ?? "",
      authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
      authorName: d.author?.username ?? d.author?.email ?? "",
    }),
    buildPayload: (fd) => {
      const validation = validateDocumentFields("inventory_transfer", fd as unknown as Record<string, unknown>);
      if (!validation.isValid) return formatValidationErrors(validation.errors);
      return {
        date: fd.date || null,
        comment: fd.comment?.trim() || null,
        amount: fd.amount ? fd.amount : null,
        posted: fd.posted === true,
        fromWarehouseUuid: fd.fromWarehouseUuid || null,
        toWarehouseUuid: fd.toWarehouseUuid || null,
        organizationUuid: fd.organizationUuid || null,
      };
    },
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved, "date"),
    afterLoad: invalidateSubTables,
    afterSave: invalidateSubTables,
  });

  const items = form.useTable("items");

  const handleTotalChange = useCallback((total: number) => {
    form.setField("amount", Number(total));
  }, [form.setField]);

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <GroupRow style={{ width: "100%", justifyContent: "space-between" }}>
                <FieldDate label={translate("date")} name={`${form.formUid}_date`} width="160px" value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} />
                <FieldToggle name={`${form.formUid}_posted`} label={translate("posted")} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} variant="success" />
              </GroupRow>
              <Group>
                <LookupField label={translate("organization")} name={`${form.formUid}_organizationUuid`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="name"
                  onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TFields>)}
                  onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)}
                  disabled={form.isLoading} />
              </Group>
              <Group>
                <LookupField label={translate("fromWarehouse")} name={`${form.formUid}_fromWarehouseUuid`} value={form.fields.fromWarehouseUuid} displayValue={form.fields.fromWarehouseName} endpoint="warehouses" displayField="name"
                  onSelect={(u, d) => form.setFields({ fromWarehouseUuid: u, fromWarehouseName: d } as Partial<TFields>)}
                  onClear={() => form.setFields({ fromWarehouseUuid: "", fromWarehouseName: "" } as Partial<TFields>)}
                  disabled={form.isLoading}
                  extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
                <LookupField label={translate("toWarehouse")} name={`${form.formUid}_toWarehouseUuid`} value={form.fields.toWarehouseUuid} displayValue={form.fields.toWarehouseName} endpoint="warehouses" displayField="name"
                  onSelect={(u, d) => form.setFields({ toWarehouseUuid: u, toWarehouseName: d } as Partial<TFields>)}
                  onClear={() => form.setFields({ toWarehouseUuid: "", toWarehouseName: "" } as Partial<TFields>)}
                  disabled={form.isLoading}
                  extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
              </Group>
            </GroupCol>
            <Group>
              <div style={{ background: "#f8f9fa", border: "1px solid #e5e7eb", borderRadius: 6, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 5, fontSize: 13, maxWidth: '200px' }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: 600, fontSize: 14 }}>
                  <span>{translate("total")}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{form.fields.amount || "0"}</span>
                </div>
                <div style={{ color: "#9ca3af", fontSize: 11 }}>
                  НК РК ст. 372 п.2 пп.3: внутреннее перемещение — не облагаемый оборот
                </div>
              </div>
            </Group>
          </div>
          {form.isEditMode && <Group align="row" style={{ flex: 1, alignItems: "end", justifyContent: "end", gap: 6 }}>
            <Field label={translate("Comment")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} />
            <Field label={translate("Author")} name={`${form.formUid}_author`} value={form.fields.authorName || ""} disabled width="auto" />
          </Group>}
        </div>
      )
    },
    {
      id: "tab-items", label: translate("tabTMZ"), component: form.isEditMode && form.fields.uuid ? (
        <TradeDocumentItemsTable
          parentUuid={form.fields.uuid} parentField="inventoryTransferUuid"
          endpoint="inventorytransferitems" componentName="InventoryTransferItemsList_part"
          hasTaxes={false}
          organizationUuid={form.fields.organizationUuid} documentDate={form.fields.date || null}
          disabled={form.isLoading} deferRemoteChanges
          parentLabel={`${translate("InventoryTransfersList")}: ID ${form.fields.id ?? "?"}${form.fields.date ? " · " + getFormatDateOnly(String(form.fields.date)) : ""}`}
          initialPendingRows={items.pending}
          onTotalChange={handleTotalChange}
          onItemsChange={items.onItemsChange}
          showRequiredHighlight={form.meta.tablesValidationFailed}
        />
      ) : (
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", color: "#999", fontSize: 14, padding: "24px 0" }}>
          {translate("saveDocumentFirst")}
        </div>
      )
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleTotalChange, canWrite, items]);

  return (
    <FormRequiredScope docType="inventory_transfer" active={form.meta.headerValidationFailed}>
      <FormDirtyScope dirtyKeys={form.unsavedFields}>
        <ModelForm paneId={form.paneId} tabs={tabs}
          onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
          onReload={form.isEditMode ? form.handleReload : undefined}
          isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
          readonly={!canWrite} />
      </FormDirtyScope>
    </FormRequiredScope>
  );
};
InventoryTransfersForm.displayName = "InventoryTransfersForm";

const InventoryTransfersList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={InventoryTransfersForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(String(d.date)) : ""} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }}
    renderCell={renderPostedCell}
  />
);
InventoryTransfersList.displayName = LIST_NAME;

export { InventoryTransfersList, InventoryTransfersForm };
