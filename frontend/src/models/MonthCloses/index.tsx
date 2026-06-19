/**
 * «Закрытие месяца» — регламентный header-документ. Закрывает счета доходов и
 * расходов (6010/7010/7210) на счёт итоговой прибыли 5610 по чистым оборотам
 * периода (см. backend/services/accountingPosting.js → POSTING_RULES.month_close).
 * Сальдо 5610 после проведения = финансовый результат периода (Кт = прибыль).
 *
 * Период задаётся выбором месяца (FieldPeriod, "YYYY-MM") → periodStart (1-е
 * число) / periodEnd (последний день). Документ без позиций.
 */
import { FC, useMemo, useCallback, useState, useEffect } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldDateTime, FieldPeriod } from "src/components/Field";
import HeaderTogglePosted from "src/components/PaneHeader/HeaderTogglePosted";
import { FormLookup } from "src/components/Field/FormLookup";
import ShowInJournalButton from "src/components/ShowInJournalButton";
import DeleteDocumentButton from "src/components/DeleteDocumentButton";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { useAssignNumber } from "src/hooks/useAssignNumber";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import {
  getFormatDateOnly,
  isoToLocalInput,
  localInputToIso,
  monthPeriodToRange,
  isoToMonthPeriod,
} from "src/utils/datetime";
import { api } from "src/services/api/client";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import DocumentEntriesButton from "src/components/AccountingEntries/DocumentEntriesButton";
import { validateDocumentFields, formatValidationErrors, getDocumentFillHint } from "src/utils/validatePostedDocument";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";

const ENDPOINT = "month-closes";
const LIST_NAME = "MonthClosesList";
const DOC_TYPE = "month_close" as const;
const RESULT_ACCOUNT = "5610";

interface TFields {
  id?: number; uuid?: string;
  number: string; date: string; comment: string;
  period: string; periodStart: string; periodEnd: string;
  posted: boolean;
  organizationUuid: string; organizationName: string;
  authorUuid: string; authorName: string;
}

const DEFAULT_FIELDS: TFields = {
  number: "", date: "", comment: "",
  period: "", periodStart: "", periodEnd: "",
  posted: true,
  organizationUuid: "", organizationName: "",
  authorUuid: "", authorName: "",
};

interface MonthCloseServerRecord {
  id?: number; uuid?: string;
  number?: string | null; date?: string; comment?: string | null;
  periodStart?: string | null; periodEnd?: string | null;
  posted?: boolean;
  organizationUuid?: string | null; organization?: { name?: string } | null;
  authorUuid?: string | null; author?: { uuid?: string; username?: string; email?: string } | null;
}

interface AccountCardResponse {
  opening: number; turnDebit: number; turnCredit: number; closing: number;
}

