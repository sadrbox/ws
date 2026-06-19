import { FC, useCallback, useMemo } from "react";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
import { FormLookup } from "src/components/Field/FormLookup";
import OwnerLookupField, { OwnerType } from "src/components/Field/OwnerLookupField";
import PrimaryToolbarButton from "src/components/PrimaryToolbarButton";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useAppContext } from "src/app";
import { useQueryClient } from "@tanstack/react-query";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { makePaneLabelFromData } from "src/utils/buildPaneLabel";

import { useFormStore } from "src/hooks/useFormStore";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { makePaneLabel } from "src/utils/buildPaneLabel";

const MODEL_ENDPOINT = "bankaccounts";

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFields {
  id?: number;
  uuid?: string;
  name: string;
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
  name: "", iban: "", bik: "", bankName: "",
  currencyUuid: "", currencyName: "",
  ownerType: "", ownerUuid: "", ownerName: "",
};

const BankAccountsForm: FC<Partial<TPane>> = (paneProps) => {
  const data = paneProps.data;
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useUserAccessRight("BankAccount");

  const initialFields: TFields | undefined = (() => {
    if (data?.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    if (data?.ownerType) {
      init.ownerType = data?.ownerType as OwnerType;
      init.ownerUuid = (data?.ownerUuid as string) || "";
      init.ownerName = (data?.ownerName as string) || "";
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
        name: d.name ?? "",
        iban: d.iban ?? "",
        bik: d.bik ?? "",
        bankName: d.bankName ?? "",
        currencyUuid: d.currencyUuid ?? "",
        currencyName: d.currency ? `${d.currency.code} — ${d.currency.name}` : "",
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
        name: fd.name?.trim() || null,
        iban: fd.iban.trim(),
        bik: fd.bik?.trim() || null,
        bankName: fd.bankName?.trim() || null,
        currencyUuid: fd.currencyUuid || null,
        ownerType: fd.ownerType || null,
        ownerUuid: fd.ownerUuid || null,
      };
    },
    buildPaneLabel: (saved) =>
      makePaneLabel("BankAccountsList", "Банковские счета", saved, saved.name || saved.iban),
  });

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <Group>
                <Field label={translate("name")} name={`${form.formUid}_name`} minWidth={FIELD_WIDTH.lg} value={form.fields.name} onChange={e => form.setField("name", e.target.value)} disabled={form.isLoading} />
                <Field label={translate("iban")} name={`${form.formUid}_iban`} minWidth={FIELD_WIDTH.lg} value={form.fields.iban} onChange={e => form.setField("iban", e.target.value)} disabled={form.isLoading} required />
              </Group>
              <GroupRow>
                <Group className={styles.w1of2}>
                  <Field label={translate("bik")} name={`${form.formUid}_bik`} minWidth="200px" value={form.fields.bik} onChange={e => form.setField("bik", e.target.value)} disabled={form.isLoading} />
                </Group>
                <Group className={styles.w1of2}>
                  <FormLookup form={form} field="currency" endpoint="currencies" displayField="code" minWidth="250px"
                    onSelect={(uuid, _display, item) => form.setFields({ currencyUuid: uuid, currencyName: uuid ? `${item.code} — ${item.name}` : "" } as any)} />
                </Group>
              </GroupRow>
              <Group>
                <Field label={translate("bankName")} name={`${form.formUid}_bankName`} minWidth={FIELD_WIDTH.lg} value={form.fields.bankName} onChange={e => form.setField("bankName", e.target.value)} disabled={form.isLoading} />
              </Group>
              <Group>
                <OwnerLookupField ownerType={form.fields.ownerType} ownerUuid={form.fields.ownerUuid} ownerName={form.fields.ownerName}
                  name={`${form.formUid}_owner`} onOwnerChange={({ ownerType, ownerUuid, ownerName }) => form.setFields({ ownerType, ownerUuid, ownerName } as any)}
                  typeLocked={!form.uuid && !!data?.ownerType} allowedTypes={["organization", "counterparty"]} disabled={form.isLoading} />
              </Group>
            </GroupCol>
          </div>
        </div>
      ),
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, form.uuid, data?.ownerType]);

  return (
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
  extraQueryParams?: Record<string, string>;
}

