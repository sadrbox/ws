/**
 * SettlementsReport — взаиморасчёты с контрагентами (дебиторка 1210 / кредиторка
 * 3310): входящее сальдо, обороты Дт/Кт, исходящее сальдо и старение долга
 * (aging) по бакетам 0–30 / 31–60 / 61–90 / >90 дней. Только проведённые
 * документы (бэкенд /accounting/settlements).
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
import styles from "./report.module.scss";
import reportCss from "./report.module.scss?inline";

const fmt = (n: number) =>
  n !== 0 ? Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const fmtZ = (n: number) =>
  Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Aging { d0_30: number; d31_60: number; d61_90: number; d90: number }
interface Row {
  counterpartyUuid: string | null;
  counterpartyName: string;
  opening: number; turnDebit: number; turnCredit: number; closing: number;
  aging: Aging;
}
interface Totals { opening: number; turnDebit: number; turnCredit: number; closing: number; d0_30: number; d31_60: number; d61_90: number; d90: number }

interface Props { uniqId?: string; [key: string]: unknown }

const SettlementsReport: FC<Props> = ({ uniqId }) => {
  const { organizationUuid: defOrg, organizationName: defOrgName } = useDefaultOrganization();

  const [dateFrom, setDateFrom] = usePersistentState("report.settlements.dateFrom", () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); });
  const [dateTo, setDateTo] = usePersistentState("report.settlements.dateTo", () => new Date().toISOString().slice(0, 10));
  const [orgUuid, setOrgUuid] = usePersistentState("report.settlements.orgUuid", defOrg || "");
  const [orgName, setOrgName] = usePersistentState("report.settlements.orgName", defOrgName || "");
  const [accountCode, setAccountCode] = usePersistentState("report.settlements.account", "1210");
  const [cptyUuid, setCptyUuid] = useState("");
  const [cptyName, setCptyName] = useState("");

  const [applied, setApplied] = useState<null | { dateFrom: string; dateTo: string; orgUuid: string; accountCode: string; cptyUuid: string }>(null);
  const handleGenerate = useCallback(() => setApplied({ dateFrom, dateTo, orgUuid, accountCode, cptyUuid }), [dateFrom, dateTo, orgUuid, accountCode, cptyUuid]);

  const { data, isLoading, isError } = useQuery<{ items: Row[]; totals: Totals; accountName: string }>({
    queryKey: ["report-settlements", applied],
    queryFn: async () => {
      const p: Record<string, string> = { accountCode: applied!.accountCode };
      if (applied!.dateFrom) p.dateFrom = applied!.dateFrom;
      if (applied!.dateTo) p.dateTo = applied!.dateTo;
      if (applied!.orgUuid) p.organizationUuid = applied!.orgUuid;
      if (applied!.cptyUuid) p.counterpartyUuid = applied!.cptyUuid;
      const resp = await api.get<any>("accounting/settlements", { params: p });
      return { items: resp?.items ?? [], totals: resp?.totals ?? null, accountName: resp?.accountName ?? "" };
    },
    enabled: !!applied,
    retry: 1,
  });

  const rows = data?.items ?? [];
  const totals = data?.totals;
  const isReceivable = accountCode === "1210";

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="st_from" value={dateFrom} onChange={e => setDateFrom(e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="st_to" value={dateTo} onChange={e => setDateTo(e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <FieldSelect label={translate("settlementsKind")} name="st_kind" value={accountCode}
          onChange={e => setAccountCode(e.target.value)}
          options={[{ value: "1210", label: translate("receivable") }, { value: "3310", label: translate("payable") }]} />
        <LookupField label={translate("organization")} name="st_org" value={orgUuid} displayValue={orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }} onClear={() => { setOrgUuid(""); setOrgName(""); }} />
        <LookupField label={translate("counterparty")} name="st_cpty" value={cptyUuid} displayValue={cptyName}
          endpoint="counterparties" displayField="name"
          onSelect={(u, d) => { setCptyUuid(u); setCptyName(d); }} onClear={() => { setCptyUuid(""); setCptyName(""); }} />
      </GroupCol>
    </>
  );

  const layout = (
    <div className={styles.Report}>
      {orgName && <div className={styles.OrgName}>{orgName}</div>}
      <div className={styles.Title}>
        {isReceivable ? translate("settlementsReceivableTitle") : translate("settlementsPayableTitle")}
      </div>

      <table className={styles.Table}>
        <thead>
          <tr>
            <th className={styles.ColN}>№</th>
            <th className={styles.ColName}>{translate("counterparty")}</th>
            <th className={styles.ColNum}>{translate("openingBalance")}</th>
            <th className={styles.ColNum}>{translate("turnoverDebit")}</th>
            <th className={styles.ColNum}>{translate("turnoverCredit")}</th>
            <th className={styles.ColNum}>{translate("closingBalance")}</th>
            <th className={styles.ColNum}>0–30</th>
            <th className={styles.ColNum}>31–60</th>
            <th className={styles.ColNum}>61–90</th>
            <th className={styles.ColNum}>&gt;90</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.counterpartyUuid ?? idx}>
              <td className={styles.ColN}>{idx + 1}</td>
              <td className={styles.ColName}>{r.counterpartyName}</td>
              <td className={styles.ColNum}>{fmt(r.opening)}</td>
              <td className={styles.ColNum}>{fmt(r.turnDebit)}</td>
              <td className={styles.ColNum}>{fmt(r.turnCredit)}</td>
              <td className={styles.ColNum}>{fmt(r.closing)}</td>
              <td className={styles.ColNum}>{fmt(r.aging.d0_30)}</td>
              <td className={styles.ColNum}>{fmt(r.aging.d31_60)}</td>
              <td className={styles.ColNum}>{fmt(r.aging.d61_90)}</td>
              <td className={styles.ColNum}>{fmt(r.aging.d90)}</td>
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr className={styles.TotalRow}>
              <td colSpan={2}>{translate("total")}</td>
              <td className={styles.ColNum}>{fmtZ(totals.opening)}</td>
              <td className={styles.ColNum}>{fmtZ(totals.turnDebit)}</td>
              <td className={styles.ColNum}>{fmtZ(totals.turnCredit)}</td>
              <td className={styles.ColNum}>{fmtZ(totals.closing)}</td>
              <td className={styles.ColNum}>{fmtZ(totals.d0_30)}</td>
              <td className={styles.ColNum}>{fmtZ(totals.d31_60)}</td>
              <td className={styles.ColNum}>{fmtZ(totals.d61_90)}</td>
              <td className={styles.ColNum}>{fmtZ(totals.d90)}</td>
            </tr>
          </tfoot>
        )}
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
      isEmpty={!isLoading && (!applied || isError || rows.length === 0)}
      emptyMessage={isError ? translate("serverError") : (!applied ? translate("reportPressGenerate") : undefined)}
      onGenerate={handleGenerate}
      fileBaseName={translate("settlementsReport")}
      title={translate("settlementsReport")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

SettlementsReport.displayName = "SettlementsReport";
export { SettlementsReport };
export default SettlementsReport;
