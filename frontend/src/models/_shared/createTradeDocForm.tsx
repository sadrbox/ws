/* eslint-disable @typescript-eslint/no-explicit-any */
// ─────────────────────────────────────────────────────────────────────────────
// createTradeDocForm — фабрика «торговых» документов с единым складом и таблицей
// позиций (TradeDocumentItemsTable): Поступление, Реализация, Возвраты.
// Вынесена из ранее продублированных форм (Sales/Purchases/SaleReturns/
// PurchaseReturns ~2500 строк). Поведение перенесено 1:1 из PurchasesForm,
// различия параметризованы конфигом. (InventoryTransfers НЕ покрывается —
// два склада/без контрагента/без НДС.)
// ─────────────────────────────────────────────────────────────────────────────
import { FC, ReactNode, useMemo, useCallback, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import BasisDocumentField, { type BasisTypeConfig } from "src/components/Field/BasisDocumentField";
import { useAssignNumber } from "src/hooks/useAssignNumber";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import { Field, FieldDateTime } from "src/components/Field";
import HeaderTogglePosted from "src/components/PaneHeader/HeaderTogglePosted";
import { FormLookup } from "src/components/Field/FormLookup";
import Notice from "src/components/Notice";
import { useDocumentNotices } from "src/hooks/useDocumentNotices";
import { useContractCounterpartyMismatch } from "src/hooks/useContractCounterpartyMismatch";
import { useContractSync } from "src/hooks/useContractSync";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useAccessPermission } from "src/hooks/useAccessPermission";
import useOrgAccountingSettings from "src/hooks/useOrgAccountingSettings";
import { useAutoFillPrimary } from "src/hooks/useAutoFillPrimary";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly, isoToLocalInput, localInputToIso } from "src/utils/datetime";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import TradeDocumentItemsTable from "src/components/DocumentItemsTable/TradeDocumentItemsTable";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";
import { validateDocumentFields, formatValidationErrors, getDocumentFillHint, type DocumentType } from "src/utils/validatePostedDocument";
import { FormRequiredScope, FormDirtyScope } from "src/hooks/useFormRequired";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import ShowInJournalButton from "src/components/ShowInJournalButton";
import NotesButton from "src/components/Notes/NotesButton";
import DeleteDocumentButton from "src/components/DeleteDocumentButton";
import DocumentEntriesButton from "src/components/AccountingEntries/DocumentEntriesButton";
import DocumentChainButton from "src/components/DocumentChain/DocumentChainButton";
import ActionsDropdownButton from "src/components/Toolbar/ActionsDropdownButton";
import RefillFromBasisButton from "src/models/_shared/RefillFromBasisButton";
import { useAppContext } from "src/app/context";
import { openDocumentFromBasis, mapCommonTradeFields, resolveOrgChangeFields, fetchDocumentItems, type BasisFromTarget } from "src/utils/createFromBasis";
import { useRefillFromBasis } from "src/hooks/useRefillFromBasis";
import { useBasisMismatch } from "src/hooks/useBasisMismatch";
import { useUserDefaults, type UserDefaultsMap } from "src/hooks/useUserDefaults";
import { useApplyUserDefaults } from "src/hooks/useApplyUserDefaults";
import { useExistingDependents, formatDependentOption } from "src/hooks/useExistingDependents";
import DocumentTotals from "src/components/DocumentTotals";
import PrintDocumentPane from "src/components/PrintPreview/PrintDocumentPane";
import PrintDropdownButton from "src/components/Toolbar/PrintDropdownButton";
import { checkStockAvailability, formatStockShortages } from "src/utils/stockControl";

/** «Создать на основании»: одна цель (документ, который можно породить). */
export interface TradeCreateTarget {
  id: string;
  /** i18-ключ названия в выпадашке «На основании». */
  optionLabelKey: string;
  /** Полная цель для openDocumentFromBasis (FormComponent, basisType, existingCheckEndpoint и т.д.). */
  target: BasisFromTarget;
}

