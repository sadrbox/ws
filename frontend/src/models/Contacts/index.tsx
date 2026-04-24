import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
import { GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import LookupField from "src/components/Field/LookupField";
import OwnerLookupField, { OwnerType } from "src/components/Field/OwnerLookupField";

import { useFormStore } from "src/hooks/useFormStore";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";

const MODEL_ENDPOINT = "contacts";
// ═══════════════════════════════════════════════════════════════════════════

interface TFields {
  id?: number;
  uuid?: string;
  value: string;
  contactTypeUuid: string;
  contactTypeName: string;
  ownerType: OwnerType;
  ownerUuid: string;
  ownerName: string;
}

const DEFAULT_FIELDS: TFields = {
  value: "", contactTypeUuid: "", contactTypeName: "",
  ownerType: "", ownerUuid: "", ownerName: "",
};

const ContactsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("Contact");
  const data = paneProps.data;

  const initialFields: TFields | undefined = (() => {
    if (!data || data.uuid) return undefined;
    if (data.ownerType) {
      return {
        ...DEFAULT_FIELDS,
        ownerType: data.ownerType as OwnerType,
        ownerUuid: (data.ownerUuid as string) || "",
        ownerName: (data.ownerName as string) || "",
      };
    }
    return undefined;
  })();

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "contacts-form",
    defaultFields: DEFAULT_FIELDS,
    initialFields,
    paneProps,
    mapServerToForm: async (d, prev) => {
      const { resolveOwnerName } = await import("src/utils/resolveOwnerName");
      const oName = await resolveOwnerName(d.ownerType, d.ownerUuid);
      return {
        ...(prev ?? DEFAULT_FIELDS),
        value: d.value ?? "",
        contactTypeUuid: d.contactTypeUuid ?? "",
        contactTypeName: d.contactType?.shortName ?? d.contactType?.name ?? "",
        ownerType: (d.ownerType as OwnerType) ?? "",
        ownerUuid: d.ownerUuid ?? "",
        ownerName: oName,
        id: d.id,
        uuid: d.uuid,
      };
    },
    buildPayload: (fd) => {
      if (!fd.value?.trim()) return "Значение обязательно";
      return {
        value: fd.value.trim(),
        contactTypeUuid: fd.contactTypeUuid || null,
        ownerType: fd.ownerType || null,
        ownerUuid: fd.ownerUuid || null,
      };
    },
    buildPaneLabel: (saved) => makePaneLabel("ContactsList", "Контакты", saved),
  });

  const tabs = useMemo(() => [
    {
      id: "general", label: translate("general") || "Основное", component: (
        <div className={styles.Form}>
          {form.isEditMode && (
            <GroupRow>
              <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
              <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
            </GroupRow>
          )}
          <GroupCol>
            <Field label="Значение *" name={`${form.formUid}_value`} minWidth="339px" value={form.fields.value} onChange={e => form.setField("value", e.target.value)} disabled={form.isLoading} />
              <LookupField
                label="Тип контакта" name={`${form.formUid}_contactTypeUuid`} minWidth="339px"
                value={form.fields.contactTypeUuid} displayValue={form.fields.contactTypeName}
                endpoint="contacttypes" displayField="shortName"
                columns={[{ key: "shortName", label: "Наименование" }]}
                onSelect={(uuid: string, display: string) => form.setFields({ contactTypeUuid: uuid, contactTypeName: display } as any)}
                disabled={form.isLoading}
              />
              <OwnerLookupField
                ownerType={form.fields.ownerType} ownerUuid={form.fields.ownerUuid} ownerName={form.fields.ownerName}
                name={`${form.formUid}_owner`}
                onOwnerChange={({ ownerType, ownerUuid, ownerName }) =>
                  form.setFields({ ownerType, ownerUuid, ownerName } as any)}
                typeLocked={!form.uuid && !!data?.ownerType}
                disabled={form.isLoading}
              />
          </GroupCol>
        </div>
      ),
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, form.uuid, data?.ownerType]);

  return (
    <ModelForm
      paneId={form.paneId}
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined}
      isLoading={form.isLoading}
      showReload={form.isEditMode}
      readonly={!canWrite}
      isDirty={form.isDirty}
    />
  );
};
ContactsForm.displayName = "ContactsForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

interface ContactsListProps {
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
  ownerUuid?: string;
  ownerField?: string;
}

const ContactsList: FC<ContactsListProps> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList
    endpoint={MODEL_ENDPOINT}
    listName="ContactsList"
    columnsJson={columnsJson}
    FormComponent={ContactsForm}
    variant={variant}
    onSelectItem={onSelectItem}
    ownerUuid={ownerUuid}
    ownerField={ownerField}
  />
);

ContactsList.displayName = "ContactsList";
export { ContactsList, ContactsForm };