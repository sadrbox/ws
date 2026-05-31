/**
 * Журнал проводок — список всех бухгалтерских проводок за период с фильтрами.
 * Колонка «Документ» кликабельна — открывает форму документа-регистратора.
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
import { docTypeLabel, openDocumentByType } from "src/utils/accountingDocTypes";
import styles from "./report.module.scss";
import reportCss from "./report.module.scss?inline";

interface JournalRow {
  uuid: string;
  date: string;
  documentType: string;
  documentTypeLabel: string;
  documentId: number | null;
  documentUuid: string;
  debitAccountCode: string;
  debitAccountName: string;
  creditAccountCode: string;
  creditAccountName: string;
  amount: number;
  description: string;
  debitAnalytics: string;
  creditAnalytics: string;
}

const fmtAmt = (n: number) =>
  Number(n || 0).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props { uniqId?: string; [key: string]: unknown }

const AccountingJournal: FC<Props> = ({ uniqId }) => {
  const { windows: { addPane } } = useAppContext();
  const { organizationUuid: defaultOrgUuid, organizationName: defaultOrgName } = useDefaultOrganization();

  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [orgUuid, setOrgUuid] = useState(defaultOrgUuid || "");
  const [orgName, setOrgName] = useState(defaultOrgName || "");
  const [accountCode, setAccountCode] = useState("");
  const [accountName, setAccountName] = useState("");
  const [cpUuid, setCpUuid] = useState(""); const [cpName, setCpName] = useState("");
  const [productUuid, setProductUuid] = useState(""); const [productName, setProductName] = useState("");

  const [applied, setApplied] = useState<null | Record<string, string>>(null);
  const handleGenerate = useCallback(() => {
    const p: Record<string, string> = {};
    if (dateFrom) p.dateFrom = dateFrom;
    if (dateTo) p.dateTo = dateTo;
    if (orgUuid) p.organizationUuid = orgUuid;
    if (accountCode) p.accountCode = accountCode;
    if (cpUuid) p.counterpartyUuid = cpUuid;
    if (productUuid) p.productUuid = productUuid;
    setApplied(p);
  }, [dateFrom, dateTo, orgUuid, accountCode, cpUuid, productUuid]);

  const { data, isLoading } = useQuery<{ items: JournalRow[]; total: number }>({
    queryKey: ["accounting-journal", applied],
    queryFn: async () => {
      const resp = await api.get<any>("accounting/journal", { params: applied! });
      return { items: resp?.items ?? [], total: resp?.total ?? 0 };
    },
    enabled: !!applied,
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="aj_from" value={dateFrom} onChange={e => setDateFrom(e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="aj_to" value={dateTo} onChange={e => setDateTo(e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="aj_org" value={orgUuid} displayValue={orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }} onClear={() => { setOrgUuid(""); setOrgName(""); }} />
        <LookupField label={translate("account")} name="aj_acc" value={accountCode} displayValue={accountName}
          endpoint="chart-of-accounts" displayField="name"
          onSelect={(_u, d, item) => { setAccountCode(item.code); setAccountName(`${item.code} ${d}`); }}
          onClear={() => { setAccountCode(""); setAccountName(""); }} />
        <LookupField label={translate("counterparty")} name="aj_cp" value={cpUuid} displayValue={cpName}
          endpoint="counterparties" displayField="name"
          onSelect={(u, d) => { setCpUuid(u); setCpName(d); }} onClear={() => { setCpUuid(""); setCpName(""); }} />
        <LookupField label={translate("product")} name="aj_prod" value={productUuid} displayValue={productName}
          endpoint="products" displayField="name"
          onSelect={(u, d) => { setProductUuid(u); setProductName(d); }} onClear={() => { setProductUuid(""); setProductName(""); }} />
      </GroupCol>
    </>
  );

  const layout = (
    <div className={styles.Report}>
      <div className={styles.Title}>{translate("accountingJournalTitle")}</div>
      <table className={styles.Table}>
        <thead>
          <tr>
            <th className={styles.ColN}>№</th>
            <th className={styles.ColDate}>{translate("date")}</th>
            <th className={styles.ColName}>{translate("document")}</th>
            <th className={styles.ColUom}>{translate("accountDebit")}</th>
            <th className={styles.ColName}>{translate("accountDebitName")}</th>
            <th className={styles.ColUom}>{translate("accountCredit")}</th>
            <th className={styles.ColName}>{translate("accountCreditName")}</th>
            <th className={styles.ColNum}>{translate("amount")}</th>
            <th className={styles.ColName}>{translate("description")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.uuid}>
              <td className={styles.ColN}>{idx + 1}</td>
              <td className={styles.ColDate}>{r.date}</td>
              <td className={styles.ColName}>
                <span className={styles.ClickableRow} style={{ cursor: "pointer", textDecoration: "underline" }}
                  onClick={() => openDocumentByType(r.documentType, r.documentUuid, addPane)}>
                  {docTypeLabel(r.documentType)}{r.documentId ? ` №${r.documentId}` : ""}
                </span>
              </td>
              <td className={styles.ColUom}>{r.debitAccountCode}</td>
              <td className={styles.ColName}>{r.debitAccountName}{r.debitAnalytics ? ` (${r.debitAnalytics})` : ""}</td>
              <td className={styles.ColUom}>{r.creditAccountCode}</td>
              <td className={styles.ColName}>{r.creditAccountName}{r.creditAnalytics ? ` (${r.creditAnalytics})` : ""}</td>
              <td className={styles.ColNum}>{fmtAmt(r.amount)}</td>
              <td className={styles.ColName}>{r.description}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={styles.TotalRow}>
            <td colSpan={7}>{translate("total")} ({rows.length})</td>
            <td className={styles.ColNum}>{fmtAmt(total)}</td>
            <td />
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
      fileBaseName={translate("accountingJournalTitle")}
      title={translate("accountingJournalTitle")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

AccountingJournal.displayName = "AccountingJournal";
export { AccountingJournal };
