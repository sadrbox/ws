/**
 * Оборотно-сальдовая ведомость (ОСВ). Сальдо/обороты по счетам за период.
 * ДВОЙНОЙ клик по счёту открывает «Карточку счёта» (период/орг переносятся).
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
import { ReportSheet, ReportTable, Th, Td, TotalRow, Money } from "./_shared/reportLayout";
import { useReportDrill, DrillLink } from "./_shared/reportDrill";
import { useReportFilters } from "./_shared/useReportFilters";
import { firstOfMonth, today } from "./_shared/reportDates";
import reportCss from "./report.module.scss?inline";

interface OsvRow {
  code: string; name: string;
  openDebit: number; openCredit: number;
  turnDebit: number; turnCredit: number;
  closeDebit: number; closeCredit: number;
}

interface Props { uniqId?: string;[key: string]: unknown }

const TurnoverBalanceSheet: FC<Props> = ({ uniqId }) => {
  const def = useDefaultOrganization();

  const { fields, setField, applied, handleGenerate } = useReportFilters({
    persistKey: "report.accounting-osv",
    defaults: { dateFrom: firstOfMonth(), dateTo: today(), orgUuid: def.organizationUuid || "", orgName: def.organizationName || "" },
  });
  const drill = useReportDrill({ applied, orgName: fields.orgName });

  const { data, isLoading } = useQuery<{ items: OsvRow[]; totals: OsvRow }>({
    queryKey: ["accounting-osv", applied],
    queryFn: async () => {
      const p: Record<string, string> = {};
      if (applied!.dateFrom) p.dateFrom = applied!.dateFrom;
      if (applied!.dateTo) p.dateTo = applied!.dateTo;
      if (applied!.orgUuid) p.organizationUuid = applied!.orgUuid;
      const resp = await api.get<any>("accounting/balance-sheet", { params: p });
      return { items: resp?.items ?? [], totals: resp?.totals };
    },
    enabled: !!applied,
  });

  const rows = data?.items ?? [];
  const totals = data?.totals;

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="osv_from" value={fields.dateFrom} onChange={e => setField("dateFrom", e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="osv_to" value={fields.dateTo} onChange={e => setField("dateTo", e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="osv_org" value={fields.orgUuid} displayValue={fields.orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => { setField("orgUuid", u); setField("orgName", d); }} onClear={() => { setField("orgUuid", ""); setField("orgName", ""); }} />
      </GroupCol>
    </>
  );

  const layout = (
    <ReportSheet org={fields.orgName || undefined} title={translate("osvTitle")}>
      <ReportTable>
        <thead>
          <tr>
            <Th col="uom" rowSpan={2}>{translate("account")}</Th>
            <Th col="name" rowSpan={2}>{translate("name")}</Th>
            <Th col="num" colSpan={2}>{translate("osvOpening")}</Th>
            <Th col="num" colSpan={2}>{translate("osvTurnover")}</Th>
            <Th col="num" colSpan={2}>{translate("osvClosing")}</Th>
          </tr>
          <tr>
            <Th col="num">{translate("debit")}</Th>
            <Th col="num">{translate("credit")}</Th>
            <Th col="num">{translate("debit")}</Th>
            <Th col="num">{translate("credit")}</Th>
            <Th col="num">{translate("debit")}</Th>
            <Th col="num">{translate("credit")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <Td col="uom">
                <DrillLink onOpen={() => drill.toReport("account-card", { accountCode: r.code, accountName: r.name })}>{r.code}</DrillLink>
              </Td>
              <Td col="name">{r.name}</Td>
              <Td col="num"><Money value={r.openDebit} /></Td>
              <Td col="num"><Money value={r.openCredit} /></Td>
              <Td col="num"><Money value={r.turnDebit} /></Td>
              <Td col="num"><Money value={r.turnCredit} /></Td>
              <Td col="num"><Money value={r.closeDebit} /></Td>
              <Td col="num"><Money value={r.closeCredit} /></Td>
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <TotalRow>
              <Td colSpan={2}>{translate("total")}</Td>
              <Td col="num"><Money value={totals.openDebit} as="zeroMoney" /></Td>
              <Td col="num"><Money value={totals.openCredit} as="zeroMoney" /></Td>
              <Td col="num"><Money value={totals.turnDebit} as="zeroMoney" /></Td>
              <Td col="num"><Money value={totals.turnCredit} as="zeroMoney" /></Td>
              <Td col="num"><Money value={totals.closeDebit} as="zeroMoney" /></Td>
              <Td col="num"><Money value={totals.closeCredit} as="zeroMoney" /></Td>
            </TotalRow>
          </tfoot>
        )}
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
      fileBaseName={translate("osvTitle")}
      title={translate("osvTitle")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

TurnoverBalanceSheet.displayName = "TurnoverBalanceSheet";
export { TurnoverBalanceSheet };
