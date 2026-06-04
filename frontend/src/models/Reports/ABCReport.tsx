/**
 * ABCReport — ABC-анализ номенклатуры по вкладу в выручку (нетто).
 * Источник — /reports/sales-by-product. Товары сортируются по убыванию нетто-
 * выручки; считается доля и накопительная доля; класс по правилу:
 *   A — накопительно до 80%, B — до 95%, C — остальное.
 */
import { FC, useState, useCallback, useMemo } from "react";
import { usePersistentState } from "src/hooks/usePersistentState";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import ReportPane from "src/components/ReportPane";
import styles from "./report.module.scss";
import reportCss from "./report.module.scss?inline";

const fmt = (n: number) => n !== 0 ? Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const fmtZ = (n: number) => Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => `${(Number(n) || 0).toLocaleString("ru-KZ", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

interface SrcRow { productUuid: string | null; productName: string; amountNet: number; qtyNet: number }
interface Row { productUuid: string | null; productName: string; amount: number; share: number; cum: number; abc: "A" | "B" | "C" }

interface Props { uniqId?: string; [key: string]: unknown }

const classOf = (cum: number): "A" | "B" | "C" => (cum <= 80 ? "A" : cum <= 95 ? "B" : "C");

const ABCReport: FC<Props> = ({ uniqId }) => {
  const { organizationUuid: defOrg, organizationName: defOrgName } = useDefaultOrganization();

  const [dateFrom, setDateFrom] = usePersistentState("report.abc.dateFrom", () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); });
  const [dateTo, setDateTo] = usePersistentState("report.abc.dateTo", () => new Date().toISOString().slice(0, 10));
  const [orgUuid, setOrgUuid] = usePersistentState("report.abc.orgUuid", defOrg || "");
  const [orgName, setOrgName] = usePersistentState("report.abc.orgName", defOrgName || "");

  const [applied, setApplied] = useState<null | { dateFrom: string; dateTo: string; orgUuid: string }>(null);
  const handleGenerate = useCallback(() => setApplied({ dateFrom, dateTo, orgUuid }), [dateFrom, dateTo, orgUuid]);

  const { data, isLoading, isError } = useQuery<SrcRow[]>({
    queryKey: ["report-abc", applied],
    queryFn: async () => {
      const p: Record<string, string> = {};
      if (applied!.dateFrom) p.dateFrom = applied!.dateFrom;
      if (applied!.dateTo) p.dateTo = applied!.dateTo;
      if (applied!.orgUuid) p.organizationUuid = applied!.orgUuid;
      const resp = await api.get<any>("reports/sales-by-product", { params: p });
      return resp?.items ?? [];
    },
    enabled: !!applied,
    retry: 1,
  });

  const { rows, total, classTotals } = useMemo(() => {
    const src = (data ?? []).map((r) => ({ ...r, amount: Number(r.amountNet) || 0 })).filter((r) => r.amount > 0);
    const total = src.reduce((s, r) => s + r.amount, 0);
    src.sort((a, b) => b.amount - a.amount);
    let cum = 0;
    const rows: Row[] = src.map((r) => {
      const share = total > 0 ? (r.amount / total) * 100 : 0;
      cum += share;
      return { productUuid: r.productUuid, productName: r.productName, amount: r.amount, share, cum, abc: classOf(cum) };
    });
    const classTotals = { A: { n: 0, amount: 0 }, B: { n: 0, amount: 0 }, C: { n: 0, amount: 0 } };
    for (const r of rows) { classTotals[r.abc].n++; classTotals[r.abc].amount += r.amount; }
    return { rows, total, classTotals };
  }, [data]);

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="abc_from" value={dateFrom} onChange={e => setDateFrom(e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="abc_to" value={dateTo} onChange={e => setDateTo(e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="abc_org" value={orgUuid} displayValue={orgName} endpoint="organizations" displayField="name"
          onSelect={(u, d) => { setOrgUuid(u); setOrgName(d); }} onClear={() => { setOrgUuid(""); setOrgName(""); }} />
      </GroupCol>
    </>
  );

  const layout = (
    <div className={styles.Report}>
      {orgName && <div className={styles.OrgName}>{orgName}</div>}
      <div className={styles.Title}>{translate("abcAnalysis")}</div>

      <div className={styles.SortLine}>
        {(["A", "B", "C"] as const).map((c) => (
          <span key={c} style={{ marginRight: 16 }}>
            <b>{c}</b>: {classTotals[c].n} {translate("abcPositions")} · {fmtZ(classTotals[c].amount)} ({pct(total > 0 ? (classTotals[c].amount / total) * 100 : 0)})
          </span>
        ))}
      </div>

      <table className={styles.Table}>
        <thead>
          <tr>
            <th className={styles.ColN}>№</th>
            <th className={styles.ColName}>{translate("reportProduct")}</th>
            <th className={styles.ColNum}>{translate("reportAmountNet")}</th>
            <th className={styles.ColNum}>{translate("abcShare")}</th>
            <th className={styles.ColNum}>{translate("abcCumulative")}</th>
            <th className={styles.ColNum}>{translate("abcClass")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.productUuid ?? idx}>
              <td className={styles.ColN}>{idx + 1}</td>
              <td className={styles.ColName}>{r.productName}</td>
              <td className={styles.ColNum}>{fmt(r.amount)}</td>
              <td className={styles.ColNum}>{pct(r.share)}</td>
              <td className={styles.ColNum}>{pct(r.cum)}</td>
              <td className={styles.ColNum}><b>{r.abc}</b></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={styles.TotalRow}>
            <td colSpan={2}>{translate("total")}</td>
            <td className={styles.ColNum}>{fmtZ(total)}</td>
            <td className={styles.ColNum}>100,0%</td>
            <td className={styles.ColNum}></td>
            <td className={styles.ColNum}></td>
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
      isEmpty={!isLoading && (!applied || isError || rows.length === 0)}
      emptyMessage={isError ? translate("serverError") : (!applied ? translate("reportPressGenerate") : undefined)}
      onGenerate={handleGenerate}
      fileBaseName={translate("abcAnalysis")}
      title={translate("abcAnalysis")}
      orientation="portrait"
      sheetFit="content"
    />
  );
};

ABCReport.displayName = "ABCReport";
export { ABCReport };
export default ABCReport;
