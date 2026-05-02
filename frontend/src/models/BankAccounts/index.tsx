import { FC, useCallback, useMemo } from "react";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import OwnerLookupField, { OwnerType } from "src/components/Field/OwnerLookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useAppContext } from "src/app";
import { useQueryClient } from "@tanstack/react-query";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { makePaneLabelFromData } from "src/utils/buildPaneLabel";

import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { makePaneLabel } from "src/utils/buildPaneLabel";

const MODEL_ENDPOINT = "bankaccounts";

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFields {
  id?: number;
  uuid?: string;
  shortName: string;
  iban: string;
  bik: string;
  bankName: string;
  currencyUuid: string;
  currencyName: string;
  ownerType: OwnerType;
  ownerUuid: string;
  ownerName: string;
}

const DEFAULT_FIELDS: TFields = {
  shortName: "", iban: "", bik: "", bankName: "",
  currencyUuid: "", currencyName: "",
  ownerType: "", ownerUuid: "", ownerName: "",
};

const BankAccountsForm: FC<Partial<TPane>> = (paneProps) => {
  const data = paneProps.data;
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useAccessRight("BankAccount");

  const initialFields: TFields | undefined = (() => {
    if (!data || data.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    if (data.ownerType) {
      init.ownerType = data.ownerType as OwnerType;
      init.ownerUuid = (data.ownerUuid as string) || "";
      init.ownerName = (data.ownerName as string) || "";
    } else if (defaultOrg.organizationUuid) {
      init.ownerType = "organization";
      init.ownerUuid = defaultOrg.organizationUuid;
      init.ownerName = defaultOrg.organizationName;
    }
    return init;
  })();

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "bank-accounts-form",
    defaultFields: DEFAULT_FIELDS,
    initialFields,
    paneProps,
    mapServerToForm: async (d, prev) => {
      const { resolveOwnerName } = await import("src/utils/resolveOwnerName");
      const oName = await resolveOwnerName(d.ownerType, d.ownerUuid);
      return {
        ...(prev ?? DEFAULT_FIELDS),
        shortName: d.shortName ?? "",
        iban: d.iban ?? "",
        bik: d.bik ?? "",
        bankName: d.bankName ?? "",
        currencyUuid: d.currencyUuid ?? "",
        currencyName: d.currency ? `${d.currency.code} — ${d.currency.shortName}` : "",
        ownerType: (d.ownerType as OwnerType) ?? "",
        ownerUuid: d.ownerUuid ?? "",
        ownerName: oName,
        id: d.id,
        uuid: d.uuid,
      };
    },
    buildPayload: (fd) => {
      if (!fd.iban?.trim()) return "IBAN обязателен";
      return {
        shortName: fd.shortName?.trim() || null,
        iban: fd.iban.trim(),
        bik: fd.bik?.trim() || null,
        bankName: fd.bankName?.trim() || null,
        currencyUuid: fd.currencyUuid || null,
        ownerType: fd.ownerType || null,
        ownerUuid: fd.ownerUuid || null,
      };
    },
    buildPaneLabel: (saved) =>
      makePaneLabel("BankAccountsList", "Банковские счета", saved, saved.shortName || saved.iban),
  });

  const tabs = useMemo(() => [
    {
      id: "general", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupRow style={{ justifyContent: "space-between", marginTop: "6px" }}>
              <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
              <Field label="UUID" name={`${form.formUid}_uuid`} value={String(form.fields.uuid ?? "-")} disabled />
            </GroupRow>
            <GroupCol>
              <Field label="Наименование" name={`${form.formUid}_shortName`} minWidth="339px" value={form.fields.shortName} onChange={e => form.setField("shortName", e.target.value)} disabled={form.isLoading} />
              <Field label="IBAN *" name={`${form.formUid}_iban`} minWidth="339px" value={form.fields.iban} onChange={e => form.setField("iban", e.target.value)} disabled={form.isLoading} />
              <Field label="БИК" name={`${form.formUid}_bik`} minWidth="200px" value={form.fields.bik} onChange={e => form.setField("bik", e.target.value)} disabled={form.isLoading} />
              <Field label="Название банка" name={`${form.formUid}_bankName`} minWidth="339px" value={form.fields.bankName} onChange={e => form.setField("bankName", e.target.value)} disabled={form.isLoading} />
              <LookupField
                label="Валюта"
                name={`${form.formUid}_currency`}
                value={form.fields.currencyUuid}
                displayValue={form.fields.currencyName}
                endpoint="currencies"
                displayField="code"
                onSelect={(uuid, _display, item) =>
                  form.setFields({ currencyUuid: uuid, currencyName: `${item.code} — ${item.shortName}` } as any)
                }
                onClear={() =>
                  form.setFields({ currencyUuid: "", currencyName: "" } as any)
                }
                minWidth="250px"
                disabled={form.isLoading}
              />
              <OwnerLookupField
                ownerType={form.fields.ownerType} ownerUuid={form.fields.ownerUuid} ownerName={form.fields.ownerName}
                name={`${form.formUid}_owner`}
                onOwnerChange={({ ownerType, ownerUuid, ownerName }) =>
                  form.setFields({ ownerType, ownerUuid, ownerName } as any)}
                typeLocked={!form.uuid && !!data?.ownerType}
                allowedTypes={["organization", "counterparty"]}
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
BankAccountsForm.displayName = "BankAccountsForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

interface BankAccountsListProps {
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
  ownerUuid?: string;
  ownerField?: string;
}

const BankAccountsList: FC<BankAccountsListProps> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList
    endpoint={MODEL_ENDPOINT}
    listName="BankAccountsList"
    columnsJson={columnsJson}
    FormComponent={BankAccountsForm}
    getLabel={(d) => String(d?.shortName || d?.iban || "")}
    variant={variant}
    onSelectItem={onSelectItem}
    ownerUuid={ownerUuid}
    ownerField={ownerField}
  />
);

BankAccountsList.displayName = "BankAccountsList";

// ═══════════════════════════════════════════════════════════════════════════
// TABLE — SubTable для вложенного списка счетов внутри форм
// ═══════════════════════════════════════════════════════════════════════════

const BA_TABLE_ENDPOINT = "bankaccounts";
const BA_TABLE_COMPONENT = "BankAccountsList_part";

export interface BankAccountsTableProps {
  /** Тип владельца: "organization", "counterparty" */
  ownerType: string;
  /** UUID владельца */
  parentUuid: string;
  /** Имя владельца (для передачи в форму) */
  parentName?: string;
  disabled?: boolean;
  /** Если true — не отправлять изменения на сервер, хранить их локально */
  deferRemoteChanges?: boolean;
  /** Колбэк при изменении строк */
  onItemsChange?: (items: TDataItem[]) => void;
  /** Начальные pending-строки */
  initialPendingRows?: TDataItem[];
}

const BankAccountsTable: FC<BankAccountsTableProps> = ({
  ownerType, parentUuid, parentName = "", disabled = false,
  deferRemoteChanges = false, onItemsChange, initialPendingRows,
}) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();

  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "shortName") {
      if (ctx.inlineEditing) return <Field label="" name={`ba_shortName_${row.id}`} value={(row.shortName as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "shortName", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.shortName as string) ?? ""}</span>;
    }
    if (col.identifier === "iban") {
      if (ctx.inlineEditing) return <Field label="" name={`ba_iban_${row.id}`} value={(row.iban as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "iban", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.iban as string) ?? ""}</span>;
    }
    if (col.identifier === "bankName") {
      if (ctx.inlineEditing) return <Field label="" name={`ba_bankName_${row.id}`} value={(row.bankName as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "bankName", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.bankName as string) ?? ""}</span>;
    }
    if (col.identifier === "bik") {
      if (ctx.inlineEditing) return <Field label="" name={`ba_bik_${row.id}`} value={(row.bik as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "bik", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.bik as string) ?? ""}</span>;
    }
    return undefined;
  }, []);

  const openFormFor = useCallback((data: TDataItem | undefined, _ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: [BA_TABLE_ENDPOINT] });
      _ctx.refetch();
    };
    addPane({
      label: makePaneLabelFromData("BankAccountsList", "Банковские счета", isEdit ? data as any : null, (data?.shortName || data?.iban) as string),
      component: BankAccountsForm,
      data: isEdit ? data : { ownerType, ownerUuid: parentUuid, ownerName: parentName } as any,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, ownerType, parentUuid, parentName, queryClient]);

  const defaultNewRow = useMemo(() => ({
    shortName: "", iban: "", bik: "", bankName: "", currencyUuid: null,
  }), []);

  // Скрываем колонку ownerName в SubTable (владелец известен из контекста)
  const adjustedColumns = useMemo(
    () => (columnsJson as any[]).map((col: any) =>
      col.identifier === "ownerName" ? { ...col, visible: false, inlist: false } : col,
    ),
    [],
  );

  return (
    <SubTable
      model={BA_TABLE_ENDPOINT}
      componentName={BA_TABLE_COMPONENT}
      columnsJson={adjustedColumns}
      parentKey="ownerUuid"
      parentUuid={parentUuid}
      extraQueryParams={{ ownerType }}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      onItemsChange={onItemsChange}
      emptyMessage={translate("saveToBankAccounts")}
      renderCell={renderCell}
      openFormFor={openFormFor}
      defaultNewRow={defaultNewRow}
    />
  );
};

BankAccountsTable.displayName = "BankAccountsTable";
export { BankAccountsList, BankAccountsForm, BankAccountsTable };
