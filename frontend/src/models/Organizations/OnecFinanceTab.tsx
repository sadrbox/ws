/**
 * «Долги и остатки» в карточке организации (ПН9 плана PLAN_ONEC_CAPABILITIES_2026-09-22).
 *
 * ПЕРВЫЙ СЛУЧАЙ, КОГДА ПАНЕЛЬ ПОКАЗЫВАЕТ ДАННЫЕ УЧЁТА ИЗ 1С, а не из ERP. Поэтому два правила:
 *
 *   1. ЧИТАЕТСЯ ПО КНОПКЕ И НЕ КЭШИРУЕТСЯ (решение владельца, 22.09). Кэш означал бы третью версию правды —
 *      1С, кэш, панель — и вместо ответа на вопрос начинался бы разговор «а почему суммы разные». Цена:
 *      при недоступном агенте карточка скажет, что чисел нет, — вместо вчерашних, выданных за сегодняшние.
 *   2. ВИДНО, НА КАКОЙ МИГ ЧИСЛА ВЕРНЫ. Дата расчёта и время чтения — рядом с суммами, иначе через час
 *      никто не скажет, откуда они.
 *
 * Половины независимы: долги могли не дать, а остатки дать — показываем то, что есть, и называем, чего нет.
 */
import { FC, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import Notice from "src/components/Notice";
import { reportError } from "src/services/errors/route";
import { getFormatDate } from "src/utils/datetime";
import { fetchOrganizationFinance, type OrganizationFinance } from "src/services/onec/api";
import { balanceRows, debtRows, debtTotals, showMoney, totalOf } from "./financeView";
import admin from "src/models/OneCAdmin/OneCAdmin.module.scss";

export const OnecFinanceTab: FC<{ organizationUuid: string }> = ({ organizationUuid }) => {
	const [data, setData] = useState<OrganizationFinance | null>(null);

	const read = useMutation({
		mutationFn: () => fetchOrganizationFinance(organizationUuid),
		onSuccess: setData,
		onError: (e) => reportError(e, { source: translate("onecOrgFinance") }),
	});

	const debts = data?.debts.ok ? debtRows(data.debts.data) : [];
	const totals = data?.debts.ok ? debtTotals(data.debts.data, debts) : null;
	const debtsTotal = data?.debts.ok ? totalOf(data.debts.data) : null;
	const balances = data?.balances.ok ? balanceRows(data.balances.data) : [];

	return (
		<div className={admin.Instances}>
			<div className={admin.Hint}>{translate("onecOrgFinanceHint")}</div>
			<div className={admin.ModalForm}>
				<Button icon="reload" variant="secondary" disabled={read.isPending} onClick={() => read.mutate()}>
					{read.isPending ? translate("loading") : translate("onecOrgFinanceRead")}
				</Button>
				{data && (
					<span className={admin.Hint}>
						{translate("onecOrgFinanceOnDate")}: {getFormatDate(data.onDate)} · {translate("onecOrgFinanceReadAt")}: {getFormatDate(data.readAt)} · {data.baseKey}
					</span>
				)}
			</div>

			{data && !data.debts.ok && (
				<Notice inline items={[{ type: "attention", text: `${translate("onecOrgDebts")}: ${data.debts.error.message ?? data.debts.error.code ?? ""}` }]} />
			)}
			{data?.debts.ok && (
				<>
					<div className={admin.Hint}>
						{translate("onecOrgDebts")}
						{/* Показано меньше, чем есть, — говорим прямо: молча обрезанный список читается как полный. */}
						{debtsTotal !== null && debtsTotal > debts.length ? ` · ${translate("onecOrgFinanceShown")} ${debts.length} ${translate("onecOrgFinanceOf")} ${debtsTotal}` : ""}
					</div>
					{!debts.length
						? <div className={admin.Hint}>{translate("onecOrgFinanceEmpty")}</div>
						: (
							<table className={`${admin.StatsTable} ${admin.ReqTable}`}>
								<thead>
									<tr>
										<th>{translate("counterparty")}</th>
										<th>{translate("binIin")}</th>
										<th>{translate("onecOrgDebtReceivable")}</th>
										<th>{translate("onecOrgDebtPayable")}</th>
										<th>{translate("onecOrgDebtOverdue")}</th>
									</tr>
								</thead>
								<tbody>
									{debts.map((d, i) => (
										<tr key={`${d.bin}-${d.name}-${i}`}>
											<td>{d.name || "—"}</td>
											<td>{d.bin || "—"}</td>
											<td>{showMoney(d.receivable)}</td>
											<td>{showMoney(d.payable)}</td>
											{/* Просрочка — единственное, что здесь красное: остальное нормальный ход дел. */}
											<td className={d.overdue ? admin.ReqOff : undefined}>{showMoney(d.overdue)}</td>
										</tr>
									))}
									{totals && (
										<tr>
											<td colSpan={2}><b>{translate("total")}</b></td>
											<td><b>{showMoney(totals.receivable)}</b></td>
											<td><b>{showMoney(totals.payable)}</b></td>
											<td><b>{showMoney(totals.overdue)}</b></td>
										</tr>
									)}
								</tbody>
							</table>
						)}
				</>
			)}

			{data && !data.balances.ok && (
				<Notice inline items={[{ type: "attention", text: `${translate("onecOrgBalances")}: ${data.balances.error.message ?? data.balances.error.code ?? ""}` }]} />
			)}
			{data?.balances.ok && (
				<>
					<div className={admin.Hint}>{translate("onecOrgBalances")}</div>
					{!balances.length
						? <div className={admin.Hint}>{translate("onecOrgFinanceEmpty")}</div>
						: (
							<table className={`${admin.StatsTable} ${admin.ReqTable}`}>
								<thead>
									<tr>
										<th>{translate("account")}</th>
										<th>{translate("name")}</th>
										<th>{translate("onecOrgBalance")}</th>
									</tr>
								</thead>
								<tbody>
									{balances.map((b, i) => (
										<tr key={`${b.account}-${i}`}>
											<td>{b.account || "—"}</td>
											<td>{b.name || "—"}</td>
											<td>{showMoney(b.balance)}</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
				</>
			)}
		</div>
	);
};

export default OnecFinanceTab;
