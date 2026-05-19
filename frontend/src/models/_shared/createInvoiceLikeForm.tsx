/* eslint-disable @typescript-eslint/no-explicit-any */
// ─────────────────────────────────────────────────────────────────────────────
// createInvoiceLikeForm — фабрика для трёх типов счёт-фактур РК
// (исходящая, входящая, на оплату). Все три используют одну и ту же
// структуру по аналогу SalesForm: dt+posted, организация/контрагент/договор,
// сводка по налогам, вкладка строк с TradeDocumentItemsTable.
//
// Соответствие НК РК ст. 412 (электронная счёт-фактура), ст. 422 (ставка НДС).
// ─────────────────────────────────────────────────────────────────────────────
import { FC, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import type { TPane } from "src/app/types";
import { Field, FieldDate } from "src/components/Field";
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
import { getFormatDateOnly } from "src/utils/main.module";
import ModelForm from "src/components/ModelForm";
import TradeDocumentItemsTable from "src/components/DocumentItemsTable/TradeDocumentItemsTable";
import { validateDocumentFields, formatValidationErrors } from "src/utils/validatePostedDocument";
import { FormRequiredScope } from "src/hooks/useFormRequired";

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
  docType: "outgoing_invoice" | "incoming_invoice" | "payment_invoice";
}

interface TFields {
  id?: number; uuid?: string;
  date: string; comment: string;
  amount: number; vatAmount: number; discountAmount: number; amountWithoutVat: number;
  posted: boolean;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  date: "", comment: "",
  amount: 0, vatAmount: 0, discountAmount: 0, amountWithoutVat: 0,
  posted: false,
  organizationUuid: "", organizationName: "",
  counterpartyUuid: "", counterpartyName: "",
  contractUuid: "", contractName: "",
  authorUuid: "", authorName: "",
};

