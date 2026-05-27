import { FC, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupRow } from "src/components/UI";
import ReportPane from "src/components/ReportPane";
import styles from "./report.module.scss";

const fmtQty = (n: number) =>
  n !== 0 ? Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 0, maximumFractionDigits: 4 }) : "—";
const fmtAmt = (n: number) =>
  n !== 0 ? Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const fmtAmtZ = (n: number) =>
  Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQtyZ = (n: number) =>
  Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

interface MovementRow {
  date: string;
  direction: "in" | "out";
  docType: string;
  docId: number;
  docUuid: string;
  counterpartyName: string;
  quantity: number;
  price: number;
  amount: number;
}

interface ProductDetailReportProps {
  uniqId?: string;
  productUuid?: string;
  productName?: string;
  initialDateFrom?: string;
  initialDateTo?: string;
  initialOrgUuid?: string;
  initialOrgName?: string;
  [key: string]: unknown;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  purchase: "Поступление товара и услуг и услуг",
  sale: "Реализация товара и услуг",
  purchaseReturn: "Возврат поставщику",
  saleReturn: "Возврат от покупателя",
};

const ProductDetailReport: FC<ProductDetailReportProps> = ({
  uniqId,
  productUuid: initProductUuid = "",
  productName: initProductName = "",
  initialDateFrom,
  initialDateTo,
  initialOrgUuid = "",
  initialOrgName = "",
}) => {
  const [dateFrom, setDateFrom] = useState(
    () => initialDateFrom ?? (() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); })(),
  );
  const [dateTo, setDateTo] = useState(
    () => initialDateTo ?? new Date().toISOString().slice(0, 10),
  );
  const [orgUuid, setOrgUuid] = useState(initialOrgUuid);
  const [orgName, setOrgName] = useState(initialOrgName);
  const [productUuid, setProductUuid] = useState(initProductUuid);
  const [productName, setProductName] = useState(initProductName);

  const buildParams = useCallback(() => {
    const p: Record<string, string> = {};
    if (productUuid) p.productUuid = productUuid;
    if (dateFrom) p.dateFrom = dateFrom;
    if (dateTo) p.dateTo = dateTo;
    if (orgUuid) p.organizationUuid = orgUuid;
    return p;
  }, [productUuid, dateFrom, dateTo, orgUuid]);

  const { data, isLoading, isError } = useQuery<{ items: MovementRow[]; productName: string }>({
    queryKey: ["report-product-movements", productUuid, dateFrom, dateTo, orgUuid],
    queryFn: async () => {
      const resp = await api.get<any>("reports/product-movements", { params: buildParams() });
      return { items: resp?.items ?? [], productName: resp?.productName ?? productName };
    },
    enabled: !!productUuid && !!dateFrom && !!dateTo,
  });

  const rows: MovementRow[] = data?.items ?? [];
  const resolvedProductName = data?.productName || productName;

  const inRows = rows.filter((r) => r.direction === "in");
  const outRows = rows.filter((r) => r.direction === "out");
  const totalIn = inRows.reduce((s, r) => s + r.amount, 0);
  const totalOut = outRows.reduce((s, r) => s + r.amount, 0);
  const totalQtyIn = inRows.reduce((s, r) => s + r.quantity, 0);
  const totalQtyOut = outRows.reduce((s, r) => s + r.quantity, 0);

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="pd_from" value={dateFrom} onChange={e => setDateFrom(e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="pd_to" value={dateTo} onChange={e => setDateTo(e.target.value)} width="150px" />
      </GroupRow>
      <GroupRow>
        <LookupField label={translate("organization")} name="pd_org" value={orgUuid} displayValue={orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }}
          onClear={() => { setOrgUuid(""); setOrgName(""); }} />
        <LookupField label={translate("product")} name="pd_product" value={productUuid} displayValue={productName}
          endpoint="products" displayField="name"
          onSelect={(u, d) => { setProductUuid(u); setProductName(d); }}
          onClear={() => { setProductUuid(""); setProductName(""); }} />
      </GroupRow>
    </>
  );

  const renderSection = (sectionRows: MovementRow[], label: string, totalQty: number, totalAmt: number) => (
    <>
      <tr className={styles.SectionHeader}>
        <td colSpan={6}>{label}</td>
      </tr>
      {sectionRows.map((row, idx) => (
        <tr key={`${row.docUuid}-${idx}`}>
          <td className={styles.ColN}>{idx + 1}</td>
          <td className={styles.ColDate}>{row.date}</td>
          <td className={styles.ColName}>{DOC_TYPE_LABELS[row.docType] ?? row.docType} №{row.docId}</td>
          <td className={styles.ColName}>{row.counterpartyName}</td>
          <td className={styles.ColNum}>{fmtQty(row.quantity)}</td>
          <td className={styles.ColNum}>{fmtAmt(row.amount)}</td>
        </tr>
      ))}
      <tr className={styles.SubtotalRow}>
        <td colSpan={4}>{translate("total")} {label.toLowerCase()}</td>
        <td className={styles.ColNum}>{fmtQtyZ(totalQty)}</td>
        <td className={styles.ColNum}>{fmtAmtZ(totalAmt)}</td>
      </tr>
    </>
  );

  const layout = (
    <div className={styles.Report}>
      {orgName && <div className={styles.OrgName}>{orgName}</div>}
      <div className={styles.Title}>{translate("reportProductMovements")}: {resolvedProductName}</div>

      <table className={styles.Table}>
        <thead>
          <tr>
            <th className={styles.ColN}>№</th>
            <th className={styles.ColDate}>{translate("date")}</th>
            <th className={styles.ColName}>{translate("document")}</th>
            <th className={styles.ColName}>{translate("counterparty")}</th>
            <th className={styles.ColNum}>{translate("quantity")}</th>
            <th className={styles.ColNum}>{translate("amount")}</th>
          </tr>
        </thead>
        <tbody>
          {renderSection(inRows, translate("reportDirectionIn"), totalQtyIn, totalIn)}
          {renderSection(outRows, translate("reportDirectionOut"), totalQtyOut, totalOut)}
        </tbody>
        <tfoot>
          <tr className={styles.TotalRow}>
            <td colSpan={4}>{translate("reportBalance")}</td>
            <td className={styles.ColNum}>{fmtQtyZ(totalQtyIn - totalQtyOut)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totalIn - totalOut)}</td>
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
      isEmpty={!isLoading && !productUuid}
      emptyMessage={!productUuid ? translate("selectProduct") : isError ? translate("serverError") : undefined}
      fileBaseName={resolvedProductName || translate("reportProductMovements")}
      title={translate("reportProductMovements")}
      orientation="portrait"
      sheetFit="content"
    />
  );
};

ProductDetailReport.displayName = "ProductDetailReport";
export { ProductDetailReport };
