/**
 * Карточка счёта — обороты по счёту за период с нарастающим остатком.
 * Открывается из ОСВ (передаётся счёт+период) или вручную. ДВОЙНОЙ клик по
 * документу открывает его. Параметры: Организация, Счёт, Период.
 */
import { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import ReportPane from "src/components/ReportPane";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { docTypeLabel } from "src/utils/accountingDocTypes";
import { ReportSheet, ReportTable, Th, Td, SubtotalRow, TotalRow, Money } from "./_shared/reportLayout";
import { useReportDrill, DrillLink } from "./_shared/reportDrill";
import { useReportFilters } from "./_shared/useReportFilters";
import { firstOfMonth, today } from "./_shared/reportDates";
import reportCss from "./report.module.scss?inline";

interface CardRow {
  uuid: string; date: string;
  documentType: string; documentId: number | null; documentUuid: string;
  corrAccountCode: string; corrAccountName: string;
  debit: number; credit: number; balance: number;
  description: string; analytics: string;
}

interface Filters extends Record<string, unknown> {
  dateFrom: string; dateTo: string; orgUuid: string; orgName: string;
  accountCode: string; accountName: string;
}

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
  initialDateFrom, initialDateTo, initialOrgUuid, initialOrgName,
}) => {
  const def = useDefaultOrganization();

  // initial — только при открытии «по ссылке» из ОСВ (с параметрами).
  const initial: Partial<Filters> = {};
  if (initialDateFrom !== undefined) initial.dateFrom = initialDateFrom;
  if (initialDateTo !== undefined) initial.dateTo = initialDateTo;
  if (initialOrgUuid !== undefined) initial.orgUuid = initialOrgUuid;
  if (initialOrgName !== undefined) initial.orgName = initialOrgName;
  if (initCode) { initial.accountCode = initCode; initial.accountName = `${initCode} ${initName}`.trim(); }

  const { fields, setField, patch, applied, handleGenerate, generateDisabled } = useReportFilters<Filters>({
    persistKey: "report.account-card",
    defaults: { dateFrom: firstOfMonth(), dateTo: today(), orgUuid: def.organizationUuid || "", orgName: def.organizationName || "", accountCode: "", accountName: "" },
    initial,
    canApply: (f) => !!f.accountCode,
  });
  const drill = useReportDrill({ orgName: fields.orgName });

  const { data, isLoading } = useQuery<any>({
    queryKey: ["accounting-account-card", applied],
    queryFn: async () => {
      const p: Record<string, string> = { accountCode: applied!.accountCode };
      if (applied!.dateFrom) p.dateFrom = applied!.dateFrom;
      if (applied!.dateTo) p.dateTo = applied!.dateTo;
      if (applied!.orgUuid) p.organizationUuid = applied!.orgUuid;
      return await api.get<any>("accounting/account-card", { params: p });
    },
    enabled: !!applied && !!applied.accountCode,
  });

  const rows: CardRow[] = data?.items ?? [];
  const opening = data?.opening ?? 0;
  const turnDebit = data?.turnDebit ?? 0;
  const turnCredit = data?.turnCredit ?? 0;
  const closing = data?.closing ?? 0;
  const resolvedName = data?.accountName || fields.accountName;

  const form = (
    <>
      <GroupRow>
        <FieldDate label={translate("reportPeriodFrom")} name="ac_from" value={fields.dateFrom} onChange={e => setField("dateFrom", e.target.value)} width="150px" />
        <FieldDate label={translate("reportPeriodTo")} name="ac_to" value={fields.dateTo} onChange={e => setField("dateTo", e.target.value)} width="150px" />
      </GroupRow>
      <GroupCol>
        <LookupField label={translate("organization")} name="ac_org" value={fields.orgUuid} displayValue={fields.orgName}
          endpoint="organizations" displayField="name"
          onSelect={(u, d) => patch({ orgUuid: u, orgName: d })} onClear={() => patch({ orgUuid: "", orgName: "" })} />
        <LookupField label={translate("account")} name="ac_acc" value={fields.accountCode} displayValue={fields.accountName}
          endpoint="chart-of-accounts" displayField="name"
          onSelect={(_u, d, item) => patch({ accountCode: item.code, accountName: `${item.code} ${d}` })}
          onClear={() => patch({ accountCode: "", accountName: "" })} />
      </GroupCol>
    </>
  );

  const layout = (
    <ReportSheet
      org={fields.orgName || undefined}
      title={`${translate("accountCardTitle")}: ${fields.accountCode} ${resolvedName && !resolvedName.startsWith(fields.accountCode) ? resolvedName : ""}`}
    >
      <ReportTable>
        <thead>
          <tr>
            <Th col="date">{translate("date")}</Th>
            <Th col="name">{translate("document")}</Th>
            <Th col="uom">{translate("accountCorr")}</Th>
            <Th col="name">{translate("subkonto")}</Th>
            <Th col="num">{translate("debit")}</Th>
            <Th col="num">{translate("credit")}</Th>
            <Th col="num">{translate("balance")}</Th>
          </tr>
        </thead>
        <tbody>
          <SubtotalRow>
            <Td colSpan={6}>{translate("openingBalance")}</Td>
            <Td col="num"><Money value={opening} as="zeroMoney" /></Td>
          </SubtotalRow>
          {rows.map((r) => (
            <tr key={r.uuid}>
              <Td col="date">{r.date}</Td>
              <Td col="name">
                <DrillLink onOpen={() => drill.toDocument(r.documentType, r.documentUuid)}>
                  {docTypeLabel(r.documentType)}{r.documentId ? ` №${r.documentId}` : ""}
                </DrillLink>
              </Td>
              <Td col="uom">{r.corrAccountCode}</Td>
              <Td col="name">{r.analytics}</Td>
              <Td col="num"><Money value={r.debit} /></Td>
              <Td col="num"><Money value={r.credit} /></Td>
              <Td col="num"><Money value={r.balance} as="zeroMoney" /></Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <SubtotalRow>
            <Td colSpan={4}>{translate("turnover")}</Td>
            <Td col="num"><Money value={turnDebit} as="zeroMoney" /></Td>
            <Td col="num"><Money value={turnCredit} as="zeroMoney" /></Td>
            <Td />
          </SubtotalRow>
          <TotalRow>
            <Td colSpan={6}>{translate("closingBalance")}</Td>
            <Td col="num"><Money value={closing} as="zeroMoney" /></Td>
          </TotalRow>
        </tfoot>
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
      isEmpty={!isLoading && (!applied || !fields.accountCode)}
      emptyMessage={!fields.accountCode ? translate("selectAccount") : (!applied ? translate("reportPressGenerate") : undefined)}
      onGenerate={handleGenerate}
      generateDisabled={generateDisabled}
      fileBaseName={translate("accountCardTitle")}
      title={translate("accountCardTitle")}
      orientation="landscape"
      sheetFit="content"
    />
  );
};

AccountCard.displayName = "AccountCard";
export { AccountCard };