export interface TradeDocConfig {
  endpoint: string;                 // "purchases"
  itemsEndpoint: string;            // "purchaseitems"
  itemsParentField: string;         // "purchaseUuid"
  itemsBatchEndpoint: string;       // "purchaseitems/batch"
  storageKey: string;               // "purchases-form"
  listName: string;                 // "PurchasesList"
  formLabel: string;                // "Поступление товара и услуг"
  formDisplayName: string;          // displayName компонента
  itemsComponentName: string;       // "PurchaseItemsList_part"
  itemsTableLabel: string;          // подпись таблицы в useFormStore
  itemsTabLabelKey?: string;        // i18-ключ вкладки позиций (default "SaleItemsList")
  parentLabelListKey: string;       // i18-ключ для parentLabel позиций ("PurchasesList")
  accessPermissionModel: string;     // "Purchase"
  docType: DocumentType;            // "purchase" (validate/scope/chain/entries)
  columnsJson: unknown;
  basisAllowedTypes: BasisTypeConfig[];
  /** Рендерить лукап «Тип цены» (default true) + valueType для дефолтов пользователя. */
  hasPriceType?: boolean;
  /** Серийные номера: роль документа (receipt/issue) + docType. Включает колонку «Серии». */
  serialMode?: "receipt" | "issue";
  serialDocType?: string;
  /** Партии: роль документа (receipt/issue). Включает колонку «Партия» (FEFO). */
  batchMode?: "receipt" | "issue";
  priceTypeValueType?: "salePriceType" | "purchasePriceType";
  /** Скрытые по умолчанию колонки позиций. */
  defaultHiddenColumns?: string[];
  /** Цели «На основании». dependentEndpoints вычисляются из target.existingCheckEndpoint. */
  createFromBasisTargets?: TradeCreateTarget[];
  /** i18-ключ метки ЭТОГО документа как источника основания (2-й арг openDocumentFromBasis). */
  basisSourceLabelKey?: string;
  /** Если задан — перед проведением проверяется остаток на складе (расходные док-ты: возвраты, реализация). */
  stockCheckDocType?: string;
  /** Печать документа (PrintDropdownButton + макет). */
  print?: TradePrintConfig;
}

export interface PrintColumnDef { key: string; label: string; defaultVisible: boolean }

/** Нормализованная строка позиции для печати (общая для торговых документов). */
export interface TradePrintRow {
  number: number; name: string; unit: string;
  quantity: number; price: number; amount: number; amountWithoutVat: number;
  vatRate: number; vatAmount: number; exciseRate: number; exciseAmount: number;
  discountPercent: number; discountAmount: number;
}

export interface TradePrintConfig {
  columnsKey: string;
  columnDefs: PrintColumnDef[];
  title: (fields: TFields) => string;
  fileBaseName: (fields: TFields) => string;
  buildLayout: (args: { fields: TFields; rows: TradePrintRow[]; cols: Record<string, boolean> }) => ReactNode;
}

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

interface TradePaneData {
  uuid?: string;
  fromBasisFields?: Partial<TFields>;
  fromBasisItems?: TDataItem[];
  organizationUuid?: string;
  organizationName?: string;
  counterpartyUuid?: string;
  counterpartyName?: string;
}

interface TradeServerRecord {
  id?: number; uuid?: string;
  number?: string | null; date?: string | null; comment?: string | null;
  amount?: number | string | null; vatAmount?: number | string | null;
  discountAmount?: number | string | null; amountWithoutVat?: number | string | null;
  posted?: boolean;
  organizationUuid?: string | null; organization?: { name?: string | null } | null;
  warehouseUuid?: string | null; warehouse?: { name?: string | null } | null;
  counterpartyUuid?: string | null; counterparty?: { name?: string | null } | null;
  contractUuid?: string | null; contract?: { name?: string | null } | null;
  priceTypeUuid?: string | null; priceType?: { name?: string | null } | null;
  authorUuid?: string | null; author?: { uuid?: string | null; username?: string | null; email?: string | null } | null;
  basisDocumentType?: string | null; basisDocumentUuid?: string | null; basisDocumentLabel?: string | null;
}

