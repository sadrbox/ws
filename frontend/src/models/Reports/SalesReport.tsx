/**
 * Отчёт о продажах по номенклатуре за период. ДВОЙНОЙ клик по строке открывает
 * «Движение товара» (период/орг переносятся).
 */
import { FC, useMemo, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import ReportPane from "src/components/ReportPane";
import { ReportSheet, ReportTable, Th, Td, TotalRow, Money } from "./_shared/reportLayout";
import { useReportDrill, DrillRow } from "./_shared/reportDrill";
import { useReportFilters } from "./_shared/useReportFilters";
import { firstOfMonth, today } from "./_shared/reportDates";
import { fmtQty, fmtQtyZero } from "./_shared/reportFormat";
import reportCss from "./report.module.scss?inline";

interface ProductRow {
  productUuid: string | null; productName: string; uom: string;
  qtySale: number; qtyReturn: number; qtyNet: number;
  amountSale: number; amountReturn: number; amountNet: number;
  exciseAmountSale: number; vatAmountSale: number; amountNoTaxSale: number;
  costNoVat: number; profit: number;
}
interface Filters extends Record<string, unknown> {
  dateFrom: string; dateTo: string; orgUuid: string; orgName: string; cptyUuid: string; cptyName: string;
}
interface SalesReportProps { uniqId?: string;[key: string]: unknown }

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

const SalesReport: FC<SalesReportProps> = ({ uniqId }) => {
  const def = useDefaultOrganization();

  const { fields, setField, patch, applied, handleGenerate } = useReportFilters<Filters>({
    persistKey: "report.sales-report",
    defaults: { dateFrom: firstOfMonth(), dateTo: today(), orgUuid: def.organizationUuid || "", orgName: def.organizationName || "", cptyUuid: "", cptyName: "" },
  });
  const drill = useReportDrill({ applied, orgName: fields.orgName });

  const { data, isLoading, isError } = useQuery<{ items: ProductRow[]; orgName: string }>({
    queryKey: ["report-sales-by-product", applied],
    queryFn: async () => {
      const p: Record<string, string> = {};
      const f = applied!;
      if (f.dateFrom) p.dateFrom = f.dateFrom;
      if (f.dateTo) p.dateTo = f.dateTo;
      if (f.orgUuid) p.organizationUuid = f.orgUuid;
      if (f.cptyUuid) p.counterpartyUuid = f.cptyUuid;
      const resp = await api.get<any>("reports/sales-by-product", { params: p });
      return { items: resp?.items ?? [], orgName: resp?.orgName ?? "" };
    },
    enabled: !!applied,
    retry: 1,
  });

  const rows: ProductRow[] = data?.items ?? [];
  const reportOrgName = data?.orgName || fields.orgName;

  const totals = useMemo(
    () => rows.reduce((acc, r) => ({
      qtySale: acc.qtySale + r.qtySale, qtyReturn: acc.qtyReturn + r.qtyReturn, qtyNet: acc.qtyNet + r.qtyNet,
      amountSale: acc.amountSale + r.amountSale, amountReturn: acc.amountReturn + r.amountReturn, amountNet: acc.amountNet + r.amountNet,
      exciseAmountSale: acc.exciseAmountSale + r.exciseAmountSale, vatAmountSale: acc.vatAmountSale + r.vatAmountSale,
      amountNoTaxSale: acc.amountNoTaxSale + r.amountNoTaxSale, costNoVat: acc.costNoVat + r.costNoVat, profit: acc.profit + r.profit,
    }), { qtySale: 0, qtyReturn: 0, qtyNet: 0, amountSale: 0, amountReturn: 0, amountNet: 0, exciseAmountSale: 0, vatAmountSale: 0, amountNoTaxSale: 0, costNoVat: 0, profit: 0 }),
    [rows],
  );

  const period = monthLabel(fields.dateFrom, fields.dateTo);

  const cells = (row: ProductRow, idx: number): ReactNode => (
    <>
      <Td col="n">{idx + 1}</Td>
      <Td col="name">{row.productName}</Td>
      <Td col="num">{fmtQty(row.qtySale)}</Td>
      <Td col="num">{fmtQty(row.qtyReturn)}</Td>
      <Td col="num">{fmtQty(row.qtyNet)}</Td>
      <Td col="num"><Money value={row.amountSale} /></Td>
      <Td col="num"><Money value={row.amountReturn} /></Td>
      <Td col="num"><Money value={row.amountNet} /></Td>
      <Td col="num"><Money value={row.exciseAmountSale} /></Td>
      <Td col="num"><Money value={row.vatAmountSale} /></Td>
      <Td col="num"><Money value={row.amountNoTaxSale} /></Td>
      <Td col="num"><Money value={row.costNoVat} /></Td>
      <Td col="num"><Money value={row.profit} /></Td>
    </>
  );

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="sf_from" value={fields.dateFrom} onChange={e => setField("dateFrom", e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="sf_to" value={fields.dateTo} onChange={e => setField("dateTo", e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="sf_org" value={fields.orgUuid} displayValue={fields.orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => patch({ orgUuid: u, orgName: d })} onClear={() => patch({ orgUuid: "", orgName: "" })} />
        <LookupField label={translate("counterparty")} name="sf_cpty" value={fields.cptyUuid} displayValue={fields.cptyName}
          endpoint="counterparties" displayField="name"
          onSelect={(u, d) => patch({ cptyUuid: u, cptyName: d })} onClear={() => patch({ cptyUuid: "", cptyName: "" })} />
      </GroupCol>
    </>
  );

  const layout = (
    <ReportSheet
      org={reportOrgName || undefined}
      title={<>{translate("reportSalesTitle")}{period && <> за {period}</>}</>}
      sortLine={fields.orgName ? `${translate("reportSortBy")} ${translate("organization")} — ${fields.orgName}` : undefined}
    >
      <ReportTable>
        <thead>
          <tr>
            <Th col="n">№</Th>
            <Th col="name">{translate("reportProduct")}</Th>
            <Th col="num">{translate("reportQtySale")}</Th>
            <Th col="num">{translate("reportQtyReturn")}</Th>
            <Th col="num">{translate("reportQtyNet")}</Th>
            <Th col="num">{translate("reportAmountSale")}</Th>
            <Th col="num">{translate("reportAmountReturn")}</Th>
            <Th col="num">{translate("reportAmountNet")}</Th>
            <Th col="num">{translate("reportAmountExcise")}</Th>
            <Th col="num">{translate("reportVatAmount")}</Th>
            <Th col="num">{translate("reportAmountNoTax")}</Th>
            <Th col="num">{translate("reportCostNoVat")}</Th>
            <Th col="num">{translate("reportProfit")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            row.productUuid
              ? <DrillRow key={row.productUuid} title={translate("reportProductMovements")}
                  onOpen={() => drill.toReport("product-detail", { productUuid: row.productUuid, productName: row.productName })}>
                  {cells(row, idx)}
                </DrillRow>
              : <tr key={idx}>{cells(row, idx)}</tr>
          ))}
        </tbody>
        <tfoot>
          <TotalRow>
            <Td colSpan={2}>{translate("total")}</Td>
            <Td col="num">{fmtQtyZero(totals.qtySale)}</Td>
            <Td col="num">{fmtQtyZero(totals.qtyReturn)}</Td>
            <Td col="num">{fmtQtyZero(totals.qtyNet)}</Td>
            <Td col="num"><Money value={totals.amountSale} as="zeroMoney" /></Td>
            <Td col="num"><Money value={totals.amountReturn} as="zeroMoney" /></Td>
            <Td col="num"><Money value={totals.amountNet} as="zeroMoney" /></Td>
            <Td col="num"><Money value={totals.exciseAmountSale} as="zeroMoney" /></Td>
            <Td col="num"><Money value={totals.vatAmountSale} as="zeroMoney" /></Td>
            <Td col="num"><Money value={totals.amountNoTaxSale} as="zeroMoney" /></Td>
            <Td col="num"><Money value={totals.costNoVat} as="zeroMoney" /></Td>
            <Td col="num"><Money value={totals.profit} as="zeroMoney" /></Td>
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
      fileBaseName={translate("SalesReportList")}
      title={translate("SalesReportList")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

SalesReport.displayName = "SalesReport";
export { SalesReport };
