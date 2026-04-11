import { FC, useCallback, useMemo } from "react";
import { useAppContext } from "src/app";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { Field } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { ContactsForm } from "./index";
import { translate } from "src/i18";
import columnsJson from "./columns.json";
import SubTable, { type SubTableContext } from "src/components/SubTable";

const MODEL_ENDPOINT = "contacts";
const COMPONENT_NAME = "ContactsList_part";

interface ContactsTableProps {
  /** Тип владельца: "organization", "counterparty", "employee", "contactPerson", "user" */
  ownerType: string;
  /** UUID владельца */
  parentUuid: string;
  /** Имя владельца (для передачи в форму) */
  parentName?: string;
  disabled?: boolean;
  /** Если true — не отправлять изменения на сервер, хранить их локально в ref (используется внутри форм) */
  deferRemoteChanges?: boolean;
  /** Колбэк для получения текущих строк (включая _pendingAction) — полезно для parent form */
  onItemsChange?: (items: any[]) => void;
  /** Начальные pending-строки (восстановленные из sessionStorage) */
  initialPendingRows?: any[];
}

const ContactsTable: FC<ContactsTableProps> = ({ ownerType, parentUuid, parentName = "", disabled = false, deferRemoteChanges = false, onItemsChange, initialPendingRows }) => {
  const { addPane } = useAppContext().windows;
  const t = translate;

  // ── renderCell ─────────────────────────────────────────────────────────
  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "value") {
      if (ctx.inlineEditing) {
        return (
          <Field
            label=""
            name={`contact_val_${row.id}`}
            value={(row.value as string) ?? ""}
            onChange={e => ctx.handleInlineChange(row, "value", e.target.value)}
            disabled={ctx.disabled}
            width="100%"
            variant="table"
          />
        );
      }
      return <span>{(row.value as string) ?? ""}</span>;
    }
    if (col.identifier === "contactType.shortName") {
      if (ctx.inlineEditing) {
        return (
          <LookupField
            label=""
            name={`contact_type_${row.id}`}
            value={(row.contactTypeUuid as string) ?? ""}
            displayValue={(row.contactType as any)?.shortName ?? ""}
            endpoint="contacttypes"
            displayField="shortName"
            columns={[{ key: "shortName", label: "Наименование" }]}
            onSelect={(uuid, _displayValue, item) => {
              ctx.handleLookupChange(row, "contactTypeUuid", uuid, {
                contactType: item && uuid ? { uuid, shortName: item.shortName ?? "" } : null,
              });
            }}
            onClear={() => {
              ctx.handleLookupChange(row, "contactTypeUuid", null, { contactType: null });
            }}
            disabled={ctx.disabled}
            width="100%"
            variant="table"
          />
        );
      }
      return <span>{(row.contactType as any)?.shortName ?? ""}</span>;
    }
    return undefined;
  }, []);

  // ── openFormFor ────────────────────────────────────────────────────────
  const openFormFor = useCallback((data: TDataItem | undefined, ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    addPane({
      label: isEdit
        ? `${t("ContactsList")}: ${data?.value || t("noName")} • ${data?.id ?? "?"}`
        : `${t("ContactsList")}: ${t("new")}`,
      component: ContactsForm,
      data: isEdit ? data : { ownerType, ownerUuid: parentUuid, ownerName: parentName } as any,
      onSave: () => ctx.refetch(),
      onClose: () => ctx.refetch(),
    });
  }, [addPane, t, ownerType, parentUuid, parentName]);

  // ── defaultNewRow (SubTable сам обрабатывает POST / deferred create) ───
  const defaultNewRow = useMemo(() => ({
    value: "",
    contactTypeUuid: null,
  }), []);

  return (
    <SubTable
      model={MODEL_ENDPOINT}
      componentName={COMPONENT_NAME}
      columnsJson={columnsJson}
      parentKey="ownerUuid"
      parentUuid={parentUuid}
      extraQueryParams={{ ownerType }}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      onItemsChange={onItemsChange}
      emptyMessage="Сохраните запись для управления контактами."
      renderCell={renderCell}
      openFormFor={openFormFor}
      defaultNewRow={defaultNewRow}
    />
  );
};

ContactsTable.displayName = "ContactsTable";
export default ContactsTable;
