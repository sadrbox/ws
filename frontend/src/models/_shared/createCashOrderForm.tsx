/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Фабрика для кассовых ордеров (ПКО/РКО).
 * Оба документа имеют идентичную структуру — отличаются только endpoint/docType/метки.
 */
import { FC, useMemo, useCallback, useState } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import { Field, FieldDateTime, FieldSelect } from "src/components/Field";
import BasisDocumentField from "src/components/Field/BasisDocumentField";
import { useAssignNumber } from "src/hooks/useAssignNumber";
import RefillFromBasisButton from "src/models/_shared/RefillFromBasisButton";
import { useBasisMismatch } from "src/hooks/useBasisMismatch";
import { refillFromBasisSource } from "src/utils/createFromBasis";
import { cashOperationTypes, defaultCashOperationType, findCashOperationType, type CashDirection } from "src/models/_shared/cashOperationTypes";
import FieldTogglePostedDocument from "src/components/Field/FieldTogglePostedDocument";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { useAutoFillPrimary } from "src/hooks/useAutoFillPrimary";
import { useUserDefaults } from "src/hooks/useUserDefaults";
import { useApplyUserDefaults } from "src/hooks/useApplyUserDefaults";
import { resolveOrgChangeFields } from "src/utils/createFromBasis";
import { useAppContext } from "src/app";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly, isoToLocalInput, localInputToIso } from "src/utils/datetime";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import ShowInJournalButton from "src/components/ShowInJournalButton";
import DocumentEntriesButton from "src/components/AccountingEntries/DocumentEntriesButton";
import PrintDocumentPane from "src/components/PrintPreview/PrintDocumentPane";
import PrintDropdownButton from "src/components/Toolbar/PrintDropdownButton";
import CashOrderPrint from "src/models/_shared/CashOrderPrint";
import type { DocumentType } from "src/utils/validatePostedDocument";
import { validateRequiredFields, formatValidationErrors } from "src/utils/validatePostedDocument";
import { FormRequiredScope, FormDirtyScope } from "src/hooks/useFormRequired";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";

export interface CashOrderFormConfig {
  endpoint: string;
  listName: string;
  formLabel: string;
  storageKey: string;
  userAccessRightModel: string;
  docType: DocumentType;
  formDisplayName: string;
  columnsJson: any;
}

interface TFields {
  id?: number; uuid?: string;
  number: string;
  date: string; comment: string; amount: string;
  posted: boolean;
  operationType: string;
  basisDocumentType: string; basisDocumentUuid: string; basisDocumentLabel: string;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
  employeeUuid: string; employeeName: string;
  cashboxUuid: string; cashboxName: string;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  number: "",
  date: "", comment: "", amount: "",
  posted: false,
  operationType: "",
  basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "",
  organizationUuid: "", organizationName: "",
  counterpartyUuid: "", counterpartyName: "",
  contractUuid: "", contractName: "",
  employeeUuid: "", employeeName: "",
  cashboxUuid: "", cashboxName: "",
  authorUuid: "", authorName: "",
};

// Серверная запись кассового ордера (вход mapServerToForm).
interface CashOrderServerRecord {
  id?: number;
  uuid?: string;
  number?: string | null;
  date?: string | null;
  comment?: string | null;
  amount?: number | string | null;
  posted?: boolean;
  operationType?: string | null;
  basisDocumentType?: string | null;
  basisDocumentUuid?: string | null;
  basisDocumentLabel?: string | null;
  organizationUuid?: string | null; organization?: { name?: string | null } | null;
  counterpartyUuid?: string | null; counterparty?: { name?: string | null } | null;
  contractUuid?: string | null; contract?: { name?: string | null } | null;
  employeeUuid?: string | null; employee?: { fullName?: string | null } | null;
  cashboxUuid?: string | null; cashbox?: { name?: string | null } | null;
  authorUuid?: string | null; author?: { uuid?: string | null; username?: string | null; email?: string | null } | null;
}