const fmtMoney = (n: number) =>
  Number(n || 0).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MonthClosesForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useUserAccessRight("MonthClose");
  const assignNumber = useAssignNumber();

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data as { uuid?: string; organizationUuid?: string; organizationName?: string } | undefined;
    if (data?.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    init.date = isoToLocalInput(new Date().toISOString());
    // Период по умолчанию — предыдущий месяц (обычно закрывают завершившийся).
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    init.period = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
    const range = monthPeriodToRange(init.period);
    init.periodStart = range.start ?? "";
    init.periodEnd = range.end ?? "";
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
    storageKey: "month-closes-form",
    defaultFields: DEFAULT_FIELDS,
    initialFields,
    paneProps,
    mapServerToForm: (d: MonthCloseServerRecord, prev): TFields => ({
      ...(prev ?? DEFAULT_FIELDS),
      id: d.id,
      uuid: d.uuid,
      number: d.number ?? "",
      date: isoToLocalInput(d.date),
      comment: d.comment ?? "",
      period: isoToMonthPeriod(d.periodStart),
      periodStart: d.periodStart ?? "",
      periodEnd: d.periodEnd ?? "",
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
        periodStart: fd.periodStart || null,
        periodEnd: fd.periodEnd || null,
        posted: fd.posted === true,
        organizationUuid: fd.organizationUuid || null,
      };
    },
    buildPaneLabel: (saved) => makeDocLabel(LIST_NAME, translate("docType_month_close"), saved, "date"),
  });

  // Выбор месяца → пересчёт границ периода.
  const handlePeriodChange = useCallback((e: { target: { value: string } }) => {
    const period = e.target.value;
    const range = monthPeriodToRange(period);
    form.setFields({ period, periodStart: range.start ?? "", periodEnd: range.end ?? "" } as Partial<TFields>);
  }, [form.setFields]);

  // Финрезультат периода: обороты счёта 5610 (Кт−Дт = прибыль) за период.
  // Подгружается для сохранённого проведённого документа.
  const [finResult, setFinResult] = useState<number | null>(null);
  const isSavedDoc = form.isEditMode && !!form.fields.uuid;
  useEffect(() => {
    let cancelled = false;
    setFinResult(null);
    if (!isSavedDoc || !form.fields.posted || !form.fields.periodStart || !form.fields.periodEnd || !form.fields.organizationUuid) return;
    const params: Record<string, string> = {
      accountCode: RESULT_ACCOUNT,
      dateFrom: form.fields.periodStart.slice(0, 10),
      dateTo: form.fields.periodEnd.slice(0, 10),
      organizationUuid: form.fields.organizationUuid,
    };
    api.get<AccountCardResponse>("accounting/account-card", { params })
      .then((r) => { if (!cancelled) setFinResult(Number(r.turnCredit || 0) - Number(r.turnDebit || 0)); })
      .catch(() => { if (!cancelled) setFinResult(null); });
    return () => { cancelled = true; };
  }, [isSavedDoc, form.fields.posted, form.fields.periodStart, form.fields.periodEnd, form.fields.organizationUuid, form.fields.uuid]);

  const tabs = useMemo(() => [
    {
      id: "tab-details",
      label: translate("general"),
      component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <GroupRow className={styles.FormHeaderRow}>
                <Field label={translate("documentNumber")} name={`${form.formUid}_number`} value={form.fields.number} onChange={e => form.setField("number", e.target.value)} disabled={form.isLoading} width="150px" maxLength={9}
                  actions={[
                    { type: "assignNumber", onClick: () => void assignNumber(ENDPOINT, form.fields.organizationUuid, form.fields.number, (n) => form.setField("number", n), form.fields.date, form.fields.uuid) },
                  ]} />
                <FieldDateTime label={translate("date")} name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="180px" />
              </GroupRow>
              <Group>
                <FieldPeriod label={translate("monthClosePeriod")} name={`${form.formUid}_period`} value={form.fields.period} onChange={handlePeriodChange} disabled={form.isLoading} width="200px" />
              </Group>
              <Group>
                <FormLookup form={form} field="organization" endpoint="organizations" />
              </Group>
              {!form.fields.organizationUuid && (
                <div className={styles.SettingHint}>{getDocumentFillHint(DOC_TYPE, form.fields as unknown as Record<string, unknown>)}</div>
              )}
              {finResult !== null && (
                <Group>
                  <Field
                    label={translate("monthCloseFinResult")}
                    name={`${form.formUid}_finResult`}
                    value={`${fmtMoney(finResult)} ₸ — ${finResult >= 0 ? translate("profit") : translate("loss")}`}
                    disabled
                    width="auto"
                  />
                </Group>
              )}
            </GroupCol>
          </div>
          {form.isEditMode && <GroupRow className={styles.FormFooterRow}>
            <Field label={translate("Comment")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} />
            <Field label={translate("Author")} name={`${form.formUid}_author`} value={form.fields.authorName || ""} disabled width="auto" />
          </GroupRow>}
        </div>
      ),
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handlePeriodChange, assignNumber, canWrite, finResult]);

  const headerActionsPortal = usePaneHeaderActions(
    form.paneId,
    (
      <>
        <HeaderTogglePosted name={`${form.formUid}_posted`} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} />
        {isSavedDoc && <><ShowInJournalButton endpoint={ENDPOINT} uuid={form.fields.uuid} /> <DeleteDocumentButton endpoint={ENDPOINT} uuid={form.fields.uuid} paneId={form.paneId} />
        <DocumentEntriesButton documentType={DOC_TYPE} documentUuid={form.fields.uuid} /></>}
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
MonthClosesForm.displayName = "MonthClosesForm";

const MonthClosesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={MonthClosesForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
    defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
MonthClosesList.displayName = LIST_NAME;

export { MonthClosesForm, MonthClosesList };
