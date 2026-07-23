import React, { FC, useMemo, useCallback } from "react";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateSubTableFor } from "src/utils/invalidateSubTableFor";
import { Field, FieldSelect } from "src/components/Field";
import { ClassifierLookup } from "src/components/Field/ClassifierLookup";
import { useEsfDictionaries } from "src/services/esf/dictionaries";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { BankAccountsTable } from "../BankAccounts";
import { ContractsTable } from "../Contracts";
import { ContactsTable } from "../Contacts";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessPermission } from "src/hooks/useAccessPermission";
import { FormRequiredScope } from "src/hooks/useFormRequired";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import EgovFillButton from "src/components/EgovFillButton";
import Notice from "src/components/Notice";
import { useFormNotices } from "src/hooks/useFormNotices";

const MODEL_ENDPOINT = "counterparties";
const LIST_NAME = "CounterpartiesList";

interface TFields { id?: number; uuid?: string; bin: string; name: string; legalName: string; countryCode: string; enterpriseCategory: string; }
const DEFAULT_FIELDS: TFields = { bin: "", name: "", legalName: "", countryCode: "KZ", enterpriseCategory: "" };

const CounterpartiesForm: FC<Partial<TPane>> = (paneProps) => {
  const esfDict = useEsfDictionaries();
  const { canWrite } = useAccessPermission("Counterparty");
  const { canRead: canReadBankAccounts } = useAccessPermission("BankAccount");
  const { canRead: canReadContracts } = useAccessPermission("Contract");
  const { canRead: canReadContacts } = useAccessPermission("Contact");
  const queryClient = useQueryClient();

  // refetchType: "active" — invalidateQueries вернёт Promise, который
  // резолвится только после refetch всех АКТИВНЫХ запросов SubTable.
  // Критично для submit-flow useFormStore: он очищает pending-строки
  // ТОЛЬКО после завершения afterSave (иначе SubTable покажет
  // устаревшие серверные строки из локального кэша react-query).
  const invalidateSubTables = useCallback(async (savedData: { uuid?: string } | undefined) => {
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
    mapServerToForm: (d, prev) => ({ ...(prev ?? DEFAULT_FIELDS), ...d, bin: d.bin ?? "", name: d.name ?? "", legalName: d.legalName ?? "", countryCode: d.countryCode ?? "KZ", enterpriseCategory: d.enterpriseCategory ?? "" }),
    buildPayload: (fd) => {
      const bin = fd.bin?.trim() ?? "";
      if (!bin || !/^\d{12}$/.test(bin)) return translate("binMustBe12Digits");
      return { bin, name: fd.name?.trim() || null, legalName: fd.legalName?.trim() || null, countryCode: fd.countryCode?.trim() || "KZ", enterpriseCategory: fd.enterpriseCategory || null };
    },
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, translate("counterparty"), saved, saved.name || saved.bin),
    afterSave: invalidateSubTables,
  });

  // Ошибки ДАННЫХ формы → <Notice /> внутри формы (системные — в <UIToast />).
  const notices = useFormNotices(form);

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
                <Group>
                  <Field label={translate("name")} name={`${form.formUid}_name`} minWidth={FIELD_WIDTH.lg} value={form.fields.name} onChange={e => form.setField("name", e.target.value)} onBlur={e => { if (!form.isEditMode && !form.fields.legalName && e.target.value) form.setField("legalName", e.target.value); }} disabled={form.isLoading} />
                  <Field label={translate("legalName")} name={`${form.formUid}_legalName`} minWidth={FIELD_WIDTH.lg} value={form.fields.legalName} onChange={e => form.setField("legalName", e.target.value)} disabled={form.isLoading} />
                </Group>
                <GroupRow>
                  <Group className={styles.w1of2}>
                    <Field label={`${translate("binIin")}`} name={`${form.formUid}_bin`} minWidth={FIELD_WIDTH.lg} value={form.fields.bin} onChange={e => form.setField("bin", e.target.value)} disabled={form.isLoading} />
                  </Group>
                  <Group className={styles.w1of2}>
                    <ClassifierLookup type="country" label={translate("countryCode")} name={`${form.formUid}_countryCode`} value={form.fields.countryCode} onChange={(code) => form.setField("countryCode", code)} disabled={form.isLoading} width="220px" />
                    <GroupCol>
                      <FieldSelect label={translate("enterpriseCategory")} name={`${form.formUid}_enterpriseCategory`} value={form.fields.enterpriseCategory} disabled={form.isLoading}
                        onChange={(e) => form.setField("enterpriseCategory", e.target.value)}
                        options={[{ value: "", label: "—" }, ...(esfDict?.customerType ?? []).map((o) => ({ value: o.code, label: o.label || o.code }))]} />
                      <div className={styles.FieldHint}>{translate("enterpriseCategoryHint")}</div>
                    </GroupCol>
                  </Group>
                </GroupRow>
                <EgovFillButton ownerType="counterparty" bin={form.fields.bin} uuid={form.fields.uuid}
                  disabled={form.isLoading || !canWrite}
                  onFillName={(n) => form.setFields({ name: n, legalName: n } as Partial<TFields>)}
                  onReload={form.handleReload} />
              </GroupCol>
            </div>
            <GroupCol className={styles.FormNotice}>
              <Notice items={notices} />
            </GroupCol>
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

  // БИН НЕ обязателен: контрагентом может быть физлицо или розничный покупатель, а из
  // 1С элементы приходят без него. Обязательно наименование. У ОРГАНИЗАЦИИ БИН
  // по-прежнему обязателен — по нему определяется адресат входящих событий 1С.
  return (
    <FormRequiredScope requiredKeys={["name"]} active>
      <ModelForm paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={form.fields.uuid} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
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