// Серверная запись документа-основания → поля шапки кассового ордера.
interface BasisSource {
  organizationUuid?: string | null; organization?: { name?: string | null } | null; organizationName?: string | null;
  counterpartyUuid?: string | null; counterparty?: { name?: string | null } | null; counterpartyName?: string | null;
  contractUuid?: string | null; contract?: { name?: string | null } | null; contractName?: string | null;
  amount?: number | string | null;
}
// Шапка для СРАВНЕНИЯ с основанием (без суммы — сумма может отличаться при частичной оплате).
function mapCashHeader(src: BasisSource): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (src.organizationUuid) { out.organizationUuid = src.organizationUuid; out.organizationName = src.organization?.name ?? src.organizationName ?? ""; }
  if (src.counterpartyUuid) { out.counterpartyUuid = src.counterpartyUuid; out.counterpartyName = src.counterparty?.name ?? src.counterpartyName ?? ""; }
  if (src.contractUuid) { out.contractUuid = src.contractUuid; out.contractName = src.contract?.name ?? src.contractName ?? ""; }
  return out;
}
// Шапка для ЗАПОЛНЕНИЯ — то же + сумма основания.
function mapCashRefill(src: BasisSource): Record<string, unknown> {
  const out = mapCashHeader(src);
  if (src.amount != null) out.amount = String(src.amount);
  return out;
}
// Обязательные поля зависят от типа операции (перевод банк↔касса не требует контрагента/договора).
function cashRequiredKeys(operationType: string, direction: CashDirection): string[] {
  const op = findCashOperationType(operationType) ?? cashOperationTypes(direction)[0];
  if (op.requiresEmployee) return ["date", "organizationUuid", "employeeUuid"];
  return op.requiresCounterparty
    ? ["date", "organizationUuid", "counterpartyUuid", "contractUuid"]
    : ["date", "organizationUuid"];
}

