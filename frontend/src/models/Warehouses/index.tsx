import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldTextarea } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "warehouses";
const LIST_NAME = "WarehousesList";

interface TFields { id?: number; uuid?: string; shortName: string; address: string; description: string; organizationUuid: string; organizationName: string; }
const DEFAULT_FIELDS: TFields = { shortName: "", address: "", description: "", organizationUuid: "", organizationName: "" };

const WarehousesForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useAccessRight("Warehouse");
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "warehouses-form", paneProps,
    defaultFields: DEFAULT_FIELDS,
    initialFields: { ...DEFAULT_FIELDS, organizationUuid: defaultOrg.organizationUuid, organizationName: defaultOrg.organizationName },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), shortName: d.shortName ?? "", address: d.address ?? "", description: d.description ?? "",
      organizationUuid: d.organizationUuid ?? "", organizationName: d.organization?.shortName ?? "",
      id: d.id, uuid: d.uuid,
    }),
    buildPayload: (fd) => ({ shortName: fd.shortName?.trim() || null, address: fd.address?.trim() || null, description: fd.description?.trim() || null, organizationUuid: fd.organizationUuid || null }),
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, "Склады", saved),
  });

  const tabs = useMemo(() => [
    { id: "general", label: translate("general"), component: (
      <div className={styles.FormWrapper}>
        <div className={styles.Form}>
          {form.isEditMode && (
            <GroupRow>
              <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
              <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
            </GroupRow>
          )}
          <GroupCol>
            <Field label="Наименование" name={`${form.formUid}_shortName`} value={form.fields.shortName} onChange={e => form.setField("shortName", e.target.value)} disabled={form.isLoading} />
            <Field label="Адрес" name={`${form.formUid}_address`} value={form.fields.address} onChange={e => form.setField("address", e.target.value)} disabled={form.isLoading} />
            <LookupField label="Организация" name={`${form.formUid}_org`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="shortName"
              onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TFields>)}
              onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)}
              minWidth="339px" disabled={form.isLoading} />
            <FieldTextarea label="Описание" name={`${form.formUid}_description`} value={form.fields.description} onChange={e => form.setField("description", e.target.value)} disabled={form.isLoading} minWidth="339px" minHeight="80px" rows={4} />
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
WarehousesForm.displayName = "WarehousesForm";

const WarehousesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={WarehousesForm}
    getLabel={(d) => d?.shortName ? String(d.shortName).slice(0, 50) : "?"} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }} />
);
WarehousesList.displayName = "WarehousesList";
export { WarehousesList, WarehousesForm };
