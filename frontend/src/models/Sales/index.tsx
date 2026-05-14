import { FC, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDateTime, Divider } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import LookupField from "src/components/Field/LookupField";
import { SaleItemsTable } from "./SaleItemsTable";
import { Group, GroupRow, GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import useOrgAccountingSettings from "src/hooks/useOrgAccountingSettings";
import { useAutoFillPrimary } from "src/hooks/useAutoFillPrimary";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly, isoToLocalInput, localInputToIso } from "src/utils/main.module";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { Toolbar } from "src/components/Toolbar";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import { usePrintDocument } from "src/components/PrintLayout/usePrintDocument";
import SaleInvoicePrint, { type SaleInvoicePrintData, type SaleInvoicePrintColumns, type SaleItemPrintRow } from "./SaleInvoicePrint";
import { buildSaleInvoiceWorkbook } from "./saleInvoiceWorkbook";
import PrintDocumentPane from "src/components/PrintPreview/PrintDocumentPane";
import { renderToStaticMarkup } from "react-dom/server";
import { useAppContext } from "src/app";
import { Icon } from "src/components/IconButton/icons";
import { api } from "src/services/api/client";

const MODEL_ENDPOINT = "sales";
const LIST_NAME = "SalesList";
const FORM_LABEL = "Реализация";


interface TFields {
  id?: number; uuid?: string;
  date: string; description: string; amount: number; posted: boolean;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
  warehouseUuid: string; warehouseName: string;
  vatAmount: number; discountAmount: number; amountWithoutVat: number;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  date: "", description: "", amount: 0, posted: false,
  organizationUuid: "", organizationName: "", counterpartyUuid: "", counterpartyName: "", contractUuid: "", contractName: "",
  warehouseUuid: "", warehouseName: "",
  vatAmount: 0, discountAmount: 0, amountWithoutVat: 0,
  authorUuid: "", authorName: "",
};

const SalesForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const queryClient = useQueryClient();
  const { canWrite } = useAccessRight("Sale");

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data;
    if (!data || data.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    // «Автор» для нового документа всегда пустой:
    // заполняется сервером при первом сохранении (req.user.uuid).
    if (data.organizationUuid) { init.organizationUuid = data.organizationUuid as string; }
    else if (defaultOrg.organizationUuid) { init.organizationUuid = defaultOrg.organizationUuid; init.organizationName = defaultOrg.organizationName; }
    if (data.counterpartyUuid) { init.counterpartyUuid = data.counterpartyUuid as string; }
    return init;
  })();

  const invalidateSubTables = useCallback(async () => {
    // refetchType: "active" — invalidateQueries вернёт Promise, который
    // резолвится только после того, как АКТИВНЫЕ (mounted) запросы
    // саб-таблиц завершат refetch. Это критично для submit-flow:
    // useFormStore очищает pending-строки SubTable ТОЛЬКО после того,
    // как afterSave дождётся свежих данных с сервера.
    await queryClient.invalidateQueries({
      queryKey: ["saleitems"],
      refetchType: "active",
    });
  }, [queryClient]);

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
        createPayload: (r: any) => ({
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
        extraSkipFields: ["saleUuid"],
      },
    },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      date: isoToLocalInput(d.date),
      description: d.description ?? "", amount: d.amount != null ? Number(d.amount) : 0,
      posted: d.posted === true,
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.shortName ?? "",
      counterpartyUuid: d.counterpartyUuid ?? "",
      counterpartyName: d.counterparty?.shortName ?? "",
      contractUuid: d.contractUuid ?? "",
      contractName: d.contract?.shortName ?? "",
      warehouseUuid: d.warehouseUuid ?? "",
      warehouseName: d.warehouse?.shortName ?? "",
      vatAmount: d.vatAmount != null ? Number(d.vatAmount) : 0,
      discountAmount: d.discountAmount != null ? Number(d.discountAmount) : 0,
      amountWithoutVat: d.amountWithoutVat != null ? Number(d.amountWithoutVat) : 0,
      authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
      authorName: d.author?.username ?? d.author?.email ?? "",
    }),
    buildPayload: (fd) => ({
      date: localInputToIso(fd.date),
      description: fd.description?.trim() || null,
      amount: fd.amount ? fd.amount : null,
      posted: fd.posted === true,
      organizationUuid: fd.organizationUuid || null,
      counterpartyUuid: fd.counterpartyUuid || null,
      contractUuid: fd.contractUuid || null,
      warehouseUuid: fd.warehouseUuid || null,
      vatAmount: fd.vatAmount ? fd.vatAmount : 0,
      discountAmount: fd.discountAmount ? fd.discountAmount : 0,
      amountWithoutVat: fd.amountWithoutVat ? fd.amountWithoutVat : 0,
    }),
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved),
    afterLoad: invalidateSubTables,
    afterSave: invalidateSubTables,
  });

  const saleItems = form.useTable("saleItems");

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
    const hasOrg = !!form.fields.organizationUuid;
    const hasCpty = !!form.fields.counterpartyUuid;
    // Авто-подбор договора имеет смысл только когда есть хотя бы один из владельцев.
    if (!hasOrg && !hasCpty) return null;
    const s: Record<string, string> = {};
    if (hasOrg) s.organizationUuid = form.fields.organizationUuid;
    if (hasCpty) s.counterpartyUuid = form.fields.counterpartyUuid;
    return s;
  }, [form.fields.organizationUuid, form.fields.counterpartyUuid]);

  useAutoFillPrimary({
    endpoint: "contracts",
    scope: contractScope,
    currentUuid: form.fields.contractUuid,
    isEditMode: form.isEditMode,
    isLoading: form.isLoading,
    apply: (uuid, name) =>
      form.setFields({ contractUuid: uuid, contractName: name } as Partial<TFields>),
  });

  const handleTotalChange = useCallback((total: number, items?: any[]) => {
    // console.log(Number(total), total);
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
      updates.organizationName = item.organization?.shortName ?? "";
    }
    if (item.counterpartyUuid) {
      updates.counterpartyUuid = item.counterpartyUuid;
      updates.counterpartyName = item.counterparty?.shortName ?? "";
    }
    form.setFields(updates);
  }, [form.setFields]);

  // ── Печать накладной (форма З-2 РК) ────────────────────────────────
  // Печать осуществляется в формате A4 HTML (регламентированная типовая
  // форма З-2 РК, приказ Минфина РК № 562 от 20.12.2012). Реализация:
  //   • SaleInvoicePrint рендерит документ в скрытом iframe;
  //   • usePrintDocument.print() вызывает window.print() в этом iframe;
  //   • пользователь в нативном диалоге может «Сохранить как PDF» или печатать.
  // xlsx-предпросмотр (buildSaleInvoiceWorkbook + GeneratedXlsxPreviewPane)
  // также используется как альтернативный путь — открывается во вкладке для
  // экспорта в .xlsx (через ctrl+клик / shift+клик ниже).
  const { print: printHtml } = usePrintDocument();
  const { windows: { addPane } } = useAppContext();
  const handlePrint = useCallback(async () => {
    if (!form.fields.uuid) return;
    try {
      // Получаем актуальные данные документа + позиции с сервера
      const [saleResp, itemsResp] = await Promise.all([
        api.get<{ success?: boolean; item?: any } | any>(`sales/${form.fields.uuid}`),
        api.get<{ success?: boolean; items?: any[] } | any>(`saleitems`, { params: { saleUuid: form.fields.uuid } }),
      ]);
      const sale = (saleResp as any)?.item ?? saleResp;
      const items: any[] = (itemsResp as any)?.items ?? (Array.isArray(itemsResp) ? itemsResp : []);

      const rows: SaleItemPrintRow[] = items.map((it, idx) => ({
        number: idx + 1,
        name: it.product?.shortName ?? it.productName ?? it.name ?? "",
        unit: it.unitOfMeasure?.shortName ?? it.unitOfMeasureName ?? "",
        quantity: Number(it.quantity ?? 0),
        price: Number(it.price ?? 0),
        discountPercent: it.discountPercent != null ? Number(it.discountPercent) : undefined,
        discountAmount: it.discountAmount != null ? Number(it.discountAmount) : undefined,
        exciseRate: it.exciseRate != null ? Number(it.exciseRate) : undefined,
        exciseAmount: it.exciseAmount != null ? Number(it.exciseAmount) : undefined,
        amountWithoutVat: it.amountWithoutVat != null ? Number(it.amountWithoutVat) : undefined,
        vatRate: it.vatRate != null ? Number(it.vatRate) : undefined,
        vatAmount: it.vatAmount != null ? Number(it.vatAmount) : undefined,
        amount: Number(it.amount ?? 0),
      }));

      // Сумма акциза по документу = сумма по строкам (на уровне Sale поля нет).
      const totalExciseAmount = rows.reduce((s, r) => s + Number(r.exciseAmount ?? 0), 0);

      // Читаем выбор пользователя «В печать» из настроек таблицы строк.
      // Ключ совпадает с componentName SubTable (см. SaleItemsTable).
      const PRINT_KEYS = [
        "discountPercent",
        "discountAmount",
        "amountWithoutVat",
        "exciseRate",
        "exciseAmount",
        "vatRate",
        "vatAmount",
      ] as const;
      const printColumns: SaleInvoicePrintColumns = {};
      try {
        const raw = localStorage.getItem("table_columns_SaleItemsList_part");
        if (raw) {
          const parsed: Array<{ identifier: string; printable?: boolean; togglePrintable?: boolean }> = JSON.parse(raw);
          for (const c of parsed) {
            if (c?.togglePrintable && (PRINT_KEYS as readonly string[]).includes(c.identifier)) {
              (printColumns as Record<string, boolean>)[c.identifier] = c.printable !== false;
            }
          }
        }
      } catch {
        // если кэш повреждён — используем поведение по умолчанию (auto-detect)
      }

      const data: SaleInvoicePrintData = {
        documentId: sale?.id ?? form.fields.id,
        documentDate: sale?.date ?? form.fields.date,
        organizationName: sale?.organization?.shortName ?? form.fields.organizationName,
        organizationBin: sale?.organization?.bin ?? sale?.organization?.iin ?? undefined,
        organizationAddress: sale?.organization?.address ?? undefined,
        counterpartyName: sale?.counterparty?.shortName ?? form.fields.counterpartyName,
        counterpartyBin: sale?.counterparty?.bin ?? sale?.counterparty?.iin ?? undefined,
        counterpartyAddress: sale?.counterparty?.address ?? undefined,
        contractName: sale?.contract?.shortName ?? form.fields.contractName,
        warehouseName: sale?.warehouse?.shortName ?? form.fields.warehouseName,
        items: rows,
        totalAmount: Number(sale?.amount ?? form.fields.amount ?? 0),
        totalAmountWithoutVat: Number(sale?.amountWithoutVat ?? form.fields.amountWithoutVat ?? 0),
        totalVatAmount: Number(sale?.vatAmount ?? form.fields.vatAmount ?? 0),
        totalDiscountAmount: Number(sale?.discountAmount ?? form.fields.discountAmount ?? 0),
        totalExciseAmount: Math.round(totalExciseAmount * 100) / 100,
        columns: printColumns,
      };

      // Открываем макет в отдельной MDI-вкладке (PrintDocumentPane).
      // Внутри pane — iframe с A4-HTML + тулбар сохранения в xlsx/xls/pdf/doc.
      // Печать происходит из самой вкладки (Печать / .pdf), а не через
      // нативный диалог из формы — пользователь видит макет, может править
      // выбор колонок и сохранить в любом из 4 форматов.
      const titleStr = `Накладная № ${data.documentId ?? ""}`;
      const fileBase = `Накладная_${data.documentId ?? "draft"}`.replace(/\s+/g, "_");
      const bodyHtml = renderToStaticMarkup(<SaleInvoicePrint data={data} />);
      const workbook = buildSaleInvoiceWorkbook(data);
      addPane({
        component: PrintDocumentPane,
        isSelector: true,
        label: titleStr,
        data: {
          id: Number(data.documentId ?? form.fields.id ?? 0),
          uuid: String(form.fields.uuid ?? ""),
          bodyHtml,
          fileBaseName: fileBase,
          title: titleStr,
          workbook,
        },
      });
    } catch (e) {
      console.error("[print] sale invoice failed", e);
      alert("Не удалось подготовить документ к печати");
    }
  }, [
    form.fields.uuid,
    form.fields.id,
    form.fields.date,
    form.fields.amount,
    form.fields.amountWithoutVat,
    form.fields.vatAmount,
    form.fields.discountAmount,
    form.fields.organizationName,
    form.fields.counterpartyName,
    form.fields.contractName,
    form.fields.warehouseName,
    addPane,
    printHtml,
  ]);

  // Регистрируем кнопку «Печать» в шапке панели (рядом с Reload/Close).
  // Доступна только для сохранённого документа.
  // ВАЖНО: возвращаемый ReactNode (портал) надо отрендерить в JSX,
  // иначе React не выполнит createPortal и кнопка не появится.
  const headerActionsPortal = usePaneHeaderActions(
    form.paneId,
    form.isEditMode && form.fields.uuid ? (
      <Toolbar.PrintButton onClick={handlePrint} disabled={form.isLoading} />
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
              <GroupRow>
                <FieldDateTime label="Дата" name={`${form.formUid}_docDate`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="180px" />


                <FieldToggle
                  name={`${form.formUid}_posted`}
                  label="Проведён"
                  value={form.fields.posted === true}
                  onChange={(v) => form.setField("posted", v)}
                  disabled={form.isLoading || !canWrite}
                  variant="success"
                />
              </GroupRow>

              <Group>
                {/* Организация — во всю ширину */}
                <LookupField label="Организация" name={`${form.formUid}_org`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="shortName" onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TFields>)} onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)} disabled={form.isLoading} />

                <LookupField label="Склад" name={`${form.formUid}_wh`} value={form.fields.warehouseUuid} displayValue={form.fields.warehouseName} endpoint="warehouses" displayField="shortName" onSelect={(u, d) => form.setFields({ warehouseUuid: u, warehouseName: d } as Partial<TFields>)} onClear={() => form.setFields({ warehouseUuid: "", warehouseName: "" } as Partial<TFields>)} disabled={form.isLoading} extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
              </Group>

              <Group>
                {/* Контрагент — во всю ширину */}
                <LookupField label="Контрагент" name={`${form.formUid}_cpty`} value={form.fields.counterpartyUuid} displayValue={form.fields.counterpartyName} endpoint="counterparties" displayField="shortName" onSelect={(u, d) => form.setFields({ counterpartyUuid: u, counterpartyName: d } as Partial<TFields>)} onClear={() => form.setFields({ counterpartyUuid: "", counterpartyName: "" } as Partial<TFields>)} disabled={form.isLoading} />

                {/* Склад | Договор — в одну строку, по 50% */}

                <LookupField label="Договор" name={`${form.formUid}_contract`} value={form.fields.contractUuid} displayValue={form.fields.contractName} endpoint="contracts" displayField="shortName" onSelect={handleContractSelect} onClear={() => form.setFields({ contractUuid: "", contractName: "" } as Partial<TFields>)} disabled={form.isLoading} extraParams={contractExtraParams} />
              </Group>

              <Group>
                {/* Комментарий */}
                <Field label="Комментарий" name={`${form.formUid}_desc`} value={form.fields.description} onChange={e => form.setField("description", e.target.value)} disabled={form.isLoading} />
              </Group>
            </GroupCol>
            <Group>
              <div style={{ background: "#f8f9fa", border: "1px solid #e5e7eb", borderRadius: 6, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 5, fontSize: 13, maxWidth: '200px' }}>
                {([
                  ...(isVatEnabled
                    ? ([
                      { label: "Без НДС", value: form.fields.amountWithoutVat },
                      { label: "НДС", value: form.fields.vatAmount },
                    ] as const)
                    : ([] as const)),
                  ...(useDiscount
                    ? ([{ label: "Скидка", value: form.fields.discountAmount }] as const)
                    : ([] as const)),
                ] as ReadonlyArray<{ label: string; value: number | string }>).map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "#6b7280" }}>
                    <span>{label}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{value || "0"}</span>
                  </div>
                ))}
                <div style={{ borderTop: "1px solid #e5e7eb", margin: "2px 0 0" }} />
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: 600, fontSize: 14, paddingTop: 2 }}>
                  <span>Итого</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{form.fields.amount || "0"}</span>
                </div>
              </div>
            </Group>

            {/* ── Служебные поля внизу: видны только для сохранённых документов ── */}
            {form.isEditMode && <><Divider /><Group align="row" gap="12px">
              <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
              <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
              <Field label="Автор" name={`${form.formUid}_author`} width="220px" value={form.fields.authorName || ""} disabled />
            </Group></>}
          </div>
        </div>
      )
    },
    {
      id: "tab-items", label: translate("SaleItemsList"), component: form.isEditMode && form.fields.uuid ? (
        <SaleItemsTable saleUuid={form.fields.uuid} organizationUuid={form.fields.organizationUuid} documentDate={form.fields.date || null} disabled={form.isLoading} deferRemoteChanges
          parentLabel={`${translate("SalesList") || "Реализация"}: №${form.fields.id ?? "?"}${form.fields.date ? " · " + getFormatDateOnly(String(form.fields.date)) : ""}`}
          initialPendingRows={saleItems.pending} onTotalChange={handleTotalChange}
          onItemsChange={saleItems.onItemsChange} />
      ) : (
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", color: "#999", fontSize: 14, padding: "24px 0" }}>
          Сохраните документ для добавления товаров
        </div>
      )
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleTotalChange, handleContractSelect, contractExtraParams, saleItems, isVatEnabled, useDiscount]);

  return (
    <>
      <ModelForm paneId={form.paneId} tabs={tabs}
        onSave={form.handleSave}
        onSaveAndClose={form.handleSaveAndClose}
        onClose={form.handleClose}
        onReload={form.isEditMode ? form.handleReload : undefined}
        isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
        //
        readonly={!canWrite} isDirty={form.isDirty} />
      {headerActionsPortal}
    </>
  );
};
SalesForm.displayName = "SalesForm";

const SalesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={SalesForm}
    getLabel={(d) => {
      return d?.date ? getFormatDateOnly(d.date as string) : "";
    }} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }} enableDateRange
    renderCell={(row, col) => {
      if (col.identifier === "posted") {
        const isPosted = row.posted === true;
        return (
          <span
            title={isPosted ? "Документ проведён" : "Не проведён"}
          >
            <Icon
              name={isPosted ? "posted" : "notPosted"}
              width={17}
              height={17}
              style={{ color: isPosted ? "#10b981" : "#9ca3af", flexShrink: 0, display: "flex" }}
            />
            {/* {isPosted ? "Проведён" : "Черновик"} */}
          </span>
        );
      }
      return undefined;
    }}
  />
);
SalesList.displayName = "SalesList";

export { SalesList, SalesForm, SaleItemsTable };

