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
import { Group } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useFormStore } from "src/hooks/useFormStore";
import ModelFormWrapper from "src/components/ModelFormWrapper";
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
  documentNumber: string; documentDate: string; description: string; amount: string; status: string; posted: boolean;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
}

const DEFAULT_FIELDS: TFields = {
  documentNumber: "", documentDate: "", description: "", amount: "", status: "draft", posted: false,
  organizationUuid: "", organizationName: "", counterpartyUuid: "", counterpartyName: "", contractUuid: "", contractName: "",
};

const SalesForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const queryClient = useQueryClient();

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
        createPayload: (r: any) => ({ productUuid: r.productUuid ?? null, quantity: r.quantity ?? 0, price: r.price ?? 0 }),
        updatePayload: (r: any) => ({ productUuid: r.productUuid ?? null, quantity: r.quantity ?? 0, price: r.price ?? 0 }),
        extraSkipFields: ["saleUuid"],
      },
    },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      documentNumber: d.documentNumber ?? "", documentDate: d.documentDate?.slice(0, 10) ?? "",
      description: d.description ?? "", amount: d.amount != null ? String(d.amount) : "",
      status: d.status ?? "draft", posted: d.posted === true,
      organizationUuid: d.organizationUuid ?? prev?.organizationUuid ?? "",
      organizationName: d.organization?.shortName ?? prev?.organizationName ?? "",
      counterpartyUuid: d.counterpartyUuid ?? prev?.counterpartyUuid ?? "",
      counterpartyName: d.counterparty?.shortName ?? prev?.counterpartyName ?? "",
      contractUuid: d.contractUuid ?? prev?.contractUuid ?? "",
      contractName: d.contract?.shortName ?? prev?.contractName ?? "",
    }),
    buildPayload: (fd) => ({
      documentNumber: fd.documentNumber?.trim() || null, documentDate: fd.documentDate || null,
      description: fd.description?.trim() || null, amount: fd.amount ? parseFloat(fd.amount) : null,
      status: fd.status || "draft", posted: fd.posted === true,
      organizationUuid: fd.organizationUuid || null,
      counterpartyUuid: fd.counterpartyUuid || null,
      contractUuid: fd.contractUuid || null,
    }),
    buildPaneLabel: (saved) => `${translate(LIST_NAME) || FORM_LABEL}: ${saved.id ?? "?"}`,
    afterLoad: invalidateSubTables,
    afterSave: async () => { setTimeout(invalidateSubTables, 0); },
  });

  const saleItems = form.useTable("saleItems");

  const handleTotalChange = useCallback((total: number) => {
    form.setField("amount", String(total));
  }, [form.setField]);

  const tabs = useMemo(() => [
    { id: "tab-details", label: translate("general") || "Общие сведения", component: (
      <div className={styles.FormBodyParts}>
        <Group align="row" gap="12px" className={styles.Form}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: 640 }}>
            {form.isEditMode && (
              <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
                <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
                <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "row", gap: "12px", alignItems: "flex-end" }}>
              <FieldDate label="Дата" name={`${form.formUid}_docDate`} value={form.fields.documentDate} onChange={e => form.setField("documentDate", e.target.value)} disabled={form.isLoading} width="200px" />
              <div style={{ display: "flex", alignItems: "center", gap: 6, height: 28, whiteSpace: "nowrap" }}>
                <input type="checkbox" id={`${form.formUid}_posted`} checked={form.fields.posted} onChange={e => form.setField("posted", e.target.checked as any)} disabled={form.isLoading} />
                <label htmlFor={`${form.formUid}_posted`} style={{ cursor: "pointer", userSelect: "none" }}>Проведён</label>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
              <LookupField label="Организация" name={`${form.formUid}_org`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="shortName" onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TFields>)} onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)} disabled={form.isLoading} width="300px" />
              <LookupField label="Контрагент" name={`${form.formUid}_cpty`} value={form.fields.counterpartyUuid} displayValue={form.fields.counterpartyName} endpoint="counterparties" displayField="shortName" onSelect={(u, d) => form.setFields({ counterpartyUuid: u, counterpartyName: d } as Partial<TFields>)} onClear={() => form.setFields({ counterpartyUuid: "", counterpartyName: "" } as Partial<TFields>)} disabled={form.isLoading} width="300px" />
            </div>
            <LookupField label="Договор" name={`${form.formUid}_contract`} value={form.fields.contractUuid} displayValue={form.fields.contractName} endpoint="contracts" displayField="shortName" onSelect={(u, d) => form.setFields({ contractUuid: u, contractName: d } as Partial<TFields>)} onClear={() => form.setFields({ contractUuid: "", contractName: "" } as Partial<TFields>)} disabled={form.isLoading} width="300px" />
            <div style={{ display: "flex", flexDirection: "row", gap: "12px", alignItems: "flex-end" }}>
              <div style={{ width: 160 }}>
                <FieldSelect label="Статус" name={`${form.formUid}_status`} value={form.fields.status} options={STATUS_OPTIONS} onChange={e => form.setField("status", e.target.value)} disabled={form.isLoading} />
              </div>
              <Field label="Сумма" name={`${form.formUid}_amount`} value={form.fields.amount} disabled width="160px" />
            </div>
            <Field label="Комментарий" name={`${form.formUid}_desc`} value={form.fields.description} onChange={e => form.setField("description", e.target.value)} disabled={form.isLoading} />
          </div>
        </Group>
      </div>
    )},
    { id: "tab-items", label: "Товары", component: form.isEditMode && form.fields.uuid ? (
      <SaleItemsTable saleUuid={form.fields.uuid} disabled={form.isLoading} deferRemoteChanges
        initialPendingRows={saleItems.pending} onTotalChange={handleTotalChange}
        onItemsChange={saleItems.onItemsChange} />
    ) : (
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", color: "#999", fontSize: 14, padding: "24px 0" }}>
        Сохраните документ для добавления товаров
      </div>
    )},
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleTotalChange, saleItems]);

  return (
    <ModelFormWrapper tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined} isLoading={form.isLoading} showReload={form.isEditMode}
      error={form.error} errorRevision={form.errorRevision} onErrorDismiss={() => form.setError(null)} />
  );
};
SalesForm.displayName = "SalesForm";

const SalesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={SalesForm}
    getLabel={(d) => d?.id ? String(d.id) : "?"} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }} />
);
SalesList.displayName = "SalesList";

export { SalesList, SalesForm };
