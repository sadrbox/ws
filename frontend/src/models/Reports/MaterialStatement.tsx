/**
 * Материальная ведомость (оборотная) — движение ТМЗ за период.
 * ДВОЙНОЙ клик: по наименованию → карточка номенклатуры; по сумме → «Движение
 * товара» (период/орг переносятся). НК РК ст. 242 п.1.
 */
import { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupRow, GroupCol } from "src/components/UI";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import ReportPane from "src/components/ReportPane";
import { ReportSheet, ReportTable, Th, Td, TotalRow, Money } from "./_shared/reportLayout";
import { useReportDrill, DrillLink } from "./_shared/reportDrill";
import { useReportFilters } from "./_shared/useReportFilters";
import { firstOfMonth, today } from "./_shared/reportDates";
import { fmtNum, fmtQty, fmtQtyZero, fmtPeriod } from "./_shared/reportFormat";
import reportCss from "./report.module.scss?inline";

interface ProductMovement {
  productUuid: string; productName: string; sku: string; accountCode: string; uom: string;
  unitCost: number; openQty: number; openAmount: number; inQty: number; inAmount: number;
  outQty: number; cogsOut: number; salePrice: number; saleAmount: number; profit: number;
  closeQty: number; closeAmount: number;
}
interface Filters extends Record<string, unknown> {
  dateFrom: string; dateTo: string; orgUuid: string; orgName: string;
  warehouseUuid: string; warehouseName: string;
}
interface MaterialStatementProps { uniqId?: string;[key: string]: unknown }

