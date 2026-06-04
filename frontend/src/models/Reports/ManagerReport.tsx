/**
 * ManagerReport — отчёт «Продажи по менеджерам».
 *
 * Аналитика учёта по менеджеру реализации (НК РК): по каждому менеджеру —
 * количество и сумма реализаций, возвратов и чистая сумма продаж. Считается
 * только по ПРОВЕДЁННЫМ документам (бэкенд /reports/sales-by-manager).
 */
import { FC, useState, useCallback, useMemo } from "react";
import { usePersistentState } from "src/hooks/usePersistentState";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import ReportPane from "src/components/ReportPane";
import styles from "./report.module.scss";
import reportCss from "./report.module.scss?inline";

const fmtAmt = (n: number) =>
  n !== 0 ? Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const fmtAmtZ = (n: number) =>
  Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number) => (n ? Number(n).toLocaleString("ru-KZ") : "—");

interface ManagerRow {
  managerUuid: string | null;
  managerName: string;
  salesCount: number;
  salesAmount: number;
  returnsCount: number;
  returnsAmount: number;
  netAmount: number;
  cogs: number;
  netRevenue: number;
  grossProfit: number;
}

interface Totals {
  salesCount: number; salesAmount: number;
  returnsCount: number; returnsAmount: number; netAmount: number;
  cogs: number; netRevenue: number; grossProfit: number;
}

interface ManagerReportProps {
  uniqId?: string;
  [key: string]: unknown;
}

function monthLabel(dateFrom: string, dateTo: string): string {
  if (!dateFrom) return "";
  try {
    const d = new Date(dateFrom + "T00:00:00");
    const month = d.toLocaleString("ru-RU", { month: "long" });
    return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${d.getFullYear()} г.`;
  } catch {
    return `${dateFrom} — ${dateTo}`;
  }
}

const ManagerReport: FC<ManagerReportProps> = ({ uniqId }) => {
  const { organizationUuid: defaultOrgUuid, organizationName: defaultOrgName } = useDefaultOrganization();

  const [dateFrom, setDateFrom] = usePersistentState("report.manager-report.dateFrom", () => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = usePersistentState("report.manager-report.dateTo", () => new Date().toISOString().slice(0, 10));
  const [orgUuid, setOrgUuid] = usePersistentState("report.manager-report.orgUuid", defaultOrgUuid || "");
  const [orgName, setOrgName] = usePersistentState("report.manager-report.orgName", defaultOrgName || "");

  const [applied, setApplied] = useState<null | { dateFrom: string; dateTo: string; orgUuid: string }>(null);
  const handleGenerate = useCallback(() => setApplied({ dateFrom, dateTo, orgUuid }), [dateFrom, dateTo, orgUuid]);

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
    () =>
      data?.totals ??
      rows.reduce(
        (a, r) => ({
          salesCount: a.salesCount + r.salesCount,
          salesAmount: a.salesAmount + r.salesAmount,
          returnsCount: a.returnsCount + r.returnsCount,
          returnsAmount: a.returnsAmount + r.returnsAmount,
          netAmount: a.netAmount + r.netAmount,
          cogs: a.cogs + r.cogs,
          netRevenue: a.netRevenue + r.netRevenue,
          grossProfit: a.grossProfit + r.grossProfit,
        }),
        { salesCount: 0, salesAmount: 0, returnsCount: 0, returnsAmount: 0, netAmount: 0, cogs: 0, netRevenue: 0, grossProfit: 0 },
      ),
    [data, rows],
  );

  const period = monthLabel(dateFrom, dateTo);

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="mr_from" value={dateFrom} onChange={e => setDateFrom(e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="mr_to" value={dateTo} onChange={e => setDateTo(e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="mr_org" value={orgUuid} displayValue={orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }}
          onClear={() => { setOrgUuid(""); setOrgName(""); }} />
      </GroupCol>
    </>
  );

  const layout = (
    <div className={styles.Report}>
      {orgName && <div className={styles.OrgName}>{orgName}</div>}
      <div className={styles.Title}>
        {translate("managerReportTitle")}
        {period && <> за {period}</>}
      </div>

      <table className={styles.Table}>
        <thead>
          <tr>
            <th className={styles.ColN}>№</th>
            <th className={styles.ColName}>{translate("manager")}</th>
            <th className={styles.ColNum}>{translate("reportSalesCount")}</th>
            <th className={styles.ColNum}>{translate("reportAmountSale")}</th>
            <th className={styles.ColNum}>{translate("reportReturnsCount")}</th>
            <th className={styles.ColNum}>{translate("reportAmountReturn")}</th>
            <th className={styles.ColNum}>{translate("reportAmountNet")}</th>
            <th className={styles.ColNum}>{translate("reportCogs")}</th>
            <th className={styles.ColNum}>{translate("reportGrossProfit")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.managerUuid ?? idx}>
              <td className={styles.ColN}>{idx + 1}</td>
              <td className={styles.ColName}>{row.managerName}</td>
              <td className={styles.ColNum}>{fmtInt(row.salesCount)}</td>
              <td className={styles.ColNum}>{fmtAmt(row.salesAmount)}</td>
              <td className={styles.ColNum}>{fmtInt(row.returnsCount)}</td>
              <td className={styles.ColNum}>{fmtAmt(row.returnsAmount)}</td>
              <td className={styles.ColNum}>{fmtAmt(row.netAmount)}</td>
              <td className={styles.ColNum}>{fmtAmt(row.cogs)}</td>
              <td className={styles.ColNum}>{fmtAmt(row.grossProfit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={styles.TotalRow}>
            <td colSpan={2}>{translate("total")}</td>
            <td className={styles.ColNum}>{fmtInt(totals.salesCount)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.salesAmount)}</td>
            <td className={styles.ColNum}>{fmtInt(totals.returnsCount)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.returnsAmount)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.netAmount)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.cogs)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.grossProfit)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
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