export function createInvoiceLikeForm(cfg: InvoiceLikeFormConfig): FC<Partial<TPane>> {
  const Form: FC<Partial<TPane>> = (paneProps) => {
    const defaultOrg = useDefaultOrganization();
    const queryClient = useQueryClient();
    const { canWrite } = useAccessRight(cfg.accessRightModel);

    const initialFields: TFields | undefined = (() => {
      const data = paneProps.data;
      if (!data || data.uuid) return undefined;
      const init = { ...DEFAULT_FIELDS };
      if (data.organizationUuid) {
        init.organizationUuid = data.organizationUuid as string;
        init.organizationName = (data.organizationName as string) || "";
      } else if (defaultOrg.organizationUuid) {
        init.organizationUuid = defaultOrg.organizationUuid;
        init.organizationName = defaultOrg.organizationName;
      }
      if (data.counterpartyUuid) {
        init.counterpartyUuid = data.counterpartyUuid as string;
        init.counterpartyName = (data.counterpartyName as string) || "";
      }
      return init;
    })();

    const invalidateSubTables = useCallback(async () => {
      await queryClient.invalidateQueries({ queryKey: [cfg.itemsEndpoint], refetchType: "active" });
    }, [queryClient]);

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
          extraSkipFields: [cfg.itemsParentField],
        },
      },
      mapServerToForm: (d, prev) => ({
        ...(prev ?? DEFAULT_FIELDS), ...d,
        date: d.date?.slice(0, 10) ?? "",
        comment: d.comment ?? "",
        amount: d.amount != null ? Number(d.amount) : 0,
        vatAmount: d.vatAmount != null ? Number(d.vatAmount) : 0,
        discountAmount: d.discountAmount != null ? Number(d.discountAmount) : 0,
        amountWithoutVat: d.amountWithoutVat != null ? Number(d.amountWithoutVat) : 0,
        posted: d.posted === true,
        organizationUuid: d.organizationUuid ?? "",
        organizationName: d.organization?.shortName ?? "",
        counterpartyUuid: d.counterpartyUuid ?? "",
        counterpartyName: d.counterparty?.shortName ?? "",
        contractUuid: d.contractUuid ?? "",
        contractName: d.contract?.shortName ?? "",
        authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
        authorName: d.author?.username ?? d.author?.email ?? "",
      }),
      buildPayload: (fd) => {
        const validation = validateDocumentFields(cfg.docType, fd as unknown as Record<string, unknown>);
        if (!validation.isValid) return formatValidationErrors(validation.errors);

        return {
          date: fd.date || null,
          comment: fd.comment?.trim() || null,
          amount: fd.amount ? fd.amount : null,
          vatAmount: fd.vatAmount ? fd.vatAmount : 0,
          discountAmount: fd.discountAmount ? fd.discountAmount : 0,
          amountWithoutVat: fd.amountWithoutVat ? fd.amountWithoutVat : 0,
          posted: fd.posted === true,
          organizationUuid: fd.organizationUuid || null,
          counterpartyUuid: fd.counterpartyUuid || null,
          contractUuid: fd.contractUuid || null,
        };
      },
      buildPaneLabel: (saved) => makeDocLabel(cfg.listName, cfg.formLabel, saved, "date"),
      afterLoad: invalidateSubTables,
      afterSave: invalidateSubTables,
    });

    const items = form.useTable("items");

    const { isVatEnabled, useDiscount } = useOrgAccountingSettings(
      form.fields.organizationUuid || null,
      form.fields.date || null,
    );

    const handleContractSelect = useCallback((uuid: string, displayValue: string, item: Record<string, any>) => {
      const updates: Partial<TFields> = { contractUuid: uuid, contractName: displayValue };
      if (item.organizationUuid) { updates.organizationUuid = item.organizationUuid; updates.organizationName = item.organization?.shortName ?? ""; }
      if (item.counterpartyUuid) { updates.counterpartyUuid = item.counterpartyUuid; updates.counterpartyName = item.counterparty?.shortName ?? ""; }
      form.setFields(updates);
    }, [form.setFields]);

    const contractScope = useMemo<Record<string, string> | null>(() => {
      const hasOrg = !!form.fields.organizationUuid;
      const hasCpty = !!form.fields.counterpartyUuid;
      if (!hasOrg && !hasCpty) return null;
      const s: Record<string, string> = {};
      if (hasOrg) s.organizationUuid = form.fields.organizationUuid;
      if (hasCpty) s.counterpartyUuid = form.fields.counterpartyUuid;
      return s;
    }, [form.fields.organizationUuid, form.fields.counterpartyUuid]);
    useAutoFillPrimary({
      endpoint: "contracts", scope: contractScope, currentUuid: form.fields.contractUuid,
      isEditMode: form.isEditMode, isLoading: form.isLoading,
      apply: (uuid, name) => form.setFields({ contractUuid: uuid, contractName: name } as Partial<TFields>),
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
                  <FieldDate label="Дата" name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="160px" />
                  <FieldToggle name={`${form.formUid}_posted`} label="Проведён" value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} variant="success" />
                </GroupRow>
                <Group>
                  <LookupField label="Организация" name={`${form.formUid}_organizationUuid`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="shortName"
                    onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TFields>)}
                    onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)}
                    disabled={form.isLoading} />
                </Group>
                <Group>
                  <LookupField label="Контрагент" name={`${form.formUid}_counterpartyUuid`} value={form.fields.counterpartyUuid} displayValue={form.fields.counterpartyName} endpoint="counterparties" displayField="shortName"
                    onSelect={(u, d) => form.setFields({ counterpartyUuid: u, counterpartyName: d } as Partial<TFields>)}
                    onClear={() => form.setFields({ counterpartyUuid: "", counterpartyName: "" } as Partial<TFields>)}
                    disabled={form.isLoading} />
                  <LookupField label="Договор" name={`${form.formUid}_contractUuid`} value={form.fields.contractUuid} displayValue={form.fields.contractName} endpoint="contracts" displayField="shortName"
                    onSelect={handleContractSelect}
                    onClear={() => form.setFields({ contractUuid: "", contractName: "" } as Partial<TFields>)}
                    disabled={form.isLoading}
                    extraParams={{
                      ...(form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : {}),
                      ...(form.fields.counterpartyUuid ? { counterpartyUuid: form.fields.counterpartyUuid } : {}),
                    }} />
                </Group>
              </GroupCol>
              <Group>
                <div style={{ background: "#f8f9fa", border: "1px solid #e5e7eb", borderRadius: 6, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 5, fontSize: 13, maxWidth: '200px' }}>
                  {([
                    ...(isVatEnabled ? ([
                      { label: "Без НДС", value: form.fields.amountWithoutVat },
                      { label: "НДС", value: form.fields.vatAmount },
                    ] as const) : ([] as const)),
                    ...(useDiscount ? ([{ label: "Скидка", value: form.fields.discountAmount }] as const) : ([] as const)),
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
            </div>
            {form.isEditMode && <><Group align="row" style={{ flex: 1, alignItems: "end", justifyContent: "end", gap: 6 }}>
              <Field label={translate("Comment")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} />
              <Field label={translate("Author")} name={`${form.formUid}_author`} value={form.fields.authorName || ""} disabled width="auto" />
            </Group></>}
          </div>
        )
      },
      {
        id: "tab-items", label: cfg.itemsTabLabel, component: form.isEditMode && form.fields.uuid ? (
          <TradeDocumentItemsTable
            parentUuid={form.fields.uuid} parentField={cfg.itemsParentField}
            endpoint={cfg.itemsEndpoint} componentName={cfg.itemsComponentName}
            organizationUuid={form.fields.organizationUuid} documentDate={form.fields.date || null}
            disabled={form.isLoading} deferRemoteChanges
            parentLabel={`${cfg.formLabel}: №${form.fields.id ?? "?"}${form.fields.date ? " · " + getFormatDateOnly(String(form.fields.date)) : ""}`}
            initialPendingRows={items.pending}
            onTotalChange={handleTotalChange}
            onItemsChange={items.onItemsChange}
          />
        ) : (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", color: "#999", fontSize: 14, padding: "24px 0" }}>
            Сохраните документ для добавления товаров
          </div>
        )
      },
    ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleContractSelect, handleTotalChange, canWrite, items, isVatEnabled, useDiscount]);

    return (
      <FormRequiredScope docType={cfg.docType}>
        <ModelForm paneId={form.paneId} tabs={tabs}
          onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
          onReload={form.isEditMode ? form.handleReload : undefined}
          isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
          readonly={!canWrite} />
      </FormRequiredScope>
    );
  };
  Form.displayName = cfg.formDisplayName;
  return Form;
}
