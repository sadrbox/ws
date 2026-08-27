/**
 * «Принятие к учёту ОС» — ввод основного средства в эксплуатацию и запуск
 * амортизации. Header-документ без позиций и БЕЗ собственных проводок: флаг
 * «Проведён» = «в эксплуатации» и гейтит начисление амортизации, которое делает
 * закрытие месяца (Дт 7210 Кт 2420 по субконто ОС; см. backend/services/
 * depreciation.js). Параметры амортизации (срок, стоимость, дата старта) хранятся
 * на самом акте.
 */
import { FC, useMemo } from "react";
import { asText } from "src/utils/asText";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDateTime, FieldNumber } from "src/components/Field";
import HeaderTogglePosted from "src/components/PaneHeader/HeaderTogglePosted";
import { FormLookup } from "src/components/Field/FormLookup";
import ShowInJournalButton from "src/components/ShowInJournalButton";
import NotesButton from "src/components/Notes/NotesButton";
import CreateTaskButton from "src/components/CreateTaskButton";
import DeleteDocumentButton from "src/components/DeleteDocumentButton";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useAccessPermission } from "src/hooks/useAccessPermission";
import { useAssignNumber } from "src/hooks/useAssignNumber";
import { makeDocLabel , type LabelSource } from "src/utils/buildPaneLabel";
import { getFormatDateOnly, isoToLocalInput, localInputToIso } from "src/utils/datetime";
import Notice from "src/components/Notice";
import { useDocumentNotices } from "src/hooks/useDocumentNotices";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import { validateDocumentFields, formatValidationErrors } from "src/utils/validatePostedDocument";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";

const ENDPOINT = "fixed-asset-acceptances";
const LIST_NAME = "FixedAssetAcceptancesList";
const DOC_TYPE = "fixed_asset_acceptance" as const;

interface TFields {
  id?: number; uuid?: string;
  number: string; date: string; comment: string;
  fixedAssetUuid: string; fixedAssetName: string;
  initialCost: string; liquidationValue: string; usefulLifeMonths: string;
  depreciationStartDate: string;
  depreciationMethod: string; depreciationAccount: string; accumulatedAccount: string;
  posted: boolean;
  organizationUuid: string; organizationName: string;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  number: "", date: "", comment: "",
  fixedAssetUuid: "", fixedAssetName: "",
  initialCost: "", liquidationValue: "0", usefulLifeMonths: "",
  depreciationStartDate: "",
  depreciationMethod: "linear", depreciationAccount: "7210", accumulatedAccount: "2420",
  posted: true,
  organizationUuid: "", organizationName: "",
  authorUuid: "", authorName: "",
};

interface AcceptanceServerRecord {
  id?: number; uuid?: string;
  number?: string | null; date?: string; comment?: string | null;
  fixedAssetUuid?: string | null; fixedAsset?: { name?: string } | null;
  initialCost?: number | string | null; liquidationValue?: number | string | null; usefulLifeMonths?: number | null;
  depreciationStartDate?: string | null;
  depreciationMethod?: string | null; depreciationAccount?: string | null; accumulatedAccount?: string | null;
  posted?: boolean;
  organizationUuid?: string | null; organization?: { name?: string } | null;
  authorUuid?: string | null; author?: { uuid?: string; username?: string; email?: string } | null;
}

const num = (v: unknown): string => (v == null || v === "" ? "" : asText(v));

const FixedAssetAcceptancesForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useAccessPermission("Product");
  const assignNumber = useAssignNumber();

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data as { uuid?: string; organizationUuid?: string; organizationName?: string } | undefined;
    if (data?.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    init.date = isoToLocalInput(new Date().toISOString());
    if (data?.organizationUuid) {
      init.organizationUuid = data.organizationUuid;
      init.organizationName = data.organizationName || "";
    } else if (defaultOrg.organizationUuid) {
      init.organizationUuid = defaultOrg.organizationUuid;
      init.organizationName = defaultOrg.organizationName;
    }
    return init;
  })();

  const form = useFormStore<TFields>({
    endpoint: ENDPOINT,
    storageKey: "fixed-asset-acceptances-form",
    defaultFields: DEFAULT_FIELDS,
    initialFields,
    paneProps,
    mapServerToForm: (d: AcceptanceServerRecord, prev): TFields => ({
      ...(prev ?? DEFAULT_FIELDS),
      id: d.id,
      uuid: d.uuid,
      number: d.number ?? "",
      date: isoToLocalInput(d.date),
      comment: d.comment ?? "",
      fixedAssetUuid: d.fixedAssetUuid ?? "",
      fixedAssetName: d.fixedAsset?.name ?? "",
      initialCost: num(d.initialCost),
      liquidationValue: num(d.liquidationValue),
      usefulLifeMonths: num(d.usefulLifeMonths),
      depreciationStartDate: d.depreciationStartDate ? isoToLocalInput(d.depreciationStartDate) : "",
      depreciationMethod: d.depreciationMethod ?? "linear",
      depreciationAccount: d.depreciationAccount ?? "7210",
      accumulatedAccount: d.accumulatedAccount ?? "2420",
      posted: d.posted === true,
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.name ?? "",
      authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
      authorName: d.author?.username ?? d.author?.email ?? "",
    }),
    buildPayload: (fd) => {
      const validation = validateDocumentFields(DOC_TYPE, fd as unknown as Record<string, unknown>);
      if (!validation.isValid) return formatValidationErrors(validation.errors);
      return {
        number: fd.number?.trim() || null,
        date: localInputToIso(fd.date),
        comment: fd.comment?.trim() || null,
        fixedAssetUuid: fd.fixedAssetUuid || null,
        initialCost: fd.initialCost !== "" ? Number(fd.initialCost) : 0,
        liquidationValue: fd.liquidationValue !== "" ? Number(fd.liquidationValue) : 0,
        usefulLifeMonths: fd.usefulLifeMonths !== "" ? Number(fd.usefulLifeMonths) : null,
        depreciationStartDate: fd.depreciationStartDate ? localInputToIso(fd.depreciationStartDate) : null,
        depreciationMethod: fd.depreciationMethod || "linear",
        depreciationAccount: fd.depreciationAccount || "7210",
        accumulatedAccount: fd.accumulatedAccount || "2420",
        posted: fd.posted === true,
        organizationUuid: fd.organizationUuid || null,
      };
    },
    buildPaneLabel: (saved: LabelSource) => makeDocLabel(LIST_NAME, translate("docType_fixed_asset_acceptance"), saved, "date"),
  });

  const notices = useDocumentNotices({ docType: DOC_TYPE, fields: form.fields as unknown as Record<string, unknown>, formError: form.errorKind === "form" ? form.error : null });

  const isSavedDoc = form.isEditMode && !!form.fields.uuid;

  const tabs = useMemo(() => [
    {
      id: "tab-details",
      label: translate("general"),
      component: (
        <div className={styles.FormContainer}>
          <div className={styles.FormWrapper}>
            <GroupCol className={styles.Form}>
              <GroupRow className={styles.FormHeaderRow}>
                <FieldDateTime label={translate("date")} name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="200px" />
                <Field label={translate("documentNumber")} name={`${form.formUid}_number`} value={form.fields.number} onChange={e => form.setField("number", e.target.value)} disabled={form.isLoading} width="200px" maxLength={9}
                  actions={[
                    { type: "assignNumber", onClick: () => void assignNumber(ENDPOINT, form.fields.organizationUuid, form.fields.number, (n) => form.setField("number", n), form.fields.date, form.fields.uuid) },
                  ]} />
              </GroupRow>
              <Group>
                <FormLookup form={form} field="fixedAsset" endpoint="fixedassets" disabled={form.isLoading} />
              </Group>
              <GroupRow>
                <FieldNumber label={translate("initialCost")} name={`${form.formUid}_initialCost`} value={form.fields.initialCost} onChange={e => form.setField("initialCost", e.target.value)} disabled={form.isLoading} width="200px" decimals={2} textAlign="right" />
                <FieldNumber label={translate("liquidationValue")} name={`${form.formUid}_liquidationValue`} value={form.fields.liquidationValue} onChange={e => form.setField("liquidationValue", e.target.value)} disabled={form.isLoading} width="200px" decimals={2} textAlign="right" />
              </GroupRow>
              <GroupRow>
                <FieldNumber label={translate("usefulLifeMonths")} name={`${form.formUid}_usefulLifeMonths`} value={form.fields.usefulLifeMonths} onChange={e => form.setField("usefulLifeMonths", e.target.value)} disabled={form.isLoading} width="200px" decimals={0} textAlign="right" />
                <FieldDateTime label={translate("depreciationStartDate")} name={`${form.formUid}_depStart`} value={form.fields.depreciationStartDate} onChange={e => form.setField("depreciationStartDate", e.target.value)} disabled={form.isLoading} width="200px" />
              </GroupRow>
              <Group>
                <FormLookup form={form} field="organization" endpoint="organizations" disabled={form.isLoading} />
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
      ),
    },
  ], [form.fields, form.formUid, form.isLoading, form.setField, assignNumber, notices]);

  const headerActionsPortal = usePaneHeaderActions(
    form.paneId,
    (
      <>
        <HeaderTogglePosted name={`${form.formUid}_posted`} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} />
        {isSavedDoc && <><NotesButton endpoint={ENDPOINT} uuid={form.fields.uuid} /> <CreateTaskButton endpoint={ENDPOINT} uuid={form.fields.uuid} /> <ShowInJournalButton endpoint={ENDPOINT} uuid={form.fields.uuid} /> <DeleteDocumentButton endpoint={ENDPOINT} uuid={form.fields.uuid} paneId={form.paneId} /></>}
      </>
    ),
  );

  return (
    <>
      <ModelForm
        paneId={form.paneId} tabs={tabs}
        onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
        onReload={form.isEditMode ? form.handleReload : undefined}
        isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
        readonly={!canWrite}
      />
      {headerActionsPortal}
    </>
  );
};
FixedAssetAcceptancesForm.displayName = "FixedAssetAcceptancesForm";

const FixedAssetAcceptancesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }> = (
  { variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }
) => (
  <ModelList
    endpoint={ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={FixedAssetAcceptancesForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField} extraQueryParams={extraQueryParams}
    defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
FixedAssetAcceptancesList.displayName = LIST_NAME;

export { FixedAssetAcceptancesForm, FixedAssetAcceptancesList };
