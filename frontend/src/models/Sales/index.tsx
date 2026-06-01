import { FC, useMemo, useCallback, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import BasisDocumentField from "src/components/Field/BasisDocumentField";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDateTime, Divider } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import LookupField from "src/components/Field/LookupField";
import TradeDocumentItemsTable from "src/components/DocumentItemsTable/TradeDocumentItemsTable";
import { Group, GroupRow, GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import useOrgAccountingSettings from "src/hooks/useOrgAccountingSettings";
import { useAutoFillPrimary } from "src/hooks/useAutoFillPrimary";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly, isoToLocalInput, localInputToIso } from "src/utils/datetime";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { validateDocumentFields, formatValidationErrors } from "src/utils/validatePostedDocument";
import { FormRequiredScope, FormDirtyScope } from "src/hooks/useFormRequired";
import { Toolbar } from "src/components/Toolbar";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import DocumentEntriesButton from "src/components/AccountingEntries/DocumentEntriesButton";
import SaleInvoicePrint, { type SaleInvoicePrintData, type SaleInvoicePrintColumns, type SaleItemPrintRow } from "./SaleInvoicePrint";
import ActPrint from "./ActPrint";
import { buildSaleInvoiceWorkbook } from "./saleInvoiceWorkbook";
import PrintDocumentPane, { type PrintColumnDef } from "src/components/PrintPreview/PrintDocumentPane";
import PrintDropdownButton from "src/components/Toolbar/PrintDropdownButton";
import ActionsDropdownButton from "src/components/Toolbar/ActionsDropdownButton";
import { useAppContext } from "src/app";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";
import { api } from "src/services/api/client";
import { openDocumentFromBasis, mapCommonTradeFields, refillFromBasisSource, fetchDocumentItems } from "src/utils/createFromBasis";
import { isEquivalent } from "src/utils/normalize";
import { checkStockAvailability, formatStockShortages } from "src/utils/stockControl";
import { useBasisMismatch } from "src/hooks/useBasisMismatch";
import RefillFromBasisButton from "src/models/_shared/RefillFromBasisButton";
import { OutgoingInvoicesForm } from "src/models/OutgoingInvoices";
import { SalesReturnsForm } from "src/models/SalesReturns";
import { useUserPermissionDefaults, type PermissionDefaultsMap } from "src/hooks/useUserPermissionDefaults";
import { useApplyPermissionDefaults, mergePermissionDefaultsIntoFields } from "src/hooks/useApplyPermissionDefaults";
import { useExistingDependents, formatDependentOption } from "src/hooks/useExistingDependents";
import DocumentTotals from "src/components/DocumentTotals";

const MODEL_ENDPOINT = "sales";
const LIST_NAME = "SalesList";
const FORM_LABEL = "Реализация товара и услуг";
const SALES_DEPENDENT_ENDPOINTS = ["outgoing-invoices", "sale-returns"];


interface TFields {
  id?: number; uuid?: string;
  date: string; comment: string; amount: number; posted: boolean;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
  warehouseUuid: string; warehouseName: string;
  vatAmount: number; discountAmount: number; amountWithoutVat: number;
  authorUuid: string; authorName: string;
  basisDocumentType: string; basisDocumentUuid: string; basisDocumentLabel: string;
}

const DEFAULT_FIELDS: TFields = {
  date: "", comment: "", amount: 0, posted: false,
  organizationUuid: "", organizationName: "", counterpartyUuid: "", counterpartyName: "", contractUuid: "", contractName: "",
  warehouseUuid: "", warehouseName: "",
  vatAmount: 0, discountAmount: 0, amountWithoutVat: 0,
  authorUuid: "", authorName: "",
  basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "",
};

const SalesForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const queryClient = useQueryClient();
  const { canWrite } = useAccessRight("Sale");
  const { windows: { addPane }, auth: { user: currentUser } } = useAppContext();

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data as any;
    if (data?.uuid) return undefined;
    if (data?.fromBasisFields) return { ...DEFAULT_FIELDS, ...data.fromBasisFields } as TFields;
    const init = { ...DEFAULT_FIELDS };
    init.date = isoToLocalInput(new Date().toISOString());
    if (data?.organizationUuid) { init.organizationUuid = data?.organizationUuid as string; }
    else if (defaultOrg.organizationUuid) { init.organizationUuid = defaultOrg.organizationUuid; init.organizationName = defaultOrg.organizationName; }
    if (data?.counterpartyUuid) { init.counterpartyUuid = data?.counterpartyUuid as string; }
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
  const allItemsRef = useRef<any[]>([]);

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
        createPayload: (r: any) => ({
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          price: r.price ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
          vatRate: r.vatRate ?? 0,
          exciseRate: r.exciseRate ?? 0,
          discountPercent: r.discountPercent ?? 0,
          datetime: r.datetime ?? null,
          posted: r.posted === true,
          organizationUuid: r.organization?.uuid ?? r.organizationUuid ?? null,
          counterpartyUuid: r.counterparty?.uuid ?? r.counterpartyUuid ?? null,
          warehouseUuid: r.warehouse?.uuid ?? r.warehouseUuid ?? null,
        }),
        updatePayload: (r: any) => ({
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          price: r.price ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
          vatRate: r.vatRate ?? 0,
          exciseRate: r.exciseRate ?? 0,
          discountPercent: r.discountPercent ?? 0,
          datetime: r.datetime ?? null,
          posted: r.posted === true,
          organizationUuid: r.organization?.uuid ?? r.organizationUuid ?? null,
          counterpartyUuid: r.counterparty?.uuid ?? r.counterpartyUuid ?? null,
          warehouseUuid: r.warehouse?.uuid ?? r.warehouseUuid ?? null,
        }),
        extraSkipFields: ["saleUuid"],
      },
    },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
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
        date: localInputToIso(fd.date),
        comment: fd.comment?.trim() || null,
        amount: fd.amount ? fd.amount : null,
        posted: fd.posted === true,
        organizationUuid: fd.organizationUuid || null,
        counterpartyUuid: fd.counterpartyUuid || null,
        contractUuid: fd.contractUuid || null,
        warehouseUuid: fd.warehouseUuid || null,
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
      let rows = allItemsRef.current.filter((r: any) => r._pendingAction !== "delete");
      if (rows.length === 0 && fd.uuid) {
        rows = await fetchDocumentItems("saleitems", "saleUuid", fd.uuid);
      }
      const shortages = await checkStockAvailability({
        documentType: "sale",
        documentUuid: fd.uuid || undefined,
        warehouseUuid: fd.warehouseUuid || null,
        items: rows.map((r: any) => ({ productUuid: r.productUuid, quantity: r.quantity })),
      });
      return shortages.length ? formatStockShortages(shortages) : null;
    },
  });

  const saleItems = form.useTable("saleItems");
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
    if (!form.fields.basisDocumentUuid || !form.fields.basisDocumentType) return;
    setIsRefilling(true);
    try {
      const result = await refillFromBasisSource(
        form.fields.basisDocumentType,
        form.fields.basisDocumentUuid,
        mapCommonTradeFields,
      );
      if (!result) return;
      if (!skipFields) {
        const rawPatch = mergePermissionDefaultsIntoFields(result.fields, permDefaultsRef.current, [
          { type: "contract", uuidKey: "contractUuid", nameKey: "contractName" },
          { type: "warehouse", uuidKey: "warehouseUuid", nameKey: "warehouseName" },
        ]);
        // Оставляем только поля, существующие в форме (иначе лишние поля → ложный Dirty).
        const cur = form.store.getSnapshot().fields as any;
        const patch = Object.fromEntries(
          Object.keys(rawPatch).filter(k => k in cur).map(k => [k, rawPatch[k]]),
        ) as Partial<TFields>;
        // Применяем только если поля реально изменились — иначе ложный Dirty.
        if (Object.keys(patch).some(k => !isEquivalent(cur[k], (patch as any)[k]))) {
          form.setFields(patch);
        }
      }
      // Текущее отображаемое состояние таблицы (сервер + pending create, без delete).
      // Если вкладка ещё не открывалась (allItemsRef пуст) — дозагружаем строки
      // с сервера, иначе первое сравнение даст «0 ≠ N» и поставит ложный Dirty.
      let displayed = allItemsRef.current.filter((r: any) => r._pendingAction !== "delete");
      if (displayed.length === 0 && form.fields.uuid) {
        displayed = await fetchDocumentItems("saleitems", "saleUuid", form.fields.uuid);
      }
      // Серверные строки (реальный uuid, не tmp) — их помечаем на удаление при заполнении.
      const serverItems = displayed.filter((r: any) =>
        !(typeof r.uuid === "string" && r.uuid.startsWith("tmp-")) && !(typeof r.id === "number" && r.id < 0),
      );
      // Сравниваем новые строки основания с отображаемыми — если совпадают,
      // не трогаем pending (иначе ложный Dirty при идентичных данных).
      const itemsAreSame = displayed.length === result.items.length &&
        displayed.every((si: any, idx: number) => {
          const ni = result.items[idx];
          return si.productUuid === ni.productUuid &&
            Number(si.quantity) === Number(ni.quantity) &&
            Number(si.price) === Number(ni.price) &&
            Number(si.vatRate) === Number(ni.vatRate) &&
            Number(si.discountPercent) === Number(ni.discountPercent) &&
            Number(si.exciseRate) === Number(ni.exciseRate);
        });
      if (!itemsAreSame) {
        const deleteMarkers = serverItems.map((r: any) => ({ ...r, _pendingAction: "delete" as const }));
        setBasisItems([...deleteMarkers, ...result.items]);
        setItemsTableKey(k => k + 1);
      }
    } catch (e) {
      console.error("[refill] failed", e);
    } finally {
      setIsRefilling(false);
    }
  }, [form.fields.basisDocumentType, form.fields.basisDocumentUuid, form.fields.uuid, form.setFields, queryClient]);

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

  const handleTotalChange = useCallback((total: number, items?: any[]) => {
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
    const hasOrg = !!form.fields.organizationUuid;
    const hasCpty = !!form.fields.counterpartyUuid;
    const p: Record<string, string> = {};
    if (hasOrg) {
      p.organizationUuid = form.fields.organizationUuid;
    } else if (!hasCpty) {
      // нет ни орг, ни контрагента → только общие договора без организации
      p.organizationUuid = "null";
    }
    // hasCpty && !hasOrg → не передаём organizationUuid (договора контрагента из любой орг)
    if (hasCpty) {
      p.counterpartyUuid = form.fields.counterpartyUuid;
    } else {
      p.counterpartyUuid = "null";
    }
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

  // ── Печать: накладная З-2 и акт выполненных работ ──────────────────

  const handlePrint = useCallback(async (layoutId: "invoice" | "act") => {
    if (!form.fields.uuid) return;
    try {
      const [saleResp, itemsResp] = await Promise.all([
        api.get<{ success?: boolean; item?: any } | any>(`sales/${form.fields.uuid}`),
        api.get<{ success?: boolean; items?: any[] } | any>(`saleitems`, { params: { saleUuid: form.fields.uuid } }),
      ]);
      const sale = (saleResp as any)?.item ?? saleResp;
      const allItems: any[] = (itemsResp as any)?.items ?? (Array.isArray(itemsResp) ? itemsResp : []);

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
        ? `Акт вып. работ № ${baseData.documentId ?? ""}`
        : `Накладная № ${baseData.documentId ?? ""}`;
      const fileBase = (isAct
        ? `Акт_${baseData.documentId ?? "draft"}`
        : `Накладная_${baseData.documentId ?? "draft"}`
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
    FormComponent: typeof OutgoingInvoicesForm | typeof SalesReturnsForm,
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
  const headerActionsPortal = usePaneHeaderActions(
    form.paneId,
    (isSavedDoc || hasBasis) ? (
      <>
        {isSavedDoc && <DocumentEntriesButton documentType="sale" documentUuid={form.fields.uuid} />}
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
            options={[
              { id: "outgoing", label: formatDependentOption(translate("outgoingInvoice"), existingDeps["outgoing-invoices"]) },
              { id: "saleReturn", label: formatDependentOption(translate("SalesReturnsList"), existingDeps["sale-returns"]) },
            ]}
            onSelect={(id) => {
              if (id === "outgoing") void handleCreateFromBasis(OutgoingInvoicesForm, translate("outgoingInvoice"), "sale", "saleitems", "outgoing-invoices");
              if (id === "saleReturn") void handleCreateFromBasis(SalesReturnsForm, translate("SalesReturnsList"), "sale", "saleitems", "sale-returns");
            }}
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
    ) : null,
  );

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>

            <GroupCol>
              {/* ── Левая колонка: поля ── */}
              {/* Строка 1: Дата · Проведён · Статус */}
              <GroupRow style={{ width: "100%", justifyContent: "space-between" }}>
                <FieldDateTime label={translate("date")} name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="180px" />
                <FieldToggle
                  name={`${form.formUid}_posted`}
                  label={translate("posted")}
                  value={form.fields.posted === true}
                  onChange={(v) => form.setField("posted", v)}
                  disabled={form.isLoading || !canWrite}
                  variant="success"
                />
              </GroupRow>

              <Group>
                {/* Организация — во всю ширину */}
                <LookupField label={translate("organization")} name={`${form.formUid}_organizationUuid`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="name" onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TFields>)} onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)} disabled={form.isLoading} />

                <LookupField label={translate("warehouse")} name={`${form.formUid}_warehouseUuid`} value={form.fields.warehouseUuid} displayValue={form.fields.warehouseName} endpoint="warehouses" displayField="name" onSelect={(u, d) => form.setFields({ warehouseUuid: u, warehouseName: d } as Partial<TFields>)} onClear={() => form.setFields({ warehouseUuid: "", warehouseName: "" } as Partial<TFields>)} disabled={form.isLoading} extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
              </Group>

              <Group>
                {/* Контрагент — во всю ширину */}
                <LookupField label={translate("counterparty")} name={`${form.formUid}_counterpartyUuid`} value={form.fields.counterpartyUuid} displayValue={form.fields.counterpartyName} endpoint="counterparties" displayField="name" onSelect={(u, d) => form.setFields({ counterpartyUuid: u, counterpartyName: d } as Partial<TFields>)} onClear={() => form.setFields({ counterpartyUuid: "", counterpartyName: "" } as Partial<TFields>)} disabled={form.isLoading} />

                <LookupField label={translate("contract")} name={`${form.formUid}_contractUuid`} value={form.fields.contractUuid} displayValue={form.fields.contractName} endpoint="contracts" displayField="name" onSelect={handleContractSelect} onClear={() => form.setFields({ contractUuid: "", contractName: "" } as Partial<TFields>)} disabled={form.isLoading} extraParams={contractExtraParams} />
              </Group>

            </GroupCol>
            <GroupCol>
              <BasisDocumentField
                allowedTypes={[{ type: "payment_invoice", endpoint: "payment-invoices" }]}
                basisDocumentType={form.fields.basisDocumentType}
                basisDocumentUuid={form.fields.basisDocumentUuid}
                basisDocumentLabel={form.fields.basisDocumentLabel}
                formUid={form.formUid}
                disabled={form.isLoading}
                onSelect={(type, uuid, label) => form.setFields({ basisDocumentType: type, basisDocumentUuid: uuid, basisDocumentLabel: label } as Partial<TFields>)}
                onClear={() => form.setFields({ basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "" } as Partial<TFields>)}
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
          parentUuid={form.fields.uuid ?? ""}
          parentField="saleUuid"
          endpoint="saleitems"
          componentName="SaleItemsList_part"
          organizationUuid={form.fields.organizationUuid}
          documentDate={form.fields.date || null}
          disabled={form.isLoading}
          deferRemoteChanges
          onRefresh={hasBasis ? () => void handleRefillFromBasis(true) : undefined}
          parentLabel={`${translate("SalesList")}: ID${form.fields.id ?? "?"}${form.fields.date ? " · " + getFormatDateOnly(String(form.fields.date)) : ""}`}
          key={itemsTableKey}
          initialPendingRows={itemsTableKey > 0 ? basisItems : (saleItems.pending.length > 0 ? saleItems.pending : basisItems)}
          onTotalChange={handleTotalChange}
          onItemsChange={saleItems.onItemsChange}
          onAllItemsChange={(rows) => { allItemsRef.current = rows; }}
          showRequiredHighlight={form.meta.tablesValidationFailed}
          defaultHiddenColumns={["amountNetOfIndirectTaxes", "amountWithoutVat"]}
        />
      )
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleTotalChange, handleContractSelect, contractExtraParams, saleItems, isVatEnabled, useDiscount, basisItems, itemsTableKey, basisMismatch]);

  return (
    <FormRequiredScope docType="sale" active={form.meta.headerValidationFailed}>
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

