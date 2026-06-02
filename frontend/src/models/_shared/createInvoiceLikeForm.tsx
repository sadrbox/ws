/* eslint-disable @typescript-eslint/no-explicit-any */
// ─────────────────────────────────────────────────────────────────────────────
// createInvoiceLikeForm — фабрика для счёт-фактур, счёт на оплату, заявок.
// ─────────────────────────────────────────────────────────────────────────────
import { FC, useMemo, useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import type { TPane } from "src/app/types";
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
import { useUserPermissionDefaults, type PermissionDefaultsMap } from "src/hooks/useUserPermissionDefaults";
import { useApplyPermissionDefaults } from "src/hooks/useApplyPermissionDefaults";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly, isoToLocalInput, localInputToIso } from "src/utils/datetime";
import ModelForm from "src/components/ModelForm";
import TradeDocumentItemsTable from "src/components/DocumentItemsTable/TradeDocumentItemsTable";
import { validateDocumentFields, formatValidationErrors } from "src/utils/validatePostedDocument";
import { FormRequiredScope, FormDirtyScope } from "src/hooks/useFormRequired";
import BasisDocumentField, { type BasisTypeConfig } from "src/components/Field/BasisDocumentField";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import PrintDocumentPane, { type PrintColumnDef } from "src/components/PrintPreview/PrintDocumentPane";
import PrintDropdownButton from "src/components/Toolbar/PrintDropdownButton";
import DocumentChainButton from "src/components/DocumentChain/DocumentChainButton";
import ActionsDropdownButton from "src/components/Toolbar/ActionsDropdownButton";
import RefillFromBasisButton from "src/models/_shared/RefillFromBasisButton";
import { useAppContext } from "src/app";
import { type BasisFromTarget, type OrgDependentField, openDocumentFromBasis, mapCommonTradeFields, resolveOrgChangeFields, runBasisRefill } from "src/utils/createFromBasis";
import { useExistingDependents, formatDependentOption } from "src/hooks/useExistingDependents";
import DocumentTotals from "src/components/DocumentTotals";
import { useBasisMismatch } from "src/hooks/useBasisMismatch";

export type { BasisTypeConfig };

export interface PrintConfig {
  buildLayout: (fields: TFields, items: any[], cols: Record<string, boolean>) => React.ReactNode;
  columnDefs: PrintColumnDef[];
  columnsKey: string;
  fileBaseName: (fields: TFields) => string;
  title: (fields: TFields) => string;
}

export interface InvoiceLikeFormConfig {
  endpoint: string;
  itemsEndpoint: string;
  itemsParentField: string;
  storageKey: string;
  listName: string;
  formLabel: string;
  itemsTabLabel: string;
  itemsComponentName: string;
  accessRightModel: string;
  formDisplayName: string;
  docType: "outgoing_invoice" | "incoming_invoice" | "payment_invoice" | "purchase_requisition" | "commercial_offer" | "sales_order" | "reservation" | "purchase_order";
  basisConfig?: { allowedTypes: BasisTypeConfig[] };
  printConfig?: PrintConfig;
  /** Документы, которые можно создать на основании этого. Кнопки появляются в шапке панели. */
  createFromBasisTargets?: BasisFromTarget[];
  /** Колонки позиций, скрытые по умолчанию для данного типа документа. */
  defaultHiddenItemColumns?: string[];
  /** Скрыть переключатель "Проведение" (напр. Счёт на оплату — не проводится). */
  hidePosted?: boolean;
  /** Показать поле «Склад» в шапке (для заказов покупателя/поставщику, резерва). */
  hasWarehouse?: boolean;
  /**
   * Блокировать поля шапки и таблицу позиций, если у документа есть основание.
   * true — только для Счёт-фактуры исходящей; остальные документы не блокируются.
   */
  lockFieldsOnBasis?: boolean;
}

interface TFields {
  id?: number; uuid?: string;
  date: string; comment: string;
  amount: number; vatAmount: number; discountAmount: number; amountWithoutVat: number;
  posted: boolean;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
  warehouseUuid: string; warehouseName: string;
  authorUuid: string; authorName: string;
  basisDocumentType: string;
  basisDocumentUuid: string;
  basisDocumentLabel: string;
}

const DEFAULT_FIELDS: TFields = {
  date: "", comment: "",
  amount: 0, vatAmount: 0, discountAmount: 0, amountWithoutVat: 0,
  posted: false,
  organizationUuid: "", organizationName: "",
  counterpartyUuid: "", counterpartyName: "",
  contractUuid: "", contractName: "",
  warehouseUuid: "", warehouseName: "",
  authorUuid: "", authorName: "",
  basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "",
};

