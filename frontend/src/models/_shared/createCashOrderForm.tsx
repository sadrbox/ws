/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Фабрика для кассовых ордеров (ПКО/РКО).
 * Оба документа имеют идентичную структуру — отличаются только endpoint/docType/метки.
 */
import { FC, useMemo, useCallback } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import { Field, FieldDateTime } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useAccessRight } from "src/hooks/useAccessRight";
import { useAutoFillPrimary } from "src/hooks/useAutoFillPrimary";
import { useUserPermissionDefaults } from "src/hooks/useUserPermissionDefaults";
import { useApplyPermissionDefaults } from "src/hooks/useApplyPermissionDefaults";
import { resolveOrgChangeFields } from "src/utils/createFromBasis";
import { useAppContext } from "src/app";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly, isoToLocalInput, localInputToIso } from "src/utils/datetime";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import DocumentEntriesButton from "src/components/AccountingEntries/DocumentEntriesButton";
import PrintDocumentPane from "src/components/PrintPreview/PrintDocumentPane";
import PrintDropdownButton from "src/components/Toolbar/PrintDropdownButton";
import CashOrderPrint from "src/models/_shared/CashOrderPrint";
import type { DocumentType } from "src/utils/validatePostedDocument";
import { validateDocumentFields, formatValidationErrors } from "src/utils/validatePostedDocument";
import { FormRequiredScope, FormDirtyScope } from "src/hooks/useFormRequired";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";

export interface CashOrderFormConfig {
  endpoint: string;
  listName: string;
  formLabel: string;
  storageKey: string;
  accessRightModel: string;
  docType: DocumentType;
  formDisplayName: string;
  columnsJson: any;
}

interface TFields {
  id?: number; uuid?: string;
  date: string; comment: string; amount: string;
  posted: boolean;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
  cashboxUuid: string; cashboxName: string;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  date: "", comment: "", amount: "",
  posted: false,
  organizationUuid: "", organizationName: "",
  counterpartyUuid: "", counterpartyName: "",
  contractUuid: "", contractName: "",
  cashboxUuid: "", cashboxName: "",
  authorUuid: "", authorName: "",
};

