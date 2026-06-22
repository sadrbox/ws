/**
 * Кассовый отчёт (Кассовая книга, аналог КО-4 РК) — обороты по счёту 1010 «Касса»
 * за период с нарастающим остатком. Источник — карточка счёта 1010 (все движения
 * наличных). ДВОЙНОЙ клик по документу открывает его.
 */
import { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { docTypeLabel } from "src/utils/accountingDocTypes";
import ReportPane from "src/components/ReportPane";
import { ReportSheet, ReportTable, Th, Td, SubtotalRow, TotalRow, Money } from "./_shared/reportLayout";
import { useReportDrill, DrillLink } from "./_shared/reportDrill";
import { useReportFilters } from "./_shared/useReportFilters";
import { firstOfMonth, today } from "./_shared/reportDates";
import { fmtDate, fmtPeriod } from "./_shared/reportFormat";
import reportCss from "./report.module.scss?inline";

const CASH_ACCOUNT = "1010";

interface CardRow {
  uuid: string; date: string;
  documentType: string; documentId: number | null; documentUuid: string;
  corrAccountCode: string; corrAccountName: string;
  debit: number; credit: number; balance: number;
  description: string; analytics: string;
}
interface AccountCardResponse {
  opening: number; turnDebit: number; turnCredit: number; closing: number;
  items: CardRow[];
}
interface Filters extends Record<string, unknown> { dateFrom: string; dateTo: string; orgUuid: string; orgName: string }
interface CashReportProps { uniqId?: string;[key: string]: unknown }

const CashReport: FC<CashReportProps> = ({ uniqId }) => {
  const def = useDefaultOrganization();

  const { fields, setField, patch, applied, handleGenerate } = useReportFilters<Filters>({
    persistKey: "report.cash-report",
    defaults: { dateFrom: firstOfMonth(), dateTo: today(), orgUuid: def.organizationUuid || "", orgName: def.organizationName || "" },
  });
  const drill = useReportDrill({ orgName: fields.orgName });

  const { data, isLoading } = useQuery<AccountCardResponse>({
    queryKey: ["report-cash-1010", applied],
    queryFn: async () => {
      const params: Record<string, string> = { accountCode: CASH_ACCOUNT };
      if (applied!.dateFrom) params.dateFrom = applied!.dateFrom;
      if (applied!.dateTo) params.dateTo = applied!.dateTo;
      if (applied!.orgUuid) params.organizationUuid = applied!.orgUuid;
      return api.get<AccountCardResponse>("accounting/account-card", { params });
    },
    enabled: !!applied,
  });

  const rows: CardRow[] = data?.items ?? [];
  const opening = data?.opening ?? 0;
  const turnDebit = data?.turnDebit ?? 0;
  const turnCredit = data?.turnCredit ?? 0;
  const closing = data?.closing ?? 0;
  const period = fmtPeriod(fields.dateFrom, fields.dateTo);

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="cr_from" value={fields.dateFrom} onChange={e => setField("dateFrom", e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="cr_to" value={fields.dateTo} onChange={e => setField("dateTo", e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="cr_org" value={fields.orgUuid} displayValue={fields.orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => patch({ orgUuid: u, orgName: d })} onClear={() => patch({ orgUuid: "", orgName: "" })} />
      </GroupCol>
    </>
  );

  const layout = (
    <ReportSheet
      org={fields.orgName || undefined}
      title={`${translate("CashReportList")} (${CASH_ACCOUNT})`}
      subTitle={period ? `${translate("reportPeriodLabel")} ${period}` : undefined}
      summary={
        <>
          <span>{translate("reportTotalReceipts")}: <strong><Money value={turnDebit} as="zeroMoney" /></strong></span>
          <span>{translate("reportTotalExpenses")}: <strong><Money value={turnCredit} as="zeroMoney" /></strong></span>
          <span>{translate("reportCashBalance")}: <strong><Money value={closing} as="zeroMoney" autoNeg /></strong></span>
        </>
      }
    >
      <ReportTable>
        <thead>
          <tr>
            <Th col="n">№</Th>
            <Th col="date">{translate("reportDate")}</Th>
            <Th col="name">{translate("document")}</Th>
            <Th col="uom">{translate("accountCorr")}</Th>
            <Th col="name">{translate("reportCounterparty")}</Th>
            <Th col="num">{translate("reportIncoming")}</Th>
            <Th col="num">{translate("reportOutgoing")}</Th>
            <Th col="num">{translate("reportBalance")}</Th>
          </tr>
        </thead>
        <tbody>
          <SubtotalRow>
            <Td colSpan={7}>{translate("openingBalance")}</Td>
            <Td col="num"><Money value={opening} as="zeroMoney" /></Td>
          </SubtotalRow>
          {rows.map((row, idx) => (
            <tr key={row.uuid}>
              <Td col="n">{idx + 1}</Td>
              <Td col="date">{fmtDate(row.date)}</Td>
              <Td col="name">
                <DrillLink onOpen={() => drill.toDocument(row.documentType, row.documentUuid)}>
                  {docTypeLabel(row.documentType)}{row.documentId ? ` №${row.documentId}` : ""}
                </DrillLink>
              </Td>
              <Td col="uom">{row.corrAccountCode}</Td>
              <Td col="name">{row.analytics || row.description}</Td>
              <Td col="num"><Money value={row.debit} /></Td>
              <Td col="num"><Money value={row.credit} /></Td>
              <Td col="num"><Money value={row.balance} as="zeroMoney" autoNeg /></Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <TotalRow>
            <Td colSpan={5}>{translate("total")}</Td>
            <Td col="num"><Money value={turnDebit} as="zeroMoney" /></Td>
            <Td col="num"><Money value={turnCredit} as="zeroMoney" /></Td>
            <Td col="num"><Money value={closing} as="zeroMoney" autoNeg /></Td>
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
      fileBaseName={translate("CashReportList")}
      title={translate("CashReportList")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

CashReport.displayName = "CashReport";
export { CashReport };