const MaterialStatement: FC<MaterialStatementProps> = ({ uniqId }) => {
  const def = useDefaultOrganization();

  const { fields, setField, patch, applied, handleGenerate } = useReportFilters<Filters>({
    persistKey: "report.material-statement",
    defaults: { dateFrom: firstOfMonth(), dateTo: today(), orgUuid: def.organizationUuid || "", orgName: def.organizationName || "", warehouseUuid: "", warehouseName: "" },
  });
  const drill = useReportDrill({ applied, orgName: fields.orgName });

  const { data: movements = [], isLoading } = useQuery<ProductMovement[]>({
    queryKey: ["report-material", applied],
    queryFn: async () => {
      const p: Record<string, string> = {};
      const f = applied!;
      if (f.dateFrom) p.dateFrom = f.dateFrom;
      if (f.dateTo) p.dateTo = f.dateTo;
      if (f.orgUuid) p.organizationUuid = f.orgUuid;
      if (f.warehouseUuid) p.warehouseUuid = f.warehouseUuid;
      const resp = await api.get<any>("reports/material-statement", { params: p });
      return resp?.items ?? [];
    },
    enabled: !!applied,
  });

  const totals = movements.reduce(
    (acc, r) => ({
      openQty: acc.openQty + r.openQty, openAmount: acc.openAmount + r.openAmount,
      inQty: acc.inQty + r.inQty, inAmount: acc.inAmount + r.inAmount,
      outQty: acc.outQty + r.outQty, cogsOut: acc.cogsOut + r.cogsOut,
      saleAmount: acc.saleAmount + r.saleAmount, profit: acc.profit + r.profit,
      closeQty: acc.closeQty + r.closeQty, closeAmount: acc.closeAmount + r.closeAmount,
    }),
    { openQty: 0, openAmount: 0, inQty: 0, inAmount: 0, outQty: 0, cogsOut: 0, saleAmount: 0, profit: 0, closeQty: 0, closeAmount: 0 },
  );

  const period = fmtPeriod(fields.dateFrom, fields.dateTo);

  // Сумма-ссылка на «Движение товара».
  const linkSum = (row: ProductMovement, value: number) => (
    <DrillLink onOpen={() => drill.toReport("product-detail", { productUuid: row.productUuid, productName: row.productName })}>{fmtNum(value)}</DrillLink>
  );

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="ms_from" value={fields.dateFrom} onChange={e => setField("dateFrom", e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="ms_to" value={fields.dateTo} onChange={e => setField("dateTo", e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="ms_org" value={fields.orgUuid} displayValue={fields.orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => patch({ orgUuid: u, orgName: d })} onClear={() => patch({ orgUuid: "", orgName: "" })} />
        <LookupField label={translate("warehouse")} name="ms_wh" value={fields.warehouseUuid} displayValue={fields.warehouseName}
          endpoint="warehouses" displayField="name"
          onSelect={(u, d) => patch({ warehouseUuid: u, warehouseName: d })} onClear={() => patch({ warehouseUuid: "", warehouseName: "" })}
          extraParams={fields.orgUuid ? { organizationUuid: fields.orgUuid } : undefined} />
      </GroupCol>
    </>
  );

  const layout = (
    <ReportSheet
      org={fields.orgName || undefined}
      title={translate("MaterialStatementList")}
      subTitle={period ? `${translate("reportPeriodLabel")} ${period}` : undefined}
      sortLine={fields.warehouseName ? `${translate("reportSortBy")} ${translate("warehouse")} — ${fields.warehouseName}` : undefined}
    >
      <ReportTable>
        <thead>
          <tr>
            <Th col="n">№</Th>
            <Th col="name">{translate("reportProduct")}</Th>
            <Th col="uom">{translate("reportAccount")}</Th>
            <Th col="uom">{translate("reportCode")}</Th>
            <Th col="uom">{translate("reportUom")}</Th>
            <Th col="num">{translate("reportCost")}</Th>
            <Th col="num">{translate("reportOpeningQty")}</Th>
            <Th col="num">{translate("reportOpeningAmount")}</Th>
            <Th col="num">{translate("reportQtyIn")}</Th>
            <Th col="num">{translate("reportAmountIn")}</Th>
            <Th col="num">{translate("reportQtyOut")}</Th>
            <Th col="num">{translate("reportCogsOut")}</Th>
            <Th col="num">{translate("reportSalePrice")}</Th>
            <Th col="num">{translate("reportSaleAmount")}</Th>
            <Th col="num">{translate("reportProfit")}</Th>
            <Th col="num">{translate("reportClosingQty")}</Th>
            <Th col="num">{translate("reportClosingAmount")}</Th>
          </tr>
        </thead>
        <tbody>
          {movements.map((row, idx) => (
            <tr key={row.productUuid}>
              <Td col="n">{idx + 1}</Td>
              <Td col="name">
                <DrillLink onOpen={() => drill.toEntity("products", row.productUuid)}>{row.productName}</DrillLink>
              </Td>
              <Td col="uom">{row.accountCode}</Td>
              <Td col="uom">{row.sku}</Td>
              <Td col="uom">{row.uom}</Td>
              <Td col="num" variant="cost"><Money value={row.unitCost} /></Td>
              <Td col="num">{fmtQty(row.openQty)}</Td>
              <Td col="num">{linkSum(row, row.openAmount)}</Td>
              <Td col="num">{fmtQty(row.inQty)}</Td>
              <Td col="num">{linkSum(row, row.inAmount)}</Td>
              <Td col="num">{fmtQty(row.outQty)}</Td>
              <Td col="num" variant="cost">{linkSum(row, row.cogsOut)}</Td>
              <Td col="num" variant="sale"><Money value={row.salePrice} /></Td>
              <Td col="num" variant="sale"><Money value={row.saleAmount} /></Td>
              <Td col="num" variant={row.profit < 0 ? "loss" : "profit"}><Money value={row.profit} /></Td>
              <Td col="num">{fmtQtyZero(row.closeQty)}</Td>
              <Td col="num">{linkSum(row, row.closeAmount)}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <TotalRow>
            <Td colSpan={6}>{translate("total")}</Td>
            <Td col="num">{fmtQtyZero(totals.openQty)}</Td>
            <Td col="num"><Money value={totals.openAmount} as="zeroMoney" /></Td>
            <Td col="num">{fmtQtyZero(totals.inQty)}</Td>
            <Td col="num"><Money value={totals.inAmount} as="zeroMoney" /></Td>
            <Td col="num">{fmtQtyZero(totals.outQty)}</Td>
            <Td col="num" variant="cost"><Money value={totals.cogsOut} as="zeroMoney" /></Td>
            <Td col="num">—</Td>
            <Td col="num" variant="sale"><Money value={totals.saleAmount} as="zeroMoney" /></Td>
            <Td col="num" variant={totals.profit < 0 ? "loss" : "profit"}><Money value={totals.profit} as="zeroMoney" /></Td>
            <Td col="num">{fmtQtyZero(totals.closeQty)}</Td>
            <Td col="num"><Money value={totals.closeAmount} as="zeroMoney" /></Td>
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
      isEmpty={!isLoading && (!applied || movements.length === 0)}
      emptyMessage={!applied ? translate("reportPressGenerate") : undefined}
      onGenerate={handleGenerate}
      fileBaseName={translate("MaterialStatementList")}
      title={translate("MaterialStatementList")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

MaterialStatement.displayName = "MaterialStatement";
export { MaterialStatement };
