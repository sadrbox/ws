/**
 * InventoryTurnoverReport — оборачиваемость склада по товарам.
 * Источник — /reports/material-statement (остатки + себестоимость списания по
 * скользящей средней). Метрики:
 *   средний остаток = (остаток нач. + остаток кон.) / 2
 *   оборачиваемость (раз) = себестоимость списания / средний остаток
 *   дней запаса = дней в периоде / оборачиваемость
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

const fmt = (n: number) => n !== 0 ? Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const fmtZ = (n: number) => Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtR = (n: number) => n > 0 ? Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const fmtD = (n: number) => Number.isFinite(n) && n > 0 ? Math.round(n).toLocaleString("ru-KZ") : "—";

interface MsRow { productUuid: string | null; productName: string; openAmount: number; closeAmount: number; cogsOut: number }
interface Row { productUuid: string | null; productName: string; openAmount: number; closeAmount: number; avg: number; cogs: number; ratio: number; days: number }

interface Props { uniqId?: string; [key: string]: unknown }

const InventoryTurnoverReport: FC<Props> = ({ uniqId }) => {
  const { organizationUuid: defOrg, organizationName: defOrgName } = useDefaultOrganization();

  const [dateFrom, setDateFrom] = usePersistentState("report.turnover.dateFrom", () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); });
  const [dateTo, setDateTo] = usePersistentState("report.turnover.dateTo", () => new Date().toISOString().slice(0, 10));
  const [orgUuid, setOrgUuid] = usePersistentState("report.turnover.orgUuid", defOrg || "");
  const [orgName, setOrgName] = usePersistentState("report.turnover.orgName", defOrgName || "");
  const [whUuid, setWhUuid] = useState("");
  const [whName, setWhName] = useState("");

  const [applied, setApplied] = useState<null | { dateFrom: string; dateTo: string; orgUuid: string; whUuid: string }>(null);
  const handleGenerate = useCallback(() => setApplied({ dateFrom, dateTo, orgUuid, whUuid }), [dateFrom, dateTo, orgUuid, whUuid]);

  const periodDays = useMemo(() => {
    if (!applied?.dateFrom || !applied?.dateTo) return 30;
    const d = (new Date(applied.dateTo).getTime() - new Date(applied.dateFrom).getTime()) / 86400000 + 1;
    return d > 0 ? d : 30;
  }, [applied]);

  const { data, isLoading, isError } = useQuery<MsRow[]>({
    queryKey: ["report-turnover", applied],
    queryFn: async () => {
      const p: Record<string, string> = {};
      if (applied!.dateFrom) p.dateFrom = applied!.dateFrom;
      if (applied!.dateTo) p.dateTo = applied!.dateTo;
      if (applied!.orgUuid) p.organizationUuid = applied!.orgUuid;
      if (applied!.whUuid) p.warehouseUuid = applied!.whUuid;
      const resp = await api.get<any>("reports/material-statement", { params: p });
      return resp?.items ?? [];
    },
    enabled: !!applied,
    retry: 1,
  });

  const rows: Row[] = useMemo(() => (data ?? []).map((r) => {
    const avg = (Number(r.openAmount) + Number(r.closeAmount)) / 2;
    const cogs = Number(r.cogsOut) || 0;
    const ratio = avg > 0 ? cogs / avg : 0;
    const days = ratio > 0 ? periodDays / ratio : 0;
    return { productUuid: r.productUuid, productName: r.productName, openAmount: Number(r.openAmount) || 0, closeAmount: Number(r.closeAmount) || 0, avg, cogs, ratio, days };
  }).filter((r) => r.openAmount || r.closeAmount || r.cogs).sort((a, b) => b.ratio - a.ratio), [data, periodDays]);

  const totals = useMemo(() => rows.reduce((t, r) => ({ openAmount: t.openAmount + r.openAmount, closeAmount: t.closeAmount + r.closeAmount, avg: t.avg + r.avg, cogs: t.cogs + r.cogs }), { openAmount: 0, closeAmount: 0, avg: 0, cogs: 0 }), [rows]);
  const totalRatio = totals.avg > 0 ? totals.cogs / totals.avg : 0;

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="tn_from" value={dateFrom} onChange={e => setDateFrom(e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="tn_to" value={dateTo} onChange={e => setDateTo(e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="tn_org" value={orgUuid} displayValue={orgName} endpoint="organizations" displayField="name"
          onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }} onClear={() => { setOrgUuid(""); setOrgName(""); }} />
        <LookupField label={translate("warehouse")} name="tn_wh" value={whUuid} displayValue={whName} endpoint="warehouses" displayField="name"
          extraParams={orgUuid ? { organizationUuid: orgUuid } : undefined}
          onSelect={(u, d) => { setWhUuid(u); setWhName(d); }} onClear={() => { setWhUuid(""); setWhName(""); }} />
      </GroupCol>
    </>
  );

  const layout = (
    <div className={styles.Report}>
      {orgName && <div className={styles.OrgName}>{orgName}</div>}
      <div className={styles.Title}>{translate("inventoryTurnover")}</div>
      <table className={styles.Table}>
        <thead>
          <tr>
            <th className={styles.ColN}>№</th>
            <th className={styles.ColName}>{translate("reportProduct")}</th>
            <th className={styles.ColNum}>{translate("openingBalance")}</th>
            <th className={styles.ColNum}>{translate("closingBalance")}</th>
            <th className={styles.ColNum}>{translate("avgStock")}</th>
            <th className={styles.ColNum}>{translate("reportCogs")}</th>
            <th className={styles.ColNum}>{translate("turnoverTimes")}</th>
            <th className={styles.ColNum}>{translate("daysOfStock")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.productUuid ?? idx}>
              <td className={styles.ColN}>{idx + 1}</td>
              <td className={styles.ColName}>{r.productName}</td>
              <td className={styles.ColNum}>{fmt(r.openAmount)}</td>
              <td className={styles.ColNum}>{fmt(r.closeAmount)}</td>
              <td className={styles.ColNum}>{fmt(r.avg)}</td>
              <td className={styles.ColNum}>{fmt(r.cogs)}</td>
              <td className={styles.ColNum}>{fmtR(r.ratio)}</td>
              <td className={styles.ColNum}>{fmtD(r.days)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={styles.TotalRow}>
            <td colSpan={2}>{translate("total")}</td>
            <td className={styles.ColNum}>{fmtZ(totals.openAmount)}</td>
            <td className={styles.ColNum}>{fmtZ(totals.closeAmount)}</td>
            <td className={styles.ColNum}>{fmtZ(totals.avg)}</td>
            <td className={styles.ColNum}>{fmtZ(totals.cogs)}</td>
            <td className={styles.ColNum}>{fmtR(totalRatio)}</td>
            <td className={styles.ColNum}>{fmtD(totalRatio > 0 ? periodDays / totalRatio : 0)}</td>
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
      fileBaseName={translate("inventoryTurnover")}
      title={translate("inventoryTurnover")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

InventoryTurnoverReport.displayName = "InventoryTurnoverReport";
export { InventoryTurnoverReport };
export default InventoryTurnoverReport;
