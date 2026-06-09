import React, { FC, useMemo, useCallback } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateSubTableFor } from "src/utils/invalidateSubTableFor";
import { Field } from "src/components/Field";
import { GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { BankAccountsTable } from "../BankAccounts";
import { ContractsTable } from "../Contracts";
import { ContactsTable } from "../Contacts";
import { useFormStore } from "src/hooks/useFormStore";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { FormRequiredScope } from "src/hooks/useFormRequired";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { makePaneLabel } from "src/utils/buildPaneLabel";

const MODEL_ENDPOINT = "counterparties";
const LIST_NAME = "CounterpartiesList";

interface TFields { id?: number; uuid?: string; bin: string; name: string; legalName: string; }
const DEFAULT_FIELDS: TFields = { bin: "", name: "", legalName: "" };

const CounterpartiesForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useUserAccessRight("Counterparty");
  const { canRead: canReadBankAccounts } = useUserAccessRight("BankAccount");
  const { canRead: canReadContracts } = useUserAccessRight("Contract");
  const { canRead: canReadContacts } = useUserAccessRight("Contact");
  const queryClient = useQueryClient();

  // refetchType: "active" — invalidateQueries вернёт Promise, который
  // резолвится только после refetch всех АКТИВНЫХ запросов SubTable.
  // Критично для submit-flow useFormStore: он очищает pending-строки
  // ТОЛЬКО после завершения afterSave (иначе SubTable покажет
  // устаревшие серверные строки из локального кэша react-query).
  const invalidateSubTables = useCallback(async (savedData: any) => {
    const uuid = savedData?.uuid ?? "";
    await Promise.all([
      invalidateSubTableFor(queryClient, "contacts", "ownerUuid", uuid),
      invalidateSubTableFor(queryClient, "bankaccounts", "ownerUuid", uuid),
      invalidateSubTableFor(queryClient, "contracts", "counterpartyUuid", uuid),
    ]);
  }, [queryClient]);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "counterparties-form", defaultFields: DEFAULT_FIELDS, paneProps,
    tables: {
      contacts: { endpoint: "contacts", parentField: "ownerUuid", label: translate("ContactsList") || "Контакты", batchEndpoint: "contacts/batch", extraFields: { ownerType: "counterparty" } },
      bankAccounts: { endpoint: "bankaccounts", parentField: "ownerUuid", label: translate("BankAccountsList") || "Банковские счета", batchEndpoint: "bankaccounts/batch", extraFields: { ownerType: "counterparty" } },
      contracts: { endpoint: "contracts", parentField: "counterpartyUuid", label: translate("ContractsList") || "Договора", batchEndpoint: "contracts/batch" },
    },
    mapServerToForm: (d, prev) => ({ ...(prev ?? DEFAULT_FIELDS), ...d, bin: d.bin ?? "", name: d.name ?? "", legalName: d.legalName ?? "" }),
    buildPayload: (fd) => {
      const bin = fd.bin?.trim() ?? "";
      if (!bin || !/^\d{12}$/.test(bin)) return translate("binMustBe12Digits");
      return { bin, name: fd.name?.trim() || null, legalName: fd.legalName?.trim() || null };
    },
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, translate("counterparty"), saved, saved.name || saved.bin),
    afterSave: invalidateSubTables,
  });

  const contacts = form.useTable("contacts");
  const bankAccounts = form.useTable("bankAccounts");
  const contracts = form.useTable("contracts");

  const ownerUuid = form.fields.uuid ?? "";

  const tabs = useMemo(() => {
    const result: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "tab-details", label: translate("general"), component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              <GroupCol>
                <Field label={translate("name")} name={`${form.formUid}_name`} minWidth="339px" value={form.fields.name} onChange={e => form.setField("name", e.target.value)} onBlur={e => { if (!form.isEditMode && !form.fields.legalName && e.target.value) form.setField("legalName", e.target.value); }} disabled={form.isLoading} />
                <Field label={translate("legalName")} name={`${form.formUid}_legalName`} minWidth="339px" value={form.fields.legalName} onChange={e => form.setField("legalName", e.target.value)} disabled={form.isLoading} />
                <Field label={`${translate("binIin")}`} name={`${form.formUid}_bin`} minWidth="339px" value={form.fields.bin} onChange={e => form.setField("bin", e.target.value)} disabled={form.isLoading || form.isEditMode} />
              </GroupCol>
            </div>
          </div>
        )
      },
    ];
    if (canReadBankAccounts) result.push({
      id: "tab1", label: translate("BankAccountsList"), component: (
        <BankAccountsTable deferRemoteChanges ownerType="counterparty" parentUuid={form.fields.uuid ?? ""} parentName={form.fields.name} initialPendingRows={bankAccounts.pending} onItemsChange={bankAccounts.onItemsChange} showPrimaryButton={form.isEditMode && canWrite} />
      )
    });
    if (canReadContracts) result.push({
      id: "tab2", label: translate("ContractsList"), component: (
        <ContractsTable deferRemoteChanges parentKey="counterpartyUuid" parentUuid={form.fields.uuid ?? ""} parentName={form.fields.name} initialPendingRows={contracts.pending} onItemsChange={contracts.onItemsChange} showPrimaryButton={form.isEditMode && canWrite} />
      )
    });
    if (canReadContacts) result.push({
      id: "tab3", label: translate("ContactsList"), component: (
        <ContactsTable deferRemoteChanges ownerType="counterparty" parentUuid={form.fields.uuid ?? ""} parentName={form.fields.name} initialPendingRows={contacts.pending} onItemsChange={contacts.onItemsChange} showPrimaryButton={form.isEditMode && canWrite} />
      )
    });
    return result;
  }, [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, contacts, bankAccounts, contracts, canReadBankAccounts, canReadContracts, canReadContacts, canWrite, ownerUuid]);

  return (
    <FormRequiredScope requiredKeys={["bin"]} active>
      <ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
        onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
        readonly={!canWrite} />
    </FormRequiredScope>
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
    getLabel={(d) => d?.name as string || "?"}
    variant={variant}
    onSelectItem={onSelectItem}
  />
);

CounterpartiesList.displayName = "CounterpartiesList";
export { CounterpartiesList, CounterpartiesForm };
