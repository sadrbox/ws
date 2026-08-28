/**
 * XYZReport — совмещённый ABC-XYZ анализ номенклатуры.
 *   ABC — вклад в выручку (нетто): A до 80%, B до 95%, C — остальное.
 *   XYZ — стабильность спроса по коэффициенту вариации (CV) помесячного
 *         НЕТТО-спроса: X ≤ 10%, Y ≤ 25%, Z > 25% (или нерегулярный/нулевой).
 * Источник — /reports/sales-by-product-xyz (помесячные количества, месяцы без
 * продаж = 0, поэтому разовая продажа классифицируется как Z, а не «стабильная»).
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
import { fmtPct } from "./_shared/reportFormat";
import { abcClass, xyzClass, coeffVariation, seriesMean, type ABC, type XYZ } from "./_shared/xyz";
import reportCss from "./report.module.scss?inline";

interface SrcRow { productUuid: string | null; productName: string; uom: string; amountNet: number; monthly: number[] }
interface Row {
  productUuid: string | null; productName: string; uom: string;
  amount: number; share: number; cum: number; abc: ABC;
  demandMonths: number; meanQty: number; cv: number | null; xyz: XYZ;
}
interface Filters extends Record<string, unknown> { dateFrom: string; dateTo: string; orgUuid: string; orgName: string }
interface Props { uniqId?: string;[key: string]: unknown }

const XYZReport: FC<Props> = ({ uniqId }) => {
  const def = useDefaultOrganization();

  const { fields, setField, patch, applied, handleGenerate } = useReportFilters<Filters>({
    persistKey: "report.xyz",
    defaults: { dateFrom: firstOfMonth(), dateTo: today(), orgUuid: def.organizationUuid || "", orgName: def.organizationName || "" },
  });
  const drill = useReportDrill({ applied, orgName: fields.orgName });

  const { data, isLoading, isError } = useQuery<SrcRow[]>({
    queryKey: ["report-xyz", applied],
    queryFn: async () => {
      const p: Record<string, string> = {};
      if (applied!.dateFrom) p.dateFrom = applied!.dateFrom;
      if (applied!.dateTo) p.dateTo = applied!.dateTo;
      if (applied!.orgUuid) p.organizationUuid = applied!.orgUuid;
      const resp = await api.get<{ items?: SrcRow[] }>("reports/sales-by-product-xyz", { params: p });
      return resp?.items ?? [];
    },
    enabled: !!applied,
    retry: 1,
  });

  const { rows, total, matrix } = useMemo(() => {
    const src = (data ?? []).map((r) => ({ ...r, amount: Number(r.amountNet) || 0 }));
    // ABC — по вкладу в выручку среди позиций с положительной нетто-суммой.
    const abcSrc = src.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
    const total = abcSrc.reduce((s, r) => s + r.amount, 0);
    const abcByUuid = new Map<string, { share: number; cum: number; abc: ABC }>();
    let cum = 0;
    for (const r of abcSrc) {
      const share = total > 0 ? (r.amount / total) * 100 : 0;
      cum += share;
      abcByUuid.set(r.productUuid ?? r.productName, { share, cum, abc: abcClass(cum) });
    }

    const rows: Row[] = src.map((r) => {
      const cv = coeffVariation(r.monthly);
      const demandMonths = r.monthly.filter((x) => x > 0).length;
      const meanQty = seriesMean(r.monthly);
      const abcInfo = abcByUuid.get(r.productUuid ?? r.productName);
      return {
        productUuid: r.productUuid, productName: r.productName, uom: r.uom,
        amount: r.amount, share: abcInfo?.share ?? 0, cum: abcInfo?.cum ?? 0, abc: abcInfo?.abc ?? "C",
        demandMonths, meanQty, cv, xyz: xyzClass(cv),
      };
    }).sort((a, b) => b.amount - a.amount || a.productName.localeCompare(b.productName, "ru"));

    // 3×3 матрица счётчиков позиций по совмещённому классу.
    const matrix: Record<ABC, Record<XYZ, number>> = {
      A: { X: 0, Y: 0, Z: 0 }, B: { X: 0, Y: 0, Z: 0 }, C: { X: 0, Y: 0, Z: 0 },
    };
    for (const r of rows) matrix[r.abc][r.xyz]++;
    return { rows, total, matrix };
  }, [data]);

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="xyz_from" value={fields.dateFrom} onChange={e => setField("dateFrom", e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="xyz_to" value={fields.dateTo} onChange={e => setField("dateTo", e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="xyz_org" value={fields.orgUuid} displayValue={fields.orgName} endpoint="organizations" displayField="name"
          onSelect={(u, d) => patch({ orgUuid: u, orgName: d })} onClear={() => patch({ orgUuid: "", orgName: "" })} />
      </GroupCol>
    </>
  );

  const layout = (
    <ReportSheet
      org={fields.orgName || undefined}
      title={translate("xyzAnalysis")}
      summary={(
        <table style={{ borderCollapse: "collapse", fontSize: "0.85em" }}>
          <thead>
            <tr>
              <th style={{ padding: "1px 6px", textAlign: "left" }}>ABC \ XYZ</th>
              {(["X", "Y", "Z"] as const).map((x) => <th key={x} style={{ padding: "1px 6px", textAlign: "center" }}>{x}</th>)}
            </tr>
          </thead>
          <tbody>
            {(["A", "B", "C"] as const).map((a) => (
              <tr key={a}>
                <td style={{ padding: "1px 6px", fontWeight: 600 }}>{a}</td>
                {(["X", "Y", "Z"] as const).map((x) => (
                  <td key={x} style={{ padding: "1px 6px", textAlign: "center" }}>{matrix[a][x] || ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    >
      <ReportTable>
        <thead>
          <tr>
            <Th col="n">№</Th>
            <Th col="name">{translate("reportProduct")}</Th>
            <Th col="num">{translate("reportAmountNet")}</Th>
            <Th col="num">{translate("abcShare")}</Th>
            <Th col="num">{translate("abcClass")}</Th>
            <Th col="num">{translate("xyzDemandMonths")}</Th>
            <Th col="num">{translate("xyzMeanQty")}</Th>
            <Th col="num">{translate("xyzVariation")}</Th>
            <Th col="num">{translate("xyzClass")}</Th>
            <Th col="num">{translate("abcXyzClass")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.productUuid ?? idx}>
              <Td col="n">{idx + 1}</Td>
              <Td col="name">
                {r.productUuid
                  ? <DrillLink onOpen={() => drill.toReport("product-detail", { productUuid: r.productUuid, productName: r.productName })}>{r.productName}</DrillLink>
                  : r.productName}
              </Td>
              <Td col="num"><Money value={r.amount} /></Td>
              <Td col="num">{fmtPct(r.share)}</Td>
              <Td col="num"><b>{r.abc}</b></Td>
              <Td col="num">{r.demandMonths}</Td>
              <Td col="num">{r.meanQty > 0 ? r.meanQty.toLocaleString("ru", { maximumFractionDigits: 3 }) : "—"}</Td>
              <Td col="num">{r.cv === null ? "—" : fmtPct(r.cv * 100)}</Td>
              <Td col="num"><b>{r.xyz}</b></Td>
              <Td col="num"><b>{r.abc}{r.xyz}</b></Td>
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
            <Td col="num" />
            <Td col="num" />
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
      fileBaseName={translate("xyzAnalysis")}
      title={translate("xyzAnalysis")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

XYZReport.displayName = "XYZReport";
export { XYZReport };
export default XYZReport;