export function createCashOrderForm(cfg: CashOrderFormConfig): {
  Form: FC<Partial<TPane>>;
  List: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }>;
} {
  const isReceipt = cfg.docType === "cash_receipt_order";
  const direction: CashDirection = isReceipt ? "receipt" : "expense";

  const Form: FC<Partial<TPane>> = (paneProps) => {
    const defaultOrg = useDefaultOrganization();
    const { canWrite } = useUserAccessRight(cfg.userAccessRightModel);
    const { auth: { user: currentUser }, windows: { addPane } } = useAppContext();
    const [isRefilling, setIsRefilling] = useState(false);
    const assignNumber = useAssignNumber();

    const initialFields: TFields | undefined = (() => {
      const data = paneProps.data;
      if (data?.uuid) return undefined;
      const init = { ...DEFAULT_FIELDS };
      init.operationType = defaultCashOperationType(direction);
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
      mapServerToForm: (d: CashOrderServerRecord, prev) => ({
        ...(prev ?? DEFAULT_FIELDS), ...d,
        number: d.number ?? "",
        date: isoToLocalInput(d.date),
        comment: d.comment ?? "",
        amount: d.amount != null ? String(d.amount) : "",
        posted: d.posted === true,
        operationType: d.operationType ?? defaultCashOperationType(direction),
        basisDocumentType: d.basisDocumentType ?? "",
        basisDocumentUuid: d.basisDocumentUuid ?? "",
        basisDocumentLabel: d.basisDocumentLabel ?? "",
        organizationUuid: d.organizationUuid ?? "",
        organizationName: d.organization?.name ?? "",
        counterpartyUuid: d.counterpartyUuid ?? "",
        counterpartyName: d.counterparty?.name ?? "",
        contractUuid: d.contractUuid ?? "",
        contractName: d.contract?.name ?? "",
        employeeUuid: d.employeeUuid ?? "",
        employeeName: d.employee?.fullName ?? "",
        cashboxUuid: d.cashboxUuid ?? "",
        cashboxName: d.cashbox?.name ?? "",
        authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
        authorName: d.author?.username ?? d.author?.email ?? "",
      }),
      buildPayload: (fd) => {
        const reqKeys = cashRequiredKeys(fd.operationType, direction);
        const validation = validateRequiredFields(reqKeys, fd as unknown as Record<string, unknown>);
        if (!validation.isValid) return formatValidationErrors(validation.errors);
        return {
          number: fd.number?.trim() || null,
          date: localInputToIso(fd.date),
          comment: fd.comment?.trim() || null,
          amount: fd.amount ? parseFloat(fd.amount) : null,
          posted: fd.posted === true,
          operationType: fd.operationType || defaultCashOperationType(direction),
          basisDocumentType: fd.basisDocumentType || null,
          basisDocumentUuid: fd.basisDocumentUuid || null,
          basisDocumentLabel: fd.basisDocumentLabel || null,
          organizationUuid: fd.organizationUuid || null,
          counterpartyUuid: fd.counterpartyUuid || null,
          contractUuid: fd.contractUuid || null,
          employeeUuid: fd.employeeUuid || null,
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

    // ── Тип операции + документ-основание ──────────────────────────────────
    const opTypeOptions = useMemo(
      () => cashOperationTypes(direction).map((t) => ({ value: t.value, label: t.label })),
      [],
    );
    const currentOp = findCashOperationType(form.fields.operationType) ?? cashOperationTypes(direction)[0];
    const allowedBasisTypes = currentOp.basisTypes;
    const requiredKeys = useMemo(
      () => cashRequiredKeys(form.fields.operationType, direction),
      [form.fields.operationType],
    );

    // Заполнить шапку (контрагент/договор/орг/сумма) из документа-основания.
    const refillHeaderFromBasis = useCallback(async (type: string, uuid: string) => {
      try {
        const res = await refillFromBasisSource(type, uuid, mapCashRefill);
        if (res?.fields) form.setFields(res.fields as Partial<TFields>);
      } catch (e) {
        console.error("[cash refill] failed", e);
      }
    }, [form.setFields]);

    const handleBasisSelect = useCallback((type: string, uuid: string, label: string) => {
      form.setFields({ basisDocumentType: type, basisDocumentUuid: uuid, basisDocumentLabel: label } as Partial<TFields>);
      void refillHeaderFromBasis(type, uuid);
    }, [form.setFields, refillHeaderFromBasis]);

    const handleBasisClear = useCallback(() => {
      form.setFields({ basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "" } as Partial<TFields>);
    }, [form.setFields]);

    const handleRefillFromBasis = useCallback(async () => {
      if (!form.fields.basisDocumentType || !form.fields.basisDocumentUuid) return;
      setIsRefilling(true);
      try {
        await refillHeaderFromBasis(form.fields.basisDocumentType, form.fields.basisDocumentUuid);
      } finally {
        setIsRefilling(false);
      }
    }, [form.fields.basisDocumentType, form.fields.basisDocumentUuid, refillHeaderFromBasis]);

    // Смена типа операции: если текущее основание не входит в допустимые — очистить.
    const handleOperationTypeChange = useCallback((value: string) => {
      const op = findCashOperationType(value);
      const allowed = new Set((op?.basisTypes ?? []).map((t) => t.type));
      const patch: Partial<TFields> = { operationType: value };
      if (form.fields.basisDocumentType && !allowed.has(form.fields.basisDocumentType)) {
        patch.basisDocumentType = ""; patch.basisDocumentUuid = ""; patch.basisDocumentLabel = "";
      }
      form.setFields(patch);
    }, [form.setFields, form.fields.basisDocumentType]);

    const basisMismatch = useBasisMismatch({
      basisType: form.fields.basisDocumentType,
      basisUuid: form.fields.basisDocumentUuid,
      currentFields: form.fields,
      currentItems: [],
      mapFields: mapCashHeader,
      ignoreItems: true,
    });

    // Смена организации: зависимые поля (договор, касса) → дефолт пользователя
    // для новой орг, иначе очистка.
    const handleOrganizationSelect = useCallback(async (uuid: string, displayValue: string) => {
      const cur = form.store.getSnapshot().fields;
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

    const permDefaults = useUserDefaults(
      currentUser?.uuid ?? "",
      form.fields.organizationUuid,
    );
    useApplyUserDefaults({
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
                <GroupRow className={styles.FormHeaderRow}>
                  <Field label={translate("documentNumber")} name={`${form.formUid}_number`} value={form.fields.number} onChange={e => form.setField("number", e.target.value)} disabled={form.isLoading} width="150px" maxLength={9} placeholder={translate("autoOnSave")}
                    actions={[
                      { type: "assignNumber", onClick: () => void assignNumber(cfg.endpoint, form.fields.organizationUuid, form.fields.number, (n) => form.setField("number", n)) },
                      { type: "clear", onClick: () => form.setField("number", "") },
                    ]} />
                  <FieldDateTime label={translate("date")} name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="180px" />
                  <FieldTogglePostedDocument name={`${form.formUid}_posted`} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} />
                </GroupRow>
                <GroupRow>
                  <FieldSelect label={translate("operationType")} name={`${form.formUid}_operationType`}
                    value={form.fields.operationType} options={opTypeOptions}
                    onChange={(e) => handleOperationTypeChange(e.target.value)} disabled={form.isLoading} />
                </GroupRow>
                {allowedBasisTypes.length > 0 && (
                  <Group>
                    <BasisDocumentField
                      allowedTypes={allowedBasisTypes}
                      basisDocumentType={form.fields.basisDocumentType}
                      basisDocumentUuid={form.fields.basisDocumentUuid}
                      basisDocumentLabel={form.fields.basisDocumentLabel}
                      formUid={form.formUid}
                      disabled={form.isLoading}
                      onSelect={handleBasisSelect}
                      onClear={handleBasisClear}
                      mismatch={basisMismatch.mismatch}
                      mismatchDetails={basisMismatch.differences}
                    />
                  </Group>
                )}
                <Group>
                  <LookupField label={translate("organization")} name={`${form.formUid}_organizationUuid`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="name"
                    onSelect={handleOrganizationSelect}
                    onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)}
                    disabled={form.isLoading} />
                </Group>
                {currentOp.requiresEmployee ? (
                  <Group>
                    <LookupField label={translate("employee")} name={`${form.formUid}_employeeUuid`} value={form.fields.employeeUuid} displayValue={form.fields.employeeName} endpoint="employees" displayField="fullName"
                      onSelect={(u, d) => form.setFields({ employeeUuid: u, employeeName: d } as Partial<TFields>)}
                      onClear={() => form.setFields({ employeeUuid: "", employeeName: "" } as Partial<TFields>)}
                      disabled={form.isLoading}
                      extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
                  </Group>
                ) : (
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
                )}
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
            {form.isEditMode && <Group className={styles.FormFooterRow}>
              <Field label={translate("Comment")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} />
              <Field label={translate("Author")} name={`${form.formUid}_author`} value={form.fields.authorName || ""} disabled width="auto" />
            </Group>}
          </div>
        ),
      },
    ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleContractSelect, handleOrganizationSelect, canWrite, opTypeOptions, allowedBasisTypes, currentOp.requiresEmployee, handleOperationTypeChange, handleBasisSelect, handleBasisClear, basisMismatch.mismatch, basisMismatch.differences, assignNumber]);

    const isSavedDoc = form.isEditMode && !!form.fields.uuid;

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
              documentNumber: form.fields.number || undefined,
              documentDate: form.fields.date,
              amount: form.fields.amount ? parseFloat(form.fields.amount) : 0,
              organizationName: form.fields.organizationName,
              counterpartyName: form.fields.counterpartyName,
              contractName: form.fields.contractName,
              cashboxName: form.fields.cashboxName,
              operationTypeLabel: currentOp.label,
              basisDocumentLabel: form.fields.basisDocumentLabel,
              employeeName: form.fields.employeeName,
              comment: form.fields.comment,
            }} />
          ),
          fileBaseName: `${isReceipt ? "ПКО" : "РКО"}_${form.fields.id ?? "новый"}`,
          title: `${cfg.formLabel} № ${form.fields.id ?? "—"}`,
        },
      });
    }, [form.fields, addPane, currentOp.label]);

    const hasBasis = !!form.fields.basisDocumentUuid;
    const headerActionsPortal = usePaneHeaderActions(
      form.paneId,
      (isSavedDoc || hasBasis) ? (
        <>
          {isSavedDoc && <PrintDropdownButton options={[{ id: "print", label: "Печать" }]} onSelect={handlePrint} title="Печать" />}
          {isSavedDoc && <DocumentEntriesButton documentType={cfg.docType} documentUuid={form.fields.uuid} />}
          {isSavedDoc && <ShowInJournalButton endpoint={cfg.endpoint} uuid={form.fields.uuid} />}
          {hasBasis && (
            <RefillFromBasisButton
              mismatch={basisMismatch.mismatch}
              mismatchDetails={basisMismatch.differences}
              disabled={form.isLoading || isRefilling}
              loading={isRefilling}
              onClick={() => void handleRefillFromBasis()}
            />
          )}
        </>
      ) : null,
    );

    return (
      <FormRequiredScope requiredKeys={requiredKeys} active>
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
