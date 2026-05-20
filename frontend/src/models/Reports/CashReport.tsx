/**
 * Кассовый журнал — все ПКО и РКО за период.
 * Аналог формы КО-4 (Кассовая книга), применяемой в РК.
 * Показывает: приход (ПКО), расход (РКО) и остаток нарастающим итогом.
 */
import { FC, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupRow } from "src/components/UI";
import { getFormatDateOnly } from "src/utils/main.module";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import ReportPane from "src/components/ReportPane";
import reportStyles from "./report.module.scss";

interface CashRow {
  uuid: string;
  date: string;
  type: "receipt" | "expense";
  counterpartyName: string;
  contractName: string;
  amount: number;
  posted: boolean;
}

const fmt = (n: number) =>
  n.toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface CashReportProps {
  uniqId?: string;
  [key: string]: unknown;
}

const CashReport: FC<CashReportProps> = ({ uniqId }) => {
  const { organizationUuid: defaultOrgUuid, organizationName: defaultOrgName } = useDefaultOrganization();

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [orgUuid, setOrgUuid] = useState(defaultOrgUuid || "");
  const [orgName, setOrgName] = useState(defaultOrgName || "");

  const buildParams = useCallback((orgFilter: string) => {
    const p: Record<string, string> = { limit: "5000", sort: JSON.stringify({ date: "asc", id: "asc" }) };
    if (dateFrom) p["filter[dateRange][startDate]"] = dateFrom;
    if (dateTo) p["filter[dateRange][endDate]"] = dateTo;
    if (orgFilter) p["filter[organizationUuid][equals]"] = orgFilter;
    return p;
  }, [dateFrom, dateTo]);

  const { data: rows = [], isLoading } = useQuery<CashRow[]>({
    queryKey: ["report-cash", dateFrom, dateTo, orgUuid],
    queryFn: async () => {
      const params = buildParams(orgUuid);
      const [pkResp, rkResp] = await Promise.all([
        api.get<any>("cash-receipt-orders", { params }),
        api.get<any>("cash-expense-orders", { params }),
      ]);
      const pkItems: any[] = pkResp?.items ?? (Array.isArray(pkResp) ? pkResp : []);
      const rkItems: any[] = rkResp?.items ?? (Array.isArray(rkResp) ? rkResp : []);
      const toRow = (d: any, type: "receipt" | "expense"): CashRow => ({
        uuid: d.uuid,
        date: d.date?.slice(0, 10) ?? "",
        type,
        counterpartyName: d.counterparty?.shortName ?? "",
        contractName: d.contract?.shortName ?? "",
        amount: Number(d.amount ?? 0),
        posted: d.posted === true,
      });
      const all: CashRow[] = [
        ...pkItems.map(d => toRow(d, "receipt")),
        ...rkItems.map(d => toRow(d, "expense")),
      ];
      all.sort((a, b) => a.date.localeCompare(b.date));
      return all;
    },
    enabled: !!dateFrom && !!dateTo,
  });

  const totalReceipts = rows.filter(r => r.type === "receipt").reduce((s, r) => s + r.amount, 0);
  const totalExpenses = rows.filter(r => r.type === "expense").reduce((s, r) => s + r.amount, 0);
  const balance = totalReceipts - totalExpenses;

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="cr_from" value={dateFrom} onChange={e => setDateFrom(e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="cr_to" value={dateTo} onChange={e => setDateTo(e.target.value)} width="150px" />
      </GroupRow>
      <Group>
        <LookupField label={translate("organization")} name="cr_org" value={orgUuid} displayValue={orgName}
          endpoint="organizations" displayField="shortName"
          onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }}
          onClear={() => { setOrgUuid(""); setOrgName(""); }} />
      </Group>
    </>
  );

  let running = 0;

  const layout = (
    <>
      <div className={reportStyles.ReportSummary} style={{ marginBottom: "8mm", display: "flex", gap: "24px", fontSize: "10pt" }}>
        <span>{translate("reportTotalReceipts")}: <strong>{fmt(totalReceipts)}</strong></span>
        <span>{translate("reportTotalExpenses")}: <strong>{fmt(totalExpenses)}</strong></span>
        <span>
          {translate("reportCashBalance")}:{" "}
          <strong style={balance < 0 ? { color: "#dc2626" } : undefined}>{fmt(balance)}</strong>
        </span>
      </div>
      <table className={reportStyles.ReportTable}>
        <thead>
          <tr>
            <th>№</th>
            <th>{translate("reportDate")}</th>
            <th>{translate("reportOrderType")}</th>
            <th>{translate("reportCounterparty")}</th>
            <th>{translate("contract")}</th>
            <th className={reportStyles.NumCol} style={{ textAlign: "right" }}>{translate("reportIncoming")}</th>
            <th className={reportStyles.NumCol} style={{ textAlign: "right" }}>{translate("reportOutgoing")}</th>
            <th className={reportStyles.NumCol} style={{ textAlign: "right" }}>{translate("reportBalance")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const receipt = row.type === "receipt" ? row.amount : 0;
            const expense = row.type === "expense" ? row.amount : 0;
            running = running + receipt - expense;
            return (
              <tr key={row.uuid} className={!row.posted ? reportStyles.Unposted : undefined}>
                <td>{idx + 1}</td>
                <td>{getFormatDateOnly(row.date)}</td>
                <td>
                  <span className={row.type === "receipt" ? reportStyles.TagReceipt : reportStyles.TagExpense}>
                    {row.type === "receipt" ? translate("cashReceiptAbbr") : translate("cashExpenseAbbr")}
                  </span>
                </td>
                <td>{row.counterpartyName}</td>
                <td>{row.contractName}</td>
                <td className={reportStyles.NumCol} style={{ textAlign: "right" }}>{receipt > 0 ? fmt(receipt) : ""}</td>
                <td className={reportStyles.NumCol} style={{ textAlign: "right" }}>{expense > 0 ? fmt(expense) : ""}</td>
                <td className={`${reportStyles.NumCol} ${running < 0 ? reportStyles.Negative : ""}`}
                  style={{ textAlign: "right", ...(running < 0 ? { color: "#dc2626" } : {}) }}>
                  {fmt(running)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className={reportStyles.TotalRow} style={{ fontWeight: 600 }}>
            <td colSpan={5}>{translate("total")}</td>
            <td className={reportStyles.NumCol} style={{ textAlign: "right" }}>{fmt(totalReceipts)}</td>
            <td className={reportStyles.NumCol} style={{ textAlign: "right" }}>{fmt(totalExpenses)}</td>
            <td className={`${reportStyles.NumCol} ${balance < 0 ? reportStyles.Negative : ""}`}
              style={{ textAlign: "right", ...(balance < 0 ? { color: "#dc2626" } : {}) }}>
              {fmt(balance)}
            </td>
          </tr>
        </tfoot>
      </table>
    </>
  );

  return (
    <ReportPane
      uniqId={uniqId}
      form={form}
      layout={layout}
      isLoading={isLoading}
      isEmpty={!isLoading && rows.length === 0}
      fileBaseName={translate("CashReportList")}
      title={translate("CashReportList")}
    />
  );
};

CashReport.displayName = "CashReport";
export { CashReport };
