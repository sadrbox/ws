/**
 * Оборотно-сальдовая ведомость (ОСВ). Сальдо/обороты по счетам за период.
 * Клик по счёту открывает «Карточку счёта» с передачей счёта и периода.
 */
import { FC, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import ReportPane from "src/components/ReportPane";
import { useAppContext } from "src/app";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { openReport } from "src/utils/openReport";
import styles from "./report.module.scss";
import reportCss from "./report.module.scss?inline";

interface OsvRow {
  code: string; name: string;
  openDebit: number; openCredit: number;
  turnDebit: number; turnCredit: number;
  closeDebit: number; closeCredit: number;
}

const fmt = (n: number) =>
  Number(n || 0) !== 0 ? Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const fmtZ = (n: number) => Number(n || 0).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props { uniqId?: string; [key: string]: unknown }

const TurnoverBalanceSheet: FC<Props> = ({ uniqId }) => {
  const { windows: { addPane } } = useAppContext();
  const { organizationUuid: defaultOrgUuid, organizationName: defaultOrgName } = useDefaultOrganization();

  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [orgUuid, setOrgUuid] = useState(defaultOrgUuid || "");
  const [orgName, setOrgName] = useState(defaultOrgName || "");

  const [applied, setApplied] = useState<null | { dateFrom: string; dateTo: string; orgUuid: string }>(null);
  const handleGenerate = useCallback(() => setApplied({ dateFrom, dateTo, orgUuid }), [dateFrom, dateTo, orgUuid]);

  const { data, isLoading } = useQuery<{ items: OsvRow[]; totals: OsvRow }>({
    queryKey: ["accounting-osv", applied],
    queryFn: async () => {
      const p: Record<string, string> = {};
      if (applied!.dateFrom) p.dateFrom = applied!.dateFrom;
      if (applied!.dateTo) p.dateTo = applied!.dateTo;
      if (applied!.orgUuid) p.organizationUuid = applied!.orgUuid;
      const resp = await api.get<any>("accounting/balance-sheet", { params: p });
      return { items: resp?.items ?? [], totals: resp?.totals };
    },
    enabled: !!applied,
  });

  const rows = data?.items ?? [];
  const totals = data?.totals;

  const openCard = (code: string, name: string) =>
    openReport("account-card", addPane, undefined, {
      accountCode: code, accountName: name,
      initialDateFrom: applied?.dateFrom, initialDateTo: applied?.dateTo,
      initialOrgUuid: applied?.orgUuid, initialOrgName: orgName,
    } as any);

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="osv_from" value={dateFrom} onChange={e => setDateFrom(e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="osv_to" value={dateTo} onChange={e => setDateTo(e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="osv_org" value={orgUuid} displayValue={orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }} onClear={() => { setOrgUuid(""); setOrgName(""); }} />
      </GroupCol>
    </>
  );

  const layout = (
    <div className={styles.Report}>
      {orgName && <div className={styles.OrgName}>{orgName}</div>}
      <div className={styles.Title}>{translate("osvTitle")}</div>
      <table className={styles.Table}>
        <thead>
          <tr>
            <th rowSpan={2} className={styles.ColUom}>{translate("account")}</th>
            <th rowSpan={2} className={styles.ColName}>{translate("name")}</th>
            <th colSpan={2} className={styles.ColNum}>{translate("osvOpening")}</th>
            <th colSpan={2} className={styles.ColNum}>{translate("osvTurnover")}</th>
            <th colSpan={2} className={styles.ColNum}>{translate("osvClosing")}</th>
          </tr>
          <tr>
            <th className={styles.ColNum}>{translate("debit")}</th>
            <th className={styles.ColNum}>{translate("credit")}</th>
            <th className={styles.ColNum}>{translate("debit")}</th>
            <th className={styles.ColNum}>{translate("credit")}</th>
            <th className={styles.ColNum}>{translate("debit")}</th>
            <th className={styles.ColNum}>{translate("credit")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <td className={styles.ColUom}>
                <span className={styles.ClickableLink}
                  onClick={() => openCard(r.code, r.name)}>{r.code}</span>
              </td>
              <td className={styles.ColName}>{r.name}</td>
              <td className={styles.ColNum}>{fmt(r.openDebit)}</td>
              <td className={styles.ColNum}>{fmt(r.openCredit)}</td>
              <td className={styles.ColNum}>{fmt(r.turnDebit)}</td>
              <td className={styles.ColNum}>{fmt(r.turnCredit)}</td>
              <td className={styles.ColNum}>{fmt(r.closeDebit)}</td>
              <td className={styles.ColNum}>{fmt(r.closeCredit)}</td>
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr className={styles.TotalRow}>
              <td colSpan={2}>{translate("total")}</td>
              <td className={styles.ColNum}>{fmtZ(totals.openDebit)}</td>
              <td className={styles.ColNum}>{fmtZ(totals.openCredit)}</td>
              <td className={styles.ColNum}>{fmtZ(totals.turnDebit)}</td>
              <td className={styles.ColNum}>{fmtZ(totals.turnCredit)}</td>
              <td className={styles.ColNum}>{fmtZ(totals.closeDebit)}</td>
              <td className={styles.ColNum}>{fmtZ(totals.closeCredit)}</td>
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
      isEmpty={!isLoading && (!applied || rows.length === 0)}
      emptyMessage={!applied ? translate("reportPressGenerate") : undefined}
      onGenerate={handleGenerate}
      fileBaseName={translate("osvTitle")}
      title={translate("osvTitle")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

TurnoverBalanceSheet.displayName = "TurnoverBalanceSheet";
export { TurnoverBalanceSheet };
