/**
 * Карточка счёта — обороты по счёту за период с нарастающим остатком.
 * Открывается из ОСВ (передаётся счёт+период) или вручную. Колонка «Документ»
 * кликабельна. Параметры: Организация, Счёт, Период.
 */
import { FC, useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import ReportPane from "src/components/ReportPane";
import { useAppContext } from "src/app";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { docTypeLabel, openDocumentByType } from "src/utils/accountingDocTypes";
import styles from "./report.module.scss";
import reportCss from "./report.module.scss?inline";

interface CardRow {
  uuid: string; date: string;
  documentType: string; documentId: number | null; documentUuid: string;
  corrAccountCode: string; corrAccountName: string;
  debit: number; credit: number; balance: number;
  description: string; analytics: string;
}

const fmt = (n: number) =>
  Number(n || 0) !== 0 ? Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const fmtZ = (n: number) => Number(n || 0).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  uniqId?: string;
  accountCode?: string;
  accountName?: string;
  initialDateFrom?: string;
  initialDateTo?: string;
  initialOrgUuid?: string;
  initialOrgName?: string;
  [key: string]: unknown;
}

const AccountCard: FC<Props> = ({
  uniqId, accountCode: initCode = "", accountName: initName = "",
  initialDateFrom, initialDateTo, initialOrgUuid = "", initialOrgName = "",
}) => {
  const { windows: { addPane } } = useAppContext();
  const def = useDefaultOrganization();

  const [dateFrom, setDateFrom] = useState(initialDateFrom ?? (() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); })());
  const [dateTo, setDateTo] = useState(initialDateTo ?? new Date().toISOString().slice(0, 10));
  const [orgUuid, setOrgUuid] = useState(initialOrgUuid || def.organizationUuid || "");
  const [orgName, setOrgName] = useState(initialOrgName || def.organizationName || "");
  const [accountCode, setAccountCode] = useState(initCode);
  const [accountName, setAccountName] = useState(initName ? `${initCode} ${initName}`.trim() : "");

  const [applied, setApplied] = useState<null | Record<string, string>>(
    initCode ? { accountCode: initCode, dateFrom: initialDateFrom ?? "", dateTo: initialDateTo ?? "", organizationUuid: initialOrgUuid } : null
  );

  const handleGenerate = useCallback(() => {
    if (!accountCode) return;
    const p: Record<string, string> = { accountCode };
    if (dateFrom) p.dateFrom = dateFrom;
    if (dateTo) p.dateTo = dateTo;
    if (orgUuid) p.organizationUuid = orgUuid;
    setApplied(p);
  }, [accountCode, dateFrom, dateTo, orgUuid]);

  // Автоформирование при открытии из ОСВ (счёт уже передан).
  useEffect(() => {
    if (initCode && !applied) handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["accounting-account-card", applied],
    queryFn: async () => {
      const resp = await api.get<any>("accounting/account-card", { params: applied! });
      return resp;
    },
    enabled: !!applied && !!applied.accountCode,
  });

  const rows: CardRow[] = data?.items ?? [];
  const opening = data?.opening ?? 0;
  const turnDebit = data?.turnDebit ?? 0;
  const turnCredit = data?.turnCredit ?? 0;
  const closing = data?.closing ?? 0;
  const resolvedName = data?.accountName || accountName;

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="ac_from" value={dateFrom} onChange={e => setDateFrom(e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="ac_to" value={dateTo} onChange={e => setDateTo(e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="ac_org" value={orgUuid} displayValue={orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }} onClear={() => { setOrgUuid(""); setOrgName(""); }} />
        <LookupField label={translate("account")} name="ac_acc" value={accountCode} displayValue={accountName}
          endpoint="chart-of-accounts" displayField="name"
          onSelect={(_u, d, item) => { setAccountCode(item.code); setAccountName(`${item.code} ${d}`); }}
          onClear={() => { setAccountCode(""); setAccountName(""); }} />
      </GroupCol>
    </>
  );

  const layout = (
    <div className={styles.Report}>
      {orgName && <div className={styles.OrgName}>{orgName}</div>}
      <div className={styles.Title}>{translate("accountCardTitle")}: {accountCode} {resolvedName && !resolvedName.startsWith(accountCode) ? resolvedName : ""}</div>
      <table className={styles.Table}>
        <thead>
          <tr>
            <th className={styles.ColDate}>{translate("date")}</th>
            <th className={styles.ColName}>{translate("document")}</th>
            <th className={styles.ColUom}>{translate("accountCorr")}</th>
            <th className={styles.ColName}>{translate("subkonto")}</th>
            <th className={styles.ColNum}>{translate("debit")}</th>
            <th className={styles.ColNum}>{translate("credit")}</th>
            <th className={styles.ColNum}>{translate("balance")}</th>
          </tr>
        </thead>
        <tbody>
          <tr className={styles.SubtotalRow}>
            <td colSpan={6}>{translate("openingBalance")}</td>
            <td className={styles.ColNum}>{fmtZ(opening)}</td>
          </tr>
          {rows.map((r) => (
            <tr key={r.uuid}>
              <td className={styles.ColDate}>{r.date}</td>
              <td className={styles.ColName}>
                <span className={styles.ClickableLink}
                  onClick={() => openDocumentByType(r.documentType, r.documentUuid, addPane)}>
                  {docTypeLabel(r.documentType)}{r.documentId ? ` №${r.documentId}` : ""}
                </span>
              </td>
              <td className={styles.ColUom}>{r.corrAccountCode}</td>
              <td className={styles.ColName}>{r.analytics}</td>
              <td className={styles.ColNum}>{fmt(r.debit)}</td>
              <td className={styles.ColNum}>{fmt(r.credit)}</td>
              <td className={styles.ColNum}>{fmtZ(r.balance)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={styles.SubtotalRow}>
            <td colSpan={4}>{translate("turnover")}</td>
            <td className={styles.ColNum}>{fmtZ(turnDebit)}</td>
            <td className={styles.ColNum}>{fmtZ(turnCredit)}</td>
            <td />
          </tr>
          <tr className={styles.TotalRow}>
            <td colSpan={6}>{translate("closingBalance")}</td>
            <td className={styles.ColNum}>{fmtZ(closing)}</td>
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
      isEmpty={!isLoading && (!applied || !accountCode)}
      emptyMessage={!accountCode ? translate("selectAccount") : (!applied ? translate("reportPressGenerate") : undefined)}
      onGenerate={handleGenerate}
      generateDisabled={!accountCode}
      fileBaseName={translate("accountCardTitle")}
      title={translate("accountCardTitle")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

AccountCard.displayName = "AccountCard";
export { AccountCard };