const BankAccountsList: FC<BankAccountsListProps> = ({ variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }) => (
  <ModelList
    endpoint={MODEL_ENDPOINT}
    listName="BankAccountsList"
    columnsJson={columnsJson}
    FormComponent={BankAccountsForm}
    getLabel={(d) => (d?.name as string | undefined) || (d?.iban as string | undefined) || ""}
    variant={variant}
    onSelectItem={onSelectItem}
    ownerUuid={ownerUuid}
    ownerField={ownerField}
    extraQueryParams={extraQueryParams}
  />
);

BankAccountsList.displayName = "BankAccountsList";

// ═══════════════════════════════════════════════════════════════════════════
// TABLE — SubTable для вложенного списка счетов внутри форм
// ═══════════════════════════════════════════════════════════════════════════

const BA_TABLE_ENDPOINT = "bankaccounts";
const BA_TABLE_COMPONENT = "BankAccountsList_part";

export interface BankAccountsTableProps {
  /** Тип владельца: "organization", "counterparty" */
  ownerType: string;
  /** UUID владельца */
  parentUuid: string;
  /** Имя владельца (для передачи в форму) */
  parentName?: string;
  disabled?: boolean;
  /** Если true — не отправлять изменения на сервер, хранить их локально */
  deferRemoteChanges?: boolean;
  /** Колбэк при изменении строк */
  onItemsChange?: (items: TDataItem[]) => void;
  /** Начальные pending-строки */
  initialPendingRows?: TDataItem[];
  /** Показывать кнопку «Сделать основным» и жирное выделение основного счёта */
  showPrimaryButton?: boolean;
}

const BankAccountsTable: FC<BankAccountsTableProps> = ({
  ownerType, parentUuid, parentName = "", disabled = false,
  deferRemoteChanges = false, onItemsChange, initialPendingRows,
  showPrimaryButton = false,
}) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();

  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "name") {
      if (ctx.inlineEditing) return <Field label="" name={`ba_name_${row.id}`} value={(row.name as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "name", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.name as string) ?? ""}</span>;
    }
    if (col.identifier === "iban") {
      if (ctx.inlineEditing) return <Field label="" name={`ba_iban_${row.id}`} value={(row.iban as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "iban", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.iban as string) ?? ""}</span>;
    }
    if (col.identifier === "bankName") {
      if (ctx.inlineEditing) return <Field label="" name={`ba_bankName_${row.id}`} value={(row.bankName as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "bankName", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.bankName as string) ?? ""}</span>;
    }
    if (col.identifier === "bik") {
      if (ctx.inlineEditing) return <Field label="" name={`ba_bik_${row.id}`} value={(row.bik as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "bik", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.bik as string) ?? ""}</span>;
    }
    return undefined;
  }, []);

  const openFormFor = useCallback((data: TDataItem | undefined, _ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: [BA_TABLE_ENDPOINT] });
      _ctx.refetch();
    };
    addPane({
      label: makePaneLabelFromData("BankAccountsList", "Банковские счета", isEdit ? data as any : null, (data?.name || data?.iban) as string),
      component: BankAccountsForm,
      data: isEdit ? data : { ownerType, ownerUuid: parentUuid, ownerName: parentName } as any,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, ownerType, parentUuid, parentName, queryClient]);

  const defaultNewRow = useMemo(() => ({
    name: "", iban: "", bik: "", bankName: "", currencyUuid: null,
  }), []);

  const adjustedColumns = useMemo(
    () => (columnsJson as any[]).map((col: any) => {
      if (col.identifier === "ownerName") return { ...col, visible: false, inlist: false };
      return col;
    }),
    [],
  );

  const primaryButton = useMemo(
    () => showPrimaryButton ? <PrimaryToolbarButton endpoint={BA_TABLE_ENDPOINT} disabled={disabled} /> : undefined,
    [showPrimaryButton, disabled],
  );

  return (
    <SubTable
      model={BA_TABLE_ENDPOINT}
      componentName={BA_TABLE_COMPONENT}
      columnsJson={adjustedColumns}
      parentKey="ownerUuid"
      parentUuid={parentUuid}
      extraQueryParams={{ ownerType }}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      onItemsChange={onItemsChange}
      emptyMessage={translate("saveToBankAccounts")}
      renderCell={renderCell}
      openFormFor={openFormFor}
      defaultNewRow={defaultNewRow}
      extraButtons={primaryButton}
      disablePrimaryRowHighlight={!showPrimaryButton}
    />
  );
};

BankAccountsTable.displayName = "BankAccountsTable";
export { BankAccountsList, BankAccountsForm, BankAccountsTable };
