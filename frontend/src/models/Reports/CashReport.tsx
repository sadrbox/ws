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
import { GroupCol, GroupRow } from "src/components/UI";
import { getFormatDateOnly } from "src/utils/datetime";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import ReportPane from "src/components/ReportPane";
import styles from "./report.module.scss";

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

function formatPeriod(from: string, to: string): string {
  if (!from) return "";
  const f = getFormatDateOnly(from) || from;
  const t = to ? getFormatDateOnly(to) || to : "";
  return t ? `${f} — ${t}` : f;
}

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

  // Отчёт формируется только по кнопке «Сформировать» (snapshot параметров).
  const [applied, setApplied] = useState<null | {
    dateFrom: string; dateTo: string; orgUuid: string;
  }>(null);

  // Даты и фильтры необязательны: пустая дата → период не ограничивается
  // с этой стороны; пустой фильтр (Организация) → без учёта фильтра.
  const handleGenerate = useCallback(() => {
    setApplied({ dateFrom, dateTo, orgUuid });
  }, [dateFrom, dateTo, orgUuid]);

  const { data: rows = [], isLoading } = useQuery<CashRow[]>({
    queryKey: ["report-cash", applied],
    queryFn: async () => {
      const params: Record<string, string> = { limit: "5000", sort: JSON.stringify({ date: "asc", id: "asc" }) };
      if (applied!.dateFrom) params["filter[dateRange][startDate]"] = applied!.dateFrom;
      if (applied!.dateTo) params["filter[dateRange][endDate]"] = applied!.dateTo;
      if (applied!.orgUuid) params["filter[organizationUuid][equals]"] = applied!.orgUuid;
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
        counterpartyName: d.counterparty?.name ?? "",
        contractName: d.contract?.name ?? "",
        amount: Number(d.amount ?? 0),
        posted: d.posted === true,
      });
      const all: CashRow[] = [
        ...pkItems.map(d => toRow(d, "receipt")).filter(r => r.posted),
        ...rkItems.map(d => toRow(d, "expense")).filter(r => r.posted),
      ];
      all.sort((a, b) => a.date.localeCompare(b.date));
      return all;
    },
    enabled: !!applied,
  });

  const totalReceipts = rows.filter(r => r.type === "receipt").reduce((s, r) => s + r.amount, 0);
  const totalExpenses = rows.filter(r => r.type === "expense").reduce((s, r) => s + r.amount, 0);
  const balance = totalReceipts - totalExpenses;

  const period = formatPeriod(dateFrom, dateTo);

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="cr_from" value={dateFrom} onChange={e => setDateFrom(e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="cr_to" value={dateTo} onChange={e => setDateTo(e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="cr_org" value={orgUuid} displayValue={orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }}
          onClear={() => { setOrgUuid(""); setOrgName(""); }} />
      </GroupCol>
    </>
  );

  let running = 0;

  const layout = (
    <div className={styles.Report}>
      {orgName && <div className={styles.OrgName}>{orgName}</div>}
      <div className={styles.Title}>{translate("CashReportList")}</div>
      {period && <div className={styles.SubTitle}>{translate("reportPeriodLabel")} {period}</div>}

      <div className={styles.Summary}>
        <span>{translate("reportTotalReceipts")}: <strong>{fmt(totalReceipts)}</strong></span>
        <span>{translate("reportTotalExpenses")}: <strong>{fmt(totalExpenses)}</strong></span>
        <span>
          {translate("reportCashBalance")}:{" "}
          <strong className={balance < 0 ? styles.Negative : undefined}>{fmt(balance)}</strong>
        </span>
      </div>

      <table className={styles.Table}>
        <thead>
          <tr>
            <th className={styles.ColN}>№</th>
            <th className={styles.ColDate}>{translate("reportDate")}</th>
            <th className={styles.ColTag}>{translate("reportOrderType")}</th>
            <th className={styles.ColName}>{translate("reportCounterparty")}</th>
            <th className={styles.ColName}>{translate("contract")}</th>
            <th className={styles.ColNum}>{translate("reportIncoming")}</th>
            <th className={styles.ColNum}>{translate("reportOutgoing")}</th>
            <th className={styles.ColNum}>{translate("reportBalance")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const receipt = row.type === "receipt" ? row.amount : 0;
            const expense = row.type === "expense" ? row.amount : 0;
            running = running + receipt - expense;
            return (
              <tr key={row.uuid} className={!row.posted ? styles.Unposted : undefined}>
                <td className={styles.ColN}>{idx + 1}</td>
                <td className={styles.ColDate}>{getFormatDateOnly(row.date)}</td>
                <td className={styles.ColTag}>
                  <span className={row.type === "receipt" ? styles.TagReceipt : styles.TagExpense}>
                    {row.type === "receipt" ? translate("cashReceiptAbbr") : translate("cashExpenseAbbr")}
                  </span>
                </td>
                <td className={styles.ColName}>{row.counterpartyName}</td>
                <td className={styles.ColName}>{row.contractName}</td>
                <td className={styles.ColNum}>{receipt > 0 ? fmt(receipt) : "—"}</td>
                <td className={styles.ColNum}>{expense > 0 ? fmt(expense) : "—"}</td>
                <td className={`${styles.ColNum}${running < 0 ? ` ${styles.Negative}` : ""}`}>
                  {fmt(running)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className={styles.TotalRow}>
            <td colSpan={5}>{translate("total")}</td>
            <td className={styles.ColNum}>{fmt(totalReceipts)}</td>
            <td className={styles.ColNum}>{fmt(totalExpenses)}</td>
            <td className={`${styles.ColNum}${balance < 0 ? ` ${styles.Negative}` : ""}`}>
              {fmt(balance)}
            </td>
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
      isEmpty={!isLoading && (!applied || rows.length === 0)}
      emptyMessage={!applied ? translate("reportPressGenerate") : undefined}
      onGenerate={handleGenerate}
      fileBaseName={translate("CashReportList")}
      title={translate("CashReportList")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

CashReport.displayName = "CashReport";
export { CashReport };
