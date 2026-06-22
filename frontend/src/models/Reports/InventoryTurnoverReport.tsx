/**
 * InventoryTurnoverReport — оборачиваемость склада по товарам.
 * Источник — /reports/material-statement. Оборачиваемость = COGS / средний остаток;
 * дней запаса = дней в периоде / оборачиваемость.
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
import { useReportFilters } from "./_shared/useReportFilters";
import { firstOfMonth, today } from "./_shared/reportDates";
import reportCss from "./report.module.scss?inline";

// Локальные: коэффициент оборачиваемости (раз) и дни запаса (целое).
const fmtR = (n: number) => n > 0 ? Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const fmtD = (n: number) => Number.isFinite(n) && n > 0 ? Math.round(n).toLocaleString("ru-KZ") : "—";

interface MsRow { productUuid: string | null; productName: string; openAmount: number; closeAmount: number; cogsOut: number }
interface Row { productUuid: string | null; productName: string; openAmount: number; closeAmount: number; avg: number; cogs: number; ratio: number; days: number }
interface Filters extends Record<string, unknown> { dateFrom: string; dateTo: string; orgUuid: string; orgName: string; whUuid: string; whName: string }
interface Props { uniqId?: string;[key: string]: unknown }

const InventoryTurnoverReport: FC<Props> = ({ uniqId }) => {
  const def = useDefaultOrganization();

  const { fields, setField, patch, applied, handleGenerate } = useReportFilters<Filters>({
    persistKey: "report.turnover",
    defaults: { dateFrom: firstOfMonth(), dateTo: today(), orgUuid: def.organizationUuid || "", orgName: def.organizationName || "", whUuid: "", whName: "" },
  });

  const periodDays = useMemo(() => {
    if (!applied?.dateFrom || !applied?.dateTo) return 30;
    const d = (new Date(applied.dateTo).getTime() - new Date(applied.dateFrom).getTime()) / 86400000 + 1;
    return d > 0 ? d : 30;
  }, [applied]);

  const { data, isLoading, isError } = useQuery<MsRow[]>({
    queryKey: ["report-turnover", applied],
    queryFn: async () => {
      const p: Record<string, string> = {};
      const f = applied!;
      if (f.dateFrom) p.dateFrom = f.dateFrom;
      if (f.dateTo) p.dateTo = f.dateTo;
      if (f.orgUuid) p.organizationUuid = f.orgUuid;
      if (f.whUuid) p.warehouseUuid = f.whUuid;
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
        <FieldDate label={translate("reportPeriodFrom")} name="tn_from" value={fields.dateFrom} onChange={e => setField("dateFrom", e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="tn_to" value={fields.dateTo} onChange={e => setField("dateTo", e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="tn_org" value={fields.orgUuid} displayValue={fields.orgName} endpoint="organizations" displayField="name"
          onSelect={(u, d) => patch({ orgUuid: u, orgName: d })} onClear={() => patch({ orgUuid: "", orgName: "" })} />
        <LookupField label={translate("warehouse")} name="tn_wh" value={fields.whUuid} displayValue={fields.whName} endpoint="warehouses" displayField="name"
          extraParams={fields.orgUuid ? { organizationUuid: fields.orgUuid } : undefined}
          onSelect={(u, d) => patch({ whUuid: u, whName: d })} onClear={() => patch({ whUuid: "", whName: "" })} />
      </GroupCol>
    </>
  );

  const layout = (
    <ReportSheet org={fields.orgName || undefined} title={translate("inventoryTurnover")}>
      <ReportTable>
        <thead>
          <tr>
            <Th col="n">№</Th>
            <Th col="name">{translate("reportProduct")}</Th>
            <Th col="num">{translate("openingBalance")}</Th>
            <Th col="num">{translate("closingBalance")}</Th>
            <Th col="num">{translate("avgStock")}</Th>
            <Th col="num">{translate("reportCogs")}</Th>
            <Th col="num">{translate("turnoverTimes")}</Th>
            <Th col="num">{translate("daysOfStock")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.productUuid ?? idx}>
              <Td col="n">{idx + 1}</Td>
              <Td col="name">{r.productName}</Td>
              <Td col="num"><Money value={r.openAmount} /></Td>
              <Td col="num"><Money value={r.closeAmount} /></Td>
              <Td col="num"><Money value={r.avg} /></Td>
              <Td col="num"><Money value={r.cogs} /></Td>
              <Td col="num">{fmtR(r.ratio)}</Td>
              <Td col="num">{fmtD(r.days)}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <TotalRow>
            <Td colSpan={2}>{translate("total")}</Td>
            <Td col="num"><Money value={totals.openAmount} as="zeroMoney" /></Td>
            <Td col="num"><Money value={totals.closeAmount} as="zeroMoney" /></Td>
            <Td col="num"><Money value={totals.avg} as="zeroMoney" /></Td>
            <Td col="num"><Money value={totals.cogs} as="zeroMoney" /></Td>
            <Td col="num">{fmtR(totalRatio)}</Td>
            <Td col="num">{fmtD(totalRatio > 0 ? periodDays / totalRatio : 0)}</Td>
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
