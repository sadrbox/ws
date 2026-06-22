/**
 * SettlementsReport — взаиморасчёты с контрагентами (дебиторка 1210 / кредиторка
 * 3310): сальдо, обороты Дт/Кт, старение долга (aging). Только проведённые
 * (бэкенд /accounting/settlements).
 */
import { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate, FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import ReportPane from "src/components/ReportPane";
import { ReportSheet, ReportTable, Th, Td, TotalRow, Money } from "./_shared/reportLayout";
import { useReportDrill, DrillLink } from "./_shared/reportDrill";
import { useReportFilters } from "./_shared/useReportFilters";
import { firstOfMonth, today } from "./_shared/reportDates";
import reportCss from "./report.module.scss?inline";

interface Aging { d0_30: number; d31_60: number; d61_90: number; d90: number }
interface Row {
  counterpartyUuid: string | null; counterpartyName: string;
  opening: number; turnDebit: number; turnCredit: number; closing: number; aging: Aging;
}
interface Totals { opening: number; turnDebit: number; turnCredit: number; closing: number; d0_30: number; d31_60: number; d61_90: number; d90: number }
interface Filters extends Record<string, unknown> {
  dateFrom: string; dateTo: string; orgUuid: string; orgName: string; accountCode: string; cptyUuid: string; cptyName: string;
}
interface Props { uniqId?: string;[key: string]: unknown }

const SettlementsReport: FC<Props> = ({ uniqId }) => {
  const def = useDefaultOrganization();

  const { fields, setField, patch, applied, handleGenerate } = useReportFilters<Filters>({
    persistKey: "report.settlements",
    defaults: { dateFrom: firstOfMonth(), dateTo: today(), orgUuid: def.organizationUuid || "", orgName: def.organizationName || "", accountCode: "1210", cptyUuid: "", cptyName: "" },
  });
  const drill = useReportDrill({ applied, orgName: fields.orgName });

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
  const isReceivable = fields.accountCode === "1210";

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="st_from" value={fields.dateFrom} onChange={e => setField("dateFrom", e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="st_to" value={fields.dateTo} onChange={e => setField("dateTo", e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <FieldSelect label={translate("settlementsKind")} name="st_kind" value={fields.accountCode}
          onChange={e => setField("accountCode", e.target.value)}
          options={[{ value: "1210", label: translate("receivable") }, { value: "3310", label: translate("payable") }]} />
        <LookupField label={translate("organization")} name="st_org" value={fields.orgUuid} displayValue={fields.orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => patch({ orgUuid: u, orgName: d })} onClear={() => patch({ orgUuid: "", orgName: "" })} />
        <LookupField label={translate("counterparty")} name="st_cpty" value={fields.cptyUuid} displayValue={fields.cptyName}
          endpoint="counterparties" displayField="name"
          onSelect={(u, d) => patch({ cptyUuid: u, cptyName: d })} onClear={() => patch({ cptyUuid: "", cptyName: "" })} />
      </GroupCol>
    </>
  );

  const layout = (
    <ReportSheet
      org={fields.orgName || undefined}
      title={isReceivable ? translate("settlementsReceivableTitle") : translate("settlementsPayableTitle")}
    >
      <ReportTable>
        <thead>
          <tr>
            <Th col="n">№</Th>
            <Th col="name">{translate("counterparty")}</Th>
            <Th col="num">{translate("openingBalance")}</Th>
            <Th col="num">{translate("turnoverDebit")}</Th>
            <Th col="num">{translate("turnoverCredit")}</Th>
            <Th col="num">{translate("closingBalance")}</Th>
            <Th col="num">0–30</Th>
            <Th col="num">31–60</Th>
            <Th col="num">61–90</Th>
            <Th col="num">&gt;90</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.counterpartyUuid ?? idx}>
              <Td col="n">{idx + 1}</Td>
              <Td col="name">
                {r.counterpartyUuid
                  ? <DrillLink onOpen={() => drill.toEntity("counterparties", r.counterpartyUuid!)}>{r.counterpartyName}</DrillLink>
                  : r.counterpartyName}
              </Td>
              <Td col="num"><Money value={r.opening} /></Td>
              <Td col="num"><Money value={r.turnDebit} /></Td>
              <Td col="num"><Money value={r.turnCredit} /></Td>
              <Td col="num"><Money value={r.closing} /></Td>
              <Td col="num"><Money value={r.aging.d0_30} /></Td>
              <Td col="num"><Money value={r.aging.d31_60} /></Td>
              <Td col="num"><Money value={r.aging.d61_90} /></Td>
              <Td col="num"><Money value={r.aging.d90} /></Td>
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <TotalRow>
              <Td colSpan={2}>{translate("total")}</Td>
              <Td col="num"><Money value={totals.opening} as="zeroMoney" /></Td>
              <Td col="num"><Money value={totals.turnDebit} as="zeroMoney" /></Td>
              <Td col="num"><Money value={totals.turnCredit} as="zeroMoney" /></Td>
              <Td col="num"><Money value={totals.closing} as="zeroMoney" /></Td>
              <Td col="num"><Money value={totals.d0_30} as="zeroMoney" /></Td>
              <Td col="num"><Money value={totals.d31_60} as="zeroMoney" /></Td>
              <Td col="num"><Money value={totals.d61_90} as="zeroMoney" /></Td>
              <Td col="num"><Money value={totals.d90} as="zeroMoney" /></Td>
            </TotalRow>
          </tfoot>
        )}
      </ReportTable>
    </ReportSheet>
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
