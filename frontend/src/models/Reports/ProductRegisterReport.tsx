/**
 * Регистр товаров — движения (приход/расход) и остатки. В регистр попадают
 * ТОЛЬКО проведённые документы. Переключатель «Движения/Остатки» работает на уже
 * применённых параметрах (snapshot по кнопке «Сформировать»).
 */
import { FC, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate, FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import ReportPane from "src/components/ReportPane";
import { ReportSheet, ReportTable, Th, Td, TotalRow, Money, DirectionTag } from "./_shared/reportLayout";
import { useReportFilters } from "./_shared/useReportFilters";
import { firstOfMonth, today } from "./_shared/reportDates";
import { fmtQty, fmtQtyZero, fmtDate, fmtPeriod } from "./_shared/reportFormat";
import reportCss from "./report.module.scss?inline";

// Человекочитаемые названия документов-регистраторов.
const DOC_TYPE_LABELS: Record<string, string> = {
  purchase: "Поступление",
  sale: "Реализация",
  inventory_transfer: "Перемещение ТМЗ",
  sale_return: "Возврат от покупателя",
  purchase_return: "Возврат поставщику",
};

interface MovementRow {
  id: number; date: string; movementType: "in" | "out";
  quantity: number | string; amount: number | string;
  documentType: string; documentId: number | null;
  product?: { name?: string } | null; warehouse?: { name?: string } | null; unitOfMeasure?: { name?: string } | null;
}
interface BalanceRow { productUuid: string | null; productName: string; warehouseName: string; unitName: string; quantity: number; amount: number }
interface Filters extends Record<string, unknown> {
  dateFrom: string; dateTo: string; orgUuid: string; orgName: string;
  warehouseUuid: string; warehouseName: string; productUuid: string; productName: string;
}
interface ProductRegisterReportProps { uniqId?: string;[key: string]: unknown }

const VIEW_OPTIONS = [
  { value: "movements", label: translate("registerMovements") },
  { value: "balances", label: translate("registerBalances") },
];

const ProductRegisterReport: FC<ProductRegisterReportProps> = ({ uniqId }) => {
  const def = useDefaultOrganization();
  const [view, setView] = useState<"movements" | "balances">("movements");

  const { fields, setField, patch, applied, handleGenerate } = useReportFilters<Filters>({
    persistKey: "report.product-register",
    defaults: { dateFrom: firstOfMonth(), dateTo: today(), orgUuid: def.organizationUuid || "", orgName: def.organizationName || "", warehouseUuid: "", warehouseName: "", productUuid: "", productName: "" },
  });

  const buildAppliedParams = useCallback(() => {
    const p: Record<string, string> = {};
    if (!applied) return p;
    if (applied.dateFrom) p.dateFrom = applied.dateFrom;
    if (applied.dateTo) p.dateTo = applied.dateTo;
    if (applied.orgUuid) p.organizationUuid = applied.orgUuid;
    if (applied.warehouseUuid) p.warehouseUuid = applied.warehouseUuid;
    if (applied.productUuid) p.productUuid = applied.productUuid;
    return p;
  }, [applied]);

  const { data: movements = [], isLoading: loadingMov } = useQuery<MovementRow[]>({
    queryKey: ["product-register", "movements", applied],
    queryFn: async () => {
      const resp = await api.get<any>("product-register", { params: buildAppliedParams() });
      return resp?.items ?? [];
    },
    enabled: view === "movements" && !!applied,
  });

  const { data: balances = [], isLoading: loadingBal } = useQuery<BalanceRow[]>({
    queryKey: ["product-register", "balances", applied],
    queryFn: async () => {
      const resp = await api.get<any>("product-register/balances", { params: buildAppliedParams() });
      return resp?.items ?? [];
    },
    enabled: view === "balances" && !!applied,
  });

  const isLoading = view === "movements" ? loadingMov : loadingBal;
  const isEmpty = view === "movements"
    ? !loadingMov && (!applied || movements.length === 0)
    : !loadingBal && (!applied || balances.length === 0);
  const period = fmtPeriod(fields.dateFrom, fields.dateTo);

  const movTotals = movements.reduce(
    (acc, r) => {
      const qty = Number(r.quantity) || 0;
      const amt = Number(r.amount) || 0;
      if (r.movementType === "in") { acc.qtyIn += qty; acc.amountIn += amt; }
      else { acc.qtyOut += qty; acc.amountOut += amt; }
      return acc;
    },
    { qtyIn: 0, amountIn: 0, qtyOut: 0, amountOut: 0 },
  );
  const balTotals = balances.reduce((acc, r) => ({ quantity: acc.quantity + r.quantity, amount: acc.amount + r.amount }), { quantity: 0, amount: 0 });

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="pr_from" value={fields.dateFrom} onChange={e => setField("dateFrom", e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="pr_to" value={fields.dateTo} onChange={e => setField("dateTo", e.target.value)} width="150px" />
      </GroupRow>
      <GroupRow>
        <FieldSelect label={translate("registerMovements") + " / " + translate("registerBalances")}
          name="pr_view" value={view} options={VIEW_OPTIONS}
          onChange={e => setView(e.target.value as "movements" | "balances")} />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="pr_org" value={fields.orgUuid} displayValue={fields.orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => patch({ orgUuid: u, orgName: d })} onClear={() => patch({ orgUuid: "", orgName: "" })} />
        <LookupField label={translate("warehouse")} name="pr_wh" value={fields.warehouseUuid} displayValue={fields.warehouseName}
          endpoint="warehouses" displayField="name"
          onSelect={(u, d) => patch({ warehouseUuid: u, warehouseName: d })} onClear={() => patch({ warehouseUuid: "", warehouseName: "" })}
          extraParams={fields.orgUuid ? { organizationUuid: fields.orgUuid } : undefined} />
        <LookupField label={translate("reportProduct")} name="pr_prod" value={fields.productUuid} displayValue={fields.productName}
          endpoint="products" displayField="name"
          onSelect={(u, d) => patch({ productUuid: u, productName: d })} onClear={() => patch({ productUuid: "", productName: "" })} />
      </GroupCol>
    </>
  );

  const movementsTable = (
    <ReportTable>
      <thead>
        <tr>
          <Th col="n">№</Th>
          <Th col="date">{translate("date")}</Th>
          <Th col="name">{translate("registerDocument")}</Th>
          <Th col="tag">{translate("registerMovementType")}</Th>
          <Th col="name">{translate("reportProduct")}</Th>
          <Th col="name">{translate("warehouse")}</Th>
          <Th col="uom">{translate("reportUom")}</Th>
          <Th col="num">{translate("registerReceipt")}</Th>
          <Th col="num">{translate("registerExpense")}</Th>
          <Th col="num">{translate("amount")}</Th>
        </tr>
      </thead>
      <tbody>
        {movements.map((r, idx) => {
          const isIn = r.movementType === "in";
          const docLabel = `${DOC_TYPE_LABELS[r.documentType] ?? r.documentType}${r.documentId ? ` № ${r.documentId}` : ""}`;
          return (
            <tr key={r.id}>
              <Td col="n">{idx + 1}</Td>
              <Td col="date">{fmtDate(r.date)}</Td>
              <Td col="name">{docLabel}</Td>
              <Td col="tag">
                <DirectionTag dir={isIn ? "receipt" : "expense"}>
                  {isIn ? translate("registerReceipt") : translate("registerExpense")}
                </DirectionTag>
              </Td>
              <Td col="name">{r.product?.name ?? ""}</Td>
              <Td col="name">{r.warehouse?.name ?? ""}</Td>
              <Td col="uom">{r.unitOfMeasure?.name ?? ""}</Td>
              <Td col="num">{isIn ? fmtQty(Number(r.quantity) || 0) : "—"}</Td>
              <Td col="num">{!isIn ? fmtQty(Number(r.quantity) || 0) : "—"}</Td>
              <Td col="num"><Money value={Number(r.amount) || 0} /></Td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <TotalRow>
          <Td colSpan={7}>{translate("total")}</Td>
          <Td col="num">{fmtQtyZero(movTotals.qtyIn)}</Td>
          <Td col="num">{fmtQtyZero(movTotals.qtyOut)}</Td>
          <Td col="num"><Money value={movTotals.amountIn} as="zeroMoney" /> / <Money value={movTotals.amountOut} as="zeroMoney" /></Td>
        </TotalRow>
      </tfoot>
    </ReportTable>
  );

  const balancesTable = (
    <ReportTable>
      <thead>
        <tr>
          <Th col="n">№</Th>
          <Th col="name">{translate("reportProduct")}</Th>
          <Th col="name">{translate("warehouse")}</Th>
          <Th col="uom">{translate("reportUom")}</Th>
          <Th col="num">{translate("reportBalance")}</Th>
          <Th col="num">{translate("amount")}</Th>
        </tr>
      </thead>
      <tbody>
        {balances.map((r, idx) => (
          <tr key={`${r.productUuid}-${idx}`}>
            <Td col="n">{idx + 1}</Td>
            <Td col="name">{r.productName}</Td>
            <Td col="name">{r.warehouseName}</Td>
            <Td col="uom">{r.unitName}</Td>
            <Td col="num" variant={r.quantity < 0 ? "neg" : undefined}>{fmtQtyZero(r.quantity)}</Td>
            <Td col="num" variant={r.amount < 0 ? "neg" : undefined}><Money value={r.amount} as="zeroMoney" /></Td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <TotalRow>
          <Td colSpan={4}>{translate("total")}</Td>
          <Td col="num">{fmtQtyZero(balTotals.quantity)}</Td>
          <Td col="num"><Money value={balTotals.amount} as="zeroMoney" /></Td>
        </TotalRow>
      </tfoot>
    </ReportTable>
  );

  const layout = (
    <ReportSheet
      org={fields.orgName || undefined}
      title={`${translate("ProductRegisterList")} — ${view === "movements" ? translate("registerMovements") : translate("registerBalances")}`}
      subTitle={period ? `${translate("reportPeriodLabel")} ${period}` : undefined}
      sortLine={fields.warehouseName ? `${translate("warehouse")} — ${fields.warehouseName}` : undefined}
    >
      {view === "movements" ? movementsTable : balancesTable}
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
      fileBaseName={translate("ProductRegisterList")}
      title={translate("ProductRegisterList")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

ProductRegisterReport.displayName = "ProductRegisterReport";
export { ProductRegisterReport };
