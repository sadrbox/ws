/* eslint-disable @typescript-eslint/no-explicit-any */
import { FC, useMemo, useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import BasisDocumentField from "src/components/Field/BasisDocumentField";
import { useAssignNumber } from "src/hooks/useAssignNumber";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDateTime } from "src/components/Field";
import HeaderTogglePosted from "src/components/PaneHeader/HeaderTogglePosted";
import { FormLookup } from "src/components/Field/FormLookup";
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
import { useAppContext } from "src/app";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import ShowInJournalButton from "src/components/ShowInJournalButton";
import DeleteDocumentButton from "src/components/DeleteDocumentButton";
import DocumentEntriesButton from "src/components/AccountingEntries/DocumentEntriesButton";
import DocumentChainButton from "src/components/DocumentChain/DocumentChainButton";
import PrintDocumentPane from "src/components/PrintPreview/PrintDocumentPane";
import PrintDropdownButton from "src/components/Toolbar/PrintDropdownButton";
import { useUserDefaults, type UserDefaultsMap } from "src/hooks/useUserDefaults";
import { useApplyUserDefaults } from "src/hooks/useApplyUserDefaults";
import RefillFromBasisButton from "src/models/_shared/RefillFromBasisButton";
import PurchaseReturnPrint from "./PurchaseReturnPrint";
import DocumentTotals from "src/components/DocumentTotals";
import { mapCommonTradeFields, fetchDocumentItems, resolveOrgChangeFields, runBasisRefill } from "src/utils/createFromBasis";
import { checkStockAvailability, formatStockShortages } from "src/utils/stockControl";
import { useBasisMismatch } from "src/hooks/useBasisMismatch";

const MODEL_ENDPOINT = "purchase-returns";
const LIST_NAME = "PurchaseReturnsList";
const FORM_LABEL = "Возврат поставщику";

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
  authorUuid: "", authorName: "",
  basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "",
};

const PRINT_COLUMN_DEFS = [
  { key: "discountPercent", label: "Скидка, %", defaultVisible: false },
  { key: "discountAmount", label: "Сумма скидки", defaultVisible: false },
  { key: "amountWithoutVat", label: "Облагаемый оборот", defaultVisible: true },
  { key: "exciseRate", label: "Ставка акциза, %", defaultVisible: false },
  { key: "exciseAmount", label: "Сумма акциза", defaultVisible: false },
  { key: "vatRate", label: "Ставка НДС, %", defaultVisible: true },
  { key: "vatAmount", label: "Сумма НДС", defaultVisible: true },
];

/** Сид панели формы возврата поставщику (paneProps.data). */
interface PurchaseReturnPaneData {
  uuid?: string;
  fromBasisFields?: Partial<TFields>;
  fromBasisItems?: TDataItem[];
  organizationUuid?: string;
  organizationName?: string;
  counterpartyUuid?: string;
  counterpartyName?: string;
}

/** Серверная запись документа возврата поставщику (вход mapServerToForm). */
interface PurchaseReturnServerRecord {
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
  authorUuid?: string | null; author?: { uuid?: string | null; username?: string | null; email?: string | null } | null;
  basisDocumentType?: string | null;
  basisDocumentUuid?: string | null;
  basisDocumentLabel?: string | null;
}

/** Строка возврата: контроль остатка (productUuid/quantity/_pendingAction) + печать (relation-объекты). */
interface PurchaseReturnItemRow extends TDataItem {
  _pendingAction?: "create" | "update" | "delete";
  productUuid?: string | null;
  product?: { name?: string | null } | null;
  productName?: string | null;
  unitOfMeasure?: { name?: string | null } | null;
  unitName?: string | null;
  quantity?: number | string | null;
  price?: number | string | null;
  amount?: number | string | null;
  amountWithoutVat?: number | string | null;
  vatRate?: number | string | null;
  vatAmount?: number | string | null;
  exciseRate?: number | string | null;
  exciseAmount?: number | string | null;
  discountPercent?: number | string | null;
  discountAmount?: number | string | null;
}

const PurchaseReturnsForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const queryClient = useQueryClient();
  const { canWrite } = useUserAccessRight("PurchaseReturn");
  const { windows: { addPane }, auth: { user: currentUser } } = useAppContext();

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data as PurchaseReturnPaneData | undefined;
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
    const data = paneProps.data as PurchaseReturnPaneData | undefined;
    return Array.isArray(data?.fromBasisItems) && data.fromBasisItems.length > 0
      ? data.fromBasisItems : [];
  });
  const [itemsTableKey, setItemsTableKey] = useState(0);
  const [isRefilling, setIsRefilling] = useState(false);

  const allItemsRef = useRef<TDataItem[]>([]);
  const permDefaultsRef = useRef<UserDefaultsMap>({});

  const invalidateSubTables = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["purchase-return-items"], refetchType: "active" });
  }, [queryClient]);

  const afterSave = useCallback(async () => {
    setBasisItems([]);
    await invalidateSubTables();
  }, [invalidateSubTables]);

  const afterReload = useCallback(() => { setBasisItems([]); }, []);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "purchase-returns-form",
    defaultFields: DEFAULT_FIELDS,
    initialFields,
    paneProps,
    derivedFields: ["amount", "vatAmount", "amountWithoutVat", "discountAmount"],
    tables: {
      items: {
        endpoint: "purchase-return-items", parentField: "purchaseReturnUuid",
        label: "Товары возврата",
        batchEndpoint: "purchase-return-items/batch",
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
        extraSkipFields: ["purchaseReturnUuid"],
      },
    },
    mapServerToForm: (d: PurchaseReturnServerRecord, prev) => ({
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
      authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
      authorName: d.author?.username ?? d.author?.email ?? "",
      basisDocumentType: d.basisDocumentType ?? "",
      basisDocumentUuid: d.basisDocumentUuid ?? "",
      basisDocumentLabel: d.basisDocumentLabel ?? "",
    }),
    buildPayload: (fd) => {
      const validation = validateDocumentFields("purchase_return", fd as unknown as Record<string, unknown>);
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
        basisDocumentType: fd.basisDocumentType || null,
        basisDocumentUuid: fd.basisDocumentUuid || null,
        basisDocumentLabel: fd.basisDocumentLabel || null,
      };
    },
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved, "date"),
    afterSave,
    afterReload,
    // Контроль остатка перед проведением (расход со склада возврата поставщику).
    onBeforeSave: async (fd) => {
      if (fd.posted !== true) return null;
      let rows = allItemsRef.current.filter((r) => (r as PurchaseReturnItemRow)._pendingAction !== "delete");
      if (rows.length === 0 && fd.uuid) {
        rows = await fetchDocumentItems("purchase-return-items", "purchaseReturnUuid", fd.uuid);
      }
      const shortages = await checkStockAvailability({
        documentType: "purchase_return",
        documentUuid: fd.uuid || undefined,
        warehouseUuid: fd.warehouseUuid || null,
        items: rows.map((r) => { const row = r as PurchaseReturnItemRow; return { productUuid: row.productUuid, quantity: row.quantity }; }),
      });
      return shortages.length ? formatStockShortages(shortages) : null;
    },
  });

  const items = form.useTable("items");
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
        itemsEndpoint: "purchase-return-items", itemsParentField: "purchaseReturnUuid",
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

  const handlePrint = useCallback(() => {
    if (!form.fields.uuid) return;
    const rows = allItemsRef.current.map((raw, i) => {
      const r = raw as PurchaseReturnItemRow;
      return {
      number: i + 1,
      name: r.product?.name ?? r.productName ?? "",
      unit: r.unitOfMeasure?.name ?? r.unitName ?? "",
      quantity: Number(r.quantity ?? 0),
      price: Number(r.price ?? 0),
      amount: Number(r.amount ?? 0),
      amountWithoutVat: Number(r.amountWithoutVat ?? 0),
      vatRate: Number(r.vatRate ?? 0),
      vatAmount: Number(r.vatAmount ?? 0),
      exciseRate: Number(r.exciseRate ?? 0),
      exciseAmount: Number(r.exciseAmount ?? 0),
      discountPercent: Number(r.discountPercent ?? 0),
      discountAmount: Number(r.discountAmount ?? 0),
      };
    });
    const titleStr = `Возврат поставщику № ${form.fields.id ?? "—"}`;
    const fileBase = `ВозвратПост_${form.fields.id ?? "новый"}`;
    addPane({
      component: PrintDocumentPane,
      isSelector: true,
      label: titleStr,
      data: {
        columnsKey: "purchase_return",
        columnDefs: PRINT_COLUMN_DEFS,
        buildLayout: (cols: Record<string, boolean>) => (
          <PurchaseReturnPrint data={{
            documentId: form.fields.id,
            documentNumber: form.fields.number || undefined,
            documentDate: form.fields.date,
            organizationName: form.fields.organizationName,
            counterpartyName: form.fields.counterpartyName,
            contractName: form.fields.contractName,
            items: rows,
            totalAmount: rows.reduce((s, r) => s + Number(r.amount ?? 0), 0),
            totalVatAmount: rows.reduce((s, r) => s + Number(r.vatAmount ?? 0), 0),
            totalAmountWithoutVat: rows.reduce((s, r) => s + Number(r.amountWithoutVat ?? 0), 0),
            totalExciseAmount: rows.reduce((s, r) => s + Number(r.exciseAmount ?? 0), 0),
            totalDiscountAmount: rows.reduce((s, r) => s + Number(r.discountAmount ?? 0), 0),
            columns: cols,
          }} />
        ),
        fileBaseName: fileBase,
        title: titleStr,
      },
    });
  }, [form.fields, addPane]);

  const hasDirtyItems = (items.pending?.length ?? 0) > 0;
  const printDisabled = form.isLoading || form.isDirty || hasDirtyItems;
  const isSavedDoc = form.isEditMode && !!form.fields.uuid;
  const headerActionsPortal = usePaneHeaderActions(
    form.paneId,
    (
      <>
        <HeaderTogglePosted name={`${form.formUid}_posted`} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} />
        {isSavedDoc && <DocumentChainButton documentType="purchase_return" documentUuid={form.fields.uuid} />}
        {isSavedDoc && <DocumentEntriesButton documentType="purchase_return" documentUuid={form.fields.uuid} />}
        {isSavedDoc && <ShowInJournalButton endpoint={MODEL_ENDPOINT} uuid={form.fields.uuid} />} {isSavedDoc && <DeleteDocumentButton endpoint={MODEL_ENDPOINT} uuid={form.fields.uuid} paneId={form.paneId} />}
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
          <PrintDropdownButton
            disabled={printDisabled}
            title={printDisabled ? "Сохраните изменения перед печатью" : "Печать"}
            options={[{ id: "print", label: "Печать" }]}
            onSelect={handlePrint}
          />
        )}
      </>
    ),
  );

  const handleContractSelect = useCallback((uuid: string, displayValue: string, item: Record<string, any>) => {
    const updates: Partial<TFields> = { contractUuid: uuid, contractName: displayValue };
    if (item.organizationUuid) { updates.organizationUuid = item.organizationUuid; updates.organizationName = item.organization?.name ?? ""; }
    if (item.counterpartyUuid) { updates.counterpartyUuid = item.counterpartyUuid; updates.counterpartyName = item.counterparty?.name ?? ""; }
    form.setFields(updates);
  }, [form.setFields]);

  // Смена организации: зависимые поля (склад, договор) → дефолт пользователя
  // для новой орг, иначе очистка.
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
    ],
    currentValues: { contractUuid: form.fields.contractUuid, warehouseUuid: form.fields.warehouseUuid },
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
            <GroupRow className={styles.FormHeaderRow}>
              <FieldDateTime label={translate("date")} name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="200px" />
              <Field label={translate("documentNumber")} name={`${form.formUid}_number`} value={form.fields.number} onChange={e => form.setField("number", e.target.value)} disabled={form.isLoading} width="200px" maxLength={9}
                actions={[
                  { type: "assignNumber", onClick: () => void assignNumber(MODEL_ENDPOINT, form.fields.organizationUuid, form.fields.number, (n) => form.setField("number", n), form.fields.date, form.fields.uuid) },
                ]} />
            </GroupRow>
            <Group>
              <FormLookup form={form} field="organization" endpoint="organizations" onSelect={handleOrganizationSelect} />
              <FormLookup form={form} field="warehouse" endpoint="warehouses"
                extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
            </Group>
            <Group>
              <FormLookup form={form} field="counterparty" endpoint="counterparties" />
              <FormLookup form={form} field="contract" endpoint="contracts" onSelect={handleContractSelect}
                extraParams={{
                  ...(form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : {}),
                  ...(form.fields.counterpartyUuid ? { counterpartyUuid: form.fields.counterpartyUuid } : {}),
                }} />
            </Group>
            <GroupCol>
              <BasisDocumentField
                allowedTypes={[{ type: "purchase", endpoint: "purchases" }]}
                basisDocumentType={form.fields.basisDocumentType}
                basisDocumentUuid={form.fields.basisDocumentUuid}
                basisDocumentLabel={form.fields.basisDocumentLabel}
                onSelect={(type, uuid, label) => form.setFields({ basisDocumentType: type, basisDocumentUuid: uuid, basisDocumentLabel: label } as Partial<TFields>)}
                onClear={() => form.setFields({ basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "" } as Partial<TFields>)}
                disabled={form.isLoading}
                formUid={form.formUid}
                mismatch={basisMismatch.mismatch}
                mismatchDetails={basisMismatch.differences}
                hint={getDocumentFillHint("purchase_return", form.fields as unknown as Record<string, unknown>)}
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
          parentUuid={form.fields.uuid ?? ""} parentField="purchaseReturnUuid"
          endpoint="purchase-return-items" componentName="PurchaseReturnItemsList_part"
          organizationUuid={form.fields.organizationUuid} documentDate={form.fields.date || null}
          disabled={form.isLoading} deferRemoteChanges
          onRefresh={hasBasis ? () => void handleRefillFromBasis(true) : undefined}
          parentLabel={`${translate("PurchaseReturnsList")}: ID ${form.fields.id ?? "?"}${form.fields.date ? " · " + getFormatDateOnly(String(form.fields.date)) : ""}`}
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

  return (
    <FormRequiredScope docType="purchase_return" active>
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
PurchaseReturnsForm.displayName = "PurchaseReturnsForm";

const PurchaseReturnsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={PurchaseReturnsForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
    defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
PurchaseReturnsList.displayName = LIST_NAME;

export { PurchaseReturnsForm, PurchaseReturnsList };
