/**
 * Кассовый отчёт (Кассовая книга, аналог КО-4 РК) — обороты по счёту 1010 «Касса»
 * за период с нарастающим остатком. Источник — регистр счёта 1010 (карточка счёта),
 * поэтому в отчёт попадают ВСЕ движения наличных: ПКО, РКО, выплата зарплаты
 * наличными, переводы банк↔касса. Колонка «Документ» кликабельна.
 */
import { FC, useState, useCallback } from "react";
import { usePersistentState } from "src/hooks/usePersistentState";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import { getFormatDateOnly } from "src/utils/datetime";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useAppContext } from "src/app";
import { docTypeLabel, openDocumentByType } from "src/utils/accountingDocTypes";
import ReportPane from "src/components/ReportPane";
import styles from "./report.module.scss";
import reportCss from "./report.module.scss?inline";

const CASH_ACCOUNT = "1010";

interface CardRow {
  uuid: string; date: string;
  documentType: string; documentId: number | null; documentUuid: string;
  corrAccountCode: string; corrAccountName: string;
  debit: number; credit: number; balance: number;
  description: string; analytics: string;
}
interface AccountCardResponse {
  opening: number; turnDebit: number; turnCredit: number; closing: number;
  items: CardRow[];
}

const fmt = (n: number) =>
  Number(n || 0) !== 0 ? Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const fmtZ = (n: number) => Number(n || 0).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  const { windows: { addPane } } = useAppContext();

  const [dateFrom, setDateFrom] = usePersistentState("report.cash-report.dateFrom", () => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = usePersistentState("report.cash-report.dateTo", () => new Date().toISOString().slice(0, 10));
  const [orgUuid, setOrgUuid] = usePersistentState("report.cash-report.orgUuid", defaultOrgUuid || "");
  const [orgName, setOrgName] = usePersistentState("report.cash-report.orgName", defaultOrgName || "");

  const [applied, setApplied] = useState<null | { dateFrom: string; dateTo: string; orgUuid: string }>(null);

  const handleGenerate = useCallback(() => {
    setApplied({ dateFrom, dateTo, orgUuid });
  }, [dateFrom, dateTo, orgUuid]);

  const { data, isLoading } = useQuery<AccountCardResponse>({
    queryKey: ["report-cash-1010", applied],
    queryFn: async () => {
      const params: Record<string, string> = { accountCode: CASH_ACCOUNT };
      if (applied!.dateFrom) params.dateFrom = applied!.dateFrom;
      if (applied!.dateTo) params.dateTo = applied!.dateTo;
      if (applied!.orgUuid) params.organizationUuid = applied!.orgUuid;
      return api.get<AccountCardResponse>("accounting/account-card", { params });
    },
    enabled: !!applied,
  });

  const rows: CardRow[] = data?.items ?? [];
  const opening = data?.opening ?? 0;
  const turnDebit = data?.turnDebit ?? 0;   // итого приход в кассу
  const turnCredit = data?.turnCredit ?? 0; // итого расход из кассы
  const closing = data?.closing ?? 0;

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

  const layout = (
    <div className={styles.Report}>
      {orgName && <div className={styles.OrgName}>{orgName}</div>}
      <div className={styles.Title}>{translate("CashReportList")} ({CASH_ACCOUNT})</div>
      {period && <div className={styles.SubTitle}>{translate("reportPeriodLabel")} {period}</div>}

      <div className={styles.Summary}>
        <span>{translate("reportTotalReceipts")}: <strong>{fmtZ(turnDebit)}</strong></span>
        <span>{translate("reportTotalExpenses")}: <strong>{fmtZ(turnCredit)}</strong></span>
        <span>
          {translate("reportCashBalance")}:{" "}
          <strong className={closing < 0 ? styles.Negative : undefined}>{fmtZ(closing)}</strong>
        </span>
      </div>

      <table className={styles.Table}>
        <thead>
          <tr>
            <th className={styles.ColN}>№</th>
            <th className={styles.ColDate}>{translate("reportDate")}</th>
            <th className={styles.ColName}>{translate("document")}</th>
            <th className={styles.ColUom}>{translate("accountCorr")}</th>
            <th className={styles.ColName}>{translate("reportCounterparty")}</th>
            <th className={styles.ColNum}>{translate("reportIncoming")}</th>
            <th className={styles.ColNum}>{translate("reportOutgoing")}</th>
            <th className={styles.ColNum}>{translate("reportBalance")}</th>
          </tr>
        </thead>
        <tbody>
          <tr className={styles.SubtotalRow}>
            <td colSpan={7}>{translate("openingBalance")}</td>
            <td className={styles.ColNum}>{fmtZ(opening)}</td>
          </tr>
          {rows.map((row, idx) => (
            <tr key={row.uuid}>
              <td className={styles.ColN}>{idx + 1}</td>
              <td className={styles.ColDate}>{getFormatDateOnly(row.date)}</td>
              <td className={styles.ColName}>
                <span className={styles.ClickableLink}
                  onClick={() => openDocumentByType(row.documentType, row.documentUuid, addPane)}>
                  {docTypeLabel(row.documentType)}{row.documentId ? ` №${row.documentId}` : ""}
                </span>
              </td>
              <td className={styles.ColUom}>{row.corrAccountCode}</td>
              <td className={styles.ColName}>{row.analytics || row.description}</td>
              <td className={styles.ColNum}>{fmt(row.debit)}</td>
              <td className={styles.ColNum}>{fmt(row.credit)}</td>
              <td className={`${styles.ColNum}${row.balance < 0 ? ` ${styles.Negative}` : ""}`}>{fmtZ(row.balance)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={styles.TotalRow}>
            <td colSpan={5}>{translate("total")}</td>
            <td className={styles.ColNum}>{fmtZ(turnDebit)}</td>
            <td className={styles.ColNum}>{fmtZ(turnCredit)}</td>
            <td className={`${styles.ColNum}${closing < 0 ? ` ${styles.Negative}` : ""}`}>{fmtZ(closing)}</td>
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
