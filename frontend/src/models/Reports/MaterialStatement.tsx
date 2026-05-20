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
import reportStyles from "./report.module.scss";

interface ProductMovement {
  productUuid: string;
  productName: string;
  uom: string;
  qtyIn: number;
  amountIn: number;
  qtyOut: number;
  amountOut: number;
}

const fmt = (n: number) =>
  n.toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtQty = (n: number) =>
  n.toLocaleString("ru-KZ", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

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

  const buildParams = useCallback((orgFilter: string) => {
    const p: Record<string, string> = { limit: "5000" };
    if (dateFrom) p["filter[dateRange][startDate]"] = dateFrom;
    if (dateTo) p["filter[dateRange][endDate]"] = dateTo;
    if (orgFilter) p["filter[organizationUuid][equals]"] = orgFilter;
    if (warehouseUuid) p["filter[warehouseUuid][equals]"] = warehouseUuid;
    return p;
  }, [dateFrom, dateTo, warehouseUuid]);

  const { data: movements = [], isLoading } = useQuery<ProductMovement[]>({
    queryKey: ["report-material", dateFrom, dateTo, orgUuid, warehouseUuid],
    queryFn: async () => {
      const [purchItemsResp, saleItemsResp] = await Promise.all([
        api.get<any>("purchaseitems", { params: buildParams(orgUuid) }),
        api.get<any>("saleitems",     { params: buildParams(orgUuid) }),
      ]);
      const purchItems: any[] = purchItemsResp?.items ?? (Array.isArray(purchItemsResp) ? purchItemsResp : []);
      const saleItems:  any[] = saleItemsResp?.items  ?? (Array.isArray(saleItemsResp)  ? saleItemsResp  : []);
      const map = new Map<string, ProductMovement>();
      const getOrCreate = (item: any): ProductMovement => {
        const key = item.productUuid ?? item.product?.uuid ?? "unknown";
        if (!map.has(key)) {
          map.set(key, {
            productUuid: key,
            productName: item.product?.shortName ?? item.productName ?? key,
            uom: item.unitOfMeasure?.shortName ?? "",
            qtyIn: 0, amountIn: 0, qtyOut: 0, amountOut: 0,
          });
        }
        return map.get(key)!;
      };
      for (const it of purchItems) {
        const row = getOrCreate(it);
        row.qtyIn    += Number(it.quantity ?? 0);
        row.amountIn += Number(it.amount ?? (Number(it.quantity ?? 0) * Number(it.price ?? 0)));
      }
      for (const it of saleItems) {
        const row = getOrCreate(it);
        row.qtyOut    += Number(it.quantity ?? 0);
        row.amountOut += Number(it.amount ?? (Number(it.quantity ?? 0) * Number(it.price ?? 0)));
      }
      return Array.from(map.values()).sort((a, b) => a.productName.localeCompare(b.productName));
    },
    enabled: !!dateFrom && !!dateTo,
  });

  const totals = movements.reduce(
    (acc, r) => ({
      qtyIn:    acc.qtyIn    + r.qtyIn,
      amountIn: acc.amountIn + r.amountIn,
      qtyOut:   acc.qtyOut   + r.qtyOut,
      amountOut: acc.amountOut + r.amountOut,
    }),
    { qtyIn: 0, amountIn: 0, qtyOut: 0, amountOut: 0 },
  );

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="ms_from" value={dateFrom} onChange={e => setDateFrom(e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="ms_to" value={dateTo} onChange={e => setDateTo(e.target.value)} width="150px" />
      </GroupRow>
      <Group>
        <LookupField label={translate("organization")} name="ms_org" value={orgUuid} displayValue={orgName}
          endpoint="organizations" displayField="shortName"
          onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }}
          onClear={() => { setOrgUuid(""); setOrgName(""); }} />
        <LookupField label={translate("warehouse")} name="ms_wh" value={warehouseUuid} displayValue={warehouseName}
          endpoint="warehouses" displayField="shortName"
          onSelect={(u, d) => { setWarehouseUuid(u); setWarehouseName(d); }}
          onClear={() => { setWarehouseUuid(""); setWarehouseName(""); }}
          extraParams={orgUuid ? { organizationUuid: orgUuid } : undefined} />
      </Group>
    </>
  );

  const layout = (
    <table className={reportStyles.ReportTable}>
      <thead>
        <tr>
          <th>№</th>
          <th>{translate("reportProduct")}</th>
          <th>{translate("reportUom")}</th>
          <th className={reportStyles.NumCol} style={{ textAlign: "right" }}>{translate("reportQtyIn")}</th>
          <th className={reportStyles.NumCol} style={{ textAlign: "right" }}>{translate("reportAmountIn")}</th>
          <th className={reportStyles.NumCol} style={{ textAlign: "right" }}>{translate("reportQtyOut")}</th>
          <th className={reportStyles.NumCol} style={{ textAlign: "right" }}>{translate("reportAmountOut")}</th>
          <th className={reportStyles.NumCol} style={{ textAlign: "right" }}>{translate("reportBalance")}</th>
        </tr>
      </thead>
      <tbody>
        {movements.map((row, idx) => {
          const netQty = row.qtyIn - row.qtyOut;
          return (
            <tr key={row.productUuid}>
              <td>{idx + 1}</td>
              <td>{row.productName}</td>
              <td>{row.uom}</td>
              <td className={reportStyles.NumCol} style={{ textAlign: "right" }}>{fmtQty(row.qtyIn)}</td>
              <td className={reportStyles.NumCol} style={{ textAlign: "right" }}>{fmt(row.amountIn)}</td>
              <td className={reportStyles.NumCol} style={{ textAlign: "right" }}>{fmtQty(row.qtyOut)}</td>
              <td className={reportStyles.NumCol} style={{ textAlign: "right" }}>{fmt(row.amountOut)}</td>
              <td className={reportStyles.NumCol} style={{ textAlign: "right" }}>{fmtQty(netQty)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className={reportStyles.TotalRow} style={{ fontWeight: 600 }}>
          <td colSpan={3}>{translate("total")}</td>
          <td className={reportStyles.NumCol} style={{ textAlign: "right" }}>{fmtQty(totals.qtyIn)}</td>
          <td className={reportStyles.NumCol} style={{ textAlign: "right" }}>{fmt(totals.amountIn)}</td>
          <td className={reportStyles.NumCol} style={{ textAlign: "right" }}>{fmtQty(totals.qtyOut)}</td>
          <td className={reportStyles.NumCol} style={{ textAlign: "right" }}>{fmt(totals.amountOut)}</td>
          <td className={reportStyles.NumCol} style={{ textAlign: "right" }}>{fmtQty(totals.qtyIn - totals.qtyOut)}</td>
        </tr>
      </tfoot>
    </table>
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
    />
  );
};

MaterialStatement.displayName = "MaterialStatement";
export { MaterialStatement };
