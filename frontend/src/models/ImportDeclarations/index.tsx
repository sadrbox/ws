/* eslint-disable @typescript-eslint/no-explicit-any */
// ─────────────────────────────────────────────────────────────────────────────
// ImportDeclarationsForm — «ГТД по импорту».
// Этап 1: документ (поставщик/декларант, № декларации на товары, дата, страна +
// позиции по таможенной стоимости). Проведение приходует товар на склад
// (регистр import_declaration) и служит источником данных декларации (ГТД № и
// № товара в декларации) для автозаполнения ЭСФ/СНТ. Таможенные пошлины в
// себестоимость + импортный НДС + проводки — Этап 2.
// ─────────────────────────────────────────────────────────────────────────────
import { FC, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateSubTableFor } from "src/utils/invalidateSubTableFor";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDateTime } from "src/components/Field";
import ClassifierLookup from "src/components/Field/ClassifierLookup";
import { useAssignNumber } from "src/hooks/useAssignNumber";
import HeaderTogglePosted from "src/components/PaneHeader/HeaderTogglePosted";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
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

const MODEL_ENDPOINT = "importdeclarations";
const LIST_NAME = "ImportDeclarationsList";
const FORM_LABEL = "ГТД по импорту";

interface TFields {
  id?: number; uuid?: string;
  number: string;
  date: string; comment: string;
  amount: number; posted: boolean;
  declarationNumber: string; declarationDate: string;
  countryCode: string; countryName: string;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  warehouseUuid: string; warehouseName: string;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  number: "",
  date: "", comment: "",
  amount: 0, posted: false,
  declarationNumber: "", declarationDate: "",
  countryCode: "", countryName: "",
  organizationUuid: "", organizationName: "",
  counterpartyUuid: "", counterpartyName: "",
  warehouseUuid: "", warehouseName: "",
  authorUuid: "", authorName: "",
};

const ImportDeclarationsForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const queryClient = useQueryClient();
  const { canWrite } = useUserAccessRight("ImportDeclaration");

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
    await invalidateSubTableFor(queryClient, "importdeclarationitems", "importDeclarationUuid", savedData?.uuid ?? "");
  }, [queryClient]);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "import-declarations-form",
    defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
    derivedFields: ["amount"],
    tables: {
      items: {
        endpoint: "importdeclarationitems", parentField: "importDeclarationUuid",
        label: "Позиции ГТД",
        batchEndpoint: "importdeclarationitems/batch",
        requiredItemFields: ["productUuid", "unitOfMeasureUuid", "quantity"],
        requiredItemFieldLabels: { productUuid: "Номенклатура", unitOfMeasureUuid: "Ед. изм.", quantity: "Количество" },
        createPayload: (r: any) => ({
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          price: r.price ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
          positionNumber: r.positionNumber ?? null,
        }),
        updatePayload: (r: any) => ({
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          price: r.price ?? 0,
          unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
          positionNumber: r.positionNumber ?? null,
        }),
        extraSkipFields: ["importDeclarationUuid"],
      },
    },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      number: d.number ?? "",
      date: isoToLocalInput(d.date),
      comment: d.comment ?? "",
      amount: d.amount != null ? Number(d.amount) : 0,
      posted: d.posted === true,
      declarationNumber: d.declarationNumber ?? "",
      declarationDate: d.declarationDate ? isoToLocalInput(d.declarationDate) : "",
      countryCode: d.countryCode ?? "",
      countryName: "",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.name ?? "",
      counterpartyUuid: d.counterpartyUuid ?? "",
      counterpartyName: d.counterparty?.name ?? "",
      warehouseUuid: d.warehouseUuid ?? "",
      warehouseName: d.warehouse?.name ?? "",
      authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
      authorName: d.author?.username ?? d.author?.email ?? "",
    }),
    buildPayload: (fd) => {
      const validation = validateDocumentFields("import_declaration", fd as unknown as Record<string, unknown>);
      if (!validation.isValid) return formatValidationErrors(validation.errors);
      return {
        number: fd.number?.trim() || null,
        date: localInputToIso(fd.date),
        comment: fd.comment?.trim() || null,
        amount: fd.amount ? fd.amount : null,
        posted: fd.posted === true,
        declarationNumber: fd.declarationNumber?.trim() || null,
        declarationDate: fd.declarationDate ? localInputToIso(fd.declarationDate) : null,
        countryCode: fd.countryCode || null,
        organizationUuid: fd.organizationUuid || null,
        counterpartyUuid: fd.counterpartyUuid || null,
        warehouseUuid: fd.warehouseUuid || null,
      };
    },
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, FORM_LABEL, saved, "date"),
    afterSave: invalidateSubTables,
  });

  const items = form.useTable("items");

  const handleTotalChange = useCallback((total: number) => {
    form.setField("amount", Number(total));
  }, [form.setField]);

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
  const notices = useDocumentNotices({ docType: "import_declaration", fields: form.fields as unknown as Record<string, unknown> });
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
              <GroupRow>
                <Field label={translate("declarationNumber")} name={`${form.formUid}_declarationNumber`} value={form.fields.declarationNumber} onChange={e => form.setField("declarationNumber", e.target.value)} disabled={form.isLoading} width="240px" />
                <FieldDateTime label={translate("declarationDate")} name={`${form.formUid}_declarationDate`} width="200px" value={form.fields.declarationDate} onChange={e => form.setField("declarationDate", e.target.value)} disabled={form.isLoading} />
              </GroupRow>
              <Group>
                <FormLookup form={form} field="organization" endpoint="organizations"
                  onSelect={handleOrganizationSelect} />
                <FormLookup form={form} field="warehouse" endpoint="warehouses"
                  extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined} />
              </Group>
              <Group>
                <FormLookup form={form} field="counterparty" endpoint="counterparties" />
                <ClassifierLookup type="country" label={translate("countryOfOrigin")} name={`${form.formUid}_countryCode`}
                  value={form.fields.countryCode} onChange={(code, name) => form.setFields({ countryCode: code, countryName: name } as Partial<TFields>)}
                  disabled={form.isLoading} width="240px" />
              </Group>
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
          parentUuid={form.fields.uuid ?? ""} parentField="importDeclarationUuid"
          endpoint="importdeclarationitems" componentName="ImportDeclarationItemsList_part"
          hasTaxes={false}
          organizationUuid={form.fields.organizationUuid} documentDate={form.fields.date || null}
          disabled={form.isLoading} deferRemoteChanges
          parentLabel={`${translate("ImportDeclarationsList")}: ID ${form.fields.id ?? "?"}${form.fields.date ? " - " + getFormatDateOnly(String(form.fields.date)) : ""}`}
          initialPendingRows={items.pending}
          onTotalChange={handleTotalChange}
          onItemsChange={items.onItemsChange}
          showRequiredHighlight
        />
      )
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleTotalChange, handleOrganizationSelect, canWrite, items, notices, assignNumber]);

  const headerActionsPortal = usePaneHeaderActions(
    form.paneId,
    <HeaderTogglePosted name={`${form.formUid}_posted`} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} />,
  );

  return (
    <FormRequiredScope docType="import_declaration" active>
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
ImportDeclarationsForm.displayName = "ImportDeclarationsForm";

const ImportDeclarationsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={ImportDeclarationsForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(String(d.date)) : ""} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
ImportDeclarationsList.displayName = LIST_NAME;

export { ImportDeclarationsList, ImportDeclarationsForm };
