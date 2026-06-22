/**
 * Журнал проводок — список всех бухгалтерских проводок за период с фильтрами.
 * ДВОЙНОЙ клик по документу открывает форму документа-регистратора.
 */
import { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import ReportPane from "src/components/ReportPane";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { docTypeLabel } from "src/utils/accountingDocTypes";
import { ReportSheet, ReportTable, Th, Td, TotalRow, Money } from "./_shared/reportLayout";
import { useReportDrill, DrillLink } from "./_shared/reportDrill";
import { useReportFilters } from "./_shared/useReportFilters";
import { firstOfMonth, today } from "./_shared/reportDates";
import reportCss from "./report.module.scss?inline";

interface JournalRow {
  uuid: string; date: string;
  documentType: string; documentTypeLabel: string; documentId: number | null; documentUuid: string;
  debitAccountCode: string; debitAccountName: string;
  creditAccountCode: string; creditAccountName: string;
  amount: number; description: string;
  debitAnalytics: string; creditAnalytics: string;
}

interface Filters extends Record<string, unknown> {
  dateFrom: string; dateTo: string; orgUuid: string; orgName: string;
  accountCode: string; accountName: string;
  cpUuid: string; cpName: string; productUuid: string; productName: string;
}

interface Props { uniqId?: string;[key: string]: unknown }

const AccountingJournal: FC<Props> = ({ uniqId }) => {
  const def = useDefaultOrganization();

  const { fields, setField, patch, applied, handleGenerate } = useReportFilters<Filters>({
    persistKey: "report.accounting-journal",
    defaults: {
      dateFrom: firstOfMonth(), dateTo: today(),
      orgUuid: def.organizationUuid || "", orgName: def.organizationName || "",
      accountCode: "", accountName: "", cpUuid: "", cpName: "", productUuid: "", productName: "",
    },
  });
  const drill = useReportDrill({ orgName: fields.orgName });

  const { data, isLoading } = useQuery<{ items: JournalRow[]; total: number }>({
    queryKey: ["accounting-journal", applied],
    queryFn: async () => {
      const p: Record<string, string> = {};
      const f = applied!;
      if (f.dateFrom) p.dateFrom = f.dateFrom;
      if (f.dateTo) p.dateTo = f.dateTo;
      if (f.orgUuid) p.organizationUuid = f.orgUuid;
      if (f.accountCode) p.accountCode = f.accountCode;
      if (f.cpUuid) p.counterpartyUuid = f.cpUuid;
      if (f.productUuid) p.productUuid = f.productUuid;
      const resp = await api.get<any>("accounting/journal", { params: p });
      return { items: resp?.items ?? [], total: resp?.total ?? 0 };
    },
    enabled: !!applied,
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="aj_from" value={fields.dateFrom} onChange={e => setField("dateFrom", e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="aj_to" value={fields.dateTo} onChange={e => setField("dateTo", e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="aj_org" value={fields.orgUuid} displayValue={fields.orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => patch({ orgUuid: u, orgName: d })} onClear={() => patch({ orgUuid: "", orgName: "" })} />
        <LookupField label={translate("account")} name="aj_acc" value={fields.accountCode} displayValue={fields.accountName}
          endpoint="chart-of-accounts" displayField="name"
          onSelect={(_u, d, item) => patch({ accountCode: item.code, accountName: `${item.code} ${d}` })}
          onClear={() => patch({ accountCode: "", accountName: "" })} />
        <LookupField label={translate("counterparty")} name="aj_cp" value={fields.cpUuid} displayValue={fields.cpName}
          endpoint="counterparties" displayField="name"
          onSelect={(u, d) => patch({ cpUuid: u, cpName: d })} onClear={() => patch({ cpUuid: "", cpName: "" })} />
        <LookupField label={translate("product")} name="aj_prod" value={fields.productUuid} displayValue={fields.productName}
          endpoint="products" displayField="name"
          onSelect={(u, d) => patch({ productUuid: u, productName: d })} onClear={() => patch({ productUuid: "", productName: "" })} />
      </GroupCol>
    </>
  );

  const layout = (
    <ReportSheet title={translate("accountingJournalTitle")}>
      <ReportTable>
        <thead>
          <tr>
            <Th col="n">№</Th>
            <Th col="date">{translate("date")}</Th>
            <Th col="name">{translate("document")}</Th>
            <Th col="uom">{translate("accountDebit")}</Th>
            <Th col="name">{translate("accountDebitName")}</Th>
            <Th col="uom">{translate("accountCredit")}</Th>
            <Th col="name">{translate("accountCreditName")}</Th>
            <Th col="num">{translate("amount")}</Th>
            <Th col="name">{translate("description")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.uuid}>
              <Td col="n">{idx + 1}</Td>
              <Td col="date">{r.date}</Td>
              <Td col="name">
                <DrillLink onOpen={() => drill.toDocument(r.documentType, r.documentUuid)}>
                  {docTypeLabel(r.documentType)}{r.documentId ? ` №${r.documentId}` : ""}
                </DrillLink>
              </Td>
              <Td col="uom">{r.debitAccountCode}</Td>
              <Td col="name">{r.debitAccountName}{r.debitAnalytics ? ` (${r.debitAnalytics})` : ""}</Td>
              <Td col="uom">{r.creditAccountCode}</Td>
              <Td col="name">{r.creditAccountName}{r.creditAnalytics ? ` (${r.creditAnalytics})` : ""}</Td>
              <Td col="num"><Money value={r.amount} as="zeroMoney" /></Td>
              <Td col="name">{r.description}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <TotalRow>
            <Td colSpan={7}>{translate("total")} ({rows.length})</Td>
            <Td col="num"><Money value={total} as="zeroMoney" /></Td>
            <Td />
          </TotalRow>
        </tfoot>
      </ReportTable>
    </ReportSheet>
  );

  return (
    <ReportPane
      uniqId={uniqId}
      form={form}
      layout={layout}
      layoutStyles={reportCss}
      isLoading={isLoading}
      isEmpty={!isLoading && (!applied || rows.length === 0)}
      emptyMessage={!applied ? translate("reportPressGenerate") : undefined}
      onGenerate={handleGenerate}
      fileBaseName={translate("accountingJournalTitle")}
      title={translate("accountingJournalTitle")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

AccountingJournal.displayName = "AccountingJournal";
export { AccountingJournal };
