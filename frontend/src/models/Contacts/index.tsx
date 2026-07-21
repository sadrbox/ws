import { FC, useCallback, useMemo, useEffect } from "react";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldSelect } from "src/components/Field";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import OwnerLookupField, { OwnerType } from "src/components/Field/OwnerLookupField";
import { useAppContext } from "src/app/context";
import { useQueryClient } from "@tanstack/react-query";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { isUnsavedRow } from "src/components/SubTable/rowModel";
import PrimaryToolbarButton from "src/components/PrimaryToolbarButton";
import { makePaneLabelFromData } from "src/utils/buildPaneLabel";

import { useFormStore } from "src/hooks/useFormStore";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { useAccessPermission } from "src/hooks/useAccessPermission";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import Notice from "src/components/Notice";
import { useFormNotices } from "src/hooks/useFormNotices";

const MODEL_ENDPOINT = "contacts";

export const CONTACT_TYPE_VALUES = [
  "legal_address", "actual_address", "telephone",
  "whatsapp", "telegram", "instagram", "facebook", "email", "website", "fax", "other",
] as const;

export type ContactTypeValue = (typeof CONTACT_TYPE_VALUES)[number];

export const CONTACT_TYPE_OPTIONS = [
  { value: "", label: "—" },
  ...CONTACT_TYPE_VALUES.map((v) => ({ value: v, label: translate(`ct_${v}`) })),
];

export const contactTypeLabel = (value: string | null | undefined): string => {
  if (!value) return "";
  return translate(`ct_${value}`) || value;
};

// ═══════════════════════════════════════════════════════════════════════════

interface TContactFields {
  id?: number;
  uuid?: string;
  value: string;
  contactType: string;
  ownerType: OwnerType;
  ownerUuid: string;
  ownerName: string;
}

const DEFAULT_FIELDS: TContactFields = {
  value: "", contactType: "",
  ownerType: "", ownerUuid: "", ownerName: "",
};

const ContactsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessPermission("Contact");
  const data = paneProps.data;

  const initialFields: TContactFields | undefined = (() => {
    if (data?.uuid) return undefined;
    if (data?.ownerType) {
      // Введённые inline значения (value/contactType) переносит общий useFormStore
      // (слияние известных полей из paneProps.data) — здесь только владелец.
      return {
        ...DEFAULT_FIELDS,
        ownerType: data?.ownerType as OwnerType,
        ownerUuid: (data?.ownerUuid as string) || "",
        ownerName: (data?.ownerName as string) || "",
      };
    }
    return undefined;
  })();

  const form = useFormStore<TContactFields>({
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
        contactType: d.contactType ?? "",
        ownerType: (d.ownerType as OwnerType) ?? "",
        ownerUuid: d.ownerUuid ?? "",
        ownerName: oName,
        id: d.id,
        uuid: d.uuid,
      };
    },
    buildPayload: (fd) => {
      if (!fd.value?.trim()) return translate("valueRequired");
      if (!fd.contactType) return translate("contactTypeRequired");
      return {
        value: fd.value.trim(),
        contactType: fd.contactType,
        ownerType: fd.ownerType || null,
        ownerUuid: fd.ownerUuid || null,
      };
    },
    buildPaneLabel: (saved) => makePaneLabel("ContactsList", translate("ContactsList"), saved, saved.value),
  });

  // Владелец пришёл из родителя (extraParams: ownerType+ownerUuid), но без имени —
  // дорезолвим его, чтобы поле «Владелец» показывало название, а не пустоту.
  const { ownerType: fOwnerType, ownerUuid: fOwnerUuid, ownerName: fOwnerName } = form.fields;
  useEffect(() => {
    if (!fOwnerType || !fOwnerUuid || fOwnerName) return;
    let alive = true;
    import("src/utils/resolveOwnerName").then(async ({ resolveOwnerName }) => {
      const name = await resolveOwnerName(fOwnerType, fOwnerUuid);
      if (alive && name) form.setField("ownerName", name);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fOwnerType, fOwnerUuid, fOwnerName]);

  // Ошибки ДАННЫХ формы → <Notice /> внутри формы (системные — в <UIToast />).
  const notices = useFormNotices(form);

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <Group>
                <Field label={`${translate("value")}`} name={`${form.formUid}_value`} minWidth={FIELD_WIDTH.lg} value={form.fields.value} onChange={e => form.setField("value", e.target.value)} disabled={form.isLoading} />
              </Group>
              <GroupRow>
                <Group className={styles.w1of2}>
                  <FieldSelect
                    label={`${translate("contactType")}`} name={`${form.formUid}_contactType`}
                    value={form.fields.contactType}
                    options={CONTACT_TYPE_OPTIONS}
                    onChange={e => form.setField("contactType", e.target.value)}
                    disabled={form.isLoading}
                    required
                  />
                </Group>
              </GroupRow>
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
          <GroupCol className={styles.FormNotice}>
            <Notice items={notices} />
          </GroupCol>
        </div>
      ),
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, form.uuid, data?.ownerType, notices]);

  return (
    <ModelForm
      paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={form.fields.uuid}
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined}
      isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
      readonly={!canWrite}
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
  extraParams?: Record<string, string>;
}

