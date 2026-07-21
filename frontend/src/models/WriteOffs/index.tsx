/* eslint-disable @typescript-eslint/no-explicit-any */
// ─────────────────────────────────────────────────────────────────────────────
// WriteOffsForm — Списание товара (E6.2).
// Цена в строках НЕ вводится: себестоимость определяется учётом (ФИФО/средняя)
// при проведении — регистр пишет расход по себестоимости, проводка Дт 7210 Кт 1330,
// итог документа (amount) проставляет сервер. Перед проведением проверяется остаток.
// ─────────────────────────────────────────────────────────────────────────────
import { FC, useMemo, useCallback, useRef } from "react";
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
import { FormLookup } from "src/components/Field/FormLookup";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessPermission } from "src/hooks/useAccessPermission";
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
import BasisDocumentField from "src/components/Field/BasisDocumentField";
import { fetchDocumentItems } from "src/utils/createFromBasis";
import { checkStockAvailability, formatStockShortages } from "src/utils/stockControl";

const MODEL_ENDPOINT = "writeoffs";
const LIST_NAME = "WriteOffsList";
const FORM_LABEL = "Списание товара";

interface TFields {
  id?: number; uuid?: string;
  number: string;
  date: string; comment: string;
  amount: number; posted: boolean;
  warehouseUuid: string; warehouseName: string;
  organizationUuid: string; organizationName: string;
  authorUuid: string; authorName: string;
  basisDocumentType: string; basisDocumentUuid: string; basisDocumentLabel: string;
}

const DEFAULT_FIELDS: TFields = {
  number: "",
  date: "", comment: "",
  amount: 0, posted: false,
  warehouseUuid: "", warehouseName: "",
  organizationUuid: "", organizationName: "",
  authorUuid: "", authorName: "",
  basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "",
};

/** Списание создаётся на основании Инвентаризации (недостача). */
const BASIS_ALLOWED_TYPES = [{ type: "stock_count", endpoint: "stockcounts" }];

const WriteOffsForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const queryClient = useQueryClient();
  const { canWrite } = useAccessPermission("WriteOff");

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data;
    if (data?.uuid) return undefined;
    if (data?.fromBasisFields) return { ...DEFAULT_FIELDS, ...(data.fromBasisFields as Partial<TFields>) };
    const init = { ...DEFAULT_FIELDS };
    init.date = isoToLocalInput(new Date().toISOString());
    if (data?.organizationUuid) { init.organizationUuid = data?.organizationUuid as string; }
    else if (defaultOrg.organizationUuid) { init.organizationUuid = defaultOrg.organizationUuid; init.organizationName = defaultOrg.organizationName; }
    return init;
  })();

  // Строки, перенесённые из документа-основания (Инвентаризация: недостача).
  const basisItems = useMemo<TDataItem[]>(() => {
    const rows = (paneProps.data as any)?.fromBasisItems;
    return Array.isArray(rows) ? rows : [];
  }, [paneProps.data]);

  const invalidateSubTables = useCallback(async (savedData: any) => {
    await invalidateSubTableFor(queryClient, "writeoffitems", "writeOffUuid", savedData?.uuid ?? "");
  }, [queryClient]);

  // Текущие строки таблицы (server + pending) — для контроля остатка в onBeforeSave.
  const allItemsRef = useRef<any[]>([]);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "write-offs-form",
    defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
    derivedFields: ["amount"],
    tables: {
      items: {
        endpoint: "writeoffitems", parentField: "writeOffUuid",
        label: "Товары списания",
        batchEndpoint: "writeoffitems/batch",
        requiredItemFields: ["productUuid", "unitOfMeasureUuid", "quantity"],
        requiredItemFieldLabels: { productUuid: "Номенклатура", unitOfMeasureUuid: "Ед. изм.", quantity: "Количество" },
        createPayload: (r: any) => ({
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
          batchUuid: r.batchUuid ?? null,
        }),
        updatePayload: (r: any) => ({
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
          batchUuid: r.batchUuid ?? null,
        }),
        extraSkipFields: ["writeOffUuid"],
      },
    },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      number: d.number ?? "",
      date: isoToLocalInput(d.date),
      comment: d.comment ?? "",
      amount: d.amount != null ? Number(d.amount) : 0,
      posted: d.posted === true,
      warehouseUuid: d.warehouseUuid ?? "",
      warehouseName: d.warehouse?.name ?? "",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.name ?? "",
      authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
      authorName: d.author?.username ?? d.author?.email ?? "",
      basisDocumentType: d.basisDocumentType ?? "",
      basisDocumentUuid: d.basisDocumentUuid ?? "",
      basisDocumentLabel: d.basisDocumentLabel ?? "",
    }),
    buildPayload: (fd) => {
      const validation = validateDocumentFields("write_off", fd as unknown as Record<string, unknown>);
      if (!validation.isValid) return formatValidationErrors(validation.errors);
      return {
        number: fd.number?.trim() || null,
        date: localInputToIso(fd.date),
        comment: fd.comment?.trim() || null,
        posted: fd.posted === true,
        warehouseUuid: fd.warehouseUuid || null,
        organizationUuid: fd.organizationUuid || null,
        basisDocumentType: fd.basisDocumentType || null,
        basisDocumentUuid: fd.basisDocumentUuid || null,
        basisDocumentLabel: fd.basisDocumentLabel || null,
      };
    },
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved, "date"),
    afterSave: invalidateSubTables,
    // Контроль остатка перед проведением (расход со склада).
    onBeforeSave: async (fd) => {
      if (fd.posted !== true) return null;
      let rows = allItemsRef.current.filter((r: any) => r._pendingAction !== "delete");
      if (rows.length === 0 && fd.uuid) {
        rows = await fetchDocumentItems("writeoffitems", "writeOffUuid", fd.uuid);
      }
      const shortages = await checkStockAvailability({
        documentType: "write_off",
        documentUuid: fd.uuid || undefined,
        warehouseUuid: fd.warehouseUuid || null,
        items: rows.map((r: any) => ({ productUuid: r.productUuid, quantity: r.quantity })),
      });
      return shortages.length ? formatStockShortages(shortages) : null;
    },
  });

  const items = form.useTable("items");

  // Смена организации: склад принадлежал прежней орг — очищаем.
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

  const assignNumber = useAssignNumber();
  const notices = useDocumentNotices({ docType: "write_off", fields: form.fields as unknown as Record<string, unknown>, formError: form.errorKind === "form" ? form.error : null });
  const fmtMoney = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

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
              <GroupCol>
                <BasisDocumentField
                  allowedTypes={BASIS_ALLOWED_TYPES}
                  basisDocumentType={form.fields.basisDocumentType}
                  // Подбор основания — только документы организации этого документа.
                  organizationUuid={form.fields.organizationUuid}
                  organizationName={form.fields.organizationName}
                  warehouseUuid={form.fields.warehouseUuid}
                  warehouseName={form.fields.warehouseName}
                  basisDocumentUuid={form.fields.basisDocumentUuid}
                  basisDocumentLabel={form.fields.basisDocumentLabel}
                  formUid={form.formUid}
                  disabled={form.isLoading}
                  onSelect={(type, uuid, label) => form.setFields({ basisDocumentType: type, basisDocumentUuid: uuid, basisDocumentLabel: label } as Partial<TFields>)}
                  onClear={() => form.setFields({ basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "" } as Partial<TFields>)}
                />
              </GroupCol>
            </GroupCol>
            <GroupCol className={styles.FormTotals}>
              <div className={styles.SummaryCard}>
                <div className={styles.SummaryRow}>
                  <span>{translate("writeOffCost")}</span>
                  <span>{fmtMoney.format(form.fields.amount || 0)}</span>
                </div>
                <div className={styles.SummaryNote}>{translate("writeOffCostNote")}</div>
              </div>
            </GroupCol>
            <GroupCol className={styles.FormNotice}>
              <Notice items={notices} />
            </GroupCol>
          </div>
          <GroupRow>
            <Field label={translate("writeOffReason")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} />
            <Field label={translate("Author")} name={`${form.formUid}_author`} value={form.fields.authorName || ""} disabled width="auto" />
          </GroupRow>
        </div>
      )
    },
    {
      id: "tab-items", label: translate("tabTMZ"), component: (
        <TradeDocumentItemsTable
          parentUuid={form.fields.uuid ?? ""} parentField="writeOffUuid"
          endpoint="writeoffitems" componentName="WriteOffItemsList_part"
          hasTaxes={false} hasPricing={false}
          serialMode="issue" serialDocType="write_off" batchMode="issue" warehouseUuid={form.fields.warehouseUuid}
          organizationUuid={form.fields.organizationUuid} documentDate={form.fields.date || null}
          disabled={form.isLoading} deferRemoteChanges
          parentLabel={`${translate("WriteOffsList")}: ID ${form.fields.id ?? "?"}${form.fields.date ? " - " + getFormatDateOnly(String(form.fields.date)) : ""}`}
          initialPendingRows={items.pending.length > 0 ? items.pending : basisItems}
          onItemsChange={items.onItemsChange}
          onAllItemsChange={(rows) => { allItemsRef.current = rows; }}
          showRequiredHighlight
        />
      )
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleOrganizationSelect, canWrite, items, basisItems, notices, assignNumber]);

  const headerActionsPortal = usePaneHeaderActions(
    form.paneId,
    <HeaderTogglePosted name={`${form.formUid}_posted`} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} />,
  );

  return (
    <FormRequiredScope docType="write_off" active>
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
WriteOffsForm.displayName = "WriteOffsForm";

const WriteOffsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }> = ({ variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={WriteOffsForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(String(d.date)) : ""} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} extraQueryParams={extraQueryParams} defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
    previewTabs={(row) => [{
      id: "items",
      label: translate("tabTMZ"),
      component: (
        <TradeDocumentItemsTable
          parentUuid={String(row.uuid ?? "")} parentField="writeOffUuid"
          endpoint="writeoffitems" componentName="WriteOffItemsList_part"
          hasTaxes={false} hasPricing={false}
          serialMode="issue" serialDocType="write_off" batchMode="issue"
          warehouseUuid={row.warehouseUuid ? String(row.warehouseUuid) : undefined}
          organizationUuid={row.organizationUuid ? String(row.organizationUuid) : null}
          documentDate={row.date ? String(row.date) : null}
          disabled disableAddRows disableDeleteRows
          emptyMessage={translate("noItems") || "Нет позиций"}
        />
      ),
    }]}
  />
);
WriteOffsList.displayName = LIST_NAME;

export { WriteOffsList, WriteOffsForm };
