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
import HeaderTogglePosted from "src/components/PaneHeader/HeaderTogglePosted";
import { FormLookup } from "src/components/Field/FormLookup";
import Notice from "src/components/Notice";
import { useDocumentNotices } from "src/hooks/useDocumentNotices";
import { useContractCounterpartyMismatch } from "src/hooks/useContractCounterpartyMismatch";
import TradeDocumentItemsTable from "src/components/DocumentItemsTable/TradeDocumentItemsTable";
import { Group, GroupRow, GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useFormStore } from "src/hooks/useFormStore";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import useOrgAccountingSettings from "src/hooks/useOrgAccountingSettings";
import { useAutoFillPrimary } from "src/hooks/useAutoFillPrimary";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly, isoToLocalInput, localInputToIso } from "src/utils/datetime";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { validateDocumentFields, formatValidationErrors, getDocumentFillHint } from "src/utils/validatePostedDocument";
import { FormRequiredScope, FormDirtyScope } from "src/hooks/useFormRequired";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import ShowInJournalButton from "src/components/ShowInJournalButton";
import DeleteDocumentButton from "src/components/DeleteDocumentButton";
import DocumentEntriesButton from "src/components/AccountingEntries/DocumentEntriesButton";
import DocumentChainButton from "src/components/DocumentChain/DocumentChainButton";
import SaleInvoicePrint, { type SaleInvoicePrintData, type SaleInvoicePrintColumns, type SaleItemPrintRow } from "./SaleInvoicePrint";
import ActPrint from "./ActPrint";
import { buildSaleInvoiceWorkbook } from "./saleInvoiceWorkbook";
import PrintDocumentPane, { type PrintColumnDef } from "src/components/PrintPreview/PrintDocumentPane";
import PrintDropdownButton from "src/components/Toolbar/PrintDropdownButton";
import ActionsDropdownButton from "src/components/Toolbar/ActionsDropdownButton";
import { useGovDocs } from "src/hooks/useGovDocs";
import { useAppContext } from "src/app/context";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";
import { api } from "src/services/api/client";
import { openDocumentFromBasis, mapCommonTradeFields, fetchDocumentItems, resolveOrgChangeFields } from "src/utils/createFromBasis";
import { useRefillFromBasis } from "src/hooks/useRefillFromBasis";
import { checkStockAvailability, formatStockShortages } from "src/utils/stockControl";
import { useBasisMismatch } from "src/hooks/useBasisMismatch";
import RefillFromBasisButton from "src/models/_shared/RefillFromBasisButton";
import { OutgoingInvoicesForm } from "src/models/OutgoingInvoices";
import { SaleReturnsForm } from "src/models/SaleReturns";
import { useUserDefaults, type UserDefaultsMap } from "src/hooks/useUserDefaults";
import { useApplyUserDefaults } from "src/hooks/useApplyUserDefaults";
import { useExistingDependents, formatDependentOption } from "src/hooks/useExistingDependents";
import DocumentTotals from "src/components/DocumentTotals";

const MODEL_ENDPOINT = "sales";
const LIST_NAME = "SalesList";
const FORM_LABEL = "Реализация товара и услуг";
const SALES_DEPENDENT_ENDPOINTS = ["outgoing-invoices", "sale-returns"];


interface TFields {
  id?: number; uuid?: string;
  number: string;
  date: string; comment: string; amount: number; posted: boolean;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
  warehouseUuid: string; warehouseName: string;
  managerUuid: string; managerName: string;
  priceTypeUuid: string; priceTypeName: string;
  vatAmount: number; discountAmount: number; amountWithoutVat: number;
  authorUuid: string; authorName: string;
  basisDocumentType: string; basisDocumentUuid: string; basisDocumentLabel: string;
}

const DEFAULT_FIELDS: TFields = {
  number: "",
  date: "", comment: "", amount: 0, posted: false,
  organizationUuid: "", organizationName: "", counterpartyUuid: "", counterpartyName: "", contractUuid: "", contractName: "",
  warehouseUuid: "", warehouseName: "",
  managerUuid: "", managerName: "",
  priceTypeUuid: "", priceTypeName: "",
  vatAmount: 0, discountAmount: 0, amountWithoutVat: 0,
  authorUuid: "", authorName: "",
  basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "",
};

/** Строка таблицы saleItems с типизированными бизнес-полями (payload / контроль остатка). */
interface SaleItemRow extends TDataItem {
  _pendingAction?: "create" | "update" | "delete";
  sourceRowId?: string | null;
  productUuid?: string | null;
  quantity?: number | string | null;
  price?: number | string | null;
  unitOfMeasureUuid?: string | null;
  vatRate?: number | string | null;
  exciseRate?: number | string | null;
  discountPercent?: number | string | null;
  datetime?: string | null;
  posted?: boolean;
  organization?: { uuid?: string | null } | null;
  counterparty?: { uuid?: string | null } | null;
  warehouse?: { uuid?: string | null } | null;
  organizationUuid?: string | null;
  counterpartyUuid?: string | null;
  warehouseUuid?: string | null;
}

