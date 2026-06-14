/**
 * Прайс-лист — текущие цены номенклатуры по ОДНОМУ выбранному типу цены.
 * Данные: последняя цена выбранного типа на каждый товар из регистра ProductPrice
 * (бэкенд GET /product-prices/price-list). Печать/экспорт через ReportPane.
 */
import { FC, useState, useCallback } from "react";
import { usePersistentState } from "src/hooks/usePersistentState";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { Field } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import ReportPane from "src/components/ReportPane";
import { getFormatDateOnly } from "src/utils/datetime";
import styles from "./report.module.scss";
import reportCss from "./report.module.scss?inline";

const fmtAmtZ = (n: number) =>
  n.toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface PriceRow {
  productUuid: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  brandName: string | null;
  unitName: string | null;
  price: number | null;
  priceDate: string | null;
}

interface PriceListResponse {
  priceTypeUuid: string | null;
  priceTypeName: string | null;
  items: PriceRow[];
}

interface PriceListReportProps {
  uniqId?: string;
  [key: string]: unknown;
}

const PriceListReport: FC<PriceListReportProps> = ({ uniqId }) => {
  const [priceTypeUuid, setPriceTypeUuid] = usePersistentState("report.price-list.priceTypeUuid", "");
  const [priceTypeName, setPriceTypeName] = usePersistentState("report.price-list.priceTypeName", "");
  const [brandUuid, setBrandUuid] = usePersistentState("report.price-list.brandUuid", "");
  const [brandName, setBrandName] = usePersistentState("report.price-list.brandName", "");
  const [search, setSearch] = useState("");

  const [applied, setApplied] = useState<null | { priceTypeUuid: string; brandUuid: string; search: string }>(null);

  const handleGenerate = useCallback(() => {
    setApplied({ priceTypeUuid, brandUuid, search });
  }, [priceTypeUuid, brandUuid, search]);

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
  const resolvedTypeName = data?.priceTypeName ?? priceTypeName;
  const isEmpty = !isLoading && (!applied || rows.length === 0);

  const form = (
    <>
      <GroupCol>
        <LookupField label={translate("priceType")} name="pl_type" value={priceTypeUuid} displayValue={priceTypeName}
          endpoint="price-types" displayField="name"
          onSelect={(u, d) => { setPriceTypeUuid(u); setPriceTypeName(d); }}
          onClear={() => { setPriceTypeUuid(""); setPriceTypeName(""); }} />
        <LookupField label={translate("brand")} name="pl_brand" value={brandUuid} displayValue={brandName}
          endpoint="brands" displayField="name"
          onSelect={(u, d) => { setBrandUuid(u); setBrandName(d); }}
          onClear={() => { setBrandUuid(""); setBrandName(""); }} />
      </GroupCol>
      <GroupRow>
        <Field label={translate("search")} name="pl_search" value={search} onChange={(e) => setSearch(e.target.value)} width="260px" />
      </GroupRow>
    </>
  );

  const layout = (
    <div className={styles.Report}>
      <div className={styles.Title}>{translate("priceListReport")}{resolvedTypeName ? ` — ${resolvedTypeName}` : ""}</div>
      {brandName && <div className={styles.SortLine}>{translate("brand")} — {brandName}</div>}
      <table className={styles.Table}>
        <thead>
          <tr>
            <th className={styles.ColN}>№</th>
            <th className={styles.ColName}>{translate("reportProduct")}</th>
            <th className={styles.ColTag}>{translate("sku")}</th>
            <th className={styles.ColTag}>{translate("barcode")}</th>
            <th className={styles.ColUom}>{translate("reportUom")}</th>
            <th className={styles.ColNum}>{translate("price")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.productUuid}>
              <td className={styles.ColN}>{idx + 1}</td>
              <td className={styles.ColName}>{r.name}</td>
              <td className={styles.ColTag}>{r.sku ?? ""}</td>
              <td className={styles.ColTag}>{r.barcode ?? ""}</td>
              <td className={styles.ColUom}>{r.unitName ?? ""}</td>
              <td className={styles.ColNum}>{r.price != null ? fmtAmtZ(r.price) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 0 && data?.items?.[0]?.priceDate && (
        <div className={styles.SortLine}>{translate("date")}: {getFormatDateOnly(String(data.items[0].priceDate))}</div>
      )}
    </div>
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
