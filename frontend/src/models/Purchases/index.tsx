/* eslint-disable @typescript-eslint/no-explicit-any */
// ─────────────────────────────────────────────────────────────────────────────
// PurchasesForm — Поступление товаров (Покупка). Структура зеркалирует
// SalesForm с учётом НК РК: НДС, акциз, Сумма скидки, ЭСФ-графы 4/6/7/8/13/14/15/16/17.
// ─────────────────────────────────────────────────────────────────────────────
import { FC, useMemo, useCallback, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import BasisDocumentField from "src/components/Field/BasisDocumentField";
import { useAssignNumber } from "src/hooks/useAssignNumber";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDateTime } from "src/components/Field";
import FieldTogglePostedDocument from "src/components/Field/FieldTogglePostedDocument";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import useOrgAccountingSettings from "src/hooks/useOrgAccountingSettings";
import { useAutoFillPrimary } from "src/hooks/useAutoFillPrimary";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly, isoToLocalInput, localInputToIso } from "src/utils/datetime";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import TradeDocumentItemsTable from "src/components/DocumentItemsTable/TradeDocumentItemsTable";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";
import { validateDocumentFields, formatValidationErrors, getDocumentFillHint } from "src/utils/validatePostedDocument";
import { FormRequiredScope, FormDirtyScope } from "src/hooks/useFormRequired";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import DocumentEntriesButton from "src/components/AccountingEntries/DocumentEntriesButton";
import DocumentChainButton from "src/components/DocumentChain/DocumentChainButton";
import ActionsDropdownButton from "src/components/Toolbar/ActionsDropdownButton";
import RefillFromBasisButton from "src/models/_shared/RefillFromBasisButton";
import { useAppContext } from "src/app";
import { openDocumentFromBasis, mapCommonTradeFields, resolveOrgChangeFields, runBasisRefill } from "src/utils/createFromBasis";
import { useBasisMismatch } from "src/hooks/useBasisMismatch";
import { PurchaseReturnsForm } from "src/models/PurchaseReturns";
import { useUserDefaults, type UserDefaultsMap } from "src/hooks/useUserDefaults";
import { useApplyUserDefaults } from "src/hooks/useApplyUserDefaults";
import { useExistingDependents, formatDependentOption } from "src/hooks/useExistingDependents";
import DocumentTotals from "src/components/DocumentTotals";

const MODEL_ENDPOINT = "purchases";
const LIST_NAME = "PurchasesList";
const FORM_LABEL = "Поступление товара и услуг";
const PURCHASES_DEPENDENT_ENDPOINTS = ["purchase-returns"];

interface TFields {
  id?: number; uuid?: string;
  number: string;
  date: string; comment: string;
  amount: number; vatAmount: number; discountAmount: number; amountWithoutVat: number;
  posted: boolean;
  organizationUuid: string; organizationName: string;
  warehouseUuid: string; warehouseName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
  priceTypeUuid: string; priceTypeName: string;
  authorUuid: string; authorName: string;
  basisDocumentType: string; basisDocumentUuid: string; basisDocumentLabel: string;
}

const DEFAULT_FIELDS: TFields = {
  number: "",
  date: "", comment: "",
  amount: 0, vatAmount: 0, discountAmount: 0, amountWithoutVat: 0,
  posted: false,
  organizationUuid: "", organizationName: "",
  warehouseUuid: "", warehouseName: "",
  counterpartyUuid: "", counterpartyName: "",
  contractUuid: "", contractName: "",
  priceTypeUuid: "", priceTypeName: "",
  authorUuid: "", authorName: "",
  basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "",
};

/** Сид панели формы поступления (paneProps.data). */
interface PurchasePaneData {
  uuid?: string;
  fromBasisFields?: Partial<TFields>;
  fromBasisItems?: TDataItem[];
  organizationUuid?: string;
  organizationName?: string;
  counterpartyUuid?: string;
  counterpartyName?: string;
}

