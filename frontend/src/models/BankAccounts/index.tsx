import { FC, useMemo, useCallback } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Divider, Field } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import OwnerLookupField, { OwnerType } from "src/components/Field/OwnerLookupField";
import { Group } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";

import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import ModelFormWrapper from "src/components/ModelFormWrapper";
import { useModelListState } from "src/hooks/useModelListState";
import { makePaneLabel, makePaneLabelFromData } from "src/utils/buildPaneLabel";

const MODEL_ENDPOINT = "bankaccounts";

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFields {
  id?: number;
  uuid?: string;
  shortName: string;
  iban: string;
  bik: string;
  bankName: string;
  currencyUuid: string;
  currencyName: string;
  ownerType: OwnerType;
  ownerUuid: string;
  ownerName: string;
}

const DEFAULT_FIELDS: TFields = {
  shortName: "", iban: "", bik: "", bankName: "",
  currencyUuid: "", currencyName: "",
  ownerType: "", ownerUuid: "", ownerName: "",
};

const BankAccountsForm: FC<Partial<TPane>> = (paneProps) => {
  const data = paneProps.data;
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useAccessRight("BankAccount");

  const initialFields: TFields | undefined = (() => {
    if (!data || data.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    if (data.ownerType) {
      init.ownerType = data.ownerType as OwnerType;
      init.ownerUuid = (data.ownerUuid as string) || "";
      init.ownerName = (data.ownerName as string) || "";
    } else if (defaultOrg.organizationUuid) {
      init.ownerType = "organization";
      init.ownerUuid = defaultOrg.organizationUuid;
      init.ownerName = defaultOrg.organizationName;
    }
    return init;
  })();

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "bank-accounts-form",
    defaultFields: DEFAULT_FIELDS,
    initialFields,
    paneProps,
    mapServerToForm: async (d, prev) => {
      const { resolveOwnerName } = await import("src/utils/resolveOwnerName");
      const oName = await resolveOwnerName(d.ownerType, d.ownerUuid);
      return {
        ...(prev ?? DEFAULT_FIELDS),
        shortName: d.shortName ?? "",
        iban: d.iban ?? "",
        bik: d.bik ?? "",
        bankName: d.bankName ?? "",
        currencyUuid: d.currencyUuid ?? "",
        currencyName: d.currency ? `${d.currency.code} — ${d.currency.shortName}` : "",
        ownerType: (d.ownerType as OwnerType) ?? "",
        ownerUuid: d.ownerUuid ?? "",
        ownerName: oName,
        id: d.id,
        uuid: d.uuid,
      };
    },
    buildPayload: (fd) => {
      if (!fd.iban?.trim()) return "IBAN обязателен";
      return {
        shortName: fd.shortName?.trim() || null,
        iban: fd.iban.trim(),
        bik: fd.bik?.trim() || null,
        bankName: fd.bankName?.trim() || null,
        currencyUuid: fd.currencyUuid || null,
        ownerType: fd.ownerType || null,
        ownerUuid: fd.ownerUuid || null,
      };
    },
    buildPaneLabel: (saved) =>
      makePaneLabel("BankAccountsList", "Банковские счета", saved, saved.shortName || saved.iban),
  });

  const tabs = useMemo(() => [
    {
      id: "general", label: translate("general") || "Основное", component: (
        <div className={styles.FormBodyParts}>
          <Group align="row" gap="12px" className={styles.Form}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
              <Field label="Наименование" name={`${form.formUid}_shortName`} minWidth="339px" value={form.fields.shortName} onChange={e => form.setField("shortName", e.target.value)} disabled={form.isLoading} />
              <Field label="IBAN *" name={`${form.formUid}_iban`} minWidth="339px" value={form.fields.iban} onChange={e => form.setField("iban", e.target.value)} disabled={form.isLoading} />
              <Field label="БИК" name={`${form.formUid}_bik`} minWidth="200px" value={form.fields.bik} onChange={e => form.setField("bik", e.target.value)} disabled={form.isLoading} />
              <Field label="Название банка" name={`${form.formUid}_bankName`} minWidth="339px" value={form.fields.bankName} onChange={e => form.setField("bankName", e.target.value)} disabled={form.isLoading} />
              <LookupField
                label="Валюта"
                name={`${form.formUid}_currency`}
                value={form.fields.currencyUuid}
                displayValue={form.fields.currencyName}
                endpoint="currencies"
                displayField="code"
                onSelect={(uuid, _display, item) =>
                  form.setFields({ currencyUuid: uuid, currencyName: `${item.code} — ${item.shortName}` } as any)
                }
                onClear={() =>
                  form.setFields({ currencyUuid: "", currencyName: "" } as any)
                }
                minWidth="250px"
                disabled={form.isLoading}
              />
              <OwnerLookupField
                ownerType={form.fields.ownerType} ownerUuid={form.fields.ownerUuid} ownerName={form.fields.ownerName}
                name={`${form.formUid}_owner`}
                onOwnerChange={({ ownerType, ownerUuid, ownerName }) =>
                  form.setFields({ ownerType, ownerUuid, ownerName } as any)}
                typeLocked={!form.uuid && !!data?.ownerType}
                allowedTypes={["organization", "counterparty"]}
                disabled={form.isLoading}
              />
            </div>
          </Group>
          {form.isEditMode && (
            <>
              <Divider />
              <Group align="row" gap="12px" className={styles.Form}>
                <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
                  <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
                  <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
                </div>
              </Group>
            </>
          )}
        </div>
      ),
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, form.uuid, data?.ownerType]);

  return (
    <ModelFormWrapper
      paneId={form.paneId}
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined}
      isLoading={form.isLoading}
      showReload={form.isEditMode}
      readonly={!canWrite}
      isDirty={form.isDirty}
    />
  );
};
BankAccountsForm.displayName = "BankAccountsForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