export function createInvoiceLikeForm(cfg: InvoiceLikeFormConfig): FC<Partial<TPane>> {
  const dependentEndpoints = (cfg.createFromBasisTargets ?? [])
    .map((t) => t.existingCheckEndpoint)
    .filter((e): e is string => !!e);

  const Form: FC<Partial<TPane>> = (paneProps) => {
    const defaultOrg = useDefaultOrganization();
    const queryClient = useQueryClient();
    const { canWrite } = useAccessRight(cfg.accessRightModel);
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
      await queryClient.invalidateQueries({ queryKey: [cfg.itemsEndpoint], refetchType: "active" });
    }, [queryClient]);

    const afterSave = useCallback(async () => {
      setBasisItems([]);
      await invalidateSubTables();
    }, [invalidateSubTables]);

    const afterReload = useCallback(() => { setBasisItems([]); }, []);

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
          label: cfg.itemsTabLabel,
          batchEndpoint: `${cfg.itemsEndpoint}/batch`,
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
            sourceRowId: r.sourceRowId ?? null,
            productUuid: r.productUuid ?? null,
            quantity: r.quantity ?? 0,
            price: r.price ?? 0,
            unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
            vatRate: r.vatRate ?? 0,
            exciseRate: r.exciseRate ?? 0,
            discountPercent: r.discountPercent ?? 0,
          }),
          extraSkipFields: [cfg.itemsParentField],
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
        counterpartyUuid: d.counterpartyUuid ?? "",
        counterpartyName: d.counterparty?.name ?? "",
        contractUuid: d.contractUuid ?? "",
        contractName: d.contract?.name ?? "",
        warehouseUuid: d.warehouseUuid ?? "",
        warehouseName: d.warehouse?.name ?? "",
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
          date: localInputToIso(fd.date),
          comment: fd.comment?.trim() || null,
          amount: fd.amount ? fd.amount : null,
          vatAmount: fd.vatAmount ? fd.vatAmount : 0,
          discountAmount: fd.discountAmount ? fd.discountAmount : 0,
          amountWithoutVat: fd.amountWithoutVat ? fd.amountWithoutVat : 0,
          posted: fd.posted === true,
          organizationUuid: fd.organizationUuid || null,
          counterpartyUuid: fd.counterpartyUuid || null,
          contractUuid: fd.contractUuid || null,
          ...(cfg.hasWarehouse ? { warehouseUuid: fd.warehouseUuid || null } : {}),
          basisDocumentType: fd.basisDocumentType || null,
          basisDocumentUuid: fd.basisDocumentUuid || null,
          basisDocumentLabel: fd.basisDocumentLabel || null,
        };
      },
      buildPaneLabel: (saved) => makeDocLabel(cfg.listName, cfg.formLabel, saved, "date"),
      afterSave,
      afterReload,
    });

    const items = form.useTable("items");
    const allItemsRef = useRef<any[]>([]);
    const permDefaultsRef = useRef<PermissionDefaultsMap>({});

    // Подсказка о несоответствии документу-основанию (шапка + строки).
    const basisMismatch = useBasisMismatch({
      basisType: form.fields.basisDocumentType,
      basisUuid: form.fields.basisDocumentUuid,
      currentFields: form.fields,
      currentItems: allItemsRef.current,
      mapFields: mapCommonTradeFields,
    });

    const hasBasis = !!form.fields.basisDocumentUuid;
    const basisLock = hasBasis && (cfg.lockFieldsOnBasis ?? false);
    const effectiveReadonly = !canWrite;

    const handleRefillFromBasis = useCallback(async (skipFields = false) => {
      setIsRefilling(true);
      try {
        // Склад — только для документов со складом (заказы/резерв).
        const orgFields: OrgDependentField[] = [
          { valueType: "contract", uuidKey: "contractUuid", nameKey: "contractName" },
        ];
        if (cfg.hasWarehouse) orgFields.push({ valueType: "warehouse", uuidKey: "warehouseUuid", nameKey: "warehouseName" });
        await runBasisRefill({
          form, skipFields,
          currentUserUuid: currentUser?.uuid ?? "",
          permDefaults: permDefaultsRef.current,
          itemsEndpoint: cfg.itemsEndpoint, itemsParentField: cfg.itemsParentField,
          orgFields,
          allItemsRef, setBasisItems, bumpItemsTableKey: () => setItemsTableKey(k => k + 1),
        });
      } catch (e) {
        console.error("[refill] failed", e);
      } finally {
        setIsRefilling(false);
      }
    }, [form, currentUser?.uuid, cfg.itemsEndpoint, cfg.itemsParentField, cfg.hasWarehouse]);

    const { isVatEnabled, useDiscount } = useOrgAccountingSettings(
      form.fields.organizationUuid || null,
      form.fields.date || null,
    );

    const handlePrint = useCallback(() => {
      if (!cfg.printConfig || !form.fields.uuid) return;
      try {
        const rows = allItemsRef.current.map((r: any, i: number) => ({
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
        }));
        const titleStr = cfg.printConfig.title(form.fields);
        const fileBase = cfg.printConfig.fileBaseName(form.fields);
        addPane({
          component: PrintDocumentPane,
          isSelector: true,
          label: titleStr,
          data: {
            id: Number(form.fields.id ?? 0),
            uuid: String(form.fields.uuid ?? ""),
            columnsKey: cfg.printConfig.columnsKey,
            columnDefs: cfg.printConfig.columnDefs,
            buildLayout: (cols: any) => cfg.printConfig!.buildLayout(form.fields, rows, cols),
            fileBaseName: fileBase,
            title: titleStr,
          },
        });
      } catch (e) {
        console.error("[print] failed", e);
      }
    }, [form.fields, addPane]);

    const handleCreateFromBasis = useCallback(async (target: BasisFromTarget) => {
      await openDocumentFromBasis(form.fields as any, cfg.formLabel, target, addPane);
    }, [form.fields, addPane]);

    const hasDirtyItems = (items.pending?.length ?? 0) > 0;
    const printDisabled = form.isLoading || form.isDirty || hasDirtyItems;
    const isSavedDoc = form.isEditMode && !!form.fields.uuid;
    const existingDeps = useExistingDependents(isSavedDoc ? form.fields.uuid : undefined, dependentEndpoints);
    const showHeaderActions = isSavedDoc || hasBasis;
    const headerActionsPortal = usePaneHeaderActions(
      form.paneId,
      showHeaderActions ? (
        <>
          {isSavedDoc && <DocumentChainButton documentType={cfg.docType} documentUuid={form.fields.uuid} />}
          {hasBasis && (
            <RefillFromBasisButton
              mismatch={basisMismatch.mismatch}
              mismatchDetails={basisMismatch.differences}
              disabled={form.isLoading || isRefilling}
              loading={isRefilling}
              onClick={() => void handleRefillFromBasis()}
            />
          )}
          {isSavedDoc && cfg.createFromBasisTargets && cfg.createFromBasisTargets.length > 0 && (
            <ActionsDropdownButton
              icon="fromBasis"
              label="На основании"
              options={cfg.createFromBasisTargets.map((t) => ({
                  id: t.basisType,
                  label: formatDependentOption(t.docLabel, t.existingCheckEndpoint ? existingDeps[t.existingCheckEndpoint] : null),
                }))}
              onSelect={(id) => {
                const target = cfg.createFromBasisTargets!.find((t) => t.basisType === id);
                if (target) void handleCreateFromBasis(target);
              }}
            />
          )}
          {isSavedDoc && cfg.printConfig && (
            <PrintDropdownButton
              disabled={printDisabled}
              title={printDisabled ? "Сохраните изменения перед печатью" : "Печать"}
              options={[{ id: "print", label: "Печать" }]}
              onSelect={handlePrint}
            />
          )}
        </>
      ) : null,
    );

    const handleContractSelect = useCallback((uuid: string, displayValue: string, item: Record<string, any>) => {
      const updates: Partial<TFields> = { contractUuid: uuid, contractName: displayValue };
      if (item.organizationUuid) { updates.organizationUuid = item.organizationUuid; updates.organizationName = item.organization?.name ?? ""; }
      if (item.counterpartyUuid) { updates.counterpartyUuid = item.counterpartyUuid; updates.counterpartyName = item.counterparty?.name ?? ""; }
      form.setFields(updates);
    }, [form.setFields]);

    // Смена организации: зависимые поля (договор, склад если есть) →
    // дефолт пользователя для новой орг, иначе очистка.
    const handleOrganizationSelect = useCallback(async (uuid: string, displayValue: string) => {
      const cur = form.store.getSnapshot().fields as any;
      if (cur.organizationUuid === uuid) return;
      form.setFields({ organizationUuid: uuid, organizationName: displayValue } as Partial<TFields>);
      const orgFields: Array<{ valueType: "warehouse" | "contract"; uuidKey: string; nameKey: string }> = [
        { valueType: "contract", uuidKey: "contractUuid", nameKey: "contractName" },
      ];
      if (cfg.hasWarehouse) orgFields.push({ valueType: "warehouse", uuidKey: "warehouseUuid", nameKey: "warehouseName" });
      const patch = await resolveOrgChangeFields(uuid, currentUser?.uuid ?? "", orgFields);
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
      fieldMappings: [{ type: "contract", uuidKey: "contractUuid", nameKey: "contractName" }],
      currentValues: { contractUuid: form.fields.contractUuid },
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
                <GroupRow className={styles.FormHeaderRow}>
                  <FieldDateTime label={translate("date")} name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="180px" />
                  {!cfg.hidePosted && <FieldToggle name={`${form.formUid}_posted`} label={translate("posted")} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} variant="success" />}
                </GroupRow>
                <Group>
                  <LookupField label={translate("organization")} name={`${form.formUid}_organizationUuid`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="name"
                    onSelect={handleOrganizationSelect}
                    onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)}
                    disabled={form.isLoading || basisLock} />
                </Group>
                <Group>
                  <LookupField label={translate("counterparty")} name={`${form.formUid}_counterpartyUuid`} value={form.fields.counterpartyUuid} displayValue={form.fields.counterpartyName} endpoint="counterparties" displayField="name"
                    onSelect={(u, d) => form.setFields({ counterpartyUuid: u, counterpartyName: d } as Partial<TFields>)}
                    onClear={() => form.setFields({ counterpartyUuid: "", counterpartyName: "" } as Partial<TFields>)}
                    disabled={form.isLoading || basisLock} />
                  <LookupField label={translate("contract")} name={`${form.formUid}_contractUuid`} value={form.fields.contractUuid} displayValue={form.fields.contractName} endpoint="contracts" displayField="name"
                    onSelect={handleContractSelect}
                    onClear={() => form.setFields({ contractUuid: "", contractName: "" } as Partial<TFields>)}
                    disabled={form.isLoading || basisLock}
                    extraParams={{
                      ...(form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : {}),
                      ...(form.fields.counterpartyUuid ? { counterpartyUuid: form.fields.counterpartyUuid } : {}),
                    }} />
                </Group>
                {cfg.hasWarehouse && (
                  <Group>
                    <LookupField label={translate("warehouse")} name={`${form.formUid}_warehouseUuid`} value={form.fields.warehouseUuid} displayValue={form.fields.warehouseName} endpoint="warehouses" displayField="name"
                      onSelect={(u, d) => form.setFields({ warehouseUuid: u, warehouseName: d } as Partial<TFields>)}
                      onClear={() => form.setFields({ warehouseUuid: "", warehouseName: "" } as Partial<TFields>)}
                      disabled={form.isLoading || basisLock}
                      extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
                  </Group>
                )}
              </GroupCol>
              {cfg.basisConfig && (
                <GroupCol>
                  <BasisDocumentField
                    allowedTypes={cfg.basisConfig.allowedTypes}
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
              )}
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
        id: "tab-items", label: cfg.itemsTabLabel, component: (
          <TradeDocumentItemsTable
            parentUuid={form.fields.uuid ?? ""} parentField={cfg.itemsParentField}
            endpoint={cfg.itemsEndpoint} componentName={cfg.itemsComponentName}
            organizationUuid={form.fields.organizationUuid} documentDate={form.fields.date || null}
            disabled={form.isLoading}
            disableAddRows={basisLock}
            disableDeleteRows={basisLock}
            fieldsReadOnly={basisLock}
            deferRemoteChanges
            onRefresh={hasBasis ? () => void handleRefillFromBasis(true) : undefined}
            parentLabel={`${cfg.formLabel}: ID ${form.fields.id ?? "?"}${form.fields.date ? " · " + getFormatDateOnly(String(form.fields.date)) : ""}`}
            key={itemsTableKey}
            initialPendingRows={itemsTableKey > 0 ? basisItems : (items.pending.length > 0 ? items.pending : basisItems)}
            onTotalChange={handleTotalChange}
            onItemsChange={items.onItemsChange}
            onAllItemsChange={(rows) => { allItemsRef.current = rows; }}
            showRequiredHighlight={form.meta.tablesValidationFailed}
            defaultHiddenColumns={cfg.defaultHiddenItemColumns}
          />
        )
      },
    ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleContractSelect, handleOrganizationSelect, handleTotalChange, canWrite, items, isVatEnabled, useDiscount, basisItems, itemsTableKey, basisMismatch]);

    return (
      <FormRequiredScope docType={cfg.docType} active={form.meta.headerValidationFailed}>
        <FormDirtyScope dirtyKeys={form.unsavedFields}>
          {headerActionsPortal}
          <ModelForm paneId={form.paneId} tabs={tabs}
            onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
            onReload={form.isEditMode ? form.handleReload : undefined}
            isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
            readonly={effectiveReadonly} />
        </FormDirtyScope>
      </FormRequiredScope>
    );
  };
  Form.displayName = cfg.formDisplayName;
  return Form;
}