export function createCashOrderForm(cfg: CashOrderFormConfig): {
  Form: FC<Partial<TPane>>;
  List: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }>;
} {
  const Form: FC<Partial<TPane>> = (paneProps) => {
    const defaultOrg = useDefaultOrganization();
    const { canWrite } = useAccessRight(cfg.accessRightModel);
    const { auth: { user: currentUser }, windows: { addPane } } = useAppContext();

    const initialFields: TFields | undefined = (() => {
      const data = paneProps.data;
      if (data?.uuid) return undefined;
      const init = { ...DEFAULT_FIELDS };
      init.date = isoToLocalInput(new Date().toISOString());
      if (data?.organizationUuid) {
        init.organizationUuid = data?.organizationUuid as string;
        init.organizationName = (data?.organizationName as string) || "";
      } else if (defaultOrg.organizationUuid) {
        init.organizationUuid = defaultOrg.organizationUuid;
        init.organizationName = defaultOrg.organizationName;
      }
      if (data?.counterpartyUuid) {
        init.counterpartyUuid = data?.counterpartyUuid as string;
        init.counterpartyName = (data?.counterpartyName as string) || "";
      }
      return init;
    })();

    const form = useFormStore<TFields>({
      endpoint: cfg.endpoint,
      storageKey: cfg.storageKey,
      defaultFields: DEFAULT_FIELDS,
      initialFields,
      paneProps,
      mapServerToForm: (d, prev) => ({
        ...(prev ?? DEFAULT_FIELDS), ...d,
        date: isoToLocalInput(d.date),
        comment: d.comment ?? "",
        amount: d.amount != null ? String(d.amount) : "",
        posted: d.posted === true,
        organizationUuid: d.organizationUuid ?? "",
        organizationName: d.organization?.name ?? "",
        counterpartyUuid: d.counterpartyUuid ?? "",
        counterpartyName: d.counterparty?.name ?? "",
        contractUuid: d.contractUuid ?? "",
        contractName: d.contract?.name ?? "",
        cashboxUuid: d.cashboxUuid ?? "",
        cashboxName: d.cashbox?.name ?? "",
        authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
        authorName: d.author?.username ?? d.author?.email ?? "",
      }),
      buildPayload: (fd) => {
        const validation = validateDocumentFields(cfg.docType, fd as unknown as Record<string, unknown>);
        if (!validation.isValid) return formatValidationErrors(validation.errors);
        return {
          date: localInputToIso(fd.date),
          comment: fd.comment?.trim() || null,
          amount: fd.amount ? parseFloat(fd.amount) : null,
          posted: fd.posted === true,
          organizationUuid: fd.organizationUuid || null,
          counterpartyUuid: fd.counterpartyUuid || null,
          contractUuid: fd.contractUuid || null,
          cashboxUuid: fd.cashboxUuid || null,
        };
      },
      buildPaneLabel: (saved) => makeDocLabel(cfg.listName, cfg.formLabel, saved, "date"),
    });

    const handleContractSelect = useCallback((uuid: string, displayValue: string, item: Record<string, any>) => {
      const updates: Partial<TFields> = { contractUuid: uuid, contractName: displayValue };
      if (item.organizationUuid) { updates.organizationUuid = item.organizationUuid; updates.organizationName = item.organization?.name ?? ""; }
      if (item.counterpartyUuid) { updates.counterpartyUuid = item.counterpartyUuid; updates.counterpartyName = item.counterparty?.name ?? ""; }
      form.setFields(updates);
    }, [form.setFields]);

    // Смена организации: зависимые поля (договор, касса) → дефолт пользователя
    // для новой орг, иначе очистка.
    const handleOrganizationSelect = useCallback(async (uuid: string, displayValue: string) => {
      const cur = form.store.getSnapshot().fields as any;
      if (cur.organizationUuid === uuid) return;
      form.setFields({ organizationUuid: uuid, organizationName: displayValue } as Partial<TFields>);
      const patch = await resolveOrgChangeFields(uuid, currentUser?.uuid ?? "", [
        { valueType: "contract", uuidKey: "contractUuid", nameKey: "contractName" },
        { valueType: "cashbox", uuidKey: "cashboxUuid", nameKey: "cashboxName" },
      ]);
      form.setFields(patch as Partial<TFields>);
    }, [form.setFields, form.store, currentUser?.uuid]);

    const contractScope = useMemo<Record<string, string> | null>(() => {
      if (!form.fields.organizationUuid) return null;
      const s: Record<string, string> = { organizationUuid: form.fields.organizationUuid };
      if (form.fields.counterpartyUuid) s.counterpartyUuid = form.fields.counterpartyUuid;
      return s;
    }, [form.fields.organizationUuid, form.fields.counterpartyUuid]);

    useAutoFillPrimary({
      endpoint: "contracts", scope: contractScope, currentUuid: form.fields.contractUuid,
      isEditMode: form.isEditMode, isLoading: form.isLoading,
      apply: (uuid, name) => form.setFieldsInitial({ contractUuid: uuid, contractName: name } as Partial<TFields>),
    });

    const permDefaults = useUserPermissionDefaults(
      currentUser?.uuid ?? "",
      form.fields.organizationUuid,
    );
    useApplyPermissionDefaults({
      defaults: permDefaults,
      organizationUuid: form.fields.organizationUuid,
      isEditMode: form.isEditMode,
      isLoading: form.isLoading,
      fieldMappings: [
        { type: "contract", uuidKey: "contractUuid", nameKey: "contractName" },
        { type: "cashbox", uuidKey: "cashboxUuid", nameKey: "cashboxName" },
      ],
      currentValues: { contractUuid: form.fields.contractUuid, cashboxUuid: form.fields.cashboxUuid },
      apply: (fields) => form.setFieldsInitial(fields as Partial<TFields>),
    });

    const tabs = useMemo(() => [
      {
        id: "tab-details",
        label: translate("general"),
        component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              <GroupCol>
                <GroupRow style={{ width: "100%", justifyContent: "space-between" }}>
                  <FieldDateTime label={translate("date")} name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="180px" />
                  <FieldToggle name={`${form.formUid}_posted`} label={translate("posted")} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} variant="success" />
                </GroupRow>
                <Group>
                  <LookupField label={translate("organization")} name={`${form.formUid}_organizationUuid`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="name"
                    onSelect={handleOrganizationSelect}
                    onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)}
                    disabled={form.isLoading} />
                </Group>
                <Group>
                  <LookupField label={translate("counterparty")} name={`${form.formUid}_counterpartyUuid`} value={form.fields.counterpartyUuid} displayValue={form.fields.counterpartyName} endpoint="counterparties" displayField="name"
                    onSelect={(u, d) => form.setFields({ counterpartyUuid: u, counterpartyName: d } as Partial<TFields>)}
                    onClear={() => form.setFields({ counterpartyUuid: "", counterpartyName: "" } as Partial<TFields>)}
                    disabled={form.isLoading} />
                  <LookupField label={translate("contract")} name={`${form.formUid}_contractUuid`} value={form.fields.contractUuid} displayValue={form.fields.contractName} endpoint="contracts" displayField="name"
                    onSelect={handleContractSelect}
                    onClear={() => form.setFields({ contractUuid: "", contractName: "" } as Partial<TFields>)}
                    disabled={form.isLoading}
                    extraParams={{
                      ...(form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : {}),
                      ...(form.fields.counterpartyUuid ? { counterpartyUuid: form.fields.counterpartyUuid } : {}),
                    }} />
                </Group>
                <GroupRow>
                  <Field label={translate("amount")} name={`${form.formUid}_amount`} width="200px" value={form.fields.amount} onChange={e => form.setField("amount", e.target.value)} disabled={form.isLoading} />
                  <LookupField label={translate("cashbox")} name={`${form.formUid}_cashboxUuid`} value={form.fields.cashboxUuid} displayValue={form.fields.cashboxName} endpoint="cashboxes" displayField="name"
                    onSelect={(u, d) => form.setFields({ cashboxUuid: u, cashboxName: d } as Partial<TFields>)}
                    onClear={() => form.setFields({ cashboxUuid: "", cashboxName: "" } as Partial<TFields>)}
                    disabled={form.isLoading}
                    extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
                </GroupRow>
              </GroupCol>
            </div>
            {form.isEditMode && <Group align="row" style={{ flex: 1, alignItems: "end", justifyContent: "end", gap: 6 }}>
              <Field label={translate("Comment")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} />
              <Field label={translate("Author")} name={`${form.formUid}_author`} value={form.fields.authorName || ""} disabled width="auto" />
            </Group>}
          </div>
        ),
      },
    ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleContractSelect, handleOrganizationSelect, canWrite]);

    const isSavedDoc = form.isEditMode && !!form.fields.uuid;

    const isReceipt = cfg.docType === "cash_receipt_order";
    const handlePrint = useCallback(() => {
      if (!form.fields.uuid) return;
      const title = isReceipt ? "ПРИХОДНЫЙ КАССОВЫЙ ОРДЕР" : "РАСХОДНЫЙ КАССОВЫЙ ОРДЕР";
      addPane({
        component: PrintDocumentPane,
        isSelector: true,
        label: `${cfg.formLabel} № ${form.fields.id ?? "—"}`,
        data: {
          id: Number(form.fields.id ?? 0),
          uuid: String(form.fields.uuid ?? ""),
          columnsKey: cfg.docType,
          columnDefs: [],
          buildLayout: () => (
            <CashOrderPrint data={{
              title,
              amountLabel: isReceipt ? "Принято" : "Выдано",
              documentId: form.fields.id,
              documentDate: form.fields.date,
              amount: form.fields.amount ? parseFloat(form.fields.amount) : 0,
              organizationName: form.fields.organizationName,
              counterpartyName: form.fields.counterpartyName,
              contractName: form.fields.contractName,
              cashboxName: form.fields.cashboxName,
              comment: form.fields.comment,
            }} />
          ),
          fileBaseName: `${isReceipt ? "ПКО" : "РКО"}_${form.fields.id ?? "новый"}`,
          title: `${cfg.formLabel} № ${form.fields.id ?? "—"}`,
        },
      });
    }, [form.fields, addPane, isReceipt]);

    const headerActionsPortal = usePaneHeaderActions(
      form.paneId,
      isSavedDoc ? (
        <>
          <PrintDropdownButton options={[{ id: "print", label: "Печать" }]} onSelect={handlePrint} title="Печать" />
          <DocumentEntriesButton documentType={cfg.docType} documentUuid={form.fields.uuid} />
        </>
      ) : null,
    );

    return (
      <FormRequiredScope docType={cfg.docType} active={form.meta.headerValidationFailed}>
        <FormDirtyScope dirtyKeys={form.unsavedFields}>
          <ModelForm
            paneId={form.paneId} tabs={tabs}
            onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
            onReload={form.isEditMode ? form.handleReload : undefined}
            isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
            readonly={!canWrite}
          />
          {headerActionsPortal}
        </FormDirtyScope>
      </FormRequiredScope>
    );
  };
  Form.displayName = cfg.formDisplayName;

  const List: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
    { variant, onSelectItem, ownerUuid, ownerField }
  ) => (
    <ModelList
      endpoint={cfg.endpoint} listName={cfg.listName} columnsJson={cfg.columnsJson} FormComponent={Form}
      getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
      variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
      defaultSort={{ id: "desc" }} enableDateRange
      renderCell={renderPostedCell}
    />
  );
  List.displayName = cfg.listName;

  return { Form, List };
}
