import React, { FC, useMemo, useCallback } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateSubTableFor } from "src/utils/invalidateSubTableFor";
import { Field, FieldSelect } from "src/components/Field";
import { useEsfDictionaries } from "src/services/esf/dictionaries";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { BankAccountsTable } from "../BankAccounts";
import { ContractsTable } from "../Contracts";
import { ContactsTable } from "../Contacts";
import { WarehousesTable } from "../Warehouses";
import { CashboxesTable } from "../Cashboxes";
import { useFormStore } from "src/hooks/useFormStore";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { FormRequiredScope } from "src/hooks/useFormRequired";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import EgovFillButton from "src/components/EgovFillButton";
import Notice from "src/components/Notice";
import { useFormNotices } from "src/hooks/useFormNotices";

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
  legalName: string;
  vatSeries: string;
  vatNumber: string;
  enterpriseCategory: string;
}

const DEFAULT_FIELDS: TFields = { bin: "", name: "", legalName: "", vatSeries: "", vatNumber: "", enterpriseCategory: "" };

const OrganizationsForm: FC<Partial<TPane>> = (paneProps) => {
  const esfDict = useEsfDictionaries();
  const { canWrite } = useUserAccessRight("Organization");
  const { canRead: canReadBankAccounts } = useUserAccessRight("BankAccount");
  const { canRead: canReadContracts } = useUserAccessRight("Contract");
  const { canRead: canReadContacts } = useUserAccessRight("Contact");
  const { canRead: canReadWarehouses } = useUserAccessRight("Warehouse");
  const { canRead: canReadCashboxes } = useUserAccessRight("Cashbox");
  const queryClient = useQueryClient();

  // refetchType: "active" — ждём завершение refetch смонтированных
  // SubTable, чтобы useFormStore.submit() очистил pending-строки
  // только после появления свежих серверных данных.
  const invalidateSubTables = useCallback(async (savedData: any) => {
    const uuid = savedData?.uuid ?? "";
    await Promise.all([
      invalidateSubTableFor(queryClient, "contacts", "ownerUuid", uuid),
      invalidateSubTableFor(queryClient, "bankaccounts", "ownerUuid", uuid),
      invalidateSubTableFor(queryClient, "contracts", "organizationUuid", uuid),
      invalidateSubTableFor(queryClient, "warehouses", "organizationUuid", uuid),
      invalidateSubTableFor(queryClient, "cashboxes", "organizationUuid", uuid),
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
        batchEndpoint: "contacts/batch",
        extraFields: { ownerType: "organization" },
      },
      bankAccounts: {
        endpoint: "bankaccounts",
        parentField: "ownerUuid",
        label: translate("BankAccountsList"),
        batchEndpoint: "bankaccounts/batch",
        extraFields: { ownerType: "organization" },
      },
      contracts: {
        endpoint: "contracts",
        parentField: "organizationUuid",
        label: translate("ContractsList"),
        batchEndpoint: "contracts/batch",
      },
      warehouses: {
        endpoint: "warehouses",
        parentField: "organizationUuid",
        label: translate("WarehousesList"),
        batchEndpoint: "warehouses/batch",
      },
      cashboxes: {
        endpoint: "cashboxes",
        parentField: "organizationUuid",
        label: translate("CashboxesList"),
        batchEndpoint: "cashboxes/batch",
      },
    },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      ...d,
      bin: d.bin ?? "",
      name: d.name ?? "",
      legalName: d.legalName ?? "",
      vatSeries: d.vatSeries ?? "",
      vatNumber: d.vatNumber ?? "",
      enterpriseCategory: d.enterpriseCategory ?? "",
    }),
    buildPayload: (fd) => {
      const bin = fd.bin?.trim() ?? "";
      if (!bin || !/^\d{12}$/.test(bin)) return "БИН должен состоять ровно из 12 цифр";
      return {
        bin, name: fd.name?.trim() || null, legalName: fd.legalName?.trim() || null,
        vatSeries: fd.vatSeries?.trim() || null,
        vatNumber: fd.vatNumber?.trim() || null,
        enterpriseCategory: fd.enterpriseCategory || null,
      };
    },
    buildPaneLabel: (saved) =>
      makePaneLabel(LIST_NAME, "Организации", saved, saved.name || saved.bin),
    afterSave: invalidateSubTables,
  });

  // Ошибки ДАННЫХ формы → <Notice /> внутри формы (системные — в <UIToast />).
  const notices = useFormNotices(form);

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
                <Group>
                  <Field label={translate("name")} name={`${form.formUid}_name`} value={form.fields.name} onChange={e => form.setField("name", e.target.value)} onBlur={e => { if (!form.isEditMode && !form.fields.legalName && e.target.value) form.setField("legalName", e.target.value); }} disabled={form.isLoading} />
                </Group>
                <Group>
                  <Field label={translate("legalName")} name={`${form.formUid}_legalName`} value={form.fields.legalName} onChange={e => form.setField("legalName", e.target.value)} disabled={form.isLoading} />
                </Group>
                <GroupRow>
                  <Group className={styles.w1of2}>
                    <Field label={translate("binIin")} name={`${form.formUid}_bin`} value={form.fields.bin} onChange={e => form.setField("bin", e.target.value)} disabled={form.isLoading} required />
                  </Group>
                </GroupRow>
                <EgovFillButton ownerType="organization" bin={form.fields.bin} uuid={form.fields.uuid}
                  disabled={form.isLoading || !canWrite}
                  onFillName={(n) => form.setFields({ name: n, legalName: n } as Partial<TFields>)}
                  onReload={form.handleReload} />
                <GroupRow>
                  <Group className={styles.w1of2}>
                    <Field label={translate("vatCertSeries")} name={`${form.formUid}_vatSeries`} value={form.fields.vatSeries} onChange={e => form.setField("vatSeries", e.target.value)} disabled={form.isLoading} width="160px" />
                  </Group>
                  <Group className={styles.w1of2}>
                    <Field label={translate("vatCertNumber")} name={`${form.formUid}_vatNumber`} value={form.fields.vatNumber} onChange={e => form.setField("vatNumber", e.target.value)} disabled={form.isLoading} width="200px" />
                  </Group>
                </GroupRow>
                <GroupRow>
                  <GroupCol>
                    <FieldSelect label={translate("enterpriseCategory")} name={`${form.formUid}_enterpriseCategory`} value={form.fields.enterpriseCategory} disabled={form.isLoading}
                      onChange={(e) => form.setField("enterpriseCategory", e.target.value)}
                      options={[{ value: "", label: "—" }, ...(esfDict?.sellerType ?? []).map((o) => ({ value: o.code, label: o.label || o.code }))]} />
                    <div className={styles.FieldHint}>{translate("enterpriseCategoryHint")}</div>
                  </GroupCol>
                </GroupRow>
              </GroupCol>
            </div>
            <GroupCol className={styles.FormNotice}>
              <Notice items={notices} />
            </GroupCol>
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
    <FormRequiredScope requiredKeys={["bin"]} active>
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
