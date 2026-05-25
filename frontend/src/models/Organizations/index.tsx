import React, { FC, useMemo, useCallback } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { useQueryClient } from "@tanstack/react-query";
import { Field } from "src/components/Field";
import { GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import BankAccountsTable from "../BankAccounts/BankAccountsTable";
import ContractsTable from "../Contracts/ContractsTable";
import ContactsTable from "../Contacts/ContactsTable";
import { WarehousesTable } from "../Warehouses";
import { CashboxesTable } from "../Cashboxes";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { FormRequiredScope } from "src/hooks/useFormRequired";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { makePaneLabel } from "src/utils/buildPaneLabel";

const MODEL_ENDPOINT = "organizations";
const LIST_NAME = "OrganizationsList";

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFields {
  id?: number;
  uuid?: string;
  bin: string;
  name: string;
  displayName: string;
}

const DEFAULT_FIELDS: TFields = { bin: "", name: "", displayName: "" };

const OrganizationsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("Organization");
  const { canRead: canReadBankAccounts } = useAccessRight("BankAccount");
  const { canRead: canReadContracts } = useAccessRight("Contract");
  const { canRead: canReadContacts } = useAccessRight("Contact");
  const { canRead: canReadWarehouses } = useAccessRight("Warehouse");
  const { canRead: canReadCashboxes } = useAccessRight("Cashbox");
  const queryClient = useQueryClient();

  // refetchType: "active" — ждём завершение refetch смонтированных
  // SubTable, чтобы useFormStore.submit() очистил pending-строки
  // только после появления свежих серверных данных.
  const invalidateSubTables = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["contacts"], refetchType: "active" }),
      queryClient.invalidateQueries({ queryKey: ["bankaccounts"], refetchType: "active" }),
      queryClient.invalidateQueries({ queryKey: ["contracts"], refetchType: "active" }),
      queryClient.invalidateQueries({ queryKey: ["warehouses"], refetchType: "active" }),
      queryClient.invalidateQueries({ queryKey: ["cashboxes"], refetchType: "active" }),
    ]);
  }, [queryClient]);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "organizations-form",
    defaultFields: DEFAULT_FIELDS,
    paneProps,
    tables: {
      contacts: {
        endpoint: "contacts",
        parentField: "ownerUuid",
        label: translate("ContactsList"),
        extraFields: { ownerType: "organization" },
      },
      bankAccounts: {
        endpoint: "bankaccounts",
        parentField: "ownerUuid",
        label: translate("BankAccountsList"),
        extraFields: { ownerType: "organization" },
      },
      contracts: {
        endpoint: "contracts",
        parentField: "organizationUuid",
        label: translate("ContractsList"),
      },
      warehouses: {
        endpoint: "warehouses",
        parentField: "organizationUuid",
        label: translate("WarehousesList"),
      },
      cashboxes: {
        endpoint: "cashboxes",
        parentField: "organizationUuid",
        label: translate("CashboxesList"),
      },
    },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      ...d,
      bin: d.bin ?? "",
      name: d.name ?? "",
      displayName: d.displayName ?? "",
    }),
    buildPayload: (fd) => {
      const bin = fd.bin?.trim() ?? "";
      if (!bin || !/^\d{12}$/.test(bin)) return "БИН должен состоять ровно из 12 цифр";
      return { bin, name: fd.name?.trim() || null, displayName: fd.displayName?.trim() || null };
    },
    buildPaneLabel: (saved) =>
      makePaneLabel(LIST_NAME, "Организации", saved, saved.name || saved.bin),
    afterLoad: invalidateSubTables,
    afterSave: invalidateSubTables,
  });

  // Гранулярные подписки на вложенные таблицы
  const contacts = form.useTable("contacts");
  const bankAccounts = form.useTable("bankAccounts");
  const contracts = form.useTable("contracts");
  const warehouses = form.useTable("warehouses");
  const cashboxes = form.useTable("cashboxes");

  const ownerUuid = form.fields.uuid ?? "";

  const tabs = useMemo(() => {
    const result: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "tab-details", label: translate("general"), component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              <GroupCol>
                <Field label={translate("name")} name={`${form.formUid}_name`} value={form.fields.name} onChange={e => form.setField("name", e.target.value)} disabled={form.isLoading} />
                <Field label={translate("displayName")} name={`${form.formUid}_displayName`} value={form.fields.displayName} onChange={e => form.setField("displayName", e.target.value)} disabled={form.isLoading} />
                <Field label={translate("binIin")} name={`${form.formUid}_bin`} value={form.fields.bin} onChange={e => form.setField("bin", e.target.value)} disabled={form.isLoading || form.isEditMode} required={!form.isEditMode} />
              </GroupCol>
            </div>
          </div>
        ),
      },
    ];
    if (canReadBankAccounts) result.push({
      id: "tab1", label: translate("BankAccountsList"), component: (
        <BankAccountsTable
          deferRemoteChanges={true}
          ownerType="organization"
          parentUuid={form.fields.uuid ?? ""}
          parentName={form.fields.name}
          initialPendingRows={bankAccounts.pending}
          onItemsChange={bankAccounts.onItemsChange}
          showPrimaryButton={form.isEditMode && canWrite}
        />
      ),
    });
    if (canReadContracts) result.push({
      id: "tab2", label: translate("ContractsList"), component: (
        <ContractsTable
          deferRemoteChanges={true}
          parentKey="organizationUuid"
          parentUuid={form.fields.uuid ?? ""}
          parentName={form.fields.name}
          initialPendingRows={contracts.pending}
          onItemsChange={contracts.onItemsChange}
          showPrimaryButton={form.isEditMode && canWrite}
        />
      ),
    });

    if (canReadWarehouses) result.push({
      id: "tab4", label: translate("WarehousesList"), component: (
        <WarehousesTable
          deferRemoteChanges={true}
          parentUuid={form.fields.uuid ?? ""}
          parentName={form.fields.name}
          initialPendingRows={warehouses.pending}
          onItemsChange={warehouses.onItemsChange}
          showPrimaryButton={form.isEditMode && canWrite}
        />
      ),
    });
    if (canReadCashboxes) result.push({
      id: "tab5", label: translate("CashboxesList"), component: (
        <CashboxesTable
          deferRemoteChanges={true}
          parentUuid={form.fields.uuid ?? ""}
          parentName={form.fields.name}
          initialPendingRows={cashboxes.pending}
          onItemsChange={cashboxes.onItemsChange}
          showPrimaryButton={form.isEditMode && canWrite}
        />
      ),
    });
    if (canReadContacts) result.push({
      id: "tab3", label: translate("ContactsList"), component: (
        <ContactsTable
          deferRemoteChanges={true}
          ownerType="organization"
          parentUuid={form.fields.uuid ?? ""}
          parentName={form.fields.name}
          initialPendingRows={contacts.pending}
          onItemsChange={contacts.onItemsChange}
          showPrimaryButton={form.isEditMode && canWrite}
        />
      ),
    });
    return result;
  }, [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, contacts, bankAccounts, contracts, warehouses, cashboxes, canReadBankAccounts, canReadContracts, canReadContacts, canReadWarehouses, canReadCashboxes, canWrite, ownerUuid]);

  return (
    <FormRequiredScope requiredKeys={["bin"]} active={form.meta.headerValidationFailed}>
      <ModelForm
        paneId={form.paneId}
        tabs={tabs}
        onSave={form.handleSave}
        onSaveAndClose={form.handleSaveAndClose}
        onClose={form.handleClose}
        onReload={form.isEditMode ? form.handleReload : undefined}
        isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
        readonly={!canWrite}
      />
    </FormRequiredScope>
  );
};
OrganizationsForm.displayName = "OrganizationsForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

const OrganizationsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant, onSelectItem }) => (
  <ModelList
    endpoint={MODEL_ENDPOINT}
    listName={LIST_NAME}
    columnsJson={columnsJson}
    FormComponent={OrganizationsForm}
    getLabel={(d) => d?.name as string || "?"}
    variant={variant}
    onSelectItem={onSelectItem}
  />
);

OrganizationsList.displayName = "OrganizationsList";
export { OrganizationsList, OrganizationsForm };
