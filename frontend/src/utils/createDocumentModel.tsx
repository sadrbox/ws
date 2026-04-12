/**
 * Фабрика для создания типовых документных форм и списков.
 *
 * Используется для: Purchases, PaymentInvoices, OutgoingInvoices, IncomingInvoices, CashExpenseOrders, CashReceiptOrders.
 * Все эти модели имеют одинаковую структуру: documentNumber, documentDate, description, amount, status, owner (org/counterparty).
 */

import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import { Divider, Field, FieldDate, FieldSelect, FieldTextarea } from "src/components/Field";
import OwnerLookupField, { OwnerType } from "src/components/Field/OwnerLookupField";
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
  ownerType: OwnerType; ownerUuid: string; ownerName: string;
}

const DEFAULT_FIELDS: TDocFields = {
  documentNumber: "", documentDate: "", description: "", amount: "", status: "draft",
  ownerType: "", ownerUuid: "", ownerName: "",
};

function mapOwnerFromServer(d: any): { ownerType: OwnerType; ownerUuid: string; ownerName: string } {
  if (d.organizationUuid) return { ownerType: "organization", ownerUuid: d.organizationUuid, ownerName: d.organization?.shortName ?? "" };
  if (d.counterpartyUuid) return { ownerType: "counterparty", ownerUuid: d.counterpartyUuid, ownerName: d.counterparty?.shortName ?? "" };
  return { ownerType: "", ownerUuid: "", ownerName: "" };
}

function buildOwnerPayload(fd: TDocFields): Record<string, unknown> {
  return {
    organizationUuid: fd.ownerType === "organization" ? (fd.ownerUuid || null) : null,
    counterpartyUuid: fd.ownerType === "counterparty" ? (fd.ownerUuid || null) : null,
  };
}

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
      const name = (data.ownerName as string) || "";
      if (data.organizationUuid) { init.ownerType = "organization"; init.ownerUuid = data.organizationUuid as string; init.ownerName = name; }
      else if (data.counterpartyUuid) { init.ownerType = "counterparty"; init.ownerUuid = data.counterpartyUuid as string; init.ownerName = name; }
      else if (data.ownerType) { init.ownerType = data.ownerType as OwnerType; init.ownerUuid = (data.ownerUuid as string) || ""; init.ownerName = name; }
      else if (defaultOrg.organizationUuid) { init.ownerType = "organization"; init.ownerUuid = defaultOrg.organizationUuid; init.ownerName = defaultOrg.organizationName; }
      return init;
    })();

    const form = useFormStore<TDocFields>({
      endpoint, storageKey, defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
      mapServerToForm: (d, prev) => {
        const owner = mapOwnerFromServer(d);
        return {
          ...(prev ?? DEFAULT_FIELDS), ...d,
          documentNumber: d.documentNumber ?? "", documentDate: d.documentDate?.slice(0, 10) ?? "",
          description: d.description ?? "", amount: d.amount != null ? String(d.amount) : "",
          status: d.status ?? "draft",
          ownerType: owner.ownerType || prev?.ownerType || "", ownerUuid: owner.ownerUuid || prev?.ownerUuid || "", ownerName: owner.ownerName || prev?.ownerName || "",
        };
      },
      buildPayload: (fd) => ({
        documentNumber: fd.documentNumber?.trim() || null, documentDate: fd.documentDate || null,
        description: fd.description?.trim() || null, amount: fd.amount ? parseFloat(fd.amount) : null,
        status: fd.status || "draft",
        ...buildOwnerPayload(fd),
      }),
      buildPaneLabel: (saved) => `${translate(listName) || formLabel}: ${saved.documentNumber || "?"} • ${saved.id ?? "?"}`,
    });

    const tabs = useMemo(() => [
      { id: "general", label: translate("general") || "Общие сведения", component: (
        <div className={styles.FormBodyParts}>
          <Group align="row" gap="12px" className={styles.Form}><div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
            <Field label="Номер документа" name={`${form.formUid}_docNum`} minWidth="339px" value={form.fields.documentNumber} onChange={e => form.setField("documentNumber", e.target.value)} disabled={form.isLoading} />
            <FieldDate label="Дата документа" name={`${form.formUid}_docDate`} minWidth="200px" value={form.fields.documentDate} onChange={e => form.setField("documentDate", e.target.value)} disabled={form.isLoading} />
            <Field label="Сумма" name={`${form.formUid}_amount`} minWidth="200px" value={form.fields.amount} onChange={e => form.setField("amount", e.target.value)} disabled={form.isLoading} />
            <FieldSelect label="Статус" name={`${form.formUid}_status`} value={form.fields.status} options={STATUS_OPTIONS} onChange={e => form.setField("status", e.target.value)} disabled={form.isLoading} />
            <OwnerLookupField name={`${form.formUid}_owner`} ownerType={form.fields.ownerType} ownerUuid={form.fields.ownerUuid} ownerName={form.fields.ownerName}
              onOwnerChange={({ ownerType, ownerUuid, ownerName }) => form.setFields({ ownerType, ownerUuid, ownerName } as Partial<TDocFields>)}
              disabled={form.isLoading} typeLocked={!form.uuid && !!(paneProps.data?.organizationUuid || paneProps.data?.counterpartyUuid || paneProps.data?.ownerType)} minWidth="339px" />
            <FieldTextarea label="Описание" name={`${form.formUid}_description`} value={form.fields.description} onChange={e => form.setField("description", e.target.value)} disabled={form.isLoading} minWidth="339px" minHeight="80px" rows={4} />
          </div></Group>
          {form.isEditMode && <><Divider /><Group align="row" gap="12px" className={styles.Form}><div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
            <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
            <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
          </div></Group></>}
        </div>
      )},
    ], [form.fields, form.isLoading, form.isEditMode, form.formUid, form.setField, form.setFields, form.uuid, paneProps.data]);

    return (
      <ModelFormWrapper tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
        onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined} isLoading={form.isLoading} showReload={form.isEditMode}
        error={form.error} errorRevision={form.errorRevision} onErrorDismiss={() => form.setError(null)} />
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
