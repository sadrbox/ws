/**
 * ABCReport — ABC-анализ номенклатуры по вкладу в выручку (нетто).
 * Источник — /reports/sales-by-product. Класс: A до 80%, B до 95%, C — остальное.
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
import { fmtMoney, fmtPct } from "./_shared/reportFormat";
import reportCss from "./report.module.scss?inline";

interface SrcRow { productUuid: string | null; productName: string; amountNet: number; qtyNet: number }
interface Row { productUuid: string | null; productName: string; amount: number; share: number; cum: number; abc: "A" | "B" | "C" }
interface Filters extends Record<string, unknown> { dateFrom: string; dateTo: string; orgUuid: string; orgName: string }
interface Props { uniqId?: string;[key: string]: unknown }

const classOf = (cum: number): "A" | "B" | "C" => (cum <= 80 ? "A" : cum <= 95 ? "B" : "C");

const ABCReport: FC<Props> = ({ uniqId }) => {
  const def = useDefaultOrganization();

  const { fields, setField, patch, applied, handleGenerate } = useReportFilters<Filters>({
    persistKey: "report.abc",
    defaults: { dateFrom: firstOfMonth(), dateTo: today(), orgUuid: def.organizationUuid || "", orgName: def.organizationName || "" },
  });

  const { data, isLoading, isError } = useQuery<SrcRow[]>({
    queryKey: ["report-abc", applied],
    queryFn: async () => {
      const p: Record<string, string> = {};
      if (applied!.dateFrom) p.dateFrom = applied!.dateFrom;
      if (applied!.dateTo) p.dateTo = applied!.dateTo;
      if (applied!.orgUuid) p.organizationUuid = applied!.orgUuid;
      const resp = await api.get<any>("reports/sales-by-product", { params: p });
      return resp?.items ?? [];
    },
    enabled: !!applied,
    retry: 1,
  });

  const { rows, total, classTotals } = useMemo(() => {
    const src = (data ?? []).map((r) => ({ ...r, amount: Number(r.amountNet) || 0 })).filter((r) => r.amount > 0);
    const total = src.reduce((s, r) => s + r.amount, 0);
    src.sort((a, b) => b.amount - a.amount);
    let cum = 0;
    const rows: Row[] = src.map((r) => {
      const share = total > 0 ? (r.amount / total) * 100 : 0;
      cum += share;
      return { productUuid: r.productUuid, productName: r.productName, amount: r.amount, share, cum, abc: classOf(cum) };
    });
    const classTotals = { A: { n: 0, amount: 0 }, B: { n: 0, amount: 0 }, C: { n: 0, amount: 0 } };
    for (const r of rows) { classTotals[r.abc].n++; classTotals[r.abc].amount += r.amount; }
    return { rows, total, classTotals };
  }, [data]);

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="abc_from" value={fields.dateFrom} onChange={e => setField("dateFrom", e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="abc_to" value={fields.dateTo} onChange={e => setField("dateTo", e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="abc_org" value={fields.orgUuid} displayValue={fields.orgName} endpoint="organizations" displayField="name"
          onSelect={(u, d) => patch({ orgUuid: u, orgName: d })} onClear={() => patch({ orgUuid: "", orgName: "" })} />
      </GroupCol>
    </>
  );

  const layout = (
    <ReportSheet
      org={fields.orgName || undefined}
      title={translate("abcAnalysis")}
      summary={(["A", "B", "C"] as const).map((c) => (
        <span key={c}><b>{c}</b>: {classTotals[c].n} {translate("abcPositions")} - {fmtMoney(classTotals[c].amount)} ({fmtPct(total > 0 ? (classTotals[c].amount / total) * 100 : 0)})</span>
      ))}
    >
      <ReportTable>
        <thead>
          <tr>
            <Th col="n">№</Th>
            <Th col="name">{translate("reportProduct")}</Th>
            <Th col="num">{translate("reportAmountNet")}</Th>
            <Th col="num">{translate("abcShare")}</Th>
            <Th col="num">{translate("abcCumulative")}</Th>
            <Th col="num">{translate("abcClass")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.productUuid ?? idx}>
              <Td col="n">{idx + 1}</Td>
              <Td col="name">{r.productName}</Td>
              <Td col="num"><Money value={r.amount} /></Td>
              <Td col="num">{fmtPct(r.share)}</Td>
              <Td col="num">{fmtPct(r.cum)}</Td>
              <Td col="num"><b>{r.abc}</b></Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <TotalRow>
            <Td colSpan={2}>{translate("total")}</Td>
            <Td col="num"><Money value={total} as="zeroMoney" /></Td>
            <Td col="num">100,0%</Td>
            <Td col="num" />
            <Td col="num" />
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
      fileBaseName={translate("abcAnalysis")}
      title={translate("abcAnalysis")}
      orientation="portrait"
      sheetFit="content"
    />
  );
};

ABCReport.displayName = "ABCReport";
export { ABCReport };
export default ABCReport;
