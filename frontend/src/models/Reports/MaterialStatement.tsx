/**
 * Материальная ведомость (оборотная) — движение ТМЗ за период.
 * Показывает: приход (из закупок) и расход (из реализаций) по каждой номенклатуре.
 * НК РК ст. 242 п.1: учёт ТМЗ обязателен при определении вычетов.
 */
import { FC, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupRow } from "src/components/UI";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import ReportPane from "src/components/ReportPane";
import { getFormatDateOnly } from "src/utils/datetime";
import { useAppContext } from "src/app";
import { openReport } from "src/utils/openReport";
import { openFormByEndpoint } from "src/registry/formRegistry";
import styles from "./report.module.scss";
import reportCss from "./report.module.scss?inline";
import { GroupCol } from "src/components/UI";

interface ProductMovement {
  productUuid: string;
  productName: string;
  sku: string;
  accountCode: string;
  uom: string;
  unitCost: number;
  openQty: number;
  openAmount: number;
  inQty: number;
  inAmount: number;
  outQty: number;
  cogsOut: number;
  salePrice: number;
  saleAmount: number;
  profit: number;
  closeQty: number;
  closeAmount: number;
}

const fmtAmt = (n: number | null | undefined) => {
  const v = Number(n) || 0;
  return v !== 0
    ? v.toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";
};

const fmtQty = (n: number | null | undefined) => {
  const v = Number(n) || 0;
  return v !== 0
    ? v.toLocaleString("ru-KZ", { minimumFractionDigits: 0, maximumFractionDigits: 3 })
    : "—";
};

