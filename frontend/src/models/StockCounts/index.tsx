/* eslint-disable @typescript-eslint/no-explicit-any */
// ─────────────────────────────────────────────────────────────────────────────
// StockCountsForm — Инвентаризация (E6.2).
// Документ НЕ двигает регистр товаров и НЕ формирует проводок: он фиксирует
// расхождение «учёт vs факт». Движения склада создаются отдельными документами —
// Списанием (недостача) и Оприходованием (излишек).
//   • accountingQuantity — остаток по учёту (снимок регистра, кнопка «Заполнить по учёту»)
//   • quantity           — фактическое количество (вводит кладовщик)
//   • deviation          — факт − учёт (вычисляется в таблице)
// ─────────────────────────────────────────────────────────────────────────────
import { FC, useMemo, useCallback, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateSubTableFor } from "src/utils/invalidateSubTableFor";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDateTime } from "src/components/Field";
import { useAssignNumber } from "src/hooks/useAssignNumber";
import HeaderTogglePosted from "src/components/PaneHeader/HeaderTogglePosted";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import { Button } from "src/components/Button";
import { FormLookup } from "src/components/Field/FormLookup";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useFormStore } from "src/hooks/useFormStore";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly, isoToLocalInput, localInputToIso } from "src/utils/datetime";
import Notice from "src/components/Notice";
import { useDocumentNotices } from "src/hooks/useDocumentNotices";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import TradeDocumentItemsTable from "src/components/DocumentItemsTable/TradeDocumentItemsTable";
import { validateDocumentFields, formatValidationErrors } from "src/utils/validatePostedDocument";
import { FormRequiredScope, FormDirtyScope } from "src/hooks/useFormRequired";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";
import { api } from "src/services/api/client";
import { showToast } from "src/components/UIToast";
import { openDocumentFromBasis, type BasisFromTarget } from "src/utils/createFromBasis";
import { useAppContext } from "src/app/context";
import ActionsDropdownButton from "src/components/Toolbar/ActionsDropdownButton";
import { WriteOffsForm } from "src/models/WriteOffs";
import { GoodsReceiptsForm } from "src/models/GoodsReceipts";

/** Отклонение строки инвентаризации: факт − учёт. */
const deviationOf = (r: any) => (Number(r.quantity) || 0) - (Number(r.accountingQuantity) || 0);

/** Шапка Списания/Оприходования наследует организацию и склад инвентаризации. */
const mapStockCountFields = (src: any) => ({
  organizationUuid: src.organizationUuid ?? "",
  organizationName: src.organizationName ?? "",
  warehouseUuid: src.warehouseUuid ?? "",
  warehouseName: src.warehouseName ?? "",
});

/**
 * Строки основания → строки документа-корректировки. Берём только строки нужного
 * знака отклонения, количество = модуль отклонения (а не факт и не учёт).
 * sourceRowId сохраняем — он делает «Перезаполнить по основанию» идемпотентным.
 */
const mapDeviationItems = (sign: 1 | -1) => (sourceItems: any[]) => {
  const ts = Date.now();
  return sourceItems
    .map((r) => ({ r, dev: deviationOf(r) }))
    .filter(({ dev }) => (sign > 0 ? dev > 0 : dev < 0))
    .map(({ r, dev }, i) => ({
      id: -(i + 1),
      uuid: `tmp-basis-${ts}-${i}`,
      _pendingAction: "create",
      sourceRowId: r.uuid ?? null,
      productUuid: r.productUuid ?? null,
      product: r.product ?? null,
      unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
      unitOfMeasure: r.unitOfMeasure ?? null,
      quantity: Math.abs(dev),
      price: 0,
    }));
};

const MODEL_ENDPOINT = "stockcounts";
const LIST_NAME = "StockCountsList";
const FORM_LABEL = "Инвентаризация";

interface TFields {
  id?: number; uuid?: string;
  number: string;
  date: string; comment: string;
  posted: boolean;
  warehouseUuid: string; warehouseName: string;
  organizationUuid: string; organizationName: string;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  number: "",
  date: "", comment: "",
  posted: false,
  warehouseUuid: "", warehouseName: "",
  organizationUuid: "", organizationName: "",
  authorUuid: "", authorName: "",
};

const StockCountsForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const queryClient = useQueryClient();
  const { canWrite } = useUserAccessRight("StockCount");
  const [isFilling, setIsFilling] = useState(false);
  const [itemsTableKey, setItemsTableKey] = useState(0);
  const allItemsRef = useRef<any[]>([]);

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data;
    if (data?.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    init.date = isoToLocalInput(new Date().toISOString());
    if (data?.organizationUuid) { init.organizationUuid = data?.organizationUuid as string; }
    else if (defaultOrg.organizationUuid) { init.organizationUuid = defaultOrg.organizationUuid; init.organizationName = defaultOrg.organizationName; }
    return init;
  })();

  const invalidateSubTables = useCallback(async (savedData: any) => {
    await invalidateSubTableFor(queryClient, "stockcountitems", "stockCountUuid", savedData?.uuid ?? "");
  }, [queryClient]);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "stock-counts-form",
    defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
    tables: {
      items: {
        endpoint: "stockcountitems", parentField: "stockCountUuid",
        label: "Позиции инвентаризации",
        batchEndpoint: "stockcountitems/batch",
        requiredItemFields: ["productUuid", "unitOfMeasureUuid"],
        requiredItemFieldLabels: { productUuid: "Номенклатура", unitOfMeasureUuid: "Ед. изм." },
        createPayload: (r: any) => ({
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          accountingQuantity: r.accountingQuantity ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
        }),
        updatePayload: (r: any) => ({
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          accountingQuantity: r.accountingQuantity ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
        }),
        extraSkipFields: ["stockCountUuid"],
      },
    },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      number: d.number ?? "",
      date: isoToLocalInput(d.date),
      comment: d.comment ?? "",
      posted: d.posted === true,
      warehouseUuid: d.warehouseUuid ?? "",
      warehouseName: d.warehouse?.name ?? "",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.name ?? "",
      authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
      authorName: d.author?.username ?? d.author?.email ?? "",
    }),
    buildPayload: (fd) => {
      const validation = validateDocumentFields("stock_count", fd as unknown as Record<string, unknown>);
      if (!validation.isValid) return formatValidationErrors(validation.errors);
      return {
        number: fd.number?.trim() || null,
        date: localInputToIso(fd.date),
        comment: fd.comment?.trim() || null,
        posted: fd.posted === true,
        warehouseUuid: fd.warehouseUuid || null,
        organizationUuid: fd.organizationUuid || null,
      };
    },
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved, "date"),
    afterSave: invalidateSubTables,
  });

  const items = form.useTable("items");

  const handleOrganizationSelect = useCallback((uuid: string, displayValue: string) => {
    const cur = form.store.getSnapshot().fields as any;
    if (cur.organizationUuid === uuid) {
      form.setFields({ organizationUuid: uuid, organizationName: displayValue } as Partial<TFields>);
      return;
    }
    form.setFields({
      organizationUuid: uuid, organizationName: displayValue,
      warehouseUuid: "", warehouseName: "",
    } as Partial<TFields>);
  }, [form.setFields, form.store]);

  // «Заполнить по учёту» — сервер снимает остатки регистра на дату документа.
  // Требует сохранённого документа (нужен uuid) и отсутствия несохранённых правок.
  const handleFillAccounting = useCallback(async () => {
    const uuid = form.fields.uuid;
    if (!uuid) return;
    setIsFilling(true);
    try {
      const resp = await api.post<{ success?: boolean; created?: number; updated?: number }>(
        `${MODEL_ENDPOINT}/${uuid}/fill-accounting`, {},
      );
      await invalidateSubTables({ uuid });
      setItemsTableKey((k) => k + 1);
      showToast(
        translate("fillAccountingDone")
          .replace("{created}", String(resp?.created ?? 0))
          .replace("{updated}", String(resp?.updated ?? 0)),
        "success",
      );
    } catch (e: any) {
      showToast(e?.response?.data?.message ?? translate("error"), "error");
    } finally {
      setIsFilling(false);
    }
  }, [form.fields.uuid, invalidateSubTables]);

  const assignNumber = useAssignNumber();
  const notices = useDocumentNotices({ docType: "stock_count", fields: form.fields as unknown as Record<string, unknown> });

  // Сводка расхождений по текущим строкам (излишек / недостача, в штуках).
  const { surplus, shortage } = useMemo(() => {
    let s = 0, d = 0;
    for (const r of allItemsRef.current) {
      if ((r as any)._pendingAction === "delete") continue;
      const dev = (Number(r.quantity) || 0) - (Number(r.accountingQuantity) || 0);
      if (dev > 0) s += dev; else d += -dev;
    }
    return { surplus: Math.round(s * 10000) / 10000, shortage: Math.round(d * 10000) / 10000 };
  }, [itemsTableKey, items]);
  const fmtQty = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 });

  const isSaved = form.isEditMode && !!form.fields.uuid;

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormContainer}>
          <div className={styles.FormWrapper}>
            <GroupCol className={styles.Form}>
              <GroupRow className={styles.FormHeaderRow}>
                <FieldDateTime label={translate("date")} name={`${form.formUid}_date`} width="200px" value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} />
                <Field label={translate("documentNumber")} name={`${form.formUid}_number`} value={form.fields.number} onChange={e => form.setField("number", e.target.value)} disabled={form.isLoading} width="200px" maxLength={9}
                  actions={[
                    { type: "assignNumber", onClick: () => void assignNumber(MODEL_ENDPOINT, form.fields.organizationUuid, form.fields.number, (n) => form.setField("number", n), form.fields.date, form.fields.uuid) },
                  ]} />
              </GroupRow>
              <Group>
                <FormLookup form={form} field="organization" endpoint="organizations"
                  onSelect={handleOrganizationSelect} />
                <FormLookup form={form} field="warehouse" endpoint="warehouses"
                  extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
              </Group>
            </GroupCol>
            <GroupCol className={styles.FormTotals}>
              <div className={styles.SummaryCard}>
                <div className={styles.SummaryRow}>
                  <span>{translate("stockCountSurplus")}</span>
                  <span>{fmtQty.format(surplus)}</span>
                </div>
                <div className={styles.SummaryRow}>
                  <span>{translate("stockCountShortage")}</span>
                  <span>{fmtQty.format(shortage)}</span>
                </div>
                <div className={styles.SummaryNote}>{translate("stockCountNote")}</div>
              </div>
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
      id: "tab-items", label: translate("tabTMZ"), component: (
        <>
          <GroupRow>
            <Button
              onClick={() => void handleFillAccounting()}
              disabled={!isSaved || !form.fields.warehouseUuid || form.isLoading || form.isDirty || isFilling}
              title={translate("fillAccountingHint")}
            >
              {translate("fillAccounting")}
            </Button>
          </GroupRow>
          <TradeDocumentItemsTable
            parentUuid={form.fields.uuid ?? ""} parentField="stockCountUuid"
            endpoint="stockcountitems" componentName="StockCountItemsList_part"
            hasTaxes={false} hasPricing={false} showStockCountColumns
            organizationUuid={form.fields.organizationUuid} documentDate={form.fields.date || null}
            disabled={form.isLoading} deferRemoteChanges
            parentLabel={`${translate("StockCountsList")}: ID ${form.fields.id ?? "?"}${form.fields.date ? " - " + getFormatDateOnly(String(form.fields.date)) : ""}`}
            key={itemsTableKey}
            initialPendingRows={items.pending}
            onItemsChange={items.onItemsChange}
            onAllItemsChange={(rows) => { allItemsRef.current = rows; }}
            showRequiredHighlight
          />
        </>
      )
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.isDirty, form.setField, form.setFields, handleOrganizationSelect, handleFillAccounting, isFilling, isSaved, canWrite, items, notices, assignNumber, itemsTableKey, surplus, shortage]);

  // «На основании»: недостача → Списание, излишек → Оприходование.
  // Строки фильтруются по знаку отклонения, количество = |отклонение|.
  const { windows: { addPane } } = useAppContext();
  const basisTargets: Record<string, BasisFromTarget> = useMemo(() => ({
    writeOff: {
      docLabel: translate("WriteOffsList"),
      FormComponent: WriteOffsForm,
      basisType: "stock_count",
      sourceItemsEndpoint: "stockcountitems",
      sourceItemsParentField: "stockCountUuid",
      mapFields: mapStockCountFields,
      mapItems: mapDeviationItems(-1),
      existingCheckEndpoint: "writeoffs",
    },
    goodsReceipt: {
      docLabel: translate("GoodsReceiptsList"),
      FormComponent: GoodsReceiptsForm,
      basisType: "stock_count",
      sourceItemsEndpoint: "stockcountitems",
      sourceItemsParentField: "stockCountUuid",
      mapFields: mapStockCountFields,
      mapItems: mapDeviationItems(1),
      existingCheckEndpoint: "goodsreceipts",
    },
  }), []);

  const handleCreateFromBasis = useCallback((id: string) => {
    const target = basisTargets[id];
    if (!target) return;
    void openDocumentFromBasis(form.fields as unknown as Record<string, any>, translate("StockCountsList"), target, addPane);
  }, [basisTargets, form.fields, addPane]);

  const headerActionsPortal = usePaneHeaderActions(
    form.paneId,
    <>
      <HeaderTogglePosted name={`${form.formUid}_posted`} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} />
      {isSaved && (
        <ActionsDropdownButton
          icon="fromBasis"
          label={translate("createFromBasis")}
          disabled={form.isLoading || form.isDirty}
          options={[
            { id: "writeOff", label: `${translate("stockCountShortage")} → ${translate("WriteOffsList")}` },
            { id: "goodsReceipt", label: `${translate("stockCountSurplus")} → ${translate("GoodsReceiptsList")}` },
          ]}
          onSelect={handleCreateFromBasis}
        />
      )}
    </>,
  );

  return (
    <FormRequiredScope docType="stock_count" active>
      <FormDirtyScope dirtyKeys={form.unsavedFields}>
        <ModelForm paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={form.fields.uuid} tabs={tabs}
          onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
          onReload={form.isEditMode ? form.handleReload : undefined}
          isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
          readonly={!canWrite} />
        {headerActionsPortal}
      </FormDirtyScope>
    </FormRequiredScope>
  );
};
StockCountsForm.displayName = "StockCountsForm";

const StockCountsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={StockCountsForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(String(d.date)) : ""} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
StockCountsList.displayName = LIST_NAME;

export { StockCountsList, StockCountsForm };
