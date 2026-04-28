import { FC, useCallback, useMemo } from "react";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
import { GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import LookupField from "src/components/Field/LookupField";
import OwnerLookupField, { OwnerType } from "src/components/Field/OwnerLookupField";
import { useAppContext } from "src/app";
import { useQueryClient } from "@tanstack/react-query";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { makePaneLabelFromData } from "src/utils/buildPaneLabel";

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
        <div className={styles.FormWrapper}>
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

// ═══════════════════════════════════════════════════════════════════════════
// TABLE — SubTable для вложенного списка контактов
// ═══════════════════════════════════════════════════════════════════════════

const CT_TABLE_ENDPOINT = "contacts";
const CT_TABLE_COMPONENT = "ContactsList_part";

export interface ContactsTableProps {
  /** Тип владельца: "organization", "counterparty", "employee", "contactperson", "user" */
  ownerType: string;
  /** UUID владельца */
  parentUuid: string;
  /** Имя владельца (для передачи в форму) */
  parentName?: string;
  disabled?: boolean;
  deferRemoteChanges?: boolean;
  onItemsChange?: (items: TDataItem[]) => void;
  initialPendingRows?: TDataItem[];
}

const ContactsTable: FC<ContactsTableProps> = ({
  ownerType, parentUuid, parentName = "", disabled = false,
  deferRemoteChanges = false, onItemsChange, initialPendingRows,
}) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();

  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "value") {
      if (ctx.inlineEditing) return <Field label="" name={`contact_val_${row.id}`} value={(row.value as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "value", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.value as string) ?? ""}</span>;
    }
    if (col.identifier === "contactType.shortName") {
      if (ctx.inlineEditing) return (
        <LookupField
          label="" name={`contact_type_${row.id}`}
          value={(row.contactTypeUuid as string) ?? ""}
          displayValue={(row.contactType as any)?.shortName ?? ""}
          endpoint="contacttypes" displayField="shortName"
          columns={[{ key: "shortName", label: "Наименование" }]}
          onSelect={(uuid, _dv, item) => ctx.handleLookupChange(row, "contactTypeUuid", uuid, {
            contactType: item && uuid ? { uuid, shortName: item.shortName ?? "" } : null,
          })}
          onClear={() => ctx.handleLookupChange(row, "contactTypeUuid", null, { contactType: null })}
          disabled={ctx.disabled} width="100%" variant="table"
        />
      );
      return <span>{(row.contactType as any)?.shortName ?? ""}</span>;
    }
    return undefined;
  }, []);

  const openFormFor = useCallback((data: TDataItem | undefined, _ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: [CT_TABLE_ENDPOINT] });
      _ctx.refetch();
    };
    addPane({
      label: makePaneLabelFromData("ContactsList", "Контакты", isEdit ? data as any : null),
      component: ContactsForm,
      data: isEdit ? data : { ownerType, ownerUuid: parentUuid, ownerName: parentName } as any,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, ownerType, parentUuid, parentName, queryClient]);

  const defaultNewRow = useMemo(() => ({ value: "", contactTypeUuid: null }), []);

  // Скрываем ownerName в SubTable — владелец известен из контекста
  const adjustedColumns = useMemo(
    () => (columnsJson as any[]).map((col: any) =>
      col.identifier === "ownerName" ? { ...col, visible: false, inlist: false } : col,
    ),
    [],
  );

  return (
    <SubTable
      model={CT_TABLE_ENDPOINT}
      componentName={CT_TABLE_COMPONENT}
      columnsJson={adjustedColumns}
      parentKey="ownerUuid"
      parentUuid={parentUuid}
      extraQueryParams={{ ownerType }}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      onItemsChange={onItemsChange}
      emptyMessage={translate("saveToContacts") || "Сохраните запись для управления контактами."}
      renderCell={renderCell}
      openFormFor={openFormFor}
      defaultNewRow={defaultNewRow}
    />
  );
};

ContactsTable.displayName = "ContactsTable";
export { ContactsList, ContactsForm, ContactsTable };