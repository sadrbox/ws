/**
 * Фабрика для создания типовых документных форм и списков.
 *
 * Используется для: Purchases, PaymentInvoices, OutgoingInvoices, IncomingInvoices, CashExpenseOrders, CashReceiptOrders.
 * Все эти модели имеют одинаковую структуру: documentNumber, documentDate, description, amount, status,
 * organizationUuid, counterpartyUuid, contractUuid.
 * При выборе договора — автозаполняются Организация и Контрагент из значений договора.
 */

import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import { Divider, Field, FieldDate, FieldSelect, FieldTextarea } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import ModelFormWrapper from "src/components/ModelFormWrapper";
import ModelList from "src/components/ModelList";

const STATUS_OPTIONS = [
  { value: "draft", label: "Черновик" },
  { value: "approved", label: "Утверждён" },
  { value: "cancelled", label: "Отменён" },
];

interface TDocFields {
  id?: number; uuid?: string;
  documentNumber: string; documentDate: string; description: string; amount: string; status: string;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
}

const DEFAULT_FIELDS: TDocFields = {
  documentNumber: "", documentDate: "", description: "", amount: "", status: "draft",
  organizationUuid: "", organizationName: "",
  counterpartyUuid: "", counterpartyName: "",
  contractUuid: "", contractName: "",
};

interface CreateDocModelOptions {
  endpoint: string;
  listName: string;
  formLabel: string;
  storageKey: string;
  columnsJson: any;
}

