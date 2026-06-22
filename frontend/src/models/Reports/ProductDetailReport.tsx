/**
 * Движение товара — приход/расход по номенклатуре за период с подытогами.
 * Открывается из «Материальной ведомости» (товар+период) или вручную.
 * ДВОЙНОЙ клик по документу открывает его.
 */
import { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import ReportPane from "src/components/ReportPane";
import { ReportSheet, ReportTable, Th, Td, SectionHeader, SubtotalRow, TotalRow, Money } from "./_shared/reportLayout";
import { useReportDrill, DrillLink } from "./_shared/reportDrill";
import { useReportFilters } from "./_shared/useReportFilters";
import { firstOfMonth, today } from "./_shared/reportDates";
import { fmtQty, fmtQtyZero } from "./_shared/reportFormat";
import reportCss from "./report.module.scss?inline";

interface MovementRow {
  date: string; direction: "in" | "out";
  docType: string; docId: number; docUuid: string;
  counterpartyName: string; quantity: number; price: number; amount: number;
}
interface Filters extends Record<string, unknown> {
  dateFrom: string; dateTo: string; orgUuid: string; orgName: string;
  productUuid: string; productName: string;
}
interface ProductDetailReportProps {
  uniqId?: string;
  productUuid?: string; productName?: string;
  initialDateFrom?: string; initialDateTo?: string; initialOrgUuid?: string; initialOrgName?: string;
  [key: string]: unknown;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  purchase: "Поступление товара и услуг",
  sale: "Реализация товара и услуг",
  purchaseReturn: "Возврат поставщику",
  saleReturn: "Возврат от покупателя",
};

const ProductDetailReport: FC<ProductDetailReportProps> = ({
  uniqId, productUuid: initProductUuid = "", productName: initProductName = "",
  initialDateFrom, initialDateTo, initialOrgUuid, initialOrgName,
}) => {
  const initial: Partial<Filters> = {};
  if (initialDateFrom !== undefined) initial.dateFrom = initialDateFrom;
  if (initialDateTo !== undefined) initial.dateTo = initialDateTo;
  if (initialOrgUuid !== undefined) initial.orgUuid = initialOrgUuid;
  if (initialOrgName !== undefined) initial.orgName = initialOrgName;
  if (initProductUuid) { initial.productUuid = initProductUuid; initial.productName = initProductName; }

  const { fields, setField, patch, applied, handleGenerate, generateDisabled } = useReportFilters<Filters>({
    persistKey: "report.product-detail",
    defaults: { dateFrom: firstOfMonth(), dateTo: today(), orgUuid: "", orgName: "", productUuid: "", productName: "" },
    initial,
    canApply: (f) => !!f.productUuid,
  });
  const drill = useReportDrill({ orgName: fields.orgName });

  const { data, isLoading, isError } = useQuery<{ items: MovementRow[]; productName: string }>({
    queryKey: ["report-product-movements", applied],
    queryFn: async () => {
      const p: Record<string, string> = {};
      const f = applied!;
      if (f.productUuid) p.productUuid = f.productUuid;
      if (f.dateFrom) p.dateFrom = f.dateFrom;
      if (f.dateTo) p.dateTo = f.dateTo;
      if (f.orgUuid) p.organizationUuid = f.orgUuid;
      const resp = await api.get<any>("reports/product-movements", { params: p });
      return { items: resp?.items ?? [], productName: resp?.productName ?? f.productName };
    },
    enabled: !!applied,
  });

  const rows: MovementRow[] = data?.items ?? [];
  const resolvedProductName = data?.productName || fields.productName;

  const inRows = rows.filter((r) => r.direction === "in");
  const outRows = rows.filter((r) => r.direction === "out");
  const totalIn = inRows.reduce((s, r) => s + r.amount, 0);
  const totalOut = outRows.reduce((s, r) => s + r.amount, 0);
  const totalQtyIn = inRows.reduce((s, r) => s + r.quantity, 0);
  const totalQtyOut = outRows.reduce((s, r) => s + r.quantity, 0);

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="pd_from" value={fields.dateFrom} onChange={e => setField("dateFrom", e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="pd_to" value={fields.dateTo} onChange={e => setField("dateTo", e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="pd_org" value={fields.orgUuid} displayValue={fields.orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => patch({ orgUuid: u, orgName: d })} onClear={() => patch({ orgUuid: "", orgName: "" })} />
        <LookupField label={translate("product")} name="pd_product" value={fields.productUuid} displayValue={fields.productName}
          endpoint="products" displayField="name"
          onSelect={(u, d) => patch({ productUuid: u, productName: d })} onClear={() => patch({ productUuid: "", productName: "" })} />
      </GroupCol>
    </>
  );

  const renderSection = (sectionRows: MovementRow[], label: string, totalQty: number, totalAmt: number) => (
    <>
      <SectionHeader><Td colSpan={6}>{label}</Td></SectionHeader>
      {sectionRows.map((row, idx) => (
        <tr key={`${row.docUuid}-${idx}`}>
          <Td col="n">{idx + 1}</Td>
          <Td col="date">{row.date}</Td>
          <Td col="name">
            <DrillLink onOpen={() => drill.toDocument(row.docType, row.docUuid)}>
              {DOC_TYPE_LABELS[row.docType] ?? row.docType} №{row.docId}
            </DrillLink>
          </Td>
          <Td col="name">{row.counterpartyName}</Td>
          <Td col="num">{fmtQty(row.quantity)}</Td>
          <Td col="num"><Money value={row.amount} /></Td>
        </tr>
      ))}
      <SubtotalRow>
        <Td colSpan={4}>{translate("total")} {label.toLowerCase()}</Td>
        <Td col="num">{fmtQtyZero(totalQty)}</Td>
        <Td col="num"><Money value={totalAmt} as="zeroMoney" /></Td>
      </SubtotalRow>
    </>
  );

  const layout = (
    <ReportSheet org={fields.orgName || undefined} title={`${translate("reportProductMovements")}: ${resolvedProductName}`}>
      <ReportTable>
        <thead>
          <tr>
            <Th col="n">№</Th>
            <Th col="date">{translate("date")}</Th>
            <Th col="name">{translate("document")}</Th>
            <Th col="name">{translate("counterparty")}</Th>
            <Th col="num">{translate("quantity")}</Th>
            <Th col="num">{translate("amount")}</Th>
          </tr>
        </thead>
        <tbody>
          {renderSection(inRows, translate("reportDirectionIn"), totalQtyIn, totalIn)}
          {renderSection(outRows, translate("reportDirectionOut"), totalQtyOut, totalOut)}
        </tbody>
        <tfoot>
          <TotalRow>
            <Td colSpan={4}>{translate("reportBalance")}</Td>
            <Td col="num">{fmtQtyZero(totalQtyIn - totalQtyOut)}</Td>
            <Td col="num"><Money value={totalIn - totalOut} as="zeroMoney" /></Td>
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
      isEmpty={!isLoading && (!fields.productUuid || !applied || isError || rows.length === 0)}
      emptyMessage={
        !fields.productUuid ? translate("selectProduct")
          : !applied ? translate("reportPressGenerate")
            : isError ? translate("serverError") : undefined
      }
      onGenerate={handleGenerate}
      generateDisabled={generateDisabled}
      fileBaseName={resolvedProductName || translate("reportProductMovements")}
      title={translate("reportProductMovements")}
      orientation="portrait"
      sheetFit="content"
    />
  );
};

ProductDetailReport.displayName = "ProductDetailReport";
export { ProductDetailReport };
