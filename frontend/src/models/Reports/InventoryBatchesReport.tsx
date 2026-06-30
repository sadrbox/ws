/**
 * InventoryBatchesReport — остатки по ПАРТИЯМ (ФИФО-слои) на дату.
 * Источник — /reports/inventory-batches. По каждому товару непогашенные слои
 * прихода: дата прихода, остаток кол-ва, себестоимость единицы, сумма. Слои
 * потребляются oldest→newest — согласовано с ФИФО-себестоимостью списания.
 */
import { FC, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import ReportPane from "src/components/ReportPane";
import { ReportSheet, ReportTable, Th, Td, TotalRow, Money } from "./_shared/reportLayout";
import { useReportFilters } from "./_shared/useReportFilters";
import { today } from "./_shared/reportDates";
import reportCss from "./report.module.scss?inline";

const fmtQty = (n: number) => Number(n || 0).toLocaleString("ru-KZ", { maximumFractionDigits: 3 });
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("ru-KZ") : "—");

interface Batch { date: string; qty: number; unitCost: number; amount: number }
interface ApiItem { productUuid: string | null; productName: string; sku: string; warehouseName: string; uom: string; batches: Batch[]; totalQty: number; totalAmount: number }
interface FlatRow { productUuid: string | null; productName: string; sku: string; warehouseName: string; uom: string; date: string; qty: number; unitCost: number; amount: number; firstOfProduct: boolean }
interface Filters extends Record<string, unknown> { dateTo: string; orgUuid: string; orgName: string; whUuid: string; whName: string; productUuid: string; productName: string }
interface Props { uniqId?: string;[key: string]: unknown }

const InventoryBatchesReport: FC<Props> = ({ uniqId }) => {
  const def = useDefaultOrganization();

  const { fields, setField, patch, applied, handleGenerate } = useReportFilters<Filters>({
    persistKey: "report.batches",
    defaults: { dateTo: today(), orgUuid: def.organizationUuid || "", orgName: def.organizationName || "", whUuid: "", whName: "", productUuid: "", productName: "" },
  });

  const { data, isLoading, isError } = useQuery<ApiItem[]>({
    queryKey: ["report-batches", applied],
    queryFn: async () => {
      const p: Record<string, string> = {};
      const f = applied!;
      if (f.dateTo) p.dateTo = f.dateTo;
      if (f.orgUuid) p.organizationUuid = f.orgUuid;
      if (f.whUuid) p.warehouseUuid = f.whUuid;
      if (f.productUuid) p.productUuid = f.productUuid;
      const resp = await api.get<any>("reports/inventory-batches", { params: p });
      return resp?.items ?? [];
    },
    enabled: !!applied,
    retry: 1,
  });

  const rows: FlatRow[] = useMemo(() => (data ?? []).flatMap((it) =>
    it.batches.map((b, i) => ({
      productUuid: it.productUuid, productName: it.productName, sku: it.sku, warehouseName: it.warehouseName, uom: it.uom,
      date: b.date, qty: b.qty, unitCost: b.unitCost, amount: b.amount, firstOfProduct: i === 0,
    })),
  ), [data]);

  const totalAmount = useMemo(() => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0), [rows]);

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportAsOfDate")} name="ib_to" value={fields.dateTo} onChange={e => setField("dateTo", e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="ib_org" value={fields.orgUuid} displayValue={fields.orgName} endpoint="organizations" displayField="name"
          onSelect={(u, d) => patch({ orgUuid: u, orgName: d })} onClear={() => patch({ orgUuid: "", orgName: "" })} />
        <LookupField label={translate("warehouse")} name="ib_wh" value={fields.whUuid} displayValue={fields.whName} endpoint="warehouses" displayField="name"
          extraParams={fields.orgUuid ? { organizationUuid: fields.orgUuid } : undefined}
          onSelect={(u, d) => patch({ whUuid: u, whName: d })} onClear={() => patch({ whUuid: "", whName: "" })} />
        <LookupField label={translate("reportProduct")} name="ib_prod" value={fields.productUuid} displayValue={fields.productName} endpoint="products" displayField="name"
          onSelect={(u, d) => patch({ productUuid: u, productName: d })} onClear={() => patch({ productUuid: "", productName: "" })} />
      </GroupCol>
    </>
  );

  const layout = (
    <ReportSheet org={fields.orgName || undefined} title={translate("inventoryBatches")}>
      <ReportTable>
        <thead>
          <tr>
            <Th col="n">№</Th>
            <Th col="name">{translate("reportProduct")}</Th>
            <Th col="name">{translate("sku")}</Th>
            <Th col="name">{translate("warehouse")}</Th>
            <Th col="num">{translate("reportArrivalDate")}</Th>
            <Th col="num">{translate("quantity")}</Th>
            <Th col="num">{translate("reportUnitCost")}</Th>
            <Th col="num">{translate("amount")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={`${r.productUuid ?? "x"}-${idx}`}>
              <Td col="n">{idx + 1}</Td>
              <Td col="name">{r.firstOfProduct ? r.productName : ""}</Td>
              <Td col="name">{r.firstOfProduct ? r.sku : ""}</Td>
              <Td col="name">{r.firstOfProduct ? r.warehouseName : ""}</Td>
              <Td col="num">{fmtDate(r.date)}</Td>
              <Td col="num">{fmtQty(r.qty)}{r.uom ? ` ${r.uom}` : ""}</Td>
              <Td col="num"><Money value={r.unitCost} /></Td>
              <Td col="num"><Money value={r.amount} /></Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <TotalRow>
            <Td colSpan={7}>{translate("total")}</Td>
            <Td col="num"><Money value={totalAmount} as="zeroMoney" /></Td>
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
      fileBaseName={translate("inventoryBatches")}
      title={translate("inventoryBatches")}
      orientation="portrait"
      sheetFit="content"
    />
  );
};

InventoryBatchesReport.displayName = "InventoryBatchesReport";
export { InventoryBatchesReport };
export default InventoryBatchesReport;
