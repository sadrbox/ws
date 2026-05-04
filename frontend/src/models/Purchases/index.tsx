import { FC, useMemo, useCallback } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Divider, Field, FieldDate, FieldSelect, FieldTextarea } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly } from "src/utils/main.module";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "purchases";
const LIST_NAME = "PurchasesList";
const FORM_LABEL = "Поступление";

const STATUS_OPTIONS = [
  { value: "draft",     label: translate("statusDraft")     || "Черновик" },
  { value: "approved",  label: translate("statusApproved")  || "Утверждён" },
  { value: "cancelled", label: translate("statusCancelled") || "Отменён" },
];

interface TFields {
  id?: number; uuid?: string;
  date: string; description: string; amount: string; status: string;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
}

const DEFAULT_FIELDS: TFields = {
  date: "", description: "", amount: "", status: "draft",
  organizationUuid: "", organizationName: "",
  counterpartyUuid: "", counterpartyName: "",
  contractUuid: "", contractName: "",
};

const PurchasesForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useAccessRight("Purchase");

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
    storageKey: "purchases-form",
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
      organizationName: (d.organization as any)?.shortName ?? "",
      counterpartyUuid: d.counterpartyUuid ?? "",
      counterpartyName: (d.counterparty as any)?.shortName ?? "",
      contractUuid: d.contractUuid ?? "",
      contractName: (d.contract as any)?.shortName ?? "",
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

  const tabs = useMemo(() => [
    {
      id: "general",
      label: translate("general") || "Основное",
      component: (
        <div className={styles.FormBodyParts}>
          <Group align="row" gap="12px" className={styles.Form}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
              <FieldDate label={translate("date") || "Дата"} name={`${form.formUid}_date`} minWidth="200px"
                value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} />
              <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
                <LookupField label={translate("OrganizationsList") || "Организация"} name={`${form.formUid}_org`}
                  endpoint="organizations" displayField="shortName"
                  value={form.fields.organizationUuid} displayValue={form.fields.organizationName}
                  onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d })}
                  onClear={() => form.setFields({ organizationUuid: "", organizationName: "" })}
                  disabled={form.isLoading} width="300px" />
                <LookupField label={translate("CounterpartiesList") || "Контрагент"} name={`${form.formUid}_cpty`}
                  endpoint="counterparties" displayField="shortName"
                  value={form.fields.counterpartyUuid} displayValue={form.fields.counterpartyName}
                  onSelect={(u, d) => form.setFields({ counterpartyUuid: u, counterpartyName: d })}
                  onClear={() => form.setFields({ counterpartyUuid: "", counterpartyName: "" })}
                  disabled={form.isLoading} width="300px" />
              </div>
              <LookupField label={translate("ContractsList") || "Договор"} name={`${form.formUid}_contract`}
                endpoint="contracts" displayField="shortName"
                value={form.fields.contractUuid} displayValue={form.fields.contractName}
                onSelect={handleContractSelect}
                onClear={() => form.setFields({ contractUuid: "", contractName: "" })}
                disabled={form.isLoading} width="300px"
                extraParams={{
                  ...(form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : {}),
                  ...(form.fields.counterpartyUuid ? { counterpartyUuid: form.fields.counterpartyUuid } : {}),
                }}
              />
              <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
                <Field label={translate("amount") || "Сумма"} name={`${form.formUid}_amount`} minWidth="200px"
                  value={form.fields.amount} onChange={e => form.setField("amount", e.target.value)} disabled={form.isLoading} />
                <FieldSelect label={translate("status") || "Статус"} name={`${form.formUid}_status`}
                  options={STATUS_OPTIONS} value={form.fields.status}
                  onChange={e => form.setField("status", e.target.value)} disabled={form.isLoading} />
              </div>
              <FieldTextarea label={translate("description") || "Описание"} name={`${form.formUid}_description`}
                value={form.fields.description} onChange={e => form.setField("description", e.target.value)}
                disabled={form.isLoading} minWidth="339px" minHeight="80px" rows={4} />
            </div>
          </Group>
          {form.isEditMode && (
            <>
              <Divider />
              <Group align="row" gap="12px" className={styles.Form}>
                <GroupRow>
                </GroupRow>
              </Group>
            </>
          )}
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
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined}
      isLoading={form.isLoading}
      readonly={!canWrite}
      isDirty={form.isDirty}
    />
  );
};
PurchasesForm.displayName = "PurchasesForm";

const PurchasesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT}
    listName={LIST_NAME}
    columnsJson={columnsJson}
    FormComponent={PurchasesForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(String(d.date)) : ""}
    variant={variant}
    onSelectItem={onSelectItem}
    ownerUuid={ownerUuid}
    ownerField={ownerField}
    defaultSort={{ id: "desc" }}
  />
);
PurchasesList.displayName = LIST_NAME;

export { PurchasesForm, PurchasesList };