export function createTradeDocForm(cfg: TradeDocConfig): {
  Form: FC<Partial<TPane>>;
  List: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }>;
} {
  const hasPriceType = cfg.hasPriceType !== false;
  const itemsTabLabelKey = cfg.itemsTabLabelKey ?? "SaleItemsList";
  const targets = cfg.createFromBasisTargets ?? [];
  const dependentEndpoints = targets
    .map((t) => t.target.existingCheckEndpoint)
    .filter((e): e is string => !!e);

  const Form: FC<Partial<TPane>> = (paneProps) => {
    const defaultOrg = useDefaultOrganization();
    const queryClient = useQueryClient();
    const { canWrite } = useAccessPermission(cfg.accessPermissionModel);
    const { windows: { addPane }, auth: { user: currentUser } } = useAppContext();

    const initialFields: TFields | undefined = (() => {
      const data = paneProps.data as TradePaneData | undefined;
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
      const data = paneProps.data as TradePaneData | undefined;
      return Array.isArray(data?.fromBasisItems) && data.fromBasisItems.length > 0
        ? data.fromBasisItems : [];
    });
    const [itemsTableKey, setItemsTableKey] = useState(0);

    const invalidateSubTables = useCallback(async () => {
      await queryClient.invalidateQueries({ queryKey: [cfg.itemsEndpoint], refetchType: "active" });
    }, [queryClient]);

    const afterSave = useCallback(async () => {
      setBasisItems([]);
      await invalidateSubTables();
    }, [invalidateSubTables]);

    const afterReload = useCallback(() => { setBasisItems([]); }, []);

    const allItemsRef = useRef<TDataItem[]>([]);
    const permDefaultsRef = useRef<UserDefaultsMap>({});

    const form = useFormStore<TFields>({
      endpoint: cfg.endpoint,
      storageKey: cfg.storageKey,
      defaultFields: DEFAULT_FIELDS,
      initialFields,
      paneProps,
      derivedFields: ["amount", "vatAmount", "amountWithoutVat", "discountAmount"],
      tables: {
        items: {
          endpoint: cfg.itemsEndpoint, parentField: cfg.itemsParentField,
          label: cfg.itemsTableLabel,
          batchEndpoint: cfg.itemsBatchEndpoint,
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
            batchUuid: r.batchUuid ?? null,
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
            batchUuid: r.batchUuid ?? null,
          }),
          extraSkipFields: [cfg.itemsParentField],
        },
      },
      mapServerToForm: (d: TradeServerRecord, prev) => ({
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
        const validation = validateDocumentFields(cfg.docType, fd as unknown as Record<string, unknown>);
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
          ...(hasPriceType ? { priceTypeUuid: fd.priceTypeUuid || null } : {}),
          basisDocumentType: fd.basisDocumentType || null,
          basisDocumentUuid: fd.basisDocumentUuid || null,
          basisDocumentLabel: fd.basisDocumentLabel || null,
        };
      },
      buildPaneLabel: (saved) => makeDocLabel(cfg.listName, cfg.formLabel, saved, "date"),
      afterSave,
      afterReload,
      // Контроль остатка перед проведением (расходные документы: возвраты, реализация).
      ...(cfg.stockCheckDocType ? {
        onBeforeSave: async (fd: TFields) => {
          if (fd.posted !== true) return null;
          let rows = allItemsRef.current.filter((r) => (r as any)._pendingAction !== "delete");
          if (rows.length === 0 && fd.uuid) {
            rows = await fetchDocumentItems(cfg.itemsEndpoint, cfg.itemsParentField, fd.uuid);
          }
          const shortages = await checkStockAvailability({
            documentType: cfg.stockCheckDocType as any,
            documentUuid: fd.uuid || undefined,
            warehouseUuid: fd.warehouseUuid || null,
            items: rows.map((r) => ({ productUuid: (r as any).productUuid, quantity: (r as any).quantity })),
          });
          return shortages.length ? formatStockShortages(shortages) : null;
        },
      } : {}),
    });

    const items = form.useTable("items");

    const hasBasis = !!form.fields.basisDocumentUuid;

    const basisMismatch = useBasisMismatch({
      basisType: form.fields.basisDocumentType,
      basisUuid: form.fields.basisDocumentUuid,
      currentFields: form.fields,
      currentItems: allItemsRef.current,
      mapFields: mapCommonTradeFields,
      // Возвраты (поставщику/покупателя) допускают частичный объём → сверяем
      // только наличие номенклатуры в основании, а не кол-во/суммы.
      itemMatchMode: cfg.docType?.endsWith("_return") ? "productsSubset" : "exact",
    });

    const contractMismatch = useContractCounterpartyMismatch(form.fields.contractUuid, form.fields.counterpartyUuid);
    const syncContract = useContractSync();
    const notices = useDocumentNotices({
      docType: cfg.docType,
      fields: form.fields as unknown as Record<string, unknown>,
      basisMismatch,
      contractMismatch,
      // Ошибка ДАННЫХ формы → в <Notice /> (системные сбои уходят в тост, см. useFormStore).
      formError: form.errorKind === "form" ? form.error : null,
    });

    const { isRefilling, handleRefillFromBasis } = useRefillFromBasis({
      form,
      currentUserUuid: currentUser?.uuid ?? "",
      permDefaultsRef,
      itemsEndpoint: cfg.itemsEndpoint,
      itemsParentField: cfg.itemsParentField,
      orgFields: [
        { valueType: "warehouse", uuidKey: "warehouseUuid", nameKey: "warehouseName" },
        { valueType: "contract", uuidKey: "contractUuid", nameKey: "contractName" },
      ],
      allItemsRef,
      setBasisItems,
      bumpItemsTableKey: () => setItemsTableKey(k => k + 1),
    });

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

    // Смена контрагента: подставляем его ОСНОВНОЙ договор, иначе чистим чужой
    // (см. useContractSync). Тот же onSelect отрабатывает и очистку контрагента —
    // LookupField зовёт onSelect("", "", {}).
    const handleCounterpartySelect = useCallback(async (uuid: string, displayValue: string) => {
      form.setFields({ counterpartyUuid: uuid, counterpartyName: displayValue } as Partial<TFields>);
      const cur = form.store.getSnapshot().fields;
      const patch = await syncContract({
        counterpartyUuid: uuid,
        organizationUuid: cur.organizationUuid,
        currentContractUuid: cur.contractUuid,
      });
      if (patch) form.setFields(patch as Partial<TFields>);
    }, [form.setFields, form.store, syncContract]);

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
        ...(hasPriceType && cfg.priceTypeValueType
          ? [{ type: cfg.priceTypeValueType, uuidKey: "priceTypeUuid", nameKey: "priceTypeName" }]
          : []),
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
          <div className={styles.FormContainer}>
            <div className={styles.FormWrapper}>
              <GroupCol className={styles.Form}>
                {/* ── Левая колонка: поля ── */}
                <GroupRow className={styles.FormHeaderRow}>
                  <FieldDateTime label={translate("date")} name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="200px" />
                  <Field label={translate("documentNumber")} name={`${form.formUid}_number`} value={form.fields.number} onChange={e => form.setField("number", e.target.value)} disabled={form.isLoading} width="200px" maxLength={9}
                    actions={[
                      { type: "assignNumber", onClick: () => void assignNumber(cfg.endpoint, form.fields.organizationUuid, form.fields.number, (n) => form.setField("number", n), form.fields.date, form.fields.uuid) },
                    ]} />
                </GroupRow>

                <Group>
                  <FormLookup form={form} field="organization" endpoint="organizations" onSelect={handleOrganizationSelect} />
                  <FormLookup form={form} field="warehouse" endpoint="warehouses"
                    extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined}
                    createDefaults={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid, organizationName: form.fields.organizationName } : undefined} />
                </Group>

                <Group>
                  <FormLookup form={form} field="counterparty" endpoint="counterparties" onSelect={handleCounterpartySelect} />
                  <FormLookup form={form} field="contract" endpoint="contracts" onSelect={handleContractSelect}
                    extraParams={{
                      ...(form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : {}),
                      ...(form.fields.counterpartyUuid ? { counterpartyUuid: form.fields.counterpartyUuid } : {}),
                    }}
                    createDefaults={{
                      ...(form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid, organizationName: form.fields.organizationName } : {}),
                      ...(form.fields.counterpartyUuid ? { counterpartyUuid: form.fields.counterpartyUuid, counterpartyName: form.fields.counterpartyName } : {}),
                    }} />
                </Group>

                {hasPriceType && (
                  <GroupRow>
                    <Group className={styles.w1of2}>
                      <FormLookup form={form} field="priceType" endpoint="price-types" />
                    </Group>
                  </GroupRow>
                )}

                <GroupCol>
                  <BasisDocumentField
                    allowedTypes={cfg.basisAllowedTypes}
                    basisDocumentType={form.fields.basisDocumentType}
                    // Подбор основания — только документы организации этого документа.
                    organizationUuid={form.fields.organizationUuid}
                    organizationName={form.fields.organizationName}
                    counterpartyUuid={form.fields.counterpartyUuid}
                    counterpartyName={form.fields.counterpartyName}
                    warehouseUuid={form.fields.warehouseUuid}
                    warehouseName={form.fields.warehouseName}
                    basisDocumentUuid={form.fields.basisDocumentUuid}
                    basisDocumentLabel={form.fields.basisDocumentLabel}
                    formUid={form.formUid}
                    disabled={form.isLoading}
                    onSelect={(type, uuid, label) => form.setFields({ basisDocumentType: type, basisDocumentUuid: uuid, basisDocumentLabel: label } as Partial<TFields>)}
                    onClear={() => form.setFields({ basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "" } as Partial<TFields>)}
                    mismatch={basisMismatch.mismatch}
                    mismatchDetails={basisMismatch.differences}
                    hint={getDocumentFillHint(cfg.docType, form.fields as unknown as Record<string, unknown>)}
                  />
                </GroupCol>
              </GroupCol>
              <GroupCol className={styles.FormTotals}>
                <DocumentTotals
                  amount={form.fields.amount}
                  vatAmount={form.fields.vatAmount}
                  discountAmount={form.fields.discountAmount}
                  amountWithoutVat={form.fields.amountWithoutVat}
                  isVatEnabled={isVatEnabled}
                  useDiscount={useDiscount}
                />
              </GroupCol>
              <GroupCol className={styles.FormNotice}>
                <Notice items={notices} />
              </GroupCol>
            </div>
            <GroupRow>
              <Field label={translate("Comment")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} />
              <Field label={translate("Author")} name={`${form.formUid}_author`} value={form.fields.authorName || ""} disabled width="auto" />
            </GroupRow>
          </div>
        )
      },
      {
        id: "tab-items", label: translate(itemsTabLabelKey), component: (
          <TradeDocumentItemsTable
            parentUuid={form.fields.uuid ?? ""} parentField={cfg.itemsParentField}
            endpoint={cfg.itemsEndpoint} componentName={cfg.itemsComponentName}
            serialMode={cfg.serialMode} serialDocType={cfg.serialDocType} batchMode={cfg.batchMode} warehouseUuid={form.fields.warehouseUuid}
            organizationUuid={form.fields.organizationUuid} documentDate={form.fields.date || null}
            priceTypeUuid={form.fields.priceTypeUuid}
            disabled={form.isLoading} deferRemoteChanges
            onRefresh={hasBasis ? () => void handleRefillFromBasis(true) : undefined}
            parentLabel={`${translate(cfg.parentLabelListKey)}: ID ${form.fields.id ?? "?"}${form.fields.date ? " - " + getFormatDateOnly(String(form.fields.date)) : ""}`}
            key={itemsTableKey}
            initialPendingRows={itemsTableKey > 0 ? basisItems : (items.pending.length > 0 ? items.pending : basisItems)}
            onTotalChange={handleTotalChange}
            onItemsChange={items.onItemsChange}
            onAllItemsChange={(rows) => { allItemsRef.current = rows; }}
            showRequiredHighlight
            defaultHiddenColumns={cfg.defaultHiddenColumns ?? ["amountNetOfIndirectTaxes", "amountWithoutVat"]}
          />
        )
      },
    ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleContractSelect, handleOrganizationSelect, handleTotalChange, canWrite, items, isVatEnabled, useDiscount, basisItems, itemsTableKey, basisMismatch, notices, assignNumber, hasBasis, handleRefillFromBasis]);

    const runCreateTarget = useCallback(async (t: TradeCreateTarget) => {
      const srcLabel = cfg.basisSourceLabelKey ? translate(cfg.basisSourceLabelKey) : cfg.formLabel;
      await openDocumentFromBasis(form.fields as any, srcLabel, t.target, addPane);
    }, [form.fields, addPane]);

    const handlePrint = useCallback(() => {
      if (!cfg.print || !form.fields.uuid) return;
      const rows: TradePrintRow[] = allItemsRef.current.map((raw, i) => {
        const r = raw as any;
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
      const fields = form.fields;
      addPane({
        component: PrintDocumentPane,
        isSelector: true,
        label: cfg.print.title(fields),
        data: {
          columnsKey: cfg.print.columnsKey,
          columnDefs: cfg.print.columnDefs,
          buildLayout: (cols: Record<string, boolean>) => cfg.print!.buildLayout({ fields, rows, cols }),
          fileBaseName: cfg.print.fileBaseName(fields),
          title: cfg.print.title(fields),
        },
      });
    }, [form.fields, addPane]);
    const hasDirtyItems = (items.pending?.length ?? 0) > 0;
    const printDisabled = form.isLoading || form.isDirty || hasDirtyItems;

    const isSavedDoc = form.isEditMode && !!form.fields.uuid;
    const existingDeps = useExistingDependents(isSavedDoc ? form.fields.uuid : undefined, dependentEndpoints);
    const headerActionsPortal = usePaneHeaderActions(
      form.paneId,
      (
        <>
          {isSavedDoc && targets.length > 0 && (
            <ActionsDropdownButton
              icon="fromBasis"
              label="На основании"
              options={targets.map((t) => ({
                id: t.id,
                label: formatDependentOption(translate(t.optionLabelKey), existingDeps[t.target.existingCheckEndpoint ?? ""]),
              }))}
              onSelect={(id) => { const t = targets.find((x) => x.id === id); if (t) void runCreateTarget(t); }}
            />
          )}
          <HeaderTogglePosted name={`${form.formUid}_posted`} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} />
          {isSavedDoc && <DocumentChainButton documentType={cfg.docType} documentUuid={form.fields.uuid} />}
          {isSavedDoc && <DocumentEntriesButton documentType={cfg.docType} documentUuid={form.fields.uuid} />}
          {isSavedDoc && <><NotesButton endpoint={cfg.endpoint} uuid={form.fields.uuid} /> <ShowInJournalButton endpoint={cfg.endpoint} uuid={form.fields.uuid} /></>} {isSavedDoc && <DeleteDocumentButton endpoint={cfg.endpoint} uuid={form.fields.uuid} paneId={form.paneId} />}
          {hasBasis && (
            <RefillFromBasisButton
              mismatch={basisMismatch.mismatch}
              mismatchDetails={basisMismatch.differences}
              disabled={form.isLoading || isRefilling}
              loading={isRefilling}
              onClick={() => void handleRefillFromBasis()}
            />
          )}
          {isSavedDoc && cfg.print && (
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

    return (
      <FormRequiredScope docType={cfg.docType} active>
        <FormDirtyScope dirtyKeys={form.unsavedFields}>
          {headerActionsPortal}
          <ModelForm paneId={form.paneId} tabs={tabs}
            onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
            onReload={form.isEditMode ? form.handleReload : undefined}
            isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
            readonly={!canWrite}
            marksEndpoint={cfg.endpoint} marksUuid={form.fields.uuid} marksOrganizationUuid={form.fields.organizationUuid} />
        </FormDirtyScope>
      </FormRequiredScope>
    );
  };
  Form.displayName = cfg.formDisplayName;

  const List: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }> = (
    { variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }
  ) => (
    <ModelList
      endpoint={cfg.endpoint} listName={cfg.listName} columnsJson={cfg.columnsJson as any} FormComponent={Form}
      getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
      variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField} extraQueryParams={extraQueryParams}
      defaultSort={{ id: "desc" }} enableDateRange
      renderCell={renderPostedCell}
      previewTabs={(row) => [{
        id: "items",
        label: translate(cfg.itemsTabLabelKey ?? "SaleItemsList"),
        component: (
          <TradeDocumentItemsTable
            parentUuid={String(row.uuid ?? "")} parentField={cfg.itemsParentField}
            endpoint={cfg.itemsEndpoint} componentName={cfg.itemsComponentName}
            serialMode={cfg.serialMode} serialDocType={cfg.serialDocType} batchMode={cfg.batchMode}
            warehouseUuid={row.warehouseUuid ? String(row.warehouseUuid) : undefined}
            organizationUuid={row.organizationUuid ? String(row.organizationUuid) : null}
            documentDate={row.date ? String(row.date) : null}
            disabled disableAddRows disableDeleteRows
            emptyMessage={translate("noItems") || "Нет позиций"}
            defaultHiddenColumns={cfg.defaultHiddenColumns ?? ["amountNetOfIndirectTaxes", "amountWithoutVat"]}
          />
        ),
      }]}
    />
  );
  List.displayName = cfg.listName;

  return { Form, List };
}