/** Сид панели формы реализации (paneProps.data). */
interface SalesPaneData {
  uuid?: string;
  fromBasisFields?: Partial<TFields>;
  fromBasisItems?: TDataItem[];
  organizationUuid?: string;
  counterpartyUuid?: string;
}

interface OrgRef { name?: string | null; bin?: string | null; iin?: string | null; address?: string | null }
interface ManagerRef { fullName?: string | null; lastName?: string | null; firstName?: string | null; middleName?: string | null }
interface AuthorRef { uuid?: string | null; username?: string | null; email?: string | null }

/** Серверная запись документа реализации (ответ GET sales/:uuid, вход mapServerToForm). */
interface SaleServerRecord {
  id?: number;
  uuid?: string;
  number?: string | null;
  date?: string | null;
  comment?: string | null;
  amount?: number | string | null;
  posted?: boolean;
  organizationUuid?: string | null; organization?: OrgRef | null;
  counterpartyUuid?: string | null; counterparty?: OrgRef | null;
  contractUuid?: string | null; contract?: { name?: string | null } | null;
  warehouseUuid?: string | null; warehouse?: { name?: string | null } | null;
  managerUuid?: string | null; manager?: ManagerRef | null;
  priceTypeUuid?: string | null; priceType?: { name?: string | null } | null;
  vatAmount?: number | string | null;
  discountAmount?: number | string | null;
  amountWithoutVat?: number | string | null;
  authorUuid?: string | null; author?: AuthorRef | null;
  basisDocumentType?: string | null;
  basisDocumentUuid?: string | null;
  basisDocumentLabel?: string | null;
}

/** Серверная позиция документа реализации (ответ GET saleitems, вход печати). */
interface SaleItemServerRecord {
  product?: { name?: string | null; isService?: boolean | null } | null;
  productName?: string | null;
  name?: string | null;
  unitOfMeasure?: { name?: string | null } | null;
  unitOfMeasureName?: string | null;
  quantity?: number | string | null;
  price?: number | string | null;
  discountPercent?: number | string | null;
  discountAmount?: number | string | null;
  exciseRate?: number | string | null;
  exciseAmount?: number | string | null;
  amountWithoutVat?: number | string | null;
  amountNetOfIndirectTaxes?: number | string | null;
  vatRate?: number | string | null;
  vatAmount?: number | string | null;
  amount?: number | string | null;
}

const SalesForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const queryClient = useQueryClient();
  const { canWrite } = useUserAccessRight("Sale");
  const { windows: { addPane }, auth: { user: currentUser } } = useAppContext();

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data as SalesPaneData | undefined;
    if (data?.uuid) return undefined;
    if (data?.fromBasisFields) return { ...DEFAULT_FIELDS, ...data.fromBasisFields };
    const init = { ...DEFAULT_FIELDS };
    init.date = isoToLocalInput(new Date().toISOString());
    if (data?.organizationUuid) { init.organizationUuid = data.organizationUuid; }
    else if (defaultOrg.organizationUuid) { init.organizationUuid = defaultOrg.organizationUuid; init.organizationName = defaultOrg.organizationName; }
    if (data?.counterpartyUuid) { init.counterpartyUuid = data.counterpartyUuid; }
    // «Менеджер» нового документа по умолчанию — сотрудник текущего пользователя
    // (если у пользователя есть связанный Сотрудник). Без сотрудника — оставляем пусто.
    const emp = (currentUser as { employee?: { uuid?: string; fullName?: string } } | undefined)?.employee;
    if (emp?.uuid) { init.managerUuid = emp.uuid; init.managerName = emp.fullName ?? ""; }
    return init;
  })();

  const [basisItems, setBasisItems] = useState<TDataItem[]>(() => {
    const data = paneProps.data as SalesPaneData | undefined;
    return Array.isArray(data?.fromBasisItems) && data.fromBasisItems.length > 0
      ? data.fromBasisItems : [];
  });
  const [itemsTableKey, setItemsTableKey] = useState(0);

  const invalidateSubTables = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: ["saleitems"],
      refetchType: "active",
    });
  }, [queryClient]);

  const afterSave = useCallback(async () => {
    setBasisItems([]);
    await invalidateSubTables();
  }, [invalidateSubTables]);

  const afterReload = useCallback(() => { setBasisItems([]); }, []);

  // Текущие строки таблицы (server + pending) — заполняется onAllItemsChange.
  // Объявлено до useFormStore, т.к. используется в onBeforeSave (контроль остатка).
  const allItemsRef = useRef<TDataItem[]>([]);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "sales-form", defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
    // Поля-итоги вычисляются автоматически из строк saleItems (handleTotalChange).
    // Исключаем из dirty-tracking — иначе любая правка строки SubTable
    // «протекает» в diff формы.
    derivedFields: ["amount", "vatAmount", "amountWithoutVat", "discountAmount"],
    tables: {
      saleItems: {
        endpoint: "saleitems", parentField: "saleUuid",
        label: translate("SaleItemsList"),
        batchEndpoint: "saleitems/batch",
        requiredItemFields: ["productUuid", "unitOfMeasureUuid", "quantity"],
        requiredItemFieldLabels: { productUuid: "Номенклатура", unitOfMeasureUuid: "Ед. изм.", quantity: "Количество" },
        createPayload: (r: TDataItem) => {
          const row = r as SaleItemRow;
          return {
            sourceRowId: row.sourceRowId ?? null,
            productUuid: row.productUuid ?? null,
            quantity: row.quantity ?? 0,
            price: row.price ?? 0,
            unitOfMeasureUuid: row.unitOfMeasureUuid ?? null,
            vatRate: row.vatRate ?? 0,
            exciseRate: row.exciseRate ?? 0,
            discountPercent: row.discountPercent ?? 0,
            datetime: row.datetime ?? null,
            posted: row.posted === true,
            organizationUuid: row.organization?.uuid ?? row.organizationUuid ?? null,
            counterpartyUuid: row.counterparty?.uuid ?? row.counterpartyUuid ?? null,
            warehouseUuid: row.warehouse?.uuid ?? row.warehouseUuid ?? null,
          };
        },
        updatePayload: (r: TDataItem) => {
          const row = r as SaleItemRow;
          return {
            sourceRowId: row.sourceRowId ?? null,
            productUuid: row.productUuid ?? null,
            quantity: row.quantity ?? 0,
            price: row.price ?? 0,
            unitOfMeasureUuid: row.unitOfMeasureUuid ?? null,
            vatRate: row.vatRate ?? 0,
            exciseRate: row.exciseRate ?? 0,
            discountPercent: row.discountPercent ?? 0,
            datetime: row.datetime ?? null,
            posted: row.posted === true,
            organizationUuid: row.organization?.uuid ?? row.organizationUuid ?? null,
            counterpartyUuid: row.counterparty?.uuid ?? row.counterpartyUuid ?? null,
            warehouseUuid: row.warehouse?.uuid ?? row.warehouseUuid ?? null,
          };
        },
        extraSkipFields: ["saleUuid"],
      },
    },
    mapServerToForm: (d: SaleServerRecord, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      number: d.number ?? "",
      date: isoToLocalInput(d.date),
      comment: d.comment ?? "", amount: d.amount != null ? Number(d.amount) : 0,
      posted: d.posted === true,
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.name ?? "",
      counterpartyUuid: d.counterpartyUuid ?? "",
      counterpartyName: d.counterparty?.name ?? "",
      contractUuid: d.contractUuid ?? "",
      contractName: d.contract?.name ?? "",
      warehouseUuid: d.warehouseUuid ?? "",
      warehouseName: d.warehouse?.name ?? "",
      managerUuid: d.managerUuid ?? "",
      managerName: d.manager?.fullName ?? [d.manager?.lastName, d.manager?.firstName, d.manager?.middleName].filter(Boolean).join(" "),
      priceTypeUuid: d.priceTypeUuid ?? "",
      priceTypeName: d.priceType?.name ?? "",
      vatAmount: d.vatAmount != null ? Number(d.vatAmount) : 0,
      discountAmount: d.discountAmount != null ? Number(d.discountAmount) : 0,
      amountWithoutVat: d.amountWithoutVat != null ? Number(d.amountWithoutVat) : 0,
      authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
      authorName: d.author?.username ?? d.author?.email ?? "",
      basisDocumentType: d.basisDocumentType ?? "",
      basisDocumentUuid: d.basisDocumentUuid ?? "",
      basisDocumentLabel: d.basisDocumentLabel ?? "",
    }),
    buildPayload: (fd) => {
      const validation = validateDocumentFields("sale", fd as unknown as Record<string, unknown>);
      if (!validation.isValid) return formatValidationErrors(validation.errors);
      return {
        number: fd.number?.trim() || null,
        date: localInputToIso(fd.date),
        comment: fd.comment?.trim() || null,
        amount: fd.amount ? fd.amount : null,
        posted: fd.posted === true,
        organizationUuid: fd.organizationUuid || null,
        counterpartyUuid: fd.counterpartyUuid || null,
        contractUuid: fd.contractUuid || null,
        warehouseUuid: fd.warehouseUuid || null,
        managerUuid: fd.managerUuid || null,
        priceTypeUuid: fd.priceTypeUuid || null,
        vatAmount: fd.vatAmount ? fd.vatAmount : 0,
        discountAmount: fd.discountAmount ? fd.discountAmount : 0,
        amountWithoutVat: fd.amountWithoutVat ? fd.amountWithoutVat : 0,
        basisDocumentType: fd.basisDocumentType || null,
        basisDocumentUuid: fd.basisDocumentUuid || null,
        basisDocumentLabel: fd.basisDocumentLabel || null,
      };
    },
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved),
    afterSave,
    afterReload,
    // Контроль остатка перед проведением: при posted=true проверяем, что склад
    // покрывает списываемые количества. Прерывает сохранение до любого HTTP.
    onBeforeSave: async (fd) => {
      if (fd.posted !== true) return null;
      let rows = allItemsRef.current.filter((r) => (r as SaleItemRow)._pendingAction !== "delete");
      if (rows.length === 0 && fd.uuid) {
        rows = await fetchDocumentItems("saleitems", "saleUuid", fd.uuid);
      }
      const shortages = await checkStockAvailability({
        documentType: "sale",
        documentUuid: fd.uuid || undefined,
        warehouseUuid: fd.warehouseUuid || null,
        items: rows.map((r) => { const row = r as SaleItemRow; return { productUuid: row.productUuid, quantity: row.quantity }; }),
      });
      return shortages.length ? formatStockShortages(shortages) : null;
    },
  });

  const saleItems = form.useTable("saleItems");
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

  const contractMismatch = useContractCounterpartyMismatch(form.fields.contractUuid, form.fields.counterpartyUuid);
  const notices = useDocumentNotices({
    docType: "sale",
    fields: form.fields as unknown as Record<string, unknown>,
    basisMismatch,
    contractMismatch,
  });

  const { isRefilling, handleRefillFromBasis } = useRefillFromBasis({
    form,
    currentUserUuid: currentUser?.uuid ?? "",
    permDefaultsRef,
    itemsEndpoint: "saleitems",
    itemsParentField: "saleUuid",
    orgFields: [
      { valueType: "warehouse", uuidKey: "warehouseUuid", nameKey: "warehouseName" },
      { valueType: "contract", uuidKey: "contractUuid", nameKey: "contractName" },
    ],
    allItemsRef,
    setBasisItems,
    bumpItemsTableKey: () => setItemsTableKey(k => k + 1),
  });

  // ── Историчные настройки учёта организации ─────────────────────────────
  // Передаём дату документа в хук — так колонки/блоки НДС/скидок отображаются
  // согласно настройкам, действовавшим на дату документа (для нового и
  // существующего документа). При смене даты — настройки автоматически
  // пересчитываются (React Query с queryKey по дате).
  const { isVatEnabled, useDiscount } = useOrgAccountingSettings(
    form.fields.organizationUuid || null,
    form.fields.date || null,
  );

  // ── Авто-подстановка ОСНОВНОГО ДОГОВОРА ───────────────────────────────
  // При выборе организации/контрагента в новой форме автоматически подставляем
  // договор, отмеченный как "основной" (isPrimary=true) для этой пары.
  // Если пользователь вручную выбрал другой договор — не перезаписываем.
  const contractScope = useMemo<Record<string, string> | null>(() => {
    if (!form.fields.organizationUuid) return null;
    const s: Record<string, string> = { organizationUuid: form.fields.organizationUuid };
    if (form.fields.counterpartyUuid) s.counterpartyUuid = form.fields.counterpartyUuid;
    return s;
  }, [form.fields.organizationUuid, form.fields.counterpartyUuid]);

  useAutoFillPrimary({
    endpoint: "contracts",
    scope: contractScope,
    currentUuid: form.fields.contractUuid,
    isEditMode: form.isEditMode,
    isLoading: form.isLoading,
    apply: (uuid, name) =>
      form.setFieldsInitial({ contractUuid: uuid, contractName: name } as Partial<TFields>),
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
      { type: "salePriceType", uuidKey: "priceTypeUuid", nameKey: "priceTypeName" },
    ],
    currentValues: { contractUuid: form.fields.contractUuid, warehouseUuid: form.fields.warehouseUuid, priceTypeUuid: form.fields.priceTypeUuid },
    apply: (fields) => form.setFieldsInitial(fields as Partial<TFields>),
  });

  const handleTotalChange = useCallback((total: number, items?: TDataItem[]) => {
    form.setField("amount", Number(total));
    if (items) {
      const vatSum = items.reduce((s, r) => s + (Number(r.vatAmount) || 0), 0);
      const discSum = items.reduce((s, r) => s + (Number(r.discountAmount) || 0), 0);
      const amtWithoutVat = Math.round((total - vatSum) * 100) / 100;
      form.setFields({
        vatAmount: Number(Math.round(vatSum * 100) / 100),
        discountAmount: Number(Math.round(discSum * 100) / 100),
        amountWithoutVat: Number(amtWithoutVat),
      } as Partial<TFields>);
    }
  }, [form.setField, form.setFields]);

  /** extraParams для LookupField Договор:
   * - Организация выбрана → фильтруем по ней
   * - Организация НЕ выбрана, Контрагент НЕ выбран → только договора без орг (organizationUuid=null)
   * - Организация НЕ выбрана, Контрагент выбран → не фильтруем по орг (показываем договора контрагента из любой орг)
   * - Контрагент выбран → фильтруем по нему (бэкенд добавит OR null)
   * - Контрагент НЕ выбран → только договора без контрагента (counterpartyUuid=null)
   */
  const contractExtraParams = useMemo(() => {
    // Контрагент НЕ выбран → фильтр только по организации (показываем ВСЕ договоры
    // выбранной организации, независимо от контрагента). Контрагент выбран →
    // добавляем строгий фильтр по нему (только его договоры). Пустые параметры не
    // передаём — бэкенд без counterpartyUuid не ограничивает по контрагенту.
    const p: Record<string, string> = {};
    if (form.fields.organizationUuid) p.organizationUuid = form.fields.organizationUuid;
    if (form.fields.counterpartyUuid) p.counterpartyUuid = form.fields.counterpartyUuid;
    return p;
  }, [form.fields.organizationUuid, form.fields.counterpartyUuid]);
  const handleContractSelect = useCallback((uuid: string, displayValue: string, item: Record<string, any>) => {
    const updates: Partial<TFields> = {
      contractUuid: uuid,
      contractName: displayValue,
    };
    if (item.organizationUuid) {
      updates.organizationUuid = item.organizationUuid;
      updates.organizationName = item.organization?.name ?? "";
    }
    if (item.counterpartyUuid) {
      updates.counterpartyUuid = item.counterpartyUuid;
      updates.counterpartyName = item.counterparty?.name ?? "";
    }
    form.setFields(updates);
  }, [form.setFields]);

  // Смена организации: зависимые поля (склад/договор) → дефолт пользователя для
  // новой орг, иначе очистка (значение принадлежало прежней организации).
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

  // ── Печать: накладная З-2 и акт выполненных работ ──────────────────

  const handlePrint = useCallback(async (layoutId: "invoice" | "act") => {
    if (!form.fields.uuid) return;
    try {
      const [saleResp, itemsResp] = await Promise.all([
        api.get<{ success?: boolean; item?: SaleServerRecord }>(`sales/${form.fields.uuid}`),
        api.get<{ success?: boolean; items?: SaleItemServerRecord[] }>(`saleitems`, { params: { saleUuid: form.fields.uuid } }),
      ]);
      const sale = (saleResp?.item ?? saleResp) as SaleServerRecord;
      const allItems = (itemsResp?.items ?? (Array.isArray(itemsResp) ? itemsResp : [])) as SaleItemServerRecord[];

      // Фильтрация по типу позиции: накладная — только товары, акт — только услуги/работы
      const filtered = allItems.filter((it) =>
        layoutId === "invoice"
          ? !it.product?.isService
          : !!it.product?.isService,
      );

      const rows: SaleItemPrintRow[] = filtered.map((it, idx) => ({
        number: idx + 1,
        name: it.product?.name ?? it.productName ?? it.name ?? "",
        unit: it.unitOfMeasure?.name ?? it.unitOfMeasureName ?? "",
        quantity: Number(it.quantity ?? 0),
        price: Number(it.price ?? 0),
        isService: !!it.product?.isService,
        discountPercent: it.discountPercent != null ? Number(it.discountPercent) : undefined,
        discountAmount: it.discountAmount != null ? Number(it.discountAmount) : undefined,
        exciseRate: it.exciseRate != null ? Number(it.exciseRate) : undefined,
        exciseAmount: it.exciseAmount != null ? Number(it.exciseAmount) : undefined,
        amountWithoutVat: it.amountWithoutVat != null ? Number(it.amountWithoutVat) : undefined,
        amountNetOfIndirectTaxes:
          it.amountNetOfIndirectTaxes != null
            ? Number(it.amountNetOfIndirectTaxes)
            : Number(it.amountWithoutVat ?? 0) - Number(it.exciseAmount ?? 0),
        vatRate: it.vatRate != null ? Number(it.vatRate) : undefined,
        vatAmount: it.vatAmount != null ? Number(it.vatAmount) : undefined,
        amount: Number(it.amount ?? 0),
      }));

      const totalExciseAmount = rows.reduce((s, r) => s + Number(r.exciseAmount ?? 0), 0);

      const baseData: SaleInvoicePrintData = {
        documentId: sale?.id ?? form.fields.id,
        documentNumber: (sale?.number ?? form.fields.number) || undefined,
        documentDate: sale?.date ?? form.fields.date,
        organizationName: sale?.organization?.name ?? form.fields.organizationName,
        organizationBin: sale?.organization?.bin ?? sale?.organization?.iin ?? undefined,
        organizationAddress: sale?.organization?.address ?? undefined,
        counterpartyName: sale?.counterparty?.name ?? form.fields.counterpartyName,
        counterpartyBin: sale?.counterparty?.bin ?? sale?.counterparty?.iin ?? undefined,
        counterpartyAddress: sale?.counterparty?.address ?? undefined,
        contractName: sale?.contract?.name ?? form.fields.contractName,
        warehouseName: sale?.warehouse?.name ?? form.fields.warehouseName,
        items: rows,
        totalAmount: rows.reduce((s, r) => s + r.amount, 0),
        totalAmountWithoutVat: rows.reduce((s, r) => s + Number(r.amountWithoutVat ?? 0), 0),
        totalVatAmount: rows.reduce((s, r) => s + Number(r.vatAmount ?? 0), 0),
        totalDiscountAmount: rows.reduce((s, r) => s + Number(r.discountAmount ?? 0), 0),
        totalExciseAmount: Math.round(totalExciseAmount * 100) / 100,
        isVatPayer: isVatEnabled,
      };

      const isAct = layoutId === "act";
      const titleStr = isAct
        ? `Акт вып. работ № ${baseData.documentNumber ?? ""}`
        : `Накладная № ${baseData.documentNumber ?? ""}`;
      const fileBase = (isAct
        ? `Акт_${baseData.documentNumber ?? "draft"}`
        : `Накладная_${baseData.documentNumber ?? "draft"}`
      ).replace(/\s+/g, "_");

      const columnDefs: PrintColumnDef[] = [
        { key: "discountPercent", label: "Скидка, %", defaultVisible: false },
        { key: "discountAmount", label: "Сумма скидки", defaultVisible: false },
        { key: "amountNetOfIndirectTaxes", label: "Сумма без налогов", defaultVisible: false },
        { key: "amountWithoutVat", label: "Облагаемый оборот", defaultVisible: true },
        { key: "exciseRate", label: "Ставка акциза, %", defaultVisible: false },
        { key: "exciseAmount", label: "Сумма акциза", defaultVisible: false },
        { key: "vatRate", label: "Ставка НДС, %", defaultVisible: true },
        { key: "vatAmount", label: "Сумма НДС", defaultVisible: true },
      ];

      const workbook = buildSaleInvoiceWorkbook(baseData);
      addPane({
        component: PrintDocumentPane,
        isSelector: true,
        label: titleStr,
        data: {
          id: Number(baseData.documentId ?? form.fields.id ?? 0),
          uuid: String(form.fields.uuid ?? ""),
          columnsKey: isAct ? "sale_act" : "sale_invoice",
          columnDefs,
          buildLayout: (cols: Record<string, boolean>) => {
            const printData: SaleInvoicePrintData = { ...baseData, columns: cols as SaleInvoicePrintColumns };
            return isAct ? <ActPrint data={printData} /> : <SaleInvoicePrint data={printData} />;
          },
          fileBaseName: fileBase,
          title: titleStr,
          workbook,
        },
      });
    } catch (e) {
      console.error("[print] failed", e);
      alert("Не удалось подготовить документ к печати");
    }
  }, [
    form.fields.uuid, form.fields.id, form.fields.date,
    form.fields.organizationName, form.fields.counterpartyName,
    form.fields.contractName, form.fields.warehouseName,
    isVatEnabled, addPane,
  ]);

  // Регистрируем кнопку «Печать» в шапке панели (рядом с Reload/Close).
  // Доступна только для сохранённого документа без несохранённых изменений.
  // ВАЖНО: возвращаемый ReactNode (портал) надо отрендерить в JSX,
  // иначе React не выполнит createPortal и кнопка не появится.
  const hasDirtyItems = (saleItems.pending?.length ?? 0) > 0;
  const handleCreateFromBasis = useCallback(async (
    FormComponent: typeof OutgoingInvoicesForm,
    docLabel: string,
    basisType: string,
    itemsEndpoint: string,
    existingCheckEndpoint?: string,
  ) => {
    await openDocumentFromBasis(
      form.fields as any,
      translate("saleRealization"),
      {
        docLabel,
        FormComponent,
        basisType,
        sourceItemsEndpoint: itemsEndpoint,
        sourceItemsParentField: "saleUuid",
        mapFields: mapCommonTradeFields,
        existingCheckEndpoint,
      },
      addPane,
    );
  }, [form.fields, addPane]);

  const printDisabled = form.isLoading || form.isDirty || hasDirtyItems;
  const printTitle = (form.isDirty || hasDirtyItems)
    ? "Сохраните изменения перед печатью"
    : undefined;
  const isSavedDoc = form.isEditMode && !!form.fields.uuid;
  const existingDeps = useExistingDependents(isSavedDoc ? form.fields.uuid : undefined, SALES_DEPENDENT_ENDPOINTS);
  // ── Гос-документы РК: ЭАВР (акт работ/услуг) и СНТ (накладная) ──
  const govDocs = useGovDocs();
  const govFields = form.fields as unknown as { awpStatus?: string | null; awpId?: string | null; sntStatus?: string | null; sntId?: string | null };
  const handleGovDoc = useCallback(async (id: string) => {
    const uuid = form.fields.uuid;
    if (!uuid) return;
    try {
      if (id === "awp") { const r = await govDocs.issueAwp(uuid); form.setFields({ awpStatus: r.awpStatus, awpId: r.awpId, awpRegistrationNumber: r.awpRegistrationNumber } as any); }
      else if (id === "awpStatus") { const r = await govDocs.refreshAwp(uuid); form.setFields({ awpStatus: r.awpStatus, awpRegistrationNumber: r.awpRegistrationNumber } as any); }
      else if (id === "snt") { const r = await govDocs.issueSnt("sales", uuid); form.setFields({ sntStatus: r.sntStatus, sntId: r.sntId, sntRegistrationNumber: r.sntRegistrationNumber } as any); }
      else if (id === "sntStatus") { const r = await govDocs.refreshSnt("sales", uuid); form.setFields({ sntStatus: r.sntStatus, sntRegistrationNumber: r.sntRegistrationNumber } as any); }
    } catch { /* ошибка показывается через govDocs.error */ }
  }, [form.fields.uuid, form.setFields, govDocs]);

  const headerActionsPortal = usePaneHeaderActions(
    form.paneId,
    (
      <>
        {/* «На основании» — первым в ряду шапки (по требованию). */}
        {isSavedDoc && (
          <ActionsDropdownButton
            label="На основании"
            options={[
              { id: "outgoing", label: formatDependentOption(translate("outgoingInvoice"), existingDeps["outgoing-invoices"]) },
              { id: "saleReturn", label: formatDependentOption(translate("SaleReturnsList"), existingDeps["sale-returns"]) },
            ]}
            onSelect={(id) => {
              if (id === "outgoing") void handleCreateFromBasis(OutgoingInvoicesForm, translate("outgoingInvoice"), "sale", "saleitems", "outgoing-invoices");
              if (id === "saleReturn") void handleCreateFromBasis(SaleReturnsForm, translate("SaleReturnsList"), "sale", "saleitems", "sale-returns");
            }}
          />
        )}
        {isSavedDoc && (
          <ActionsDropdownButton
            icon="download"
            label={translate("govDocsSection")}
            disabled={govDocs.busy || form.isLoading || form.isDirty}
            options={[
              { id: "awp", label: govFields.awpStatus ? translate("govAwpResend") : translate("govAwpIssue") },
              ...(govFields.awpId ? [{ id: "awpStatus", label: translate("govAwpStatus") }] : []),
              { id: "snt", label: govFields.sntStatus ? translate("govSntResend") : translate("govSntIssue") },
              ...(govFields.sntId ? [{ id: "sntStatus", label: translate("govSntStatus") }] : []),
            ]}
            onSelect={(id) => void handleGovDoc(id)}
          />
        )}
        <HeaderTogglePosted name={`${form.formUid}_posted`} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} />
        {isSavedDoc && <DocumentChainButton documentType="sale" documentUuid={form.fields.uuid} />}
        {isSavedDoc && <DocumentEntriesButton documentType="sale" documentUuid={form.fields.uuid} />}
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
            title={printTitle ?? "Печать"}
            options={[
              { id: "invoice", label: "Накладная З-2 (товары)" },
              { id: "act", label: "Акт выполненных работ (услуги/работы)" },
            ]}
            onSelect={(id) => handlePrint(id as "invoice" | "act")}
          />
        )}
      </>
    ),
  );

  const assignNumber = useAssignNumber();
  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormContainer}>
          <div className={styles.FormWrapper}>
            <GroupCol className={styles.Form}>
              {/* ── Левая колонка: поля ── */}
              {/* Строка 1: Дата - Проведён - Статус */}
              <GroupRow className={styles.FormHeaderRow}>
                <FieldDateTime label={translate("date")} name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="200px" />
                <Field label={translate("documentNumber")} name={`${form.formUid}_number`} value={form.fields.number} onChange={e => form.setField("number", e.target.value)} disabled={form.isLoading} width="200px" maxLength={9}
                  actions={[
                    { type: "assignNumber", onClick: () => void assignNumber(MODEL_ENDPOINT, form.fields.organizationUuid, form.fields.number, (n) => form.setField("number", n), form.fields.date, form.fields.uuid) },
                  ]} />
              </GroupRow>

              <Group>
                {/* Организация — во всю ширину */}
                <FormLookup form={form} field="organization" endpoint="organizations" onSelect={handleOrganizationSelect} />

                <FormLookup form={form} field="warehouse" endpoint="warehouses" extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
              </Group>

              <Group>
                {/* Контрагент — во всю ширину */}
                <FormLookup form={form} field="counterparty" endpoint="counterparties" />
                <FormLookup form={form} field="contract" endpoint="contracts" onSelect={handleContractSelect} extraParams={contractExtraParams} />
              </Group>

              <GroupRow>
                <Group className={styles.w1of2}>
                  {/* Менеджер реализации — аналитика учёта движения продаж по менеджеру (НК РК) */}
                  <FormLookup form={form} field="manager" endpoint="employees" displayField="fullName" extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
                </Group>
              </GroupRow>

              <GroupRow>
                <Group className={styles.w1of2}>
                  <FormLookup form={form} field="priceType" endpoint="price-types" />
                </Group>
              </GroupRow>

              <GroupCol>
                <BasisDocumentField
                  allowedTypes={[
                    { type: "sales_order", endpoint: "sales-orders" },
                    { type: "reservation", endpoint: "reservations" },
                    { type: "commercial_offer", endpoint: "commercial-offers" },
                    { type: "payment_invoice", endpoint: "payment-invoices" },
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
                  hint={getDocumentFillHint("sale", form.fields as unknown as Record<string, unknown>)}
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
      id: "tab-items", label: translate("SaleItemsList"), component: (
        <TradeDocumentItemsTable
          parentUuid={form.fields.uuid ?? ""}
          parentField="saleUuid"
          endpoint="saleitems"
          componentName="SaleItemsList_part"
          organizationUuid={form.fields.organizationUuid}
          documentDate={form.fields.date || null}
          priceTypeUuid={form.fields.priceTypeUuid}
          disabled={form.isLoading}
          deferRemoteChanges
          onRefresh={hasBasis ? () => void handleRefillFromBasis(true) : undefined}
          parentLabel={`${translate("SalesList")}: ID${form.fields.id ?? "?"}${form.fields.date ? " - " + getFormatDateOnly(String(form.fields.date)) : ""}`}
          key={itemsTableKey}
          initialPendingRows={itemsTableKey > 0 ? basisItems : (saleItems.pending.length > 0 ? saleItems.pending : basisItems)}
          onTotalChange={handleTotalChange}
          onItemsChange={saleItems.onItemsChange}
          onAllItemsChange={(rows) => { allItemsRef.current = rows; }}
          showRequiredHighlight
          defaultHiddenColumns={["amountNetOfIndirectTaxes", "amountWithoutVat"]}
        />
      )
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleTotalChange, handleContractSelect, handleOrganizationSelect, contractExtraParams, saleItems, isVatEnabled, useDiscount, basisItems, itemsTableKey, basisMismatch, notices, assignNumber]);

  return (
    <FormRequiredScope docType="sale" active>
      <FormDirtyScope dirtyKeys={form.unsavedFields}>
        <ModelForm paneId={form.paneId} tabs={tabs}
          onSave={form.handleSave}
          onSaveAndClose={form.handleSaveAndClose}
          onClose={form.handleClose}
          onReload={form.isEditMode ? form.handleReload : undefined}
          isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
          readonly={!canWrite} />
        {headerActionsPortal}
      </FormDirtyScope>
    </FormRequiredScope>
  );
};
SalesForm.displayName = "SalesForm";

const SalesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={SalesForm}
    getLabel={(d) => {
      return d?.date ? getFormatDateOnly(d.date as string) : "";
    }} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
SalesList.displayName = "SalesList";

export { SalesList, SalesForm };

