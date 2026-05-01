import React, { FC, useMemo, useCallback } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { useQueryClient } from "@tanstack/react-query";
import { Field } from "src/components/Field";
import { GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import BankAccountsTable from "../BankAccounts/BankAccountsTable";
import ContractsTable from "../Contracts/ContractsTable";
import ContactsTable from "../Contacts/ContactsTable";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { makePaneLabel } from "src/utils/buildPaneLabel";

const MODEL_ENDPOINT = "counterparties";
const LIST_NAME = "CounterpartiesList";

interface TFields { id?: number; uuid?: string; bin: string; shortName: string; displayName: string; }
const DEFAULT_FIELDS: TFields = { bin: "", shortName: "", displayName: "" };

const CounterpartiesForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("Counterparty");
  const { canRead: canReadBankAccounts } = useAccessRight("BankAccount");
  const { canRead: canReadContracts }    = useAccessRight("Contract");
  const { canRead: canReadContacts }     = useAccessRight("Contact");
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
      contracts:    { endpoint: "contracts",    parentField: "counterpartyUuid", label: translate("ContractsList") || "Договора" },
    },
    mapServerToForm: (d, prev) => ({ ...(prev ?? DEFAULT_FIELDS), ...d, bin: d.bin ?? "", shortName: d.shortName ?? "", displayName: d.displayName ?? "" }),
    buildPayload: (fd) => {
      const bin = fd.bin?.trim() ?? "";
      if (!bin || !/^\d{12}$/.test(bin)) return "БИН должен состоять ровно из 12 цифр";
      return { bin, shortName: fd.shortName?.trim() || null, displayName: fd.displayName?.trim() || null };
    },
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, "Контрагенты", saved, saved.shortName || saved.bin),
    afterLoad: invalidateSubTables,
    afterSave: async () => { setTimeout(invalidateSubTables, 0); },
  });

  const contacts = form.useTable("contacts");
  const bankAccounts = form.useTable("bankAccounts");
  const contracts = form.useTable("contracts");

  const tabs = useMemo(() => {
    const result: { id: string; label: string; component: React.ReactNode }[] = [
    { id: "tab0", label: translate("general"), component: (
      <div className={styles.FormWrapper}>
        <div className={styles.Form}>
          {form.isEditMode && (
            <GroupRow>
              <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
              <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
            </GroupRow>
          )}
          <GroupCol>
            <Field label="Наименование" name={`${form.formUid}_shortName`} minWidth="339px" value={form.fields.shortName} onChange={e => form.setField("shortName", e.target.value)} disabled={form.isLoading} />
            <Field label="Полное наименование" name={`${form.formUid}_displayName`} minWidth="339px" value={form.fields.displayName} onChange={e => form.setField("displayName", e.target.value)} disabled={form.isLoading} />
            <Field label="БИН / ИНН *" name={`${form.formUid}_bin`} minWidth="339px" value={form.fields.bin} onChange={e => form.setField("bin", e.target.value)} disabled={form.isLoading || form.isEditMode} />
          </GroupCol>
        </div>
      </div>
    )},
    ];
    if (canReadBankAccounts) result.push({ id: "tab1", label: translate("BankAccountsList"), component: (
      <BankAccountsTable deferRemoteChanges ownerType="counterparty" parentUuid={form.fields.uuid ?? ""} parentName={form.fields.shortName} initialPendingRows={bankAccounts.pending} onItemsChange={bankAccounts.onItemsChange} />
    )});
    if (canReadContracts) result.push({ id: "tab2", label: translate("ContractsList"), component: (
      <ContractsTable deferRemoteChanges parentKey="counterpartyUuid" parentUuid={form.fields.uuid ?? ""} parentName={form.fields.shortName} initialPendingRows={contracts.pending} onItemsChange={contracts.onItemsChange} />
    )});
    if (canReadContacts) result.push({ id: "tab3", label: translate("ContactsList"), component: (
      <ContactsTable deferRemoteChanges ownerType="counterparty" parentUuid={form.fields.uuid ?? ""} parentName={form.fields.shortName} initialPendingRows={contacts.pending} onItemsChange={contacts.onItemsChange} />
    )});
    return result;
  }, [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, contacts, bankAccounts, contracts, canReadBankAccounts, canReadContracts, canReadContacts]);

  return (
    <ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined} isLoading={form.isLoading}
      readonly={!canWrite} isDirty={form.isDirty} />
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