interface BankAccountsListProps {
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
  ownerUuid?: string;
  ownerField?: string;
}

const BankAccountsList: FC<BankAccountsListProps> = ({ variant = 'default', onSelectItem, ownerUuid, ownerField } = {}) => {
  const isPartOf = !!ownerUuid;
  const componentName = isPartOf ? "BankAccountsList_part" : "BankAccountsList";
  const { addPane } = useAppContext().windows;
  const t = (key: string) => translate(key) || key;

  const ownerFilter = useMemo(() => {
    if (ownerUuid && ownerField) return { [ownerField]: { value: ownerUuid, operator: "equals" } };
    return undefined;
  }, [ownerUuid, ownerField]);

  const { error, refetch, buildTableProps } = useModelListState({
    model: MODEL_ENDPOINT, componentName, columnsJson,
    defaultSort: { id: "asc" },
    columnsVariant: isPartOf ? "part" : undefined,
    ownerFilter,
  });

  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    const newData = !isEdit && ownerUuid && ownerField
      ? { [ownerField]: ownerUuid } as unknown as TDataItem
      : d;
    addPane({
      label: makePaneLabelFromData("BankAccountsList", "Банковские счета", isEdit ? d as any : null, (d?.shortName || d?.iban) as string),
      component: BankAccountsForm, data: newData, onSave: () => refetch(), onClose: () => refetch(),
    });
  }, [addPane, t, refetch, componentName, ownerUuid, ownerField]);

  if (error) {
    return (
      <div className="error-container"><div className="error-message">
        <h3>{t("errorTitle") || "Ошибка загрузки"}</h3>
        <p>{(error as Error)?.message || "Неизвестная ошибка"}</p>
        <button onClick={() => refetch()} className="retry-button">{t("retry") || "Повторить"}</button>
      </div></div>
    );
  }

  return <Table {...buildTableProps({ variant, onSelectItem, openModelForm, enableDateRange: false })} />;
};

BankAccountsList.displayName = "BankAccountsList";
export { BankAccountsList, BankAccountsForm };
// export default memo(BankAccountsList);
