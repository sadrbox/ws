/**
 * Регистр товаров — экран просмотра движений (приход/расход) и остатков.
 * Данные формируются автоматически при проведении документов
 * (Поступление, Реализация, Перемещение ТМЗ, Возвраты). В регистр попадают
 * ТОЛЬКО проведённые документы (posted=true).
 */
import { FC, useState, useCallback } from "react";
import { usePersistentState } from "src/hooks/usePersistentState";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate, FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import ReportPane from "src/components/ReportPane";
import { getFormatDateOnly } from "src/utils/datetime";
import styles from "./report.module.scss";
import reportCss from "./report.module.scss?inline";

// ─── форматтеры ───────────────────────────────────────────────────────────────
const fmtAmt = (n: number) =>
  n !== 0 ? n.toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const fmtQty = (n: number) =>
  n !== 0 ? n.toLocaleString("ru-KZ", { minimumFractionDigits: 0, maximumFractionDigits: 4 }) : "—";
const fmtAmtZ = (n: number) =>
  n.toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQtyZ = (n: number) =>
  n.toLocaleString("ru-KZ", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

function formatPeriod(from: string, to: string): string {
  if (!from) return "";
  const f = getFormatDateOnly(from) || from;
  const t = to ? getFormatDateOnly(to) || to : "";
  return t ? `${f} — ${t}` : f;
}

// Человекочитаемые названия документов-регистраторов.
const DOC_TYPE_LABELS: Record<string, string> = {
  purchase: "Поступление",
  sale: "Реализация",
  inventory_transfer: "Перемещение ТМЗ",
  sale_return: "Возврат от покупателя",
  purchase_return: "Возврат поставщику",
};

interface MovementRow {
  id: number;
  date: string;
  movementType: "in" | "out";
  quantity: number | string;
  amount: number | string;
  documentType: string;
  documentId: number | null;
  product?: { name?: string } | null;
  warehouse?: { name?: string } | null;
  unitOfMeasure?: { name?: string } | null;
}

interface BalanceRow {
  productUuid: string | null;
  productName: string;
  warehouseName: string;
  unitName: string;
  quantity: number;
  amount: number;
}

interface ProductRegisterReportProps {
  uniqId?: string;
  [key: string]: unknown;
}

const VIEW_OPTIONS = [
  { value: "movements", label: translate("registerMovements") },
  { value: "balances", label: translate("registerBalances") },
];

const ProductRegisterReport: FC<ProductRegisterReportProps> = ({ uniqId }) => {
  const { organizationUuid: defaultOrgUuid, organizationName: defaultOrgName } = useDefaultOrganization();

  const [view, setView] = useState<"movements" | "balances">("movements");
  const [dateFrom, setDateFrom] = usePersistentState("report.product-register.dateFrom", () => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = usePersistentState("report.product-register.dateTo", () => new Date().toISOString().slice(0, 10));
  const [orgUuid, setOrgUuid] = usePersistentState("report.product-register.orgUuid", defaultOrgUuid || "");
  const [orgName, setOrgName] = usePersistentState("report.product-register.orgName", defaultOrgName || "");
  const [warehouseUuid, setWarehouseUuid] = usePersistentState("report.product-register.warehouseUuid", "");
  const [warehouseName, setWarehouseName] = usePersistentState("report.product-register.warehouseName", "");
  const [productUuid, setProductUuid] = usePersistentState("report.product-register.productUuid", "");
  const [productName, setProductName] = usePersistentState("report.product-register.productName", "");

  // Отчёт формируется только по кнопке «Сформировать» (snapshot параметров).
  // view (Движения/Остатки) переключается независимо — на применённых параметрах.
  const [applied, setApplied] = useState<null | {
    dateFrom: string; dateTo: string; orgUuid: string; warehouseUuid: string; productUuid: string;
  }>(null);

  // Даты и фильтры необязательны: пустая дата → период не ограничивается
  // с этой стороны; пустой фильтр (Организация/Склад/Номенклатура) → без учёта фильтра.
  const handleGenerate = useCallback(() => {
    setApplied({ dateFrom, dateTo, orgUuid, warehouseUuid, productUuid });
  }, [dateFrom, dateTo, orgUuid, warehouseUuid, productUuid]);

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
  const period = formatPeriod(dateFrom, dateTo);

  // Итоги движений (приход/расход).
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
  const balTotals = balances.reduce(
    (acc, r) => ({ quantity: acc.quantity + r.quantity, amount: acc.amount + r.amount }),
    { quantity: 0, amount: 0 },
  );

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="pr_from" value={dateFrom} onChange={e => setDateFrom(e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="pr_to" value={dateTo} onChange={e => setDateTo(e.target.value)} width="150px" />
      </GroupRow>
      <GroupRow>
        <FieldSelect label={translate("registerMovements") + " / " + translate("registerBalances")}
          name="pr_view" value={view} options={VIEW_OPTIONS}
          onChange={e => setView(e.target.value as "movements" | "balances")} />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="pr_org" value={orgUuid} displayValue={orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }}
          onClear={() => { setOrgUuid(""); setOrgName(""); }} />
        <LookupField label={translate("warehouse")} name="pr_wh" value={warehouseUuid} displayValue={warehouseName}
          endpoint="warehouses" displayField="name"
          onSelect={(u, d) => { setWarehouseUuid(u); setWarehouseName(d); }}
          onClear={() => { setWarehouseUuid(""); setWarehouseName(""); }}
          extraParams={orgUuid ? { organizationUuid: orgUuid } : undefined} />
        <LookupField label={translate("reportProduct")} name="pr_prod" value={productUuid} displayValue={productName}
          endpoint="products" displayField="name"
          onSelect={(u, d) => { setProductUuid(u); setProductName(d); }}
          onClear={() => { setProductUuid(""); setProductName(""); }} />
      </GroupCol>
    </>
  );

  const movementsTable = (
    <table className={styles.Table}>
      <thead>
        <tr>
          <th className={styles.ColN}>№</th>
          <th className={styles.ColDate}>{translate("date")}</th>
          <th className={styles.ColName}>{translate("registerDocument")}</th>
          <th className={styles.ColTag}>{translate("registerMovementType")}</th>
          <th className={styles.ColName}>{translate("reportProduct")}</th>
          <th className={styles.ColName}>{translate("warehouse")}</th>
          <th className={styles.ColUom}>{translate("reportUom")}</th>
          <th className={styles.ColNum}>{translate("registerReceipt")}</th>
          <th className={styles.ColNum}>{translate("registerExpense")}</th>
          <th className={styles.ColNum}>{translate("amount")}</th>
        </tr>
      </thead>
      <tbody>
        {movements.map((r, idx) => {
          const isIn = r.movementType === "in";
          const docLabel = `${DOC_TYPE_LABELS[r.documentType] ?? r.documentType}${r.documentId ? ` № ${r.documentId}` : ""}`;
          return (
            <tr key={r.id}>
              <td className={styles.ColN}>{idx + 1}</td>
              <td className={styles.ColDate}>{r.date ? getFormatDateOnly(String(r.date)) : ""}</td>
              <td className={styles.ColName}>{docLabel}</td>
              <td className={styles.ColTag}>
                <span className={isIn ? styles.TagReceipt : styles.TagExpense}>
                  {isIn ? translate("registerReceipt") : translate("registerExpense")}
                </span>
              </td>
              <td className={styles.ColName}>{r.product?.name ?? ""}</td>
              <td className={styles.ColName}>{r.warehouse?.name ?? ""}</td>
              <td className={styles.ColUom}>{r.unitOfMeasure?.name ?? ""}</td>
              <td className={styles.ColNum}>{isIn ? fmtQty(Number(r.quantity) || 0) : "—"}</td>
              <td className={styles.ColNum}>{!isIn ? fmtQty(Number(r.quantity) || 0) : "—"}</td>
              <td className={styles.ColNum}>{fmtAmt(Number(r.amount) || 0)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className={styles.TotalRow}>
          <td colSpan={7}>{translate("total")}</td>
          <td className={styles.ColNum}>{fmtQtyZ(movTotals.qtyIn)}</td>
          <td className={styles.ColNum}>{fmtQtyZ(movTotals.qtyOut)}</td>
          <td className={styles.ColNum}>{fmtAmtZ(movTotals.amountIn)} / {fmtAmtZ(movTotals.amountOut)}</td>
        </tr>
      </tfoot>
    </table>
  );

  const balancesTable = (
    <table className={styles.Table}>
      <thead>
        <tr>
          <th className={styles.ColN}>№</th>
          <th className={styles.ColName}>{translate("reportProduct")}</th>
          <th className={styles.ColName}>{translate("warehouse")}</th>
          <th className={styles.ColUom}>{translate("reportUom")}</th>
          <th className={styles.ColNum}>{translate("reportBalance")}</th>
          <th className={styles.ColNum}>{translate("amount")}</th>
        </tr>
      </thead>
      <tbody>
        {balances.map((r, idx) => (
          <tr key={`${r.productUuid}-${idx}`}>
            <td className={styles.ColN}>{idx + 1}</td>
            <td className={styles.ColName}>{r.productName}</td>
            <td className={styles.ColName}>{r.warehouseName}</td>
            <td className={styles.ColUom}>{r.unitName}</td>
            <td className={`${styles.ColNum}${r.quantity < 0 ? " " + styles.Negative : ""}`}>{fmtQtyZ(r.quantity)}</td>
            <td className={`${styles.ColNum}${r.amount < 0 ? " " + styles.Negative : ""}`}>{fmtAmtZ(r.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className={styles.TotalRow}>
          <td colSpan={4}>{translate("total")}</td>
          <td className={styles.ColNum}>{fmtQtyZ(balTotals.quantity)}</td>
          <td className={styles.ColNum}>{fmtAmtZ(balTotals.amount)}</td>
        </tr>
      </tfoot>
    </table>
  );

  const layout = (
    <div className={styles.Report}>
      {orgName && <div className={styles.OrgName}>{orgName}</div>}
      <div className={styles.Title}>
        {translate("ProductRegisterList")} — {view === "movements" ? translate("registerMovements") : translate("registerBalances")}
      </div>
      {period && <div className={styles.SubTitle}>{translate("reportPeriodLabel")} {period}</div>}
      {warehouseName && (
        <div className={styles.SortLine}>{translate("warehouse")} — {warehouseName}</div>
      )}
      {view === "movements" ? movementsTable : balancesTable}
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
      fileBaseName={translate("ProductRegisterList")}
      title={translate("ProductRegisterList")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

ProductRegisterReport.displayName = "ProductRegisterReport";
export { ProductRegisterReport };