const contactsListRenderCell = (row: TDataItem, col: TColumn) => {
  if (col.identifier === "contactType") {
    return <span>{contactTypeLabel(row.contactType as string)}</span>;
  }
  return undefined;
};

const ContactsList: FC<ContactsListProps> = ({ variant, onSelectItem, ownerUuid, ownerField, extraParams }) => (
  <ModelList
    endpoint={MODEL_ENDPOINT}
    listName="ContactsList"
    columnsJson={columnsJson}
    FormComponent={ContactsForm}
    variant={variant}
    onSelectItem={onSelectItem}
    ownerUuid={ownerUuid}
    ownerField={ownerField}
    extraQueryParams={extraParams}
    renderCell={contactsListRenderCell}
  />
);

ContactsList.displayName = "ContactsList";

// ═══════════════════════════════════════════════════════════════════════════
// TABLE — SubTable для вложенного списка контактов
// ═══════════════════════════════════════════════════════════════════════════

const CT_TABLE_COMPONENT = "ContactsTable";

export interface ContactsTableProps {
  ownerType: string;
  parentUuid: string;
  parentName?: string;
  disabled?: boolean;
  deferRemoteChanges?: boolean;
  onItemsChange?: (items: TDataItem[]) => void;
  initialPendingRows?: TDataItem[];
  showPrimaryButton?: boolean;
}

const ContactsTable: FC<ContactsTableProps> = ({
  ownerType, parentUuid, parentName = "", disabled = false,
  deferRemoteChanges = false, onItemsChange, initialPendingRows,
  showPrimaryButton = false,
}) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();

  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "value") {
      if (ctx.inlineEditing) return <Field label="" name={`contact_val_${row.id}`} value={(row.value as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "value", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.value as string) ?? ""}</span>;
    }
    if (col.identifier === "contactType") {
      if (ctx.inlineEditing) return (
        <FieldSelect
          label="" name={`contact_type_${row.id}`}
          value={(row.contactType as string) ?? ""}
          options={CONTACT_TYPE_OPTIONS}
          onChange={e => ctx.handleInlineChange(row, "contactType", e.target.value)}
          disabled={ctx.disabled}
          variant="table"
        />
      );
      return <span>{contactTypeLabel(row.contactType as string)}</span>;
    }
    return undefined;
  }, []);

  const openFormFor = useCallback((data: TDataItem | undefined, ctx: SubTableContext) => {
    // Не считать temp-строку (uuid «tmp-…») существующей — иначе GET по фейку → 404.
    const isEdit = !!data?.uuid && !isUnsavedRow(data);
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: [MODEL_ENDPOINT] });
      ctx.refetch();
    };
    addPane({
      label: makePaneLabelFromData("ContactsList", translate("ContactsList"), isEdit ? data as any : null),
      component: ContactsForm,
      // Новая строка: пробрасываем введённые inline значения (data после
      // санитизации SubTable) + владельца — иначе набранное в таблице теряется.
      data: isEdit ? data : { ...(data as Record<string, unknown>), ownerType, ownerUuid: parentUuid, ownerName: parentName } as any,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, ownerType, parentUuid, parentName, queryClient]);

  const defaultNewRow = useMemo(() => ({ value: "", contactType: "" }), []);

  const adjustedColumns = useMemo(
    () => (columnsJson as any[]).map((col: any) =>
      col.identifier === "ownerName" ? { ...col, visible: false, inlist: false } : col,
    ),
    [],
  );

  return (
    <SubTable
      model={MODEL_ENDPOINT}
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
      emptyMessage={translate("saveToContacts")}
      renderCell={renderCell}
      openFormFor={openFormFor}
      defaultNewRow={defaultNewRow}
      extraButtons={showPrimaryButton ? <PrimaryToolbarButton endpoint={MODEL_ENDPOINT} disabled={disabled} label={translate("makePrimary")} /> : undefined}
    />
  );
};

ContactsTable.displayName = "ContactsTable";
export { ContactsList, ContactsForm, ContactsTable };
