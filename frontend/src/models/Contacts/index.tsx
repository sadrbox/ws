import { FC, useMemo, useCallback } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Divider, Field } from "src/components/Field";
import { Group } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import LookupField from "src/components/Field/LookupField";
import OwnerLookupField, { OwnerType } from "src/components/Field/OwnerLookupField";

import { useFormStore } from "src/hooks/useFormStore";
import ModelFormWrapper from "src/components/ModelFormWrapper";
import { useModelListState } from "src/hooks/useModelListState";

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
    buildPaneLabel: (saved) =>
      `${translate("ContactsList") || "ContactsList"}: ${saved.value || "?"} • ${saved.id ?? "?"}`,
  });

  const tabs = useMemo(() => [
    {
      id: "general", label: translate("general") || "Общие сведения", component: (
        <div className={styles.FormBodyParts}>
          <Group align="row" gap="12px" className={styles.Form}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
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
            </div>
          </Group>
          {form.isEditMode && (
            <>
              <Divider />
              <Group align="row" gap="12px" className={styles.Form}>
                <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
                  <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
                  <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
                </div>
              </Group>
            </>
          )}
        </div>
      ),
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, form.uuid, data?.ownerType]);

  return (
    <ModelFormWrapper
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined}
      isLoading={form.isLoading}
      showReload={form.isEditMode}
      error={form.error}
      errorRevision={form.errorRevision}
      onErrorDismiss={() => form.setError(null)}
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

const ContactsList: FC<ContactsListProps> = ({ variant = 'default', onSelectItem, ownerUuid, ownerField } = {}) => {
  const isPartOf = !!ownerUuid;
  const componentName = isPartOf ? "ContactsList_part" : "ContactsList";
  const { addPane } = useAppContext().windows;
  const t = (key: string) => translate(key) || key;

  const ownerFilter = useMemo(() => {
    if (ownerUuid && ownerField) return { [ownerField]: { value: ownerUuid, operator: "equals" } };
    return undefined;
  }, [ownerUuid, ownerField]);

  const { error, refetch, buildTableProps } = useModelListState({
    model: MODEL_ENDPOINT, componentName, columnsJson,
    defaultSort: { id: "asc" },
    columnsVariant: isPartOf ? "part" : undefined,
    ownerFilter,
  });

  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    const newData = !isEdit && ownerUuid && ownerField
      ? { [ownerField]: ownerUuid } as unknown as TDataItem
      : d;
    addPane({
      label: isEdit ? `${t(componentName)}: ${d?.value || t("noName")} • ${d?.id ?? "?"}` : `${t(componentName)}: ${t("new")}`,
      component: ContactsForm, data: newData, onSave: () => refetch(), onClose: () => refetch(),
    });
  }, [addPane, t, refetch, componentName, ownerUuid, ownerField]);

  if (error) {
    return (
      <div className="error-container"><div className="error-message">
        <h3>{t("errorTitle") || "Ошибка загрузки"}</h3>
        <p>{(error as Error)?.message || "Неизвестная ошибка"}</p>
        <button onClick={() => refetch()} className="retry-button">{t("retry") || "Повторить"}</button>
      </div></div>
    );
  }

  return <Table {...buildTableProps({ variant, onSelectItem, openModelForm, enableDateRange: false })} />;
};

ContactsList.displayName = "ContactsList";
export { ContactsList, ContactsForm };
