import { FC, useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useAppContext } from "src/app";
import ReportPane from "src/components/ReportPane";
import { ProductDetailReport } from "./ProductDetailReport";
import styles from "./report.module.scss";

// ─── number formatter ────────────────────────────────────────────────────────

const fmtQty = (n: number) =>
  n !== 0 ? Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 0, maximumFractionDigits: 4 }) : "—";

const fmtAmt = (n: number) =>
  n !== 0 ? Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

const fmtAmtZ = (n: number) =>
  Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtQtyZ = (n: number) =>
  Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

// ─── types ────────────────────────────────────────────────────────────────────

interface ProductRow {
  productUuid: string | null;
  productName: string;
  uom: string;
  qtySale: number;
  qtyReturn: number;
  qtyNet: number;
  amountSale: number;
  amountReturn: number;
  amountNet: number;
  exciseAmountSale: number;
  vatAmountSale: number;
  amountNoTaxSale: number;
  costNoVat: number;
  profit: number;
}

interface SalesReportProps {
  uniqId?: string;
  [key: string]: unknown;
}

// ─── helper: month label ─────────────────────────────────────────────────────

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

// ─── component ───────────────────────────────────────────────────────────────

const SalesReport: FC<SalesReportProps> = ({ uniqId }) => {
  const { windows: { addPane } } = useAppContext();
  const { organizationUuid: defaultOrgUuid, organizationName: defaultOrgName } =
    useDefaultOrganization();

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [orgUuid, setOrgUuid] = useState(defaultOrgUuid || "");
  const [orgName, setOrgName] = useState(defaultOrgName || "");
  const [cptyUuid, setCptyUuid] = useState("");
  const [cptyName, setCptyName] = useState("");

  // Отчёт формируется только по кнопке «Сформировать» (snapshot параметров).
  const [applied, setApplied] = useState<null | {
    dateFrom: string; dateTo: string; orgUuid: string; cptyUuid: string;
  }>(null);

  // Даты и фильтры необязательны: пустая дата → период не ограничивается
  // с этой стороны; пустой фильтр (Организация/Контрагент) → без учёта фильтра.
  const handleGenerate = useCallback(() => {
    setApplied({ dateFrom, dateTo, orgUuid, cptyUuid });
  }, [dateFrom, dateTo, orgUuid, cptyUuid]);

  const { data, isLoading, isError } = useQuery<{ items: ProductRow[]; orgName: string }>({
    queryKey: ["report-sales-by-product", applied],
    queryFn: async () => {
      const p: Record<string, string> = {};
      if (applied!.dateFrom) p.dateFrom = applied!.dateFrom;
      if (applied!.dateTo) p.dateTo = applied!.dateTo;
      if (applied!.orgUuid) p.organizationUuid = applied!.orgUuid;
      if (applied!.cptyUuid) p.counterpartyUuid = applied!.cptyUuid;
      const resp = await api.get<any>("reports/sales-by-product", { params: p });
      return { items: resp?.items ?? [], orgName: resp?.orgName ?? "" };
    },
    enabled: !!applied,
    retry: 1,
  });

  const rows: ProductRow[] = data?.items ?? [];
  const reportOrgName = data?.orgName || orgName;

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          qtySale: acc.qtySale + r.qtySale,
          qtyReturn: acc.qtyReturn + r.qtyReturn,
          qtyNet: acc.qtyNet + r.qtyNet,
          amountSale: acc.amountSale + r.amountSale,
          amountReturn: acc.amountReturn + r.amountReturn,
          amountNet: acc.amountNet + r.amountNet,
          exciseAmountSale: acc.exciseAmountSale + r.exciseAmountSale,
          vatAmountSale: acc.vatAmountSale + r.vatAmountSale,
          amountNoTaxSale: acc.amountNoTaxSale + r.amountNoTaxSale,
          costNoVat: acc.costNoVat + r.costNoVat,
          profit: acc.profit + r.profit,
        }),
        {
          qtySale: 0, qtyReturn: 0, qtyNet: 0,
          amountSale: 0, amountReturn: 0, amountNet: 0,
          exciseAmountSale: 0, vatAmountSale: 0, amountNoTaxSale: 0,
          costNoVat: 0, profit: 0,
        },
      ),
    [rows],
  );

  const period = monthLabel(dateFrom, dateTo);

  const openDetail = useCallback((row: ProductRow) => {
    if (!row.productUuid) return;
    addPane({
      component: ProductDetailReport,
      label: `${translate("reportProductMovements")}: ${row.productName}`,
      data: {
        productUuid: row.productUuid,
        productName: row.productName,
        initialDateFrom: dateFrom,
        initialDateTo: dateTo,
        initialOrgUuid: orgUuid,
        initialOrgName: orgName,
      },
    });
  }, [addPane, dateFrom, dateTo, orgUuid, orgName]);

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="sf_from" value={dateFrom} onChange={e => setDateFrom(e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="sf_to" value={dateTo} onChange={e => setDateTo(e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="sf_org" value={orgUuid} displayValue={orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }}
          onClear={() => { setOrgUuid(""); setOrgName(""); }} />
        <LookupField label={translate("counterparty")} name="sf_cpty" value={cptyUuid} displayValue={cptyName}
          endpoint="counterparties" displayField="name"
          onSelect={(u, d) => { setCptyUuid(u); setCptyName(d); }}
          onClear={() => { setCptyUuid(""); setCptyName(""); }} />
      </GroupCol>
    </>
  );

  const layout = (
    <div className={styles.Report}>
      {reportOrgName && <div className={styles.OrgName}>{reportOrgName}</div>}
      <div className={styles.Title}>
        {translate("reportSalesTitle")}
        {period && <> за {period}</>}
      </div>
      {orgName && (
        <div className={styles.SortLine}>
          {translate("reportSortBy")} {translate("organization")} — {orgName}
        </div>
      )}

      <table className={styles.Table}>
        <thead>
          <tr>
            <th className={styles.ColN}>№</th>
            <th className={styles.ColName}>{translate("reportProduct")}</th>
            <th className={styles.ColNum}>{translate("reportQtySale")}</th>
            <th className={styles.ColNum}>{translate("reportQtyReturn")}</th>
            <th className={styles.ColNum}>{translate("reportQtyNet")}</th>
            <th className={styles.ColNum}>{translate("reportAmountSale")}</th>
            <th className={styles.ColNum}>{translate("reportAmountReturn")}</th>
            <th className={styles.ColNum}>{translate("reportAmountNet")}</th>
            <th className={styles.ColNum}>{translate("reportAmountExcise")}</th>
            <th className={styles.ColNum}>{translate("reportVatAmount")}</th>
            <th className={styles.ColNum}>{translate("reportAmountNoTax")}</th>
            <th className={styles.ColNum}>{translate("reportCostNoVat")}</th>
            <th className={styles.ColNum}>{translate("reportProfit")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.productUuid ?? idx} className={row.productUuid ? styles.ClickableRow : undefined} onClick={() => openDetail(row)} title={row.productUuid ? translate("reportProductMovements") : undefined}>
              <td className={styles.ColN}>{idx + 1}</td>
              <td className={styles.ColName}>{row.productName}</td>
              <td className={styles.ColNum}>{fmtQty(row.qtySale)}</td>
              <td className={styles.ColNum}>{fmtQty(row.qtyReturn)}</td>
              <td className={styles.ColNum}>{fmtQty(row.qtyNet)}</td>
              <td className={styles.ColNum}>{fmtAmt(row.amountSale)}</td>
              <td className={styles.ColNum}>{fmtAmt(row.amountReturn)}</td>
              <td className={styles.ColNum}>{fmtAmt(row.amountNet)}</td>
              <td className={styles.ColNum}>{fmtAmt(row.exciseAmountSale)}</td>
              <td className={styles.ColNum}>{fmtAmt(row.vatAmountSale)}</td>
              <td className={styles.ColNum}>{fmtAmt(row.amountNoTaxSale)}</td>
              <td className={styles.ColNum}>{fmtAmt(row.costNoVat)}</td>
              <td className={styles.ColNum}>{fmtAmt(row.profit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={styles.TotalRow}>
            <td colSpan={2}>{translate("total")}</td>
            <td className={styles.ColNum}>{fmtQtyZ(totals.qtySale)}</td>
            <td className={styles.ColNum}>{fmtQtyZ(totals.qtyReturn)}</td>
            <td className={styles.ColNum}>{fmtQtyZ(totals.qtyNet)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.amountSale)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.amountReturn)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.amountNet)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.exciseAmountSale)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.vatAmountSale)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.amountNoTaxSale)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.costNoVat)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.profit)}</td>
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
