/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Банковская выписка (одна операция: поступление/списание по расчётному счёту).
 * Header-документ без позиций; проводится (Дт1030/Кт1210 для in, Дт3310/Кт1030
 * для out — см. backend/services/accountingPosting.js).
 */
import { FC, useMemo, useCallback, useState } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldNumber, FieldDateTime, FieldSelect } from "src/components/Field";
import HeaderTogglePosted from "src/components/PaneHeader/HeaderTogglePosted";
import { FormLookup } from "src/components/Field/FormLookup";
import BasisDocumentField from "src/components/Field/BasisDocumentField";
import { useBasisMismatch } from "src/hooks/useBasisMismatch";
import { mapCommonTradeFields, resolveOrgChangeFields, refillFromBasisSource } from "src/utils/createFromBasis";
import RefillFromBasisButton from "src/models/_shared/RefillFromBasisButton";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { useAppContext } from "src/app";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly, isoToLocalInput, localInputToIso } from "src/utils/datetime";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import { useAssignNumber } from "src/hooks/useAssignNumber";
import DocumentEntriesButton from "src/components/AccountingEntries/DocumentEntriesButton";
import DocumentChainButton from "src/components/DocumentChain/DocumentChainButton";
import PrintDocumentPane from "src/components/PrintPreview/PrintDocumentPane";
import PrintDropdownButton from "src/components/Toolbar/PrintDropdownButton";
import BankStatementPrint from "./BankStatementPrint";
import { validateDocumentFields, formatValidationErrors, getDocumentFillHint } from "src/utils/validatePostedDocument";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";

const ENDPOINT = "bank-statements";
const LIST_NAME = "BankStatementsList";
const DOC_TYPE = "bank_statement" as const;

interface TFields {
  id?: number; uuid?: string;
  number: string;
  date: string; comment: string; amount: string; direction: string;
  posted: boolean;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
  bankAccountUuid: string; bankAccountName: string;
  authorUuid: string; authorName: string;
  basisDocumentType: string; basisDocumentUuid: string; basisDocumentLabel: string;
}

const DEFAULT_FIELDS: TFields = {
  number: "",
  date: "", comment: "", amount: "", direction: "bankStatementIn",
  posted: true,
  organizationUuid: "", organizationName: "",
  counterpartyUuid: "", counterpartyName: "",
  contractUuid: "", contractName: "",
  bankAccountUuid: "", bankAccountName: "",
  authorUuid: "", authorName: "",
  basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "",
};

const BankStatementsForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useUserAccessRight("BankStatement");
  const { auth: { user: currentUser }, windows: { addPane } } = useAppContext();

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data as any;
    if (data?.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    init.date = isoToLocalInput(new Date().toISOString());
    if (data?.organizationUuid) {
      init.organizationUuid = data.organizationUuid as string;
      init.organizationName = (data.organizationName as string) || "";
    } else if (defaultOrg.organizationUuid) {
      init.organizationUuid = defaultOrg.organizationUuid;
      init.organizationName = defaultOrg.organizationName;
    }
    if (data?.counterpartyUuid) {
      init.counterpartyUuid = data.counterpartyUuid as string;
      init.counterpartyName = (data.counterpartyName as string) || "";
    }
    return init;
  })();

  const form = useFormStore<TFields>({
    endpoint: ENDPOINT,
    storageKey: "bank-statements-form",
    defaultFields: DEFAULT_FIELDS,
    initialFields,
    paneProps,
    mapServerToForm: (d: any, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      number: d.number ?? "",
      date: isoToLocalInput(d.date),
      comment: d.comment ?? "",
      amount: d.amount != null ? String(d.amount) : "",
      direction: d.direction ?? "bankStatementIn",
      posted: d.posted === true,
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.name ?? "",
      counterpartyUuid: d.counterpartyUuid ?? "",
      counterpartyName: d.counterparty?.name ?? "",
      contractUuid: d.contractUuid ?? "",
      contractName: d.contract?.name ?? "",
      bankAccountUuid: d.bankAccountUuid ?? "",
      bankAccountName: d.bankAccount?.name ?? "",
      authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
      authorName: d.author?.username ?? d.author?.email ?? "",
      basisDocumentType: d.basisDocumentType ?? "",
      basisDocumentUuid: d.basisDocumentUuid ?? "",
      basisDocumentLabel: d.basisDocumentLabel ?? "",
    }),
    buildPayload: (fd) => {
      const validation = validateDocumentFields(DOC_TYPE, fd as unknown as Record<string, unknown>);
      if (!validation.isValid) return formatValidationErrors(validation.errors);
      return {
        number: fd.number?.trim() || null,
        date: localInputToIso(fd.date),
        comment: fd.comment?.trim() || null,
        amount: fd.amount ? parseFloat(fd.amount) : null,
        direction: fd.direction || "bankStatementIn",
        posted: fd.posted === true,
        organizationUuid: fd.organizationUuid || null,
        counterpartyUuid: fd.counterpartyUuid || null,
        contractUuid: fd.contractUuid || null,
        bankAccountUuid: fd.bankAccountUuid || null,
        basisDocumentType: fd.basisDocumentType || null,
        basisDocumentUuid: fd.basisDocumentUuid || null,
        basisDocumentLabel: fd.basisDocumentLabel || null,
      };
    },
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, translate("docType_bank_statement"), saved, "date"),
  });

  const handleContractSelect = useCallback((uuid: string, displayValue: string, item: Record<string, any>) => {
    const updates: Partial<TFields> = { contractUuid: uuid, contractName: displayValue };
    if (item.organizationUuid) { updates.organizationUuid = item.organizationUuid; updates.organizationName = item.organization?.name ?? ""; }
    if (item.counterpartyUuid) { updates.counterpartyUuid = item.counterpartyUuid; updates.counterpartyName = item.counterparty?.name ?? ""; }
    form.setFields(updates);
  }, [form.setFields]);

  // Смена организации: зависимые поля (договор, банк-счёт) → дефолт пользователя
  // для новой орг, иначе очистка.
  const handleOrganizationSelect = useCallback(async (uuid: string, displayValue: string) => {
    const cur = form.store.getSnapshot().fields as any;
    if (cur.organizationUuid === uuid) return;
    form.setFields({ organizationUuid: uuid, organizationName: displayValue } as Partial<TFields>);
    const patch = await resolveOrgChangeFields(uuid, currentUser?.uuid ?? "", [
      { valueType: "contract", uuidKey: "contractUuid", nameKey: "contractName" },
      { valueType: "bankAccount", uuidKey: "bankAccountUuid", nameKey: "bankAccountName" },
    ]);
    form.setFields(patch as Partial<TFields>);
  }, [form.setFields, form.store, currentUser?.uuid]);

  const basisMismatch = useBasisMismatch({
    basisType: form.fields.basisDocumentType,
    basisUuid: form.fields.basisDocumentUuid,
    currentFields: form.fields,
    currentItems: [],
    mapFields: mapCommonTradeFields,
    ignoreItems: true, // банк-выписка без табличной части — сверяем только шапку
  });

  const hasBasis = !!form.fields.basisDocumentUuid;
  const [isRefilling, setIsRefilling] = useState(false);

  // Header-документ без позиций: перезаполняем только поля шапки
  // (организация/контрагент/договор) из документа-основания.
  const handleRefillFromBasis = useCallback(async () => {
    const snap = form.store.getSnapshot().fields as any;
    if (!snap.basisDocumentUuid || !snap.basisDocumentType) return;
    setIsRefilling(true);
    try {
      const result = await refillFromBasisSource(snap.basisDocumentType, snap.basisDocumentUuid, mapCommonTradeFields);
      if (!result) return;
      const cur = form.store.getSnapshot().fields as any;
      // Только поля, существующие у банк-выписки (склад и т.п. отбрасываются).
      const patch = Object.fromEntries(
        Object.keys(result.fields).filter(k => k in cur).map(k => [k, result.fields[k]]),
      ) as Partial<TFields>;
      if (Object.keys(patch).some(k => String(cur[k] ?? "") !== String((patch as any)[k] ?? ""))) {
        form.setFields(patch);
      }
    } catch (e) {
      console.error("[refill] failed", e);
    } finally {
      setIsRefilling(false);
    }
  }, [form]);

  const assignNumber = useAssignNumber();

  const tabs = useMemo(() => [
    {
      id: "tab-details",
      label: translate("general"),
      component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupRow className={styles.FormHeaderRow}>
              <FieldDateTime label={translate("date")} name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="200px" />
              <Field label={translate("documentNumber")} name={`${form.formUid}_number`} value={form.fields.number} onChange={e => form.setField("number", e.target.value)} disabled={form.isLoading} width="200px" maxLength={9}
                actions={[
                  { type: "assignNumber", onClick: () => void assignNumber(ENDPOINT, form.fields.organizationUuid, form.fields.number, (n) => form.setField("number", n), form.fields.date, form.fields.uuid) },
                ]} />
            </GroupRow>
            <Group>
              <FormLookup form={form} field="organization" endpoint="organizations"
                onSelect={handleOrganizationSelect} />
            </Group>
            <Group>
              <FormLookup form={form} field="counterparty" endpoint="counterparties" />
              <FormLookup form={form} field="contract" endpoint="contracts"
                onSelect={handleContractSelect}
                extraParams={{
                  ...(form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : {}),
                  ...(form.fields.counterpartyUuid ? { counterpartyUuid: form.fields.counterpartyUuid } : {}),
                }} />
            </Group>
            <Group>
              <FormLookup form={form} field="bankAccount" endpoint="bankaccounts" label="BankAccountsList"
                extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
            </Group>
            <GroupRow>
              <Group className={styles.w1of2}>
                <FieldSelect
                  label={translate("bankStatementDirection")}
                  name={`${form.formUid}_direction`}
                  value={form.fields.direction}
                  options={[
                    { value: "bankStatementIn", label: translate("bankStatementIn") },
                    { value: "bankStatementOut", label: translate("bankStatementOut") },
                  ]}
                  onChange={e => form.setField("direction", e.target.value)}
                  disabled={form.isLoading || !canWrite}
                />
              </Group>
              <Group className={styles.w1of2}>
                <FieldNumber label={translate("amount")} name={`${form.formUid}_amount`} width="200px" value={form.fields.amount} onChange={e => form.setField("amount", e.target.value)} disabled={form.isLoading} decimals={2} />
              </Group>
            </GroupRow>
            <GroupCol>
              <BasisDocumentField
                allowedTypes={[
                  { type: "payment_invoice", endpoint: "payment-invoices" },
                  { type: "incoming_invoice", endpoint: "incoming-invoices" },
                  { type: "outgoing_invoice", endpoint: "outgoing-invoices" },
                ]}
                basisDocumentType={form.fields.basisDocumentType}
                basisDocumentUuid={form.fields.basisDocumentUuid}
                basisDocumentLabel={form.fields.basisDocumentLabel}
                formUid={form.formUid}
                disabled={form.isLoading}
                onSelect={(type, uuid, label) => form.setFields({ basisDocumentType: type, basisDocumentUuid: uuid, basisDocumentLabel: label } as Partial<TFields>)}
                onClear={() => form.setFields({ basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "" } as Partial<TFields>)}
                mismatch={basisMismatch.mismatch}
                mismatchDetails={basisMismatch.differences}
                hint={getDocumentFillHint(DOC_TYPE, form.fields as unknown as Record<string, unknown>)}
              />
            </GroupCol>
          </div>
          {form.isEditMode && <GroupCol className={styles.FormFooterCol}>
            <GroupRow className={styles.FormHeaderRow}>
              <Field label={translate("Comment")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} />
              <Field label={translate("Author")} name={`${form.formUid}_author`} value={form.fields.authorName || ""} disabled width="auto" />
            </GroupRow>
          </GroupCol>}
        </div>
      ),
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleContractSelect, handleOrganizationSelect, canWrite, basisMismatch.mismatch, basisMismatch.differences]);

  const isSavedDoc = form.isEditMode && !!form.fields.uuid;

  const handlePrint = useCallback(() => {
    if (!form.fields.uuid) return;
    addPane({
      component: PrintDocumentPane,
      isSelector: true,
      label: `Банковская выписка № ${form.fields.id ?? "—"}`,
      data: {
        id: Number(form.fields.id ?? 0),
        uuid: String(form.fields.uuid ?? ""),
        columnsKey: "bank_statement",
        columnDefs: [],
        buildLayout: () => (
          <BankStatementPrint data={{
            documentId: form.fields.id, documentNumber: form.fields.number || undefined,
            documentDate: form.fields.date,
            direction: form.fields.direction,
            amount: form.fields.amount ? parseFloat(form.fields.amount) : 0,
            organizationName: form.fields.organizationName,
            counterpartyName: form.fields.counterpartyName,
            contractName: form.fields.contractName,
            bankAccountName: form.fields.bankAccountName,
            basisLabel: form.fields.basisDocumentLabel,
          }} />
        ),
        fileBaseName: `БанкВыписка_${form.fields.id ?? "новый"}`,
        title: `Банковская выписка № ${form.fields.id ?? "—"}`,
      },
    });
  }, [form.fields, addPane]);

  const headerActionsPortal = usePaneHeaderActions(
    form.paneId,
    (
      <>
        {/* Единый порядок шапки: Проведён → Цепочка → Проводки → Перезаполнить → Печать. */}
        <HeaderTogglePosted name={`${form.formUid}_posted`} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} />
        {isSavedDoc && <DocumentChainButton documentType={DOC_TYPE} documentUuid={form.fields.uuid} />}
        {isSavedDoc && <DocumentEntriesButton documentType={DOC_TYPE} documentUuid={form.fields.uuid} />}
        {hasBasis && (
          <RefillFromBasisButton
            mismatch={basisMismatch.mismatch}
            mismatchDetails={basisMismatch.differences}
            disabled={form.isLoading || isRefilling}
            loading={isRefilling}
            onClick={() => void handleRefillFromBasis()}
          />
        )}
        {isSavedDoc && <PrintDropdownButton options={[{ id: "print", label: "Печать" }]} onSelect={handlePrint} title="Печать" />}
      </>
    ),
  );

  return (
    <>
      <ModelForm
        paneId={form.paneId} endpoint={ENDPOINT} recordUuid={form.fields.uuid} tabs={tabs}
        onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
        onReload={form.isEditMode ? form.handleReload : undefined}
        isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
        readonly={!canWrite}
      />
      {headerActionsPortal}
    </>
  );
};
BankStatementsForm.displayName = "BankStatementsForm";

const BankStatementsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={BankStatementsForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
    defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
BankStatementsList.displayName = LIST_NAME;

export { BankStatementsForm, BankStatementsList };
