/**
 * Прайс-лист — текущие цены номенклатуры по ОДНОМУ выбранному типу цены.
 * Данные: последняя цена выбранного типа (GET /product-prices/price-list).
 */
import { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { Field } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import ReportPane from "src/components/ReportPane";
import { ReportSheet, ReportTable, Th, Td, Money } from "./_shared/reportLayout";
import { useReportFilters } from "./_shared/useReportFilters";
import { fmtDate } from "./_shared/reportFormat";
import reportCss from "./report.module.scss?inline";
import styles from "./report.module.scss";

interface PriceRow {
  productUuid: string; name: string; sku: string | null; barcode: string | null;
  brandName: string | null; unitName: string | null; price: number | null; priceDate: string | null;
}
interface PriceListResponse { priceTypeUuid: string | null; priceTypeName: string | null; items: PriceRow[] }
interface Filters extends Record<string, unknown> {
  priceTypeUuid: string; priceTypeName: string; brandUuid: string; brandName: string; search: string;
}
interface PriceListReportProps { uniqId?: string;[key: string]: unknown }

const PriceListReport: FC<PriceListReportProps> = ({ uniqId }) => {
  const { fields, setField, patch, applied, handleGenerate } = useReportFilters<Filters>({
    persistKey: "report.price-list",
    defaults: { priceTypeUuid: "", priceTypeName: "", brandUuid: "", brandName: "", search: "" },
  });

  const { data, isLoading } = useQuery<PriceListResponse>({
    queryKey: ["price-list", applied],
    queryFn: async () => {
      const params: Record<string, string> = { onlyPriced: "1" };
      if (applied!.priceTypeUuid) params.priceTypeUuid = applied!.priceTypeUuid;
      if (applied!.brandUuid) params.brandUuid = applied!.brandUuid;
      if (applied!.search) params.search = applied!.search;
      return api.get<PriceListResponse>("product-prices/price-list", { params });
    },
    enabled: !!applied,
  });

  const rows: PriceRow[] = data?.items ?? [];
  const resolvedTypeName = data?.priceTypeName ?? fields.priceTypeName;
  const isEmpty = !isLoading && (!applied || rows.length === 0);

  const form = (
    <>
      <GroupCol>
        <LookupField label={translate("priceType")} name="pl_type" value={fields.priceTypeUuid} displayValue={fields.priceTypeName}
          endpoint="price-types" displayField="name"
          onSelect={(u, d) => patch({ priceTypeUuid: u, priceTypeName: d })} onClear={() => patch({ priceTypeUuid: "", priceTypeName: "" })} />
        <LookupField label={translate("brand")} name="pl_brand" value={fields.brandUuid} displayValue={fields.brandName}
          endpoint="brands" displayField="name"
          onSelect={(u, d) => patch({ brandUuid: u, brandName: d })} onClear={() => patch({ brandUuid: "", brandName: "" })} />
      </GroupCol>
      <GroupRow>
        <Field label={translate("search")} name="pl_search" value={fields.search} onChange={(e) => setField("search", e.target.value)} width="260px" />
      </GroupRow>
    </>
  );

  const layout = (
    <ReportSheet
      title={`${translate("priceListReport")}${resolvedTypeName ? ` — ${resolvedTypeName}` : ""}`}
      sortLine={fields.brandName ? `${translate("brand")} — ${fields.brandName}` : undefined}
    >
      <ReportTable>
        <thead>
          <tr>
            <Th col="n">№</Th>
            <Th col="name">{translate("reportProduct")}</Th>
            <Th col="tag">{translate("sku")}</Th>
            <Th col="tag">{translate("barcode")}</Th>
            <Th col="uom">{translate("reportUom")}</Th>
            <Th col="num">{translate("price")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.productUuid}>
              <Td col="n">{idx + 1}</Td>
              <Td col="name">{r.name}</Td>
              <Td col="tag">{r.sku ?? ""}</Td>
              <Td col="tag">{r.barcode ?? ""}</Td>
              <Td col="uom">{r.unitName ?? ""}</Td>
              <Td col="num">{r.price != null ? <Money value={r.price} as="zeroMoney" /> : "—"}</Td>
            </tr>
          ))}
        </tbody>
      </ReportTable>
      {rows.length > 0 && data?.items?.[0]?.priceDate && (
        <div className={styles.SortLine}>{translate("date")}: {fmtDate(data.items[0].priceDate)}</div>
      )}
    </ReportSheet>
  );

  return (
    <ReportPane
      uniqId={uniqId}
      form={form}
      layout={layout}
      layoutStyles={reportCss}
      isLoading={isLoading}
      isEmpty={isEmpty}
      emptyMessage={!applied ? translate("reportPressGenerate") : undefined}
      onGenerate={handleGenerate}
      fileBaseName={translate("priceListReport")}
      title={translate("priceListReport")}
      orientation="portrait"
      sheetFit="content"
    />
  );
};

PriceListReport.displayName = "PriceListReport";
export { PriceListReport };
