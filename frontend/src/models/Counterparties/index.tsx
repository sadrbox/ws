import { FC, useMemo, useCallback } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { useQueryClient } from "@tanstack/react-query";
import { Divider, Field } from "src/components/Field";
import { Group } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import BankAccountsTable from "../BankAccounts/BankAccountsTable";
import ContractsTable from "../Contracts/ContractsTable";
import ContactsTable from "../Contacts/ContactsTable";
import { useFormStore } from "src/hooks/useFormStore";
import ModelFormWrapper from "src/components/ModelFormWrapper";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "counterparties";
const LIST_NAME = "CounterpartiesList";

interface TFields { id?: number; uuid?: string; bin: string; shortName: string; displayName: string; }
const DEFAULT_FIELDS: TFields = { bin: "", shortName: "", displayName: "" };

const CounterpartiesForm: FC<Partial<TPane>> = (paneProps) => {
  const queryClient = useQueryClient();

  const invalidateSubTables = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["contacts"] });
    queryClient.invalidateQueries({ queryKey: ["bankaccounts"] });
    queryClient.invalidateQueries({ queryKey: ["contracts"] });
  }, [queryClient]);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "counterparties-form", defaultFields: DEFAULT_FIELDS, paneProps,
    tables: {
      contacts:     { endpoint: "contacts",     parentField: "ownerUuid", label: translate("ContactsList") || "Контакты",          extraFields: { ownerType: "counterparty" } },
      bankAccounts: { endpoint: "bankaccounts", parentField: "ownerUuid", label: translate("BankAccountsList") || "Банковские счета", extraFields: { ownerType: "counterparty" } },
      contracts:    { endpoint: "contracts",    parentField: "ownerUuid", label: translate("ContractsList") || "Договора",          extraFields: { ownerType: "counterparty" } },
    },
    mapServerToForm: (d, prev) => ({ ...(prev ?? DEFAULT_FIELDS), ...d, bin: d.bin ?? prev?.bin ?? "", shortName: d.shortName ?? "", displayName: d.displayName ?? "" }),
    buildPayload: (fd) => {
      const bin = fd.bin?.trim() ?? "";
      if (!bin || !/^\d{12}$/.test(bin)) return "БИН должен состоять ровно из 12 цифр";
      return { bin, shortName: fd.shortName?.trim() || null, displayName: fd.displayName?.trim() || null };
    },
    buildPaneLabel: (saved) => `${translate(LIST_NAME) || "Контрагенты"}: ${saved.shortName || saved.bin || "?"} • ${saved.id ?? "?"}`,
    afterLoad: invalidateSubTables,
    afterSave: async () => { setTimeout(invalidateSubTables, 0); },
  });

  const contacts = form.useTable("contacts");
  const bankAccounts = form.useTable("bankAccounts");
  const contracts = form.useTable("contracts");

  const tabs = useMemo(() => [
    { id: "tab0", label: translate("general") || "Общие сведения", component: (
      <div className={styles.FormBodyParts}>
        <Group align="row" gap="12px" className={styles.Form}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
            <Field label="Наименование" name={`${form.formUid}_shortName`} minWidth="339px" value={form.fields.shortName} onChange={e => form.setField("shortName", e.target.value)} disabled={form.isLoading} />
            <Field label="Полное наименование" name={`${form.formUid}_displayName`} minWidth="339px" value={form.fields.displayName} onChange={e => form.setField("displayName", e.target.value)} disabled={form.isLoading} />
            <Field label="БИН / ИНН *" name={`${form.formUid}_bin`} minWidth="339px" value={form.fields.bin} onChange={e => form.setField("bin", e.target.value)} disabled={form.isLoading || form.isEditMode} />
          </div>
        </Group>
        {form.isEditMode && (<><Divider /><Group align="row" gap="12px" className={styles.Form}><div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
          <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
          <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
        </div></Group></>)}
      </div>
    )},
    { id: "tab1", label: "Банковские счета", component: (
      <BankAccountsTable deferRemoteChanges ownerType="counterparty" parentUuid={form.fields.uuid ?? ""} parentName={form.fields.shortName} initialPendingRows={bankAccounts.pending} onItemsChange={bankAccounts.onItemsChange} />
    )},
    { id: "tab2", label: "Договора", component: (
      <ContractsTable deferRemoteChanges ownerType="counterparty" parentUuid={form.fields.uuid ?? ""} parentName={form.fields.shortName} initialPendingRows={contracts.pending} onItemsChange={contracts.onItemsChange} />
    )},
    { id: "tab3", label: "Контакты", component: (
      <ContactsTable deferRemoteChanges ownerType="counterparty" parentUuid={form.fields.uuid ?? ""} parentName={form.fields.shortName} initialPendingRows={contacts.pending} onItemsChange={contacts.onItemsChange} />
    )},
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, contacts, bankAccounts, contracts]);

  return (
    <ModelFormWrapper tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined} isLoading={form.isLoading} showReload={form.isEditMode}
      error={form.error} errorRevision={form.errorRevision} onErrorDismiss={() => form.setError(null)} />
  );
};
CounterpartiesForm.displayName = "CounterpartiesForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

const CounterpartiesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant, onSelectItem }) => (
  <ModelList
    endpoint={MODEL_ENDPOINT}
    listName={LIST_NAME}
    columnsJson={columnsJson}
    FormComponent={CounterpartiesForm}
    getLabel={(d) => d?.shortName as string || "?"}
    variant={variant}
    onSelectItem={onSelectItem}
  />
);

CounterpartiesList.displayName = "CounterpartiesList";
export { CounterpartiesList, CounterpartiesForm };
