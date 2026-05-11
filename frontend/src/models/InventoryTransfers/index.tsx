import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDate, FieldSelect, FieldTextarea, Divider } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly } from "src/utils/main.module";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "inventory-transfers";
const LIST_NAME = "InventoryTransfersList";
const FORM_LABEL = "Перемещение ТМЗ";

const STATUS_OPTIONS = [
  { value: "draft", label: "Черновик" },
  { value: "approved", label: "Утверждён" },
  { value: "cancelled", label: "Отменён" },
];

interface TFields {
  id?: number; uuid?: string;
  documentNumber: string; date: string; description: string; status: string;
  fromWarehouseUuid: string; fromWarehouseName: string;
  toWarehouseUuid: string; toWarehouseName: string;
  organizationUuid: string; organizationName: string;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  documentNumber: "", date: "", description: "", status: "draft",
  fromWarehouseUuid: "", fromWarehouseName: "",
  toWarehouseUuid: "", toWarehouseName: "",
  organizationUuid: "", organizationName: "",
  authorUuid: "", authorName: "",
};

const InventoryTransfersForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useAccessRight("InventoryTransfer");

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data;
    if (!data || data.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    // «Автор» в новом документе пуст: заполняется сервером при сохранении.
    if (data.organizationUuid) { init.organizationUuid = data.organizationUuid as string; }
    else if (defaultOrg.organizationUuid) { init.organizationUuid = defaultOrg.organizationUuid; init.organizationName = defaultOrg.organizationName; }
    return init;
  })();

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "inventory-transfers-form", defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      documentNumber: d.documentNumber ?? "", date: d.date?.slice(0, 10) ?? "",
      description: d.description ?? "", status: d.status ?? "draft",
      fromWarehouseUuid: d.fromWarehouseUuid ?? "", fromWarehouseName: d.fromWarehouse?.shortName ?? "",
      toWarehouseUuid: d.toWarehouseUuid ?? "", toWarehouseName: d.toWarehouse?.shortName ?? "",
      organizationUuid: d.organizationUuid ?? "", organizationName: d.organization?.shortName ?? "",
      authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
      authorName: d.author?.username ?? d.author?.email ?? "",
    }),
    buildPayload: (fd) => ({
      documentNumber: fd.documentNumber?.trim() || null, date: fd.date || null,
      description: fd.description?.trim() || null, status: fd.status || "draft",
      fromWarehouseUuid: fd.fromWarehouseUuid || null, toWarehouseUuid: fd.toWarehouseUuid || null,
      organizationUuid: fd.organizationUuid || null,
    }),
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved, "date"),
  });

  const tabs = useMemo(() => [
    {
      id: "general", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <Field label="Номер документа" name={`${form.formUid}_docNum`} minWidth="339px" value={form.fields.documentNumber} onChange={e => form.setField("documentNumber", e.target.value)} disabled={form.isLoading} />
              <FieldDate label="Дата документа" name={`${form.formUid}_docDate`} minWidth="200px" value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} />
              <FieldSelect label="Статус" name={`${form.formUid}_status`} value={form.fields.status} options={STATUS_OPTIONS} onChange={e => form.setField("status", e.target.value)} disabled={form.isLoading} />
              <LookupField label="Со склада" name={`${form.formUid}_fromWh`} value={form.fields.fromWarehouseUuid} displayValue={form.fields.fromWarehouseName} endpoint="warehouses" displayField="shortName" onSelect={(u, d) => form.setFields({ fromWarehouseUuid: u, fromWarehouseName: d } as Partial<TFields>)} onClear={() => form.setFields({ fromWarehouseUuid: "", fromWarehouseName: "" } as Partial<TFields>)} minWidth="339px" disabled={form.isLoading} />
              <LookupField label="На склад" name={`${form.formUid}_toWh`} value={form.fields.toWarehouseUuid} displayValue={form.fields.toWarehouseName} endpoint="warehouses" displayField="shortName" onSelect={(u, d) => form.setFields({ toWarehouseUuid: u, toWarehouseName: d } as Partial<TFields>)} onClear={() => form.setFields({ toWarehouseUuid: "", toWarehouseName: "" } as Partial<TFields>)} minWidth="339px" disabled={form.isLoading} />
              <LookupField label="Организация" name={`${form.formUid}_org`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="shortName" onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TFields>)} onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)} minWidth="339px" disabled={form.isLoading} />
              <FieldTextarea label="Описание" name={`${form.formUid}_description`} value={form.fields.description} onChange={e => form.setField("description", e.target.value)} disabled={form.isLoading} minWidth="339px" minHeight="80px" rows={4} />
            </GroupCol>
            {/* ── Служебные поля внизу: ID/UUID/Автор — видны только для сохранённых документов ── */}
            {form.isEditMode && <><Divider /><GroupRow>
              <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
              <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
              <Field label="Автор" name={`${form.formUid}_author`} width="220px" value={form.fields.authorName || ""} disabled />
            </GroupRow></>}
          </div>
        </div>
      )
    },
  ], [form.fields, form.isLoading, form.isEditMode, form.formUid, form.setField, form.setFields]);

  return (
    <ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading}
      readonly={!canWrite} isDirty={form.isDirty} />
  );
};
InventoryTransfersForm.displayName = "InventoryTransfersForm";

const InventoryTransfersList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={InventoryTransfersForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(String(d.date)) : ""} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }} />
);
InventoryTransfersList.displayName = "InventoryTransfersList";

export { InventoryTransfersList, InventoryTransfersForm };
