/* eslint-disable @typescript-eslint/no-explicit-any */
// ─────────────────────────────────────────────────────────────────────────────
// InventoryTransfersForm — Перемещение ТМЗ.
// НК РК ст. 372 п.2 пп.3: внутреннее перемещение ТМЗ между складами одной
// организации НЕ является облагаемым оборотом, поэтому в строках нет НДС/
// акциза/скидки — таблица использует TradeDocumentItemsTable hasTaxes=false.
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
import ActionsDropdownButton from "src/components/Toolbar/ActionsDropdownButton";
import { useGovDocs } from "src/hooks/useGovDocs";
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
import { fetchDocumentItems } from "src/utils/createFromBasis";
import { checkStockAvailability, formatStockShortages } from "src/utils/stockControl";

const MODEL_ENDPOINT = "inventory-transfers";
const LIST_NAME = "InventoryTransfersList";
const FORM_LABEL = "Перемещение ТМЗ";

interface TFields {
  id?: number; uuid?: string;
  number: string;
  date: string; comment: string;
  amount: number; posted: boolean;
  fromWarehouseUuid: string; fromWarehouseName: string;
  toWarehouseUuid: string; toWarehouseName: string;
  organizationUuid: string; organizationName: string;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  number: "",
  date: "", comment: "",
  amount: 0, posted: false,
  fromWarehouseUuid: "", fromWarehouseName: "",
  toWarehouseUuid: "", toWarehouseName: "",
  organizationUuid: "", organizationName: "",
  authorUuid: "", authorName: "",
};

const InventoryTransfersForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const queryClient = useQueryClient();
  const { canWrite } = useAccessPermission("InventoryTransfer");

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
    await invalidateSubTableFor(queryClient, "inventorytransferitems", "inventoryTransferUuid", savedData?.uuid ?? "");
  }, [queryClient]);

  // Текущие строки таблицы (server + pending) — для контроля остатка в onBeforeSave.
  const allItemsRef = useRef<any[]>([]);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "inventory-transfers-form",
    defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
    derivedFields: ["amount"],
    tables: {
      items: {
        endpoint: "inventorytransferitems", parentField: "inventoryTransferUuid",
        label: "Товары перемещения",
        batchEndpoint: "inventorytransferitems/batch",
        requiredItemFields: ["productUuid", "unitOfMeasureUuid", "quantity"],
        requiredItemFieldLabels: { productUuid: "Номенклатура", unitOfMeasureUuid: "Ед. изм.", quantity: "Количество" },
        createPayload: (r: any) => ({
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          price: r.price ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
        }),
        updatePayload: (r: any) => ({
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          price: r.price ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
        }),
        extraSkipFields: ["inventoryTransferUuid"],
      },
    },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      number: d.number ?? "",
      date: isoToLocalInput(d.date),
      comment: d.comment ?? "",
      amount: d.amount != null ? Number(d.amount) : 0,
      posted: d.posted === true,
      fromWarehouseUuid: d.fromWarehouseUuid ?? "",
      fromWarehouseName: d.fromWarehouse?.name ?? "",
      toWarehouseUuid: d.toWarehouseUuid ?? "",
      toWarehouseName: d.toWarehouse?.name ?? "",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.name ?? "",
      authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
      authorName: d.author?.username ?? d.author?.email ?? "",
    }),
    buildPayload: (fd) => {
      const validation = validateDocumentFields("inventory_transfer", fd as unknown as Record<string, unknown>);
      if (!validation.isValid) return formatValidationErrors(validation.errors);
      return {
        number: fd.number?.trim() || null,
        date: localInputToIso(fd.date),
        comment: fd.comment?.trim() || null,
        amount: fd.amount ? fd.amount : null,
        posted: fd.posted === true,
        fromWarehouseUuid: fd.fromWarehouseUuid || null,
        toWarehouseUuid: fd.toWarehouseUuid || null,
        organizationUuid: fd.organizationUuid || null,
      };
    },
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved, "date"),
    afterSave: invalidateSubTables,
    // Контроль остатка перед проведением (расход со склада-источника fromWarehouse).
    onBeforeSave: async (fd) => {
      if (fd.posted !== true) return null;
      let rows = allItemsRef.current.filter((r: any) => r._pendingAction !== "delete");
      if (rows.length === 0 && fd.uuid) {
        rows = await fetchDocumentItems("inventorytransferitems", "inventoryTransferUuid", fd.uuid);
      }
      const shortages = await checkStockAvailability({
        documentType: "inventory_transfer",
        documentUuid: fd.uuid || undefined,
        fromWarehouseUuid: fd.fromWarehouseUuid || null,
        items: rows.map((r: any) => ({ productUuid: r.productUuid, quantity: r.quantity })),
      });
      return shortages.length ? formatStockShortages(shortages) : null;
    },
  });

  const items = form.useTable("items");

  const handleTotalChange = useCallback((total: number) => {
    form.setField("amount", Number(total));
  }, [form.setField]);

  // Смена организации: склады принадлежали прежней орг — очищаем оба
  // (для перемещения единый дефолт-склад неприменим к источнику и приёмнику).
  const handleOrganizationSelect = useCallback((uuid: string, displayValue: string) => {
    const cur = form.store.getSnapshot().fields as any;
    if (cur.organizationUuid === uuid) {
      form.setFields({ organizationUuid: uuid, organizationName: displayValue } as Partial<TFields>);
      return;
    }
    form.setFields({
      organizationUuid: uuid, organizationName: displayValue,
      fromWarehouseUuid: "", fromWarehouseName: "",
      toWarehouseUuid: "", toWarehouseName: "",
    } as Partial<TFields>);
  }, [form.setFields, form.store]);

  const assignNumber = useAssignNumber();
  const notices = useDocumentNotices({ docType: "inventory_transfer", fields: form.fields as unknown as Record<string, unknown>, formError: form.errorKind === "form" ? form.error : null });
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
              </Group>
              <Group>
                <FormLookup form={form} field="fromWarehouse" endpoint="warehouses"
                  extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
                <FormLookup form={form} field="toWarehouse" endpoint="warehouses"
                  extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
              </Group>
            </GroupCol>
            <GroupCol className={styles.FormTotals}>
              <div className={styles.SummaryCard}>
                <div className={styles.SummaryNote}>
                  НК РК ст. 372 п.2 пп.3: внутреннее перемещение — не облагаемый оборот
                </div>
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
        <TradeDocumentItemsTable
          parentUuid={form.fields.uuid ?? ""} parentField="inventoryTransferUuid"
          endpoint="inventorytransferitems" componentName="InventoryTransferItemsList_part"
          hasTaxes={false} hasPricing={false}
          organizationUuid={form.fields.organizationUuid} documentDate={form.fields.date || null}
          serialMode="transfer" serialDocType="inventory_transfer" batchMode="issue"
          warehouseUuid={form.fields.fromWarehouseUuid} toWarehouseUuid={form.fields.toWarehouseUuid}
          disabled={form.isLoading} deferRemoteChanges
          parentLabel={`${translate("InventoryTransfersList")}: ID ${form.fields.id ?? "?"}${form.fields.date ? " - " + getFormatDateOnly(String(form.fields.date)) : ""}`}
          initialPendingRows={items.pending}
          onTotalChange={handleTotalChange}
          onItemsChange={items.onItemsChange}
          onAllItemsChange={(rows) => { allItemsRef.current = rows; }}
          showRequiredHighlight
        />
      )
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleTotalChange, handleOrganizationSelect, canWrite, items, notices, assignNumber]);

  // ── СНТ (сопроводительная накладная) из документа Перемещения ──
  const govDocs = useGovDocs();
  const sntFields = form.fields as unknown as { sntStatus?: string | null; sntId?: string | null };
  const isSavedDoc = form.isEditMode && !!form.fields.uuid;
  const handleSnt = useCallback(async (id: string) => {
    const uuid = form.fields.uuid;
    if (!uuid) return;
    try {
      if (id === "snt") { const r = await govDocs.issueSnt("inventory-transfers", uuid); form.setFields({ sntStatus: r.sntStatus, sntId: r.sntId, sntRegistrationNumber: r.sntRegistrationNumber } as any); }
      else if (id === "sntStatus") { const r = await govDocs.refreshSnt("inventory-transfers", uuid); form.setFields({ sntStatus: r.sntStatus, sntRegistrationNumber: r.sntRegistrationNumber } as any); }
    } catch { /* ошибка через govDocs.error */ }
  }, [form.fields.uuid, form.setFields, govDocs]);

  const headerActionsPortal = usePaneHeaderActions(
    form.paneId,
    <>
      <HeaderTogglePosted name={`${form.formUid}_posted`} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} />
      {isSavedDoc && (
        <ActionsDropdownButton
          icon="download"
          label={translate("govDocsSection")}
          disabled={govDocs.busy || form.isLoading || form.isDirty}
          options={[
            { id: "snt", label: sntFields.sntStatus ? translate("govSntResend") : translate("govSntIssue") },
            ...(sntFields.sntId ? [{ id: "sntStatus", label: translate("govSntStatus") }] : []),
          ]}
          onSelect={(id) => void handleSnt(id)}
        />
      )}
    </>,
  );

  return (
    <FormRequiredScope docType="inventory_transfer" active>
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
InventoryTransfersForm.displayName = "InventoryTransfersForm";

const InventoryTransfersList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }> = ({ variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={InventoryTransfersForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(String(d.date)) : ""} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} extraQueryParams={extraQueryParams} defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
    previewTabs={(row) => [{
      id: "items",
      label: translate("tabTMZ"),
      component: (
        <TradeDocumentItemsTable
          parentUuid={String(row.uuid ?? "")} parentField="inventoryTransferUuid"
          endpoint="inventorytransferitems" componentName="InventoryTransferItemsList_part"
          hasTaxes={false} hasPricing={false}
          organizationUuid={row.organizationUuid ? String(row.organizationUuid) : null}
          documentDate={row.date ? String(row.date) : null}
          serialMode="transfer" serialDocType="inventory_transfer" batchMode="issue"
          warehouseUuid={row.fromWarehouseUuid ? String(row.fromWarehouseUuid) : undefined}
          toWarehouseUuid={row.toWarehouseUuid ? String(row.toWarehouseUuid) : undefined}
          disabled disableAddRows disableDeleteRows
          emptyMessage={translate("noItems") || "Нет позиций"}
        />
      ),
    }]}
  />
);
InventoryTransfersList.displayName = LIST_NAME;

export { InventoryTransfersList, InventoryTransfersForm };
