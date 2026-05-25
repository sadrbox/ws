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
import { getFormatDateOnly } from "src/utils/main.module";
import styles from "./report.module.scss";

interface ProductMovement {
  productUuid: string;
  productName: string;
  uom: string;
  qtyIn: number;
  amountIn: number;
  qtyOut: number;
  amountOut: number;
}

const fmtAmt = (n: number) =>
  n !== 0
    ? n.toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

const fmtQty = (n: number) =>
  n !== 0
    ? n.toLocaleString("ru-KZ", { minimumFractionDigits: 0, maximumFractionDigits: 3 })
    : "—";

const fmtAmtZ = (n: number) =>
  n.toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtQtyZ = (n: number) =>
  n.toLocaleString("ru-KZ", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

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

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [orgUuid, setOrgUuid] = useState(defaultOrgUuid || "");
  const [orgName, setOrgName] = useState(defaultOrgName || "");
  const [warehouseUuid, setWarehouseUuid] = useState("");
  const [warehouseName, setWarehouseName] = useState("");

  const buildParams = useCallback(() => {
    const p: Record<string, string> = {};
    if (dateFrom) p.dateFrom = dateFrom;
    if (dateTo) p.dateTo = dateTo;
    if (orgUuid) p.organizationUuid = orgUuid;
    if (warehouseUuid) p.warehouseUuid = warehouseUuid;
    return p;
  }, [dateFrom, dateTo, orgUuid, warehouseUuid]);

  const { data: movements = [], isLoading } = useQuery<ProductMovement[]>({
    queryKey: ["report-material", dateFrom, dateTo, orgUuid, warehouseUuid],
    queryFn: async () => {
      const resp = await api.get<any>("reports/material-statement", { params: buildParams() });
      return resp?.items ?? [];
    },
    enabled: !!dateFrom && !!dateTo,
  });

  const totals = movements.reduce(
    (acc, r) => ({
      qtyIn:     acc.qtyIn     + r.qtyIn,
      amountIn:  acc.amountIn  + r.amountIn,
      qtyOut:    acc.qtyOut    + r.qtyOut,
      amountOut: acc.amountOut + r.amountOut,
    }),
    { qtyIn: 0, amountIn: 0, qtyOut: 0, amountOut: 0 },
  );

  const period = formatPeriod(dateFrom, dateTo);

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="ms_from" value={dateFrom} onChange={e => setDateFrom(e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="ms_to" value={dateTo} onChange={e => setDateTo(e.target.value)} width="150px" />
      </GroupRow>
      <Group>
        <LookupField label={translate("organization")} name="ms_org" value={orgUuid} displayValue={orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }}
          onClear={() => { setOrgUuid(""); setOrgName(""); }} />
        <LookupField label={translate("warehouse")} name="ms_wh" value={warehouseUuid} displayValue={warehouseName}
          endpoint="warehouses" displayField="name"
          onSelect={(u, d) => { setWarehouseUuid(u); setWarehouseName(d); }}
          onClear={() => { setWarehouseUuid(""); setWarehouseName(""); }}
          extraParams={orgUuid ? { organizationUuid: orgUuid } : undefined} />
      </Group>
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
            <th className={styles.ColUom}>{translate("reportUom")}</th>
            <th className={styles.ColNum}>{translate("reportQtyIn")}</th>
            <th className={styles.ColNum}>{translate("reportAmountIn")}</th>
            <th className={styles.ColNum}>{translate("reportQtyOut")}</th>
            <th className={styles.ColNum}>{translate("reportAmountOut")}</th>
            <th className={styles.ColNum}>{translate("reportBalance")}</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((row, idx) => {
            const netQty = row.qtyIn - row.qtyOut;
            return (
              <tr key={row.productUuid}>
                <td className={styles.ColN}>{idx + 1}</td>
                <td className={styles.ColName}>{row.productName}</td>
                <td className={styles.ColUom}>{row.uom}</td>
                <td className={styles.ColNum}>{fmtQty(row.qtyIn)}</td>
                <td className={styles.ColNum}>{fmtAmt(row.amountIn)}</td>
                <td className={styles.ColNum}>{fmtQty(row.qtyOut)}</td>
                <td className={styles.ColNum}>{fmtAmt(row.amountOut)}</td>
                <td className={styles.ColNum}>{fmtQtyZ(netQty)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className={styles.TotalRow}>
            <td colSpan={3}>{translate("total")}</td>
            <td className={styles.ColNum}>{fmtQtyZ(totals.qtyIn)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.amountIn)}</td>
            <td className={styles.ColNum}>{fmtQtyZ(totals.qtyOut)}</td>
            <td className={styles.ColNum}>{fmtAmtZ(totals.amountOut)}</td>
            <td className={styles.ColNum}>{fmtQtyZ(totals.qtyIn - totals.qtyOut)}</td>
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
      isEmpty={!isLoading && movements.length === 0}
      fileBaseName={translate("MaterialStatementList")}
      title={translate("MaterialStatementList")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

MaterialStatement.displayName = "MaterialStatement";
export { MaterialStatement };
