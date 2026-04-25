import { FC, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDate, FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import SaleItemsTable from "./SaleItemsTable";
import { Group, GroupRow, GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly } from "src/utils/main.module";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "sales";
const LIST_NAME = "SalesList";
const FORM_LABEL = "Реализация";

const STATUS_OPTIONS = [
  { value: "draft", label: "Черновик" },
  { value: "approved", label: "Утверждён" },
  { value: "cancelled", label: "Отменён" },
];

interface TFields {
  id?: number; uuid?: string;
  documentNumber: string; date: string; description: string; amount: string; status: string; posted: boolean;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
  warehouseUuid: string; warehouseName: string;
  vatAmount: string; discountAmount: string; amountWithoutVat: string;
}

const DEFAULT_FIELDS: TFields = {
  documentNumber: "", date: "", description: "", amount: "", status: "draft", posted: false,
  organizationUuid: "", organizationName: "", counterpartyUuid: "", counterpartyName: "", contractUuid: "", contractName: "",
  warehouseUuid: "", warehouseName: "",
  vatAmount: "0", discountAmount: "0", amountWithoutVat: "0",
};

const SalesForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const queryClient = useQueryClient();
  const { canWrite } = useAccessRight("Sale");

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data;
    if (!data || data.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    if (data.organizationUuid) { init.organizationUuid = data.organizationUuid as string; }
    else if (defaultOrg.organizationUuid) { init.organizationUuid = defaultOrg.organizationUuid; init.organizationName = defaultOrg.organizationName; }
    if (data.counterpartyUuid) { init.counterpartyUuid = data.counterpartyUuid as string; }
    return init;
  })();

  const invalidateSubTables = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["saleitems"] });
  }, [queryClient]);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "sales-form", defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
    tables: {
      saleItems: {
        endpoint: "saleitems", parentField: "saleUuid",
        label: translate("SaleItemsList") || "Товары",
        createPayload: (r: any) => ({
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          price: r.price ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
          vatRateUuid: r.vatRateUuid ?? null,
          vatRate: r.vatRate ?? 0,
          discountPercent: r.discountPercent ?? 0,
        }),
        updatePayload: (r: any) => ({
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          price: r.price ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
          vatRateUuid: r.vatRateUuid ?? null,
          vatRate: r.vatRate ?? 0,
          discountPercent: r.discountPercent ?? 0,
        }),
        extraSkipFields: ["saleUuid"],
      },
    },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      documentNumber: d.documentNumber ?? "", date: d.date?.slice(0, 10) ?? "",
      description: d.description ?? "", amount: d.amount != null ? String(d.amount) : "",
      status: d.status ?? "draft", posted: d.posted === true,
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.shortName ?? "",
      counterpartyUuid: d.counterpartyUuid ?? "",
      counterpartyName: d.counterparty?.shortName ?? "",
      contractUuid: d.contractUuid ?? "",
      contractName: d.contract?.shortName ?? "",
      warehouseUuid: d.warehouseUuid ?? "",
      warehouseName: d.warehouse?.shortName ?? "",
      vatAmount: d.vatAmount != null ? String(d.vatAmount) : "0",
      discountAmount: d.discountAmount != null ? String(d.discountAmount) : "0",
      amountWithoutVat: d.amountWithoutVat != null ? String(d.amountWithoutVat) : "0",
    }),
    buildPayload: (fd) => ({
      documentNumber: fd.documentNumber?.trim() || null, date: fd.date || null,
      description: fd.description?.trim() || null, amount: fd.amount ? parseFloat(fd.amount) : null,
      status: fd.status || "draft", posted: fd.posted === true,
      organizationUuid: fd.organizationUuid || null,
      counterpartyUuid: fd.counterpartyUuid || null,
      contractUuid: fd.contractUuid || null,
      warehouseUuid: fd.warehouseUuid || null,
      vatAmount: fd.vatAmount ? parseFloat(fd.vatAmount) : 0,
      discountAmount: fd.discountAmount ? parseFloat(fd.discountAmount) : 0,
      amountWithoutVat: fd.amountWithoutVat ? parseFloat(fd.amountWithoutVat) : 0,
    }),
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved),
    afterLoad: invalidateSubTables,
    afterSave: async () => { setTimeout(invalidateSubTables, 0); },
  });

  const saleItems = form.useTable("saleItems");

  const handleTotalChange = useCallback((total: number, items?: any[]) => {
    form.setField("amount", String(total));
    if (items) {
      const vatSum = items.reduce((s, r) => s + (Number(r.vatAmount) || 0), 0);
      const discSum = items.reduce((s, r) => s + (Number(r.discountAmount) || 0), 0);
      const amtWithoutVat = Math.round((total - vatSum) * 100) / 100;
      form.setFields({
        vatAmount: String(Math.round(vatSum * 100) / 100),
        discountAmount: String(Math.round(discSum * 100) / 100),
        amountWithoutVat: String(amtWithoutVat),
      } as Partial<TFields>);
    }
  }, [form.setField, form.setFields]);

  /** extraParams для LookupField Договор:
   * - Организация выбрана → фильтруем по ней
   * - Организация НЕ выбрана, Контрагент НЕ выбран → только договора без орг (organizationUuid=null)
   * - Организация НЕ выбрана, Контрагент выбран → не фильтруем по орг (показываем договора контрагента из любой орг)
   * - Контрагент выбран → фильтруем по нему (бэкенд добавит OR null)
   * - Контрагент НЕ выбран → только договора без контрагента (counterpartyUuid=null)
   */
  const contractExtraParams = useMemo(() => {
    const hasOrg = !!form.fields.organizationUuid;
    const hasCpty = !!form.fields.counterpartyUuid;
    const p: Record<string, string> = {};
    if (hasOrg) {
      p.organizationUuid = form.fields.organizationUuid;
    } else if (!hasCpty) {
      // нет ни орг, ни контрагента → только общие договора без организации
      p.organizationUuid = "null";
    }
    // hasCpty && !hasOrg → не передаём organizationUuid (договора контрагента из любой орг)
    if (hasCpty) {
      p.counterpartyUuid = form.fields.counterpartyUuid;
    } else {
      p.counterpartyUuid = "null";
    }
    return p;
  }, [form.fields.organizationUuid, form.fields.counterpartyUuid]);
  const handleContractSelect = useCallback((uuid: string, displayValue: string, item: Record<string, any>) => {
    const updates: Partial<TFields> = {
      contractUuid: uuid,
      contractName: displayValue,
    };
    if (item.organizationUuid) {
      updates.organizationUuid = item.organizationUuid;
      updates.organizationName = item.organization?.shortName ?? "";
    }
    if (item.counterpartyUuid) {
      updates.counterpartyUuid = item.counterpartyUuid;
      updates.counterpartyName = item.counterparty?.shortName ?? "";
    }
    form.setFields(updates);
  }, [form.setFields]);

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general") || "Основное", component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            {/* ID / UUID — только в режиме редактирования */}
            {form.isEditMode && (
              <GroupRow>
                <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
                <Field label="UUID" name={`${form.formUid}_uuid`} value={String(form.fields.uuid ?? "-")} disabled />
              </GroupRow>
            )}
            <GroupCol>
              {/* ── Левая колонка: поля ── */}


              {/* Строка 1: Дата · Проведён · Статус */}
              <GroupRow>
                <FieldDate label="Дата" name={`${form.formUid}_docDate`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} />



                <FieldSelect label="Статус" name={`${form.formUid}_status`} value={form.fields.status} options={STATUS_OPTIONS} onChange={e => form.setField("status", e.target.value)} disabled={form.isLoading} />
              </GroupRow>

              <Group>
                {/* Организация — во всю ширину */}
                <LookupField label="Организация" name={`${form.formUid}_org`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="shortName" onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TFields>)} onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)} disabled={form.isLoading} />

                <LookupField label="Склад" name={`${form.formUid}_wh`} value={form.fields.warehouseUuid} displayValue={form.fields.warehouseName} endpoint="warehouses" displayField="shortName" onSelect={(u, d) => form.setFields({ warehouseUuid: u, warehouseName: d } as Partial<TFields>)} onClear={() => form.setFields({ warehouseUuid: "", warehouseName: "" } as Partial<TFields>)} disabled={form.isLoading} extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
              </Group>

              {/* Контрагент — во всю ширину */}
              <LookupField label="Контрагент" name={`${form.formUid}_cpty`} value={form.fields.counterpartyUuid} displayValue={form.fields.counterpartyName} endpoint="counterparties" displayField="shortName" onSelect={(u, d) => form.setFields({ counterpartyUuid: u, counterpartyName: d } as Partial<TFields>)} onClear={() => form.setFields({ counterpartyUuid: "", counterpartyName: "" } as Partial<TFields>)} disabled={form.isLoading} />

              {/* Склад | Договор — в одну строку, по 50% */}
              <div style={{ display: "flex", flexDirection: "row", gap: "12px", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>

                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <LookupField label="Договор" name={`${form.formUid}_contract`} value={form.fields.contractUuid} displayValue={form.fields.contractName} endpoint="contracts" displayField="shortName" onSelect={handleContractSelect} onClear={() => form.setFields({ contractUuid: "", contractName: "" } as Partial<TFields>)} disabled={form.isLoading} extraParams={contractExtraParams} />
                </div>
              </div>

              {/* Комментарий */}
              <Field label="Комментарий" name={`${form.formUid}_desc`} value={form.fields.description} onChange={e => form.setField("description", e.target.value)} disabled={form.isLoading} />
            </GroupCol>
          </div>
          {/* ── Правая колонка: итоги ── */}
          <div className={styles.Form}>
            <div style={{ background: "#f8f9fa", border: "1px solid #e5e7eb", borderRadius: 6, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 5, fontSize: 13, maxWidth: '200px' }}>
              {([
                { label: "Без НДС", value: form.fields.amountWithoutVat },
                { label: "НДС", value: form.fields.vatAmount },
                { label: "Скидка", value: form.fields.discountAmount },
              ] as const).map(({ label, value }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "#6b7280" }}>
                  <span>{label}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{value || "0"}</span>
                </div>
              ))}
              <div style={{ borderTop: "1px solid #e5e7eb", margin: "2px 0 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: 600, fontSize: 14, paddingTop: 2 }}>
                <span>Итого</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{form.fields.amount || "0"}</span>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: "tab-items", label: translate("SaleItemsList") || "Товары", component: form.isEditMode && form.fields.uuid ? (
        <SaleItemsTable saleUuid={form.fields.uuid} disabled={form.isLoading} deferRemoteChanges
          initialPendingRows={saleItems.pending} onTotalChange={handleTotalChange}
          onItemsChange={saleItems.onItemsChange} />
      ) : (
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", color: "#999", fontSize: 14, padding: "24px 0" }}>
          Сохраните документ для добавления товаров
        </div>
      )
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleTotalChange, handleContractSelect, contractExtraParams, saleItems]);

  return (
    <ModelForm paneId={form.paneId} tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      // onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined}
      isLoading={form.isLoading}
      // showReload={form.isEditMode}
      readonly={!canWrite} isDirty={form.isDirty} />
  );
};
SalesForm.displayName = "SalesForm";

const SalesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={SalesForm}
    getLabel={(d) => {
      return d?.date ? getFormatDateOnly(String(d.date)) : "";
    }} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }} />
);
SalesList.displayName = "SalesList";

export { SalesList, SalesForm };