export function createDocumentModel(opts: CreateDocModelOptions) {
  const { endpoint, listName, formLabel, storageKey, columnsJson } = opts;

  const DocForm: FC<Partial<TPane>> = (paneProps) => {
    const defaultOrg = useDefaultOrganization();

    const initialFields: TDocFields = (() => {
      const data = paneProps.data;
      if (!data || data.uuid) return { ...DEFAULT_FIELDS };
      const init = { ...DEFAULT_FIELDS };
      if (data.organizationUuid) {
        init.organizationUuid = data.organizationUuid as string;
        init.organizationName = (data.organizationName as string) || "";
      } else if (defaultOrg.organizationUuid) {
        init.organizationUuid = defaultOrg.organizationUuid;
        init.organizationName = defaultOrg.organizationName;
      }
      if (data.counterpartyUuid) {
        init.counterpartyUuid = data.counterpartyUuid as string;
        init.counterpartyName = (data.counterpartyName as string) || "";
      }
      return init;
    })();

    const form = useFormStore<TDocFields>({
      endpoint, storageKey, defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
      mapServerToForm: (d, prev) => ({
        ...(prev ?? DEFAULT_FIELDS), ...d,
        documentNumber: d.documentNumber ?? "", documentDate: d.documentDate?.slice(0, 10) ?? "",
        description: d.description ?? "", amount: d.amount != null ? String(d.amount) : "",
        status: d.status ?? "draft",
        organizationUuid: d.organizationUuid ?? prev?.organizationUuid ?? "",
        organizationName: d.organization?.shortName ?? prev?.organizationName ?? "",
        counterpartyUuid: d.counterpartyUuid ?? prev?.counterpartyUuid ?? "",
        counterpartyName: d.counterparty?.shortName ?? prev?.counterpartyName ?? "",
        contractUuid: d.contractUuid ?? prev?.contractUuid ?? "",
        contractName: d.contract?.shortName ?? prev?.contractName ?? "",
      }),
      buildPayload: (fd) => ({
        documentNumber: fd.documentNumber?.trim() || null, documentDate: fd.documentDate || null,
        description: fd.description?.trim() || null, amount: fd.amount ? parseFloat(fd.amount) : null,
        status: fd.status || "draft",
        organizationUuid: fd.organizationUuid || null,
        counterpartyUuid: fd.counterpartyUuid || null,
        contractUuid: fd.contractUuid || null,
      }),
      buildPaneLabel: (saved) => `${translate(listName) || formLabel}: ${saved.documentNumber || "?"} • ${saved.id ?? "?"}`,
    });

    /** При выборе договора — автозаполняем Организацию и Контрагента из данных договора */
    const handleContractSelect = (uuid: string, displayValue: string, item: Record<string, any>) => {
      const updates: Partial<TDocFields> = {
        contractUuid: uuid,
        contractName: displayValue,
      };
      // Заполняем организацию из договора если есть
      if (item.organizationUuid) {
        updates.organizationUuid = item.organizationUuid;
        updates.organizationName = item.organization?.shortName ?? "";
      }
      // Заполняем контрагента из договора если есть
      if (item.counterpartyUuid) {
        updates.counterpartyUuid = item.counterpartyUuid;
        updates.counterpartyName = item.counterparty?.shortName ?? "";
      }
      form.setFields(updates);
    };

    const tabs = useMemo(() => [
      { id: "general", label: translate("general") || "Общие сведения", component: (
        <div className={styles.FormBodyParts}>
          <Group align="row" gap="12px" className={styles.Form}><div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
            <Field label="Номер документа" name={`${form.formUid}_docNum`} minWidth="339px" value={form.fields.documentNumber} onChange={e => form.setField("documentNumber", e.target.value)} disabled={form.isLoading} />
            <FieldDate label="Дата документа" name={`${form.formUid}_docDate`} minWidth="200px" value={form.fields.documentDate} onChange={e => form.setField("documentDate", e.target.value)} disabled={form.isLoading} />
            <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
              <LookupField label="Организация" name={`${form.formUid}_org`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="shortName" onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TDocFields>)} onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TDocFields>)} disabled={form.isLoading} width="300px" />
              <LookupField label="Контрагент" name={`${form.formUid}_cpty`} value={form.fields.counterpartyUuid} displayValue={form.fields.counterpartyName} endpoint="counterparties" displayField="shortName" onSelect={(u, d) => form.setFields({ counterpartyUuid: u, counterpartyName: d } as Partial<TDocFields>)} onClear={() => form.setFields({ counterpartyUuid: "", counterpartyName: "" } as Partial<TDocFields>)} disabled={form.isLoading} width="300px" />
            </div>
            <LookupField label="Договор" name={`${form.formUid}_contract`} value={form.fields.contractUuid} displayValue={form.fields.contractName} endpoint="contracts" displayField="shortName" onSelect={handleContractSelect} onClear={() => form.setFields({ contractUuid: "", contractName: "" } as Partial<TDocFields>)} disabled={form.isLoading} width="300px" extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
            <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
              <Field label="Сумма" name={`${form.formUid}_amount`} minWidth="200px" value={form.fields.amount} onChange={e => form.setField("amount", e.target.value)} disabled={form.isLoading} />
              <FieldSelect label="Статус" name={`${form.formUid}_status`} value={form.fields.status} options={STATUS_OPTIONS} onChange={e => form.setField("status", e.target.value)} disabled={form.isLoading} />
            </div>
            <FieldTextarea label="Описание" name={`${form.formUid}_description`} value={form.fields.description} onChange={e => form.setField("description", e.target.value)} disabled={form.isLoading} minWidth="339px" minHeight="80px" rows={4} />
          </div></Group>
          {form.isEditMode && <><Divider /><Group align="row" gap="12px" className={styles.Form}><div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
            <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
            <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
          </div></Group></>}
        </div>
      )},
    ], [form.fields, form.isLoading, form.isEditMode, form.formUid, form.setField, form.setFields, form.uuid, handleContractSelect]);

    return (
      <ModelFormWrapper tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
        onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined} isLoading={form.isLoading} showReload={form.isEditMode}
        error={form.error} errorRevision={form.errorRevision} onErrorDismiss={() => form.setError(null)} isDirty={form.isDirty} />
    );
  };
  DocForm.displayName = `${listName.replace("List", "")}Form`;

  const DocList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
    <ModelList endpoint={endpoint} listName={listName} columnsJson={columnsJson} FormComponent={DocForm}
      getLabel={(d) => d?.documentNumber ? String(d.documentNumber).slice(0, 50) : "?"} variant={variant} onSelectItem={onSelectItem}
      ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }} />
  );
  DocList.displayName = `${listName}`;

  return { Form: DocForm, List: DocList };
}
