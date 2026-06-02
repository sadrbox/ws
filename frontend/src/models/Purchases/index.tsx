/* eslint-disable @typescript-eslint/no-explicit-any */
// ─────────────────────────────────────────────────────────────────────────────
// PurchasesForm — Поступление товаров (Покупка). Структура зеркалирует
// SalesForm с учётом НК РК: НДС, акциз, Сумма скидки, ЭСФ-графы 4/6/7/8/13/14/15/16/17.
// ─────────────────────────────────────────────────────────────────────────────
import { FC, useMemo, useCallback, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import BasisDocumentField from "src/components/Field/BasisDocumentField";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDateTime } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useAccessRight } from "src/hooks/useAccessRight";
import useOrgAccountingSettings from "src/hooks/useOrgAccountingSettings";
import { useAutoFillPrimary } from "src/hooks/useAutoFillPrimary";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly, isoToLocalInput, localInputToIso } from "src/utils/datetime";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import TradeDocumentItemsTable from "src/components/DocumentItemsTable/TradeDocumentItemsTable";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";
import { validateDocumentFields, formatValidationErrors } from "src/utils/validatePostedDocument";
import { FormRequiredScope, FormDirtyScope } from "src/hooks/useFormRequired";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import DocumentEntriesButton from "src/components/AccountingEntries/DocumentEntriesButton";
import ActionsDropdownButton from "src/components/Toolbar/ActionsDropdownButton";
import RefillFromBasisButton from "src/models/_shared/RefillFromBasisButton";
import { useAppContext } from "src/app";
import { openDocumentFromBasis, mapCommonTradeFields, refillFromBasisSource, fetchDocumentItems, resolveOrgDependentRefill, resolveOrgChangeFields, buildRefillBasisItems } from "src/utils/createFromBasis";
import { useBasisMismatch } from "src/hooks/useBasisMismatch";
import { isEquivalent } from "src/utils/normalize";
import { PurchaseReturnsForm } from "src/models/PurchaseReturns";
import { useUserPermissionDefaults, type PermissionDefaultsMap } from "src/hooks/useUserPermissionDefaults";
import { useApplyPermissionDefaults } from "src/hooks/useApplyPermissionDefaults";
import { useExistingDependents, formatDependentOption } from "src/hooks/useExistingDependents";
import DocumentTotals from "src/components/DocumentTotals";

const MODEL_ENDPOINT = "purchases";
const LIST_NAME = "PurchasesList";
const FORM_LABEL = "Поступление товара и услуг";
const PURCHASES_DEPENDENT_ENDPOINTS = ["purchase-returns"];

interface TFields {
  id?: number; uuid?: string;
  date: string; comment: string;
  amount: number; vatAmount: number; discountAmount: number; amountWithoutVat: number;
  posted: boolean;
  organizationUuid: string; organizationName: string;
  warehouseUuid: string; warehouseName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
  authorUuid: string; authorName: string;
  basisDocumentType: string; basisDocumentUuid: string; basisDocumentLabel: string;
}

const DEFAULT_FIELDS: TFields = {
  date: "", comment: "",
  amount: 0, vatAmount: 0, discountAmount: 0, amountWithoutVat: 0,
  posted: false,
  organizationUuid: "", organizationName: "",
  warehouseUuid: "", warehouseName: "",
  counterpartyUuid: "", counterpartyName: "",
  contractUuid: "", contractName: "",
  authorUuid: "", authorName: "",
  basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "",
};

const PurchasesForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const queryClient = useQueryClient();
  const { canWrite } = useAccessRight("Purchase");

  const { windows: { addPane }, auth: { user: currentUser } } = useAppContext();

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data as any;
    if (data?.uuid) return undefined;
    if (data?.fromBasisFields) return { ...DEFAULT_FIELDS, ...data.fromBasisFields } as TFields;
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

  const [basisItems, setBasisItems] = useState<any[]>(() => {
    const data = paneProps.data as any;
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
        createPayload: (r: any) => ({
          sourceRowId: r.sourceRowId ?? null,
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          price: r.price ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
          vatRate: r.vatRate ?? 0,
          exciseRate: r.exciseRate ?? 0,
          discountPercent: r.discountPercent ?? 0,
        }),
        updatePayload: (r: any) => ({
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
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
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
  const allItemsRef = useRef<any[]>([]);
  const permDefaultsRef = useRef<PermissionDefaultsMap>({});

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
    // Берём ТЕКУЩЕЕ основание из свежего снапшота стора (а не из замыкания):
    // после смены типа/документа основания refill заполняет именно по нему.
    const snap = form.store.getSnapshot().fields as any;
    const basisType = snap.basisDocumentType;
    const basisUuid = snap.basisDocumentUuid;
    if (!basisUuid || !basisType) return;
    setIsRefilling(true);
    try {
      const result = await refillFromBasisSource(
        basisType,
        basisUuid,
        mapCommonTradeFields,
      );
      if (!result) return;
      if (!skipFields) {
        const cur = form.store.getSnapshot().fields as any;
        // Поля, зависящие от организации (склад/договор), которых нет у основания:
        // при смене организации — дефолт пользователя для новой орг, иначе очистка.
        const orgPatch = await resolveOrgDependentRefill(result.fields, cur, currentUser?.uuid ?? "", permDefaultsRef.current, [
          { valueType: "warehouse", uuidKey: "warehouseUuid", nameKey: "warehouseName" },
          { valueType: "contract", uuidKey: "contractUuid", nameKey: "contractName" },
        ]);
        const rawPatch = { ...result.fields, ...orgPatch };
        const patch = Object.fromEntries(
          Object.keys(rawPatch).filter(k => k in cur).map(k => [k, rawPatch[k]]),
        ) as Partial<TFields>;
        if (Object.keys(patch).some(k => !isEquivalent(cur[k], (patch as any)[k]))) {
          form.setFields(patch);
        }
      }
      let displayed = allItemsRef.current.filter((r: any) => r._pendingAction !== "delete");
      if (displayed.length === 0 && form.fields.uuid) {
        displayed = await fetchDocumentItems("purchaseitems", "purchaseUuid", form.fields.uuid);
      }
      // Идемпотентный merge по sourceRowId (см. buildRefillBasisItems).
      const merged = buildRefillBasisItems(displayed, result.items);
      if (merged.length) {
        setBasisItems(merged);
        setItemsTableKey(k => k + 1);
      }
    } catch (e) {
      console.error("[refill] failed", e);
    } finally {
      setIsRefilling(false);
    }
  }, [form.fields.basisDocumentType, form.fields.basisDocumentUuid, form.fields.uuid, form.setFields, queryClient]);

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
    const cur = form.store.getSnapshot().fields as any;
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

  const permDefaults = useUserPermissionDefaults(
    currentUser?.uuid ?? "",
    form.fields.organizationUuid,
  );
  permDefaultsRef.current = permDefaults;
  useApplyPermissionDefaults({
    defaults: permDefaults,
    organizationUuid: form.fields.organizationUuid,
    isEditMode: form.isEditMode,
    isLoading: form.isLoading,
    fieldMappings: [
      { type: "contract", uuidKey: "contractUuid", nameKey: "contractName" },
      { type: "warehouse", uuidKey: "warehouseUuid", nameKey: "warehouseName" },
    ],
    currentValues: { contractUuid: form.fields.contractUuid, warehouseUuid: form.fields.warehouseUuid },
    apply: (fields) => form.setFieldsInitial(fields as Partial<TFields>),
  });

  const handleTotalChange = useCallback((total: number, rows?: any[]) => {
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

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
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
          {form.isEditMode && <GroupCol style={{ flex: 1, alignItems: "start", justifyContent: "end", gap: 6 }}>
            <GroupRow style={{ width: "100%", justifyContent: "space-between" }}>
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
          showRequiredHighlight={form.meta.tablesValidationFailed}
          defaultHiddenColumns={["amountNetOfIndirectTaxes", "amountWithoutVat"]}
        />
      )
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleContractSelect, handleOrganizationSelect, handleTotalChange, canWrite, items, isVatEnabled, useDiscount, basisItems, itemsTableKey, basisMismatch]);

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
    <FormRequiredScope docType="purchase" active={form.meta.headerValidationFailed}>
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