/** Серверная запись документа поступления (вход mapServerToForm). */
interface PurchaseServerRecord {
  id?: number;
  uuid?: string;
  number?: string | null;
  date?: string | null;
  comment?: string | null;
  amount?: number | string | null;
  vatAmount?: number | string | null;
  discountAmount?: number | string | null;
  amountWithoutVat?: number | string | null;
  posted?: boolean;
  organizationUuid?: string | null; organization?: { name?: string | null } | null;
  warehouseUuid?: string | null; warehouse?: { name?: string | null } | null;
  counterpartyUuid?: string | null; counterparty?: { name?: string | null } | null;
  contractUuid?: string | null; contract?: { name?: string | null } | null;
  priceTypeUuid?: string | null; priceType?: { name?: string | null } | null;
  authorUuid?: string | null; author?: { uuid?: string | null; username?: string | null; email?: string | null } | null;
  basisDocumentType?: string | null;
  basisDocumentUuid?: string | null;
  basisDocumentLabel?: string | null;
}

const PurchasesForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const queryClient = useQueryClient();
  const { canWrite } = useUserAccessRight("Purchase");

  const { windows: { addPane }, auth: { user: currentUser } } = useAppContext();

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data as PurchasePaneData | undefined;
    if (data?.uuid) return undefined;
    if (data?.fromBasisFields) return { ...DEFAULT_FIELDS, ...data.fromBasisFields };
    const init = { ...DEFAULT_FIELDS };
    init.date = isoToLocalInput(new Date().toISOString());
    if (data?.organizationUuid) {
      init.organizationUuid = data.organizationUuid;
      init.organizationName = data.organizationName || "";
    } else if (defaultOrg.organizationUuid) {
      init.organizationUuid = defaultOrg.organizationUuid;
      init.organizationName = defaultOrg.organizationName;
    }
    if (data?.counterpartyUuid) {
      init.counterpartyUuid = data.counterpartyUuid;
      init.counterpartyName = data.counterpartyName || "";
    }
    return init;
  })();

  const [basisItems, setBasisItems] = useState<TDataItem[]>(() => {
    const data = paneProps.data as PurchasePaneData | undefined;
    return Array.isArray(data?.fromBasisItems) && data.fromBasisItems.length > 0
      ? data.fromBasisItems : [];
  });
  const [itemsTableKey, setItemsTableKey] = useState(0);
  const [isRefilling, setIsRefilling] = useState(false);

  const invalidateSubTables = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["purchaseitems"], refetchType: "active" });
  }, [queryClient]);

  const afterSave = useCallback(async () => {
    setBasisItems([]);
    await invalidateSubTables();
  }, [invalidateSubTables]);

  const afterReload = useCallback(() => { setBasisItems([]); }, []);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "purchases-form",
    defaultFields: DEFAULT_FIELDS,
    initialFields,
    paneProps,
    derivedFields: ["amount", "vatAmount", "amountWithoutVat", "discountAmount"],
    tables: {
      items: {
        endpoint: "purchaseitems", parentField: "purchaseUuid",
        label: "Товары поступления",
        batchEndpoint: "purchaseitems/batch",
        requiredItemFields: ["productUuid", "unitOfMeasureUuid", "quantity"],
        requiredItemFieldLabels: { productUuid: "Номенклатура", unitOfMeasureUuid: "Ед. изм.", quantity: "Количество" },
        createPayload: (r: TDataItem) => ({
          sourceRowId: r.sourceRowId ?? null,
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          price: r.price ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
          vatRate: r.vatRate ?? 0,
          exciseRate: r.exciseRate ?? 0,
          discountPercent: r.discountPercent ?? 0,
        }),
        updatePayload: (r: TDataItem) => ({
          sourceRowId: r.sourceRowId ?? null,
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          price: r.price ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
          vatRate: r.vatRate ?? 0,
          exciseRate: r.exciseRate ?? 0,
          discountPercent: r.discountPercent ?? 0,
        }),
        extraSkipFields: ["purchaseUuid"],
      },
    },
    mapServerToForm: (d: PurchaseServerRecord, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      number: d.number ?? "",
      date: isoToLocalInput(d.date),
      comment: d.comment ?? "",
      amount: d.amount != null ? Number(d.amount) : 0,
      vatAmount: d.vatAmount != null ? Number(d.vatAmount) : 0,
      discountAmount: d.discountAmount != null ? Number(d.discountAmount) : 0,
      amountWithoutVat: d.amountWithoutVat != null ? Number(d.amountWithoutVat) : 0,
      posted: d.posted === true,
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.name ?? "",
      warehouseUuid: d.warehouseUuid ?? "",
      warehouseName: d.warehouse?.name ?? "",
      counterpartyUuid: d.counterpartyUuid ?? "",
      counterpartyName: d.counterparty?.name ?? "",
      contractUuid: d.contractUuid ?? "",
      contractName: d.contract?.name ?? "",
      priceTypeUuid: d.priceTypeUuid ?? "",
      priceTypeName: d.priceType?.name ?? "",
      authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
      authorName: d.author?.username ?? d.author?.email ?? "",
      basisDocumentType: d.basisDocumentType ?? "",
      basisDocumentUuid: d.basisDocumentUuid ?? "",
      basisDocumentLabel: d.basisDocumentLabel ?? "",
    }),
    buildPayload: (fd) => {
      const validation = validateDocumentFields("purchase", fd as unknown as Record<string, unknown>);
      if (!validation.isValid) return formatValidationErrors(validation.errors);
      return {
        number: fd.number?.trim() || null,
        date: localInputToIso(fd.date),
        comment: fd.comment?.trim() || null,
        amount: fd.amount ? fd.amount : null,
        vatAmount: fd.vatAmount ? fd.vatAmount : 0,
        discountAmount: fd.discountAmount ? fd.discountAmount : 0,
        amountWithoutVat: fd.amountWithoutVat ? fd.amountWithoutVat : 0,
        posted: fd.posted === true,
        organizationUuid: fd.organizationUuid || null,
        warehouseUuid: fd.warehouseUuid || null,
        counterpartyUuid: fd.counterpartyUuid || null,
        contractUuid: fd.contractUuid || null,
        priceTypeUuid: fd.priceTypeUuid || null,
        basisDocumentType: fd.basisDocumentType || null,
        basisDocumentUuid: fd.basisDocumentUuid || null,
        basisDocumentLabel: fd.basisDocumentLabel || null,
      };
    },
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved, "date"),
    afterSave,
    afterReload,
  });

  const items = form.useTable("items");
  const allItemsRef = useRef<TDataItem[]>([]);
  const permDefaultsRef = useRef<UserDefaultsMap>({});

  const hasBasis = !!form.fields.basisDocumentUuid;

  // Подсказка о несоответствии документу-основанию (шапка + строки).
  const basisMismatch = useBasisMismatch({
    basisType: form.fields.basisDocumentType,
    basisUuid: form.fields.basisDocumentUuid,
    currentFields: form.fields,
    currentItems: allItemsRef.current,
    mapFields: mapCommonTradeFields,
  });

  const handleRefillFromBasis = useCallback(async (skipFields = false) => {
    setIsRefilling(true);
    try {
      await runBasisRefill({
        form, skipFields,
        currentUserUuid: currentUser?.uuid ?? "",
        permDefaults: permDefaultsRef.current,
        itemsEndpoint: "purchaseitems", itemsParentField: "purchaseUuid",
        orgFields: [
          { valueType: "warehouse", uuidKey: "warehouseUuid", nameKey: "warehouseName" },
          { valueType: "contract", uuidKey: "contractUuid", nameKey: "contractName" },
        ],
        allItemsRef, setBasisItems, bumpItemsTableKey: () => setItemsTableKey(k => k + 1),
      });
    } catch (e) {
      console.error("[refill] failed", e);
    } finally {
      setIsRefilling(false);
    }
  }, [form, currentUser?.uuid]);

  const { isVatEnabled, useDiscount } = useOrgAccountingSettings(
    form.fields.organizationUuid || null,
    form.fields.date || null,
  );

  const handleContractSelect = useCallback((uuid: string, displayValue: string, item: Record<string, any>) => {
    const updates: Partial<TFields> = { contractUuid: uuid, contractName: displayValue };
    if (item.organizationUuid) { updates.organizationUuid = item.organizationUuid; updates.organizationName = item.organization?.name ?? ""; }
    if (item.counterpartyUuid) { updates.counterpartyUuid = item.counterpartyUuid; updates.counterpartyName = item.counterparty?.name ?? ""; }
    form.setFields(updates);
  }, [form.setFields]);

  // Смена организации: зависимые поля (склад/договор) → дефолт пользователя для
  // новой орг, иначе очистка.
  const handleOrganizationSelect = useCallback(async (uuid: string, displayValue: string) => {
    const cur = form.store.getSnapshot().fields;
    if (cur.organizationUuid === uuid) return;
    form.setFields({ organizationUuid: uuid, organizationName: displayValue } as Partial<TFields>);
    const patch = await resolveOrgChangeFields(uuid, currentUser?.uuid ?? "", [
      { valueType: "warehouse", uuidKey: "warehouseUuid", nameKey: "warehouseName" },
      { valueType: "contract", uuidKey: "contractUuid", nameKey: "contractName" },
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
  permDefaultsRef.current = permDefaults;
  useApplyUserDefaults({
    defaults: permDefaults,
    organizationUuid: form.fields.organizationUuid,
    isEditMode: form.isEditMode,
    isLoading: form.isLoading,
    fieldMappings: [
      { type: "contract", uuidKey: "contractUuid", nameKey: "contractName" },
      { type: "warehouse", uuidKey: "warehouseUuid", nameKey: "warehouseName" },
      { type: "purchasePriceType", uuidKey: "priceTypeUuid", nameKey: "priceTypeName" },
    ],
    currentValues: { contractUuid: form.fields.contractUuid, warehouseUuid: form.fields.warehouseUuid, priceTypeUuid: form.fields.priceTypeUuid },
    apply: (fields) => form.setFieldsInitial(fields as Partial<TFields>),
  });

  const handleTotalChange = useCallback((total: number, rows?: TDataItem[]) => {
    form.setField("amount", Number(total));
    if (rows) {
      const vatSum = rows.reduce((s, r) => s + (Number(r.vatAmount) || 0), 0);
      const discSum = rows.reduce((s, r) => s + (Number(r.discountAmount) || 0), 0);
      const amtWithoutVat = Math.round((total - vatSum) * 100) / 100;
      form.setFields({
        vatAmount: Number(Math.round(vatSum * 100) / 100),
        discountAmount: Number(Math.round(discSum * 100) / 100),
        amountWithoutVat: Number(amtWithoutVat),
      } as Partial<TFields>);
    }
  }, [form.setField, form.setFields]);

  const assignNumber = useAssignNumber();
  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <GroupRow className={styles.FormHeaderRow}>
                <Field label={translate("documentNumber")} name={`${form.formUid}_number`} value={form.fields.number} onChange={e => form.setField("number", e.target.value)} disabled={form.isLoading} width="150px" placeholder={translate("autoOnSave")}
                  actions={[
                    { type: "assignNumber", onClick: () => void assignNumber(MODEL_ENDPOINT, form.fields.organizationUuid, (n) => form.setField("number", n)) },
                    { type: "clear", onClick: () => form.setField("number", "") },
                  ]} />
                <FieldDateTime label={translate("date")} name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="180px" />
                <FieldTogglePostedDocument name={`${form.formUid}_posted`} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} />
              </GroupRow>
              <Group>
                <LookupField label={translate("organization")} name={`${form.formUid}_organizationUuid`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="name"
                  onSelect={handleOrganizationSelect}
                  onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)}
                  disabled={form.isLoading} />
                <LookupField label={translate("warehouse")} name={`${form.formUid}_warehouseUuid`} value={form.fields.warehouseUuid} displayValue={form.fields.warehouseName} endpoint="warehouses" displayField="name"
                  onSelect={(u, d) => form.setFields({ warehouseUuid: u, warehouseName: d } as Partial<TFields>)}
                  onClear={() => form.setFields({ warehouseUuid: "", warehouseName: "" } as Partial<TFields>)}
                  disabled={form.isLoading}
                  extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
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
                <LookupField label={translate("priceType")} name={`${form.formUid}_priceTypeUuid`} value={form.fields.priceTypeUuid} displayValue={form.fields.priceTypeName} endpoint="price-types" displayField="name"
                  onSelect={(u, d) => form.setFields({ priceTypeUuid: u, priceTypeName: d } as Partial<TFields>)}
                  onClear={() => form.setFields({ priceTypeUuid: "", priceTypeName: "" } as Partial<TFields>)}
                  disabled={form.isLoading} />
              </Group>
            </GroupCol>
            <GroupCol>
              <BasisDocumentField
                allowedTypes={[
                  { type: "purchase_requisition", endpoint: "purchase-requisitions" },
                  { type: "purchase_order", endpoint: "purchase-orders" },
                  { type: "incoming_invoice", endpoint: "incoming-invoices" },
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
                hint={getDocumentFillHint("purchase", form.fields as unknown as Record<string, unknown>)}
              />
            </GroupCol>
            <Group>
              <DocumentTotals
                amount={form.fields.amount}
                vatAmount={form.fields.vatAmount}
                discountAmount={form.fields.discountAmount}
                amountWithoutVat={form.fields.amountWithoutVat}
                isVatEnabled={isVatEnabled}
                useDiscount={useDiscount}
              />
            </Group>
          </div>
          {form.isEditMode && <GroupCol className={styles.FormFooterCol}>
            <GroupRow className={styles.FormHeaderRow}>
              <Field label={translate("Comment")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} />
              <Field label={translate("Author")} name={`${form.formUid}_author`} value={form.fields.authorName || ""} disabled width="auto" />
            </GroupRow>
          </GroupCol>}
        </div>
      )
    },
    {
      id: "tab-items", label: translate("SaleItemsList"), component: (
        <TradeDocumentItemsTable
          parentUuid={form.fields.uuid ?? ""} parentField="purchaseUuid"
          endpoint="purchaseitems" componentName="PurchaseItemsList_part"
          organizationUuid={form.fields.organizationUuid} documentDate={form.fields.date || null}
          disabled={form.isLoading} deferRemoteChanges
          onRefresh={hasBasis ? () => void handleRefillFromBasis(true) : undefined}
          parentLabel={`${translate("PurchasesList")}: ID ${form.fields.id ?? "?"}${form.fields.date ? " · " + getFormatDateOnly(String(form.fields.date)) : ""}`}
          key={itemsTableKey}
          initialPendingRows={itemsTableKey > 0 ? basisItems : (items.pending.length > 0 ? items.pending : basisItems)}
          onTotalChange={handleTotalChange}
          onItemsChange={items.onItemsChange}
          onAllItemsChange={(rows) => { allItemsRef.current = rows; }}
          showRequiredHighlight
          defaultHiddenColumns={["amountNetOfIndirectTaxes", "amountWithoutVat"]}
        />
      )
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleContractSelect, handleOrganizationSelect, handleTotalChange, canWrite, items, isVatEnabled, useDiscount, basisItems, itemsTableKey, basisMismatch, assignNumber]);

  const handleCreatePurchaseReturn = useCallback(async () => {
    await openDocumentFromBasis(
      form.fields as any,
      translate("purchaseReceipt"),
      {
        docLabel: translate("PurchaseReturnsList"),
        FormComponent: PurchaseReturnsForm,
        basisType: "purchase",
        sourceItemsEndpoint: "purchaseitems",
        sourceItemsParentField: "purchaseUuid",
        mapFields: mapCommonTradeFields,
        existingCheckEndpoint: "purchase-returns",
      },
      addPane,
    );
  }, [form.fields, addPane]);

  const isSavedDoc = form.isEditMode && !!form.fields.uuid;
  const existingDeps = useExistingDependents(isSavedDoc ? form.fields.uuid : undefined, PURCHASES_DEPENDENT_ENDPOINTS);
  const headerActionsPortal = usePaneHeaderActions(
    form.paneId,
    (isSavedDoc || hasBasis) ? (
      <>
        {isSavedDoc && <DocumentChainButton documentType="purchase" documentUuid={form.fields.uuid} />}
        {isSavedDoc && <DocumentEntriesButton documentType="purchase" documentUuid={form.fields.uuid} />}
        {hasBasis && (
          <RefillFromBasisButton
            mismatch={basisMismatch.mismatch}
            mismatchDetails={basisMismatch.differences}
            disabled={form.isLoading || isRefilling}
            loading={isRefilling}
            onClick={() => void handleRefillFromBasis()}
          />
        )}
        {isSavedDoc && (
          <ActionsDropdownButton
            icon="fromBasis"
            label="На основании"
            options={[{ id: "purchaseReturn", label: formatDependentOption(translate("PurchaseReturnsList"), existingDeps["purchase-returns"]) }]}
            onSelect={() => void handleCreatePurchaseReturn()}
          />
        )}
      </>
    ) : null,
  );

  return (
    <FormRequiredScope docType="purchase" active>
      <FormDirtyScope dirtyKeys={form.unsavedFields}>
        {headerActionsPortal}
        <ModelForm paneId={form.paneId} tabs={tabs}
          onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
          onReload={form.isEditMode ? form.handleReload : undefined}
          isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
          readonly={!canWrite} />
      </FormDirtyScope>
    </FormRequiredScope>
  );
};
PurchasesForm.displayName = "PurchasesForm";

const PurchasesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={PurchasesForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
    defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
PurchasesList.displayName = LIST_NAME;

export { PurchasesForm, PurchasesList };
