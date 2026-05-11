import { FC, useMemo, useCallback } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Divider, Field, FieldDate, FieldSelect, FieldTextarea } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useAccessRight } from "src/hooks/useAccessRight";
import { useAutoFillPrimary } from "src/hooks/useAutoFillPrimary";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly } from "src/utils/main.module";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "outgoing-invoices";
const LIST_NAME = "OutgoingInvoicesList";
const FORM_LABEL = "СФ исходящая";

const STATUS_OPTIONS = [
  { value: "draft", label: translate("statusDraft") || "Черновик" },
  { value: "approved", label: translate("statusApproved") || "Утверждён" },
  { value: "cancelled", label: translate("statusCancelled") || "Отменён" },
];

interface TFields {
  id?: number; uuid?: string;
  date: string; description: string; amount: string; status: string;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  date: "", description: "", amount: "", status: "draft",
  organizationUuid: "", organizationName: "",
  counterpartyUuid: "", counterpartyName: "",
  contractUuid: "", contractName: "",
  authorUuid: "", authorName: "",
};

const OutgoingInvoicesForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useAccessRight("OutgoingInvoice");

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data;
    if (!data || data.uuid) return undefined;
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

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "outgoing-invoices-form",
    defaultFields: DEFAULT_FIELDS,
    initialFields,
    paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      date: d.date?.slice(0, 10) ?? "",
      description: d.description ?? "",
      amount: d.amount != null ? String(d.amount) : "",
      status: d.status ?? "draft",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.shortName ?? "",
      counterpartyUuid: d.counterpartyUuid ?? "",
      counterpartyName: d.counterparty?.shortName ?? "",
      contractUuid: d.contractUuid ?? "",
      contractName: d.contract?.shortName ?? "",
      authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
      authorName: d.author?.username ?? d.author?.email ?? "",
    }),
    buildPayload: (fd) => ({
      date: fd.date || null,
      description: fd.description?.trim() || null,
      amount: fd.amount ? parseFloat(fd.amount) : null,
      status: fd.status || "draft",
      organizationUuid: fd.organizationUuid || null,
      counterpartyUuid: fd.counterpartyUuid || null,
      contractUuid: fd.contractUuid || null,
    }),
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved, "date"),
  });

  const handleContractSelect = useCallback((uuid: string, displayValue: string, item: Record<string, any>) => {
    const updates: Partial<TFields> = { contractUuid: uuid, contractName: displayValue };
    if (item.organizationUuid) { updates.organizationUuid = item.organizationUuid; updates.organizationName = item.organization?.shortName ?? ""; }
    if (item.counterpartyUuid) { updates.counterpartyUuid = item.counterpartyUuid; updates.counterpartyName = item.counterparty?.shortName ?? ""; }
    form.setFields(updates);
  }, [form.setFields]);

  // ── Авто-подстановка ОСНОВНОГО ДОГОВОРА для пары организация/контрагент ─
  const contractScope = useMemo<Record<string, string> | null>(() => {
    const hasOrg = !!form.fields.organizationUuid;
    const hasCpty = !!form.fields.counterpartyUuid;
    if (!hasOrg && !hasCpty) return null;
    const s: Record<string, string> = {};
    if (hasOrg) s.organizationUuid = form.fields.organizationUuid;
    if (hasCpty) s.counterpartyUuid = form.fields.counterpartyUuid;
    return s;
  }, [form.fields.organizationUuid, form.fields.counterpartyUuid]);
  useAutoFillPrimary({
    endpoint: "contracts",
    scope: contractScope,
    currentUuid: form.fields.contractUuid,
    isEditMode: form.isEditMode,
    isLoading: form.isLoading,
    apply: (uuid, name) => form.setFields({ contractUuid: uuid, contractName: name } as Partial<TFields>),
  });

  const tabs = useMemo(() => [
    {
      id: "general",
      label: translate("general") || "Основное",
      component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <GroupRow>
                <FieldDate label={translate("date") || "Дата"} name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="120px" />
                <Field label="Автор" name={`${form.formUid}_author`} width="220px" value={form.fields.authorName || "-"} disabled />
                <FieldSelect label={translate("status") || "Статус"} name={`${form.formUid}_status`} options={STATUS_OPTIONS} value={form.fields.status} onChange={e => form.setField("status", e.target.value)} disabled={form.isLoading} />
              </GroupRow>

              <Group>
                <LookupField label={translate("OrganizationsList") || "Организация"} name={`${form.formUid}_org`} endpoint="organizations" displayField="shortName"
                  value={form.fields.organizationUuid} displayValue={form.fields.organizationName}
                  onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d })}
                  onClear={() => form.setFields({ organizationUuid: "", organizationName: "" })}
                  disabled={form.isLoading} />
              </Group>

              <Group>
                <LookupField label={translate("CounterpartiesList") || "Контрагент"} name={`${form.formUid}_cpty`} endpoint="counterparties" displayField="shortName"
                  value={form.fields.counterpartyUuid} displayValue={form.fields.counterpartyName}
                  onSelect={(u, d) => form.setFields({ counterpartyUuid: u, counterpartyName: d })}
                  onClear={() => form.setFields({ counterpartyUuid: "", counterpartyName: "" })}
                  disabled={form.isLoading} />
                <LookupField label={translate("ContractsList") || "Договор"} name={`${form.formUid}_contract`} endpoint="contracts" displayField="shortName"
                  value={form.fields.contractUuid} displayValue={form.fields.contractName}
                  onSelect={handleContractSelect}
                  onClear={() => form.setFields({ contractUuid: "", contractName: "" })}
                  disabled={form.isLoading}
                  extraParams={{
                    ...(form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : {}),
                    ...(form.fields.counterpartyUuid ? { counterpartyUuid: form.fields.counterpartyUuid } : {}),
                  }}
                />
              </Group>

              <GroupRow>
                <Field label={translate("amount") || "Сумма"} name={`${form.formUid}_amount`} width="200px" value={form.fields.amount} onChange={e => form.setField("amount", e.target.value)} disabled={form.isLoading} />
              </GroupRow>

              <Group>
                <FieldTextarea label={translate("description") || "Описание"} name={`${form.formUid}_description`} value={form.fields.description} onChange={e => form.setField("description", e.target.value)} disabled={form.isLoading} minHeight="80px" rows={4} />
              </Group>
            </GroupCol>
            {form.isEditMode && (<Divider />)}
          </div>
        </div>
      ),
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleContractSelect]);

  return (
    <ModelForm
      paneId={form.paneId}
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined}
      isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
      readonly={!canWrite}
      isDirty={form.isDirty}
    />
  );
};
OutgoingInvoicesForm.displayName = "OutgoingInvoicesForm";

const OutgoingInvoicesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT}
    listName={LIST_NAME}
    columnsJson={columnsJson}
    FormComponent={OutgoingInvoicesForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant}
    onSelectItem={onSelectItem}
    ownerUuid={ownerUuid}
    ownerField={ownerField}
    defaultSort={{ id: "desc" }}
  />
);
OutgoingInvoicesList.displayName = LIST_NAME;

export { OutgoingInvoicesForm, OutgoingInvoicesList };

