/**
 * ManagerReport — отчёт «Продажи по менеджерам». По каждому менеджеру: кол-во и
 * сумма реализаций/возвратов, нетто, себестоимость, валовая прибыль (проведённые).
 */
import { FC, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import ReportPane from "src/components/ReportPane";
import { ReportSheet, ReportTable, Th, Td, TotalRow, Money } from "./_shared/reportLayout";
import { useReportDrill, DrillLink } from "./_shared/reportDrill";
import { useReportFilters } from "./_shared/useReportFilters";
import { firstOfMonth, today } from "./_shared/reportDates";
import reportCss from "./report.module.scss?inline";

const fmtInt = (n: number) => (n ? Number(n).toLocaleString("ru-KZ") : "—");

interface ManagerRow {
  managerUuid: string | null; managerName: string;
  salesCount: number; salesAmount: number; returnsCount: number; returnsAmount: number;
  netAmount: number; cogs: number; netRevenue: number; grossProfit: number;
}
interface Totals {
  salesCount: number; salesAmount: number; returnsCount: number; returnsAmount: number;
  netAmount: number; cogs: number; netRevenue: number; grossProfit: number;
}
interface Filters extends Record<string, unknown> { dateFrom: string; dateTo: string; orgUuid: string; orgName: string }
interface ManagerReportProps { uniqId?: string;[key: string]: unknown }

function monthLabel(dateFrom: string, dateTo: string): string {
  if (!dateFrom) return "";
  try {
    const d = new Date(dateFrom + "T00:00:00");
    const month = d.toLocaleString("ru-RU", { month: "long" });
    return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${d.getFullYear()} г.`;
  } catch { return `${dateFrom} — ${dateTo}`; }
}

const ManagerReport: FC<ManagerReportProps> = ({ uniqId }) => {
  const def = useDefaultOrganization();

  const { fields, setField, patch, applied, handleGenerate } = useReportFilters<Filters>({
    persistKey: "report.manager-report",
    defaults: { dateFrom: firstOfMonth(), dateTo: today(), orgUuid: def.organizationUuid || "", orgName: def.organizationName || "" },
  });
  const drill = useReportDrill({ applied, orgName: fields.orgName });

  const { data, isLoading, isError } = useQuery<{ items: ManagerRow[]; totals: Totals }>({
    queryKey: ["report-sales-by-manager", applied],
    queryFn: async () => {
      const p: Record<string, string> = {};
      if (applied!.dateFrom) p.dateFrom = applied!.dateFrom;
      if (applied!.dateTo) p.dateTo = applied!.dateTo;
      if (applied!.orgUuid) p.organizationUuid = applied!.orgUuid;
      const resp = await api.get<any>("reports/sales-by-manager", { params: p });
      return { items: resp?.items ?? [], totals: resp?.totals ?? null };
    },
    enabled: !!applied,
    retry: 1,
  });

  const rows: ManagerRow[] = data?.items ?? [];
  const totals = useMemo<Totals>(
    () => data?.totals ?? rows.reduce((a, r) => ({
      salesCount: a.salesCount + r.salesCount, salesAmount: a.salesAmount + r.salesAmount,
      returnsCount: a.returnsCount + r.returnsCount, returnsAmount: a.returnsAmount + r.returnsAmount,
      netAmount: a.netAmount + r.netAmount, cogs: a.cogs + r.cogs, netRevenue: a.netRevenue + r.netRevenue, grossProfit: a.grossProfit + r.grossProfit,
    }), { salesCount: 0, salesAmount: 0, returnsCount: 0, returnsAmount: 0, netAmount: 0, cogs: 0, netRevenue: 0, grossProfit: 0 }),
    [data, rows],
  );

  const period = monthLabel(fields.dateFrom, fields.dateTo);

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="mr_from" value={fields.dateFrom} onChange={e => setField("dateFrom", e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="mr_to" value={fields.dateTo} onChange={e => setField("dateTo", e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="mr_org" value={fields.orgUuid} displayValue={fields.orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => patch({ orgUuid: u, orgName: d })} onClear={() => patch({ orgUuid: "", orgName: "" })} />
      </GroupCol>
    </>
  );

  const layout = (
    <ReportSheet org={fields.orgName || undefined} title={<>{translate("managerReportTitle")}{period && <> за {period}</>}</>}>
      <ReportTable>
        <thead>
          <tr>
            <Th col="n">№</Th>
            <Th col="name">{translate("manager")}</Th>
            <Th col="num">{translate("reportSalesCount")}</Th>
            <Th col="num">{translate("reportAmountSale")}</Th>
            <Th col="num">{translate("reportReturnsCount")}</Th>
            <Th col="num">{translate("reportAmountReturn")}</Th>
            <Th col="num">{translate("reportAmountNet")}</Th>
            <Th col="num">{translate("reportCogs")}</Th>
            <Th col="num">{translate("reportGrossProfit")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.managerUuid ?? idx}>
              <Td col="n">{idx + 1}</Td>
              <Td col="name">
                {row.managerUuid
                  ? <DrillLink onOpen={() => drill.toEntity("employees", row.managerUuid!)}>{row.managerName}</DrillLink>
                  : row.managerName}
              </Td>
              <Td col="num">{fmtInt(row.salesCount)}</Td>
              <Td col="num"><Money value={row.salesAmount} /></Td>
              <Td col="num">{fmtInt(row.returnsCount)}</Td>
              <Td col="num"><Money value={row.returnsAmount} /></Td>
              <Td col="num"><Money value={row.netAmount} /></Td>
              <Td col="num"><Money value={row.cogs} /></Td>
              <Td col="num"><Money value={row.grossProfit} /></Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <TotalRow>
            <Td colSpan={2}>{translate("total")}</Td>
            <Td col="num">{fmtInt(totals.salesCount)}</Td>
            <Td col="num"><Money value={totals.salesAmount} as="zeroMoney" /></Td>
            <Td col="num">{fmtInt(totals.returnsCount)}</Td>
            <Td col="num"><Money value={totals.returnsAmount} as="zeroMoney" /></Td>
            <Td col="num"><Money value={totals.netAmount} as="zeroMoney" /></Td>
            <Td col="num"><Money value={totals.cogs} as="zeroMoney" /></Td>
            <Td col="num"><Money value={totals.grossProfit} as="zeroMoney" /></Td>
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
      isEmpty={!isLoading && (!applied || isError || rows.length === 0)}
      emptyMessage={isError ? translate("serverError") : (!applied ? translate("reportPressGenerate") : undefined)}
      onGenerate={handleGenerate}
      fileBaseName={translate("managerReport")}
      title={translate("managerReport")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

ManagerReport.displayName = "ManagerReport";
export { ManagerReport };
export default ManagerReport;