const fmtAmtZ = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtQtyZ = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString("ru-KZ", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

function formatPeriod(from: string, to: string): string {
  if (!from) return "";
  const f = getFormatDateOnly(from) || from;
  const t = to ? getFormatDateOnly(to) || to : "";
  return t ? `${f} — ${t}` : f;
}

interface MaterialStatementProps {
  uniqId?: string;
  [key: string]: unknown;
}

const MaterialStatement: FC<MaterialStatementProps> = ({ uniqId }) => {
  const { organizationUuid: defaultOrgUuid, organizationName: defaultOrgName } = useDefaultOrganization();
  const { windows: { addPane } } = useAppContext();

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [orgUuid, setOrgUuid] = useState(defaultOrgUuid || "");
  const [orgName, setOrgName] = useState(defaultOrgName || "");
  const [warehouseUuid, setWarehouseUuid] = useState("");
  const [warehouseName, setWarehouseName] = useState("");

  // Параметры применяются только по кнопке «Сформировать» (snapshot),
  // чтобы отчёт не перезагружался при каждом изменении фильтров.
  const [applied, setApplied] = useState<null | {
    dateFrom: string; dateTo: string; orgUuid: string; warehouseUuid: string;
  }>(null);

  // Даты и фильтры необязательны: пустая дата → период не ограничивается
  // с этой стороны; пустой фильтр (Организация/Склад) → без учёта фильтра.
  const handleGenerate = useCallback(() => {
    setApplied({ dateFrom, dateTo, orgUuid, warehouseUuid });
  }, [dateFrom, dateTo, orgUuid, warehouseUuid]);

  const { data: movements = [], isLoading } = useQuery<ProductMovement[]>({
    queryKey: ["report-material", applied],
    queryFn: async () => {
      const p: Record<string, string> = {};
      if (applied!.dateFrom) p.dateFrom = applied!.dateFrom;
      if (applied!.dateTo) p.dateTo = applied!.dateTo;
      if (applied!.orgUuid) p.organizationUuid = applied!.orgUuid;
      if (applied!.warehouseUuid) p.warehouseUuid = applied!.warehouseUuid;
      const resp = await api.get<any>("reports/material-statement", { params: p });
      return resp?.items ?? [];
    },
    enabled: !!applied,
  });

  const totals = movements.reduce(
    (acc, r) => ({
      openQty: acc.openQty + r.openQty,
      openAmount: acc.openAmount + r.openAmount,
      inQty: acc.inQty + r.inQty,
      inAmount: acc.inAmount + r.inAmount,
      outQty: acc.outQty + r.outQty,
      cogsOut: acc.cogsOut + r.cogsOut,
      saleAmount: acc.saleAmount + r.saleAmount,
      profit: acc.profit + r.profit,
      closeQty: acc.closeQty + r.closeQty,
      closeAmount: acc.closeAmount + r.closeAmount,
    }),
    { openQty: 0, openAmount: 0, inQty: 0, inAmount: 0, outQty: 0, cogsOut: 0, saleAmount: 0, profit: 0, closeQty: 0, closeAmount: 0 },
  );

  const period = formatPeriod(dateFrom, dateTo);

  // Ссылка на карточку номенклатуры.
  const openProductCard = (row: ProductMovement) => {
    if (row.productUuid) void openFormByEndpoint("products", row.productUuid, addPane);
  };

  // Ссылка на «Движение товара» с передачей параметров отчёта и строки.
  const openMovements = (row: ProductMovement) => {
    if (!row.productUuid) return;
    void openReport("product-detail", addPane, undefined, {
      productUuid: row.productUuid,
      productName: row.productName,
      initialDateFrom: applied?.dateFrom,
      initialDateTo: applied?.dateTo,
      initialOrgUuid: applied?.orgUuid,
      initialOrgName: orgName,
    } as any);
  };

  const linkSum = (row: ProductMovement, value: number) => (
    <span className={styles.ClickableRow} style={{ cursor: "pointer", textDecoration: "underline" }}
      onClick={() => openMovements(row)}>{fmtAmt(value)}</span>
  );

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="ms_from" value={dateFrom} onChange={e => setDateFrom(e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="ms_to" value={dateTo} onChange={e => setDateTo(e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="ms_org" value={orgUuid} displayValue={orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }}
          onClear={() => { setOrgUuid(""); setOrgName(""); }} />
        <LookupField label={translate("warehouse")} name="ms_wh" value={warehouseUuid} displayValue={warehouseName}
          endpoint="warehouses" displayField="name"
          onSelect={(u, d) => { setWarehouseUuid(u); setWarehouseName(d); }}
          onClear={() => { setWarehouseUuid(""); setWarehouseName(""); }}
          extraParams={orgUuid ? { organizationUuid: orgUuid } : undefined} />
      </GroupCol>
    </>
  );

  const layout = (
    <div className={styles.Report}>
      {orgName && <div className={styles.OrgName}>{orgName}</div>}
      <div className={styles.Title}>{translate("MaterialStatementList")}</div>
      {period && <div className={styles.SubTitle}>{translate("reportPeriodLabel")} {period}</div>}
      {warehouseName && (
        <div className={styles.SortLine}>
          {translate("reportSortBy")} {translate("warehouse")} — {warehouseName}
        </div>
      )}

      <table className={styles.Table}>
        <thead>
          <tr>
            <th className={styles.ColN}>№</th>
            <th className={styles.ColName}>{translate("reportProduct")}</th>
            <th className={styles.ColUom}>{translate("reportAccount")}</th>
            <th className={styles.ColUom}>{translate("reportCode")}</th>
            <th className={styles.ColUom}>{translate("reportUom")}</th>
            <th className={styles.ColNum}>{translate("reportCost")}</th>
            <th className={styles.ColNum}>{translate("reportOpeningQty")}</th>
            <th className={styles.ColNum}>{translate("reportOpeningAmount")}</th>
            <th className={styles.ColNum}>{translate("reportQtyIn")}</th>
            <th className={styles.ColNum}>{translate("reportAmountIn")}</th>
            <th className={styles.ColNum}>{translate("reportQtyOut")}</th>
            <th className={styles.ColNum}>{translate("reportCogsOut")}</th>
            <th className={styles.ColNum}>{translate("reportSalePrice")}</th>
            <th className={styles.ColNum}>{translate("reportSaleAmount")}</th>
            <th className={styles.ColNum}>{translate("reportProfit")}</th>
            <th className={styles.ColNum}>{translate("reportClosingQty")}</th>
            <th className={styles.ColNum}>{translate("reportClosingAmount")}</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((row, idx) => (
            <tr key={row.productUuid}>
              <td className={styles.ColN}>{idx + 1}</td>
              <td className={styles.ColName}>
                <span className={styles.ClickableRow} style={{ cursor: "pointer", textDecoration: "underline" }}
                  onClick={() => openProductCard(row)}>{row.productName}</span>
              </td>
              <td className={styles.ColUom}>{row.accountCode}</td>
              <td className={styles.ColUom}>{row.sku}</td>
              <td className={styles.ColUom}>{row.uom}</td>
              <td className={`${styles.ColNum} ${styles.Cost}`}>{fmtAmt(row.unitCost)}</td>
              <td className={styles.ColNum}>{fmtQty(row.openQty)}</td>
              <td className={styles.ColNum}>{linkSum(row, row.openAmount)}</td>
              <td className={styles.ColNum}>{fmtQty(row.inQty)}</td>
              <td className={styles.ColNum}>{linkSum(row, row.inAmount)}</td>
              <td className={styles.ColNum}>{fmtQty(row.outQty)}</td>
              <td className={`${styles.ColNum} ${styles.Cost}`}>{linkSum(row, row.cogsOut)}</td>
              <td className={`${styles.ColNum} ${styles.SalePrice}`}>{fmtAmt(row.salePrice)}</td>
              <td className={`${styles.ColNum} ${styles.SalePrice}`}>{fmtAmt(row.saleAmount)}</td>
              <td className={`${styles.ColNum} ${row.profit < 0 ? styles.Loss : styles.Profit}`}>{fmtAmt(row.profit)}</td>
              <td className={styles.ColNum}>{fmtQtyZ(row.closeQty)}</td>
              <td className={styles.ColNum}>{linkSum(row, row.closeAmount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={styles.TotalRow}>
            <td colSpan={6}>{translate("total")}</td>
            <td className={styles.ColNum}>{fmtQtyZ(totals.openQty)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.openAmount)}</td>
            <td className={styles.ColNum}>{fmtQtyZ(totals.inQty)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.inAmount)}</td>
            <td className={styles.ColNum}>{fmtQtyZ(totals.outQty)}</td>
            <td className={`${styles.ColNum} ${styles.Cost}`}>{fmtAmtZ(totals.cogsOut)}</td>
            <td className={styles.ColNum}>—</td>
            <td className={`${styles.ColNum} ${styles.SalePrice}`}>{fmtAmtZ(totals.saleAmount)}</td>
            <td className={`${styles.ColNum} ${totals.profit < 0 ? styles.Loss : styles.Profit}`}>{fmtAmtZ(totals.profit)}</td>
            <td className={styles.ColNum}>{fmtQtyZ(totals.closeQty)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.closeAmount)}</td>
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
