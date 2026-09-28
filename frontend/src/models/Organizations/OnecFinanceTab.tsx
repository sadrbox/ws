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
 *
 * ТАБЛИЦЫ — общий компонент Table (28.09), как у соседних вкладок карточки: сортировка по колонкам, быстрый
 * поиск, ширины и видимость колонок запоминаются. Две таблицы делят высоту вкладки (`fitHeight`) и листают
 * свои строки сами. Кнопки «Обновить» у таблиц нет: чтение одно на обе половины — кнопкой над ними.
 */
import { FC, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import Notice from "src/components/Notice";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { reportError } from "src/services/errors/route";
import { getFormatDate } from "src/utils/datetime";
import { fetchOrganizationFinance, type OrganizationFinance } from "src/services/onec/api";
import {
	balanceRows, balanceTableRows, debtFooterValues, debtRows, debtTableRows, showMoney, totalOf,
} from "./financeView";
import admin from "src/models/OneCAdmin/OneCAdmin.module.scss";

const DEBTS = "Organizations_onec_debts";
const BALANCES = "Organizations_onec_balances";

// Идентификатор колонки — ключ перевода её заголовка (getTranslateColumn).
const debtColumns = (): TColumn[] => ([
	{ identifier: "counterparty", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "binIin", type: "string", width: "150px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecOrgDebtReceivable", type: "number", width: "150px", minWidth: "100px", alignment: "right", visible: true, inlist: true, footer: "sum" },
	{ identifier: "onecOrgDebtPayable", type: "number", width: "150px", minWidth: "100px", alignment: "right", visible: true, inlist: true, footer: "sum" },
	{ identifier: "onecOrgDebtOverdue", type: "number", width: "150px", minWidth: "100px", alignment: "right", visible: true, inlist: true, footer: "sum" },
] as unknown as TColumn[]);

const balanceColumns = (): TColumn[] => ([
	{ identifier: "account", type: "string", width: "120px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "320px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecOrgBalance", type: "number", width: "160px", minWidth: "100px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[]);

const MONEY = new Set(["onecOrgDebtReceivable", "onecOrgDebtPayable", "onecOrgDebtOverdue", "onecOrgBalance"]);

/** Суммы — с разрядами и «—» вместо пустого; просрочка — единственное красное: остальное нормальный ход дел. */
const renderMoneyCell = (row: TDataItem, col: TColumn) => {
	if (!MONEY.has(col.identifier)) return undefined;
	const n = row[col.identifier] as number | null;
	if (col.identifier === "onecOrgDebtOverdue" && n) return <span className={admin.ReqOff}>{showMoney(n)}</span>;
	return showMoney(n);
};

export const OnecFinanceTab: FC<{ organizationUuid: string }> = ({ organizationUuid }) => {
	const [data, setData] = useState<OrganizationFinance | null>(null);

	const read = useMutation({
		mutationFn: () => fetchOrganizationFinance(organizationUuid),
		onSuccess: setData,
		onError: (e) => reportError(e, { source: translate("onecOrgFinance") }),
	});

	const debts = useMemo(() => (data?.debts.ok ? debtRows(data.debts.data) : []), [data]);
	const debtsTotal = data?.debts.ok ? totalOf(data.debts.data) : null;
	const debtView = useStaticTableView(useMemo(() => debtTableRows(debts), [debts]), {}, DEBTS, { scope: organizationUuid });
	const debtFooter = useMemo(() => (data?.debts.ok ? debtFooterValues(data.debts.data, translate("total")) : undefined), [data]);
	const [debtCols, setDebtCols] = useState<TColumn[]>(() => getModelColumns(debtColumns(), DEBTS));

	const balanceView = useStaticTableView(useMemo(() => (data?.balances.ok ? balanceTableRows(balanceRows(data.balances.data)) : []), [data]), {}, BALANCES, { scope: organizationUuid });
	const [balanceCols, setBalanceCols] = useState<TColumn[]>(() => getModelColumns(balanceColumns(), BALANCES));

	return (
		<>
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
					<Table {...buildStaticTableProps({
						componentName: DEBTS, rows: debtView.rows, columns: debtCols, setColumns: setDebtCols,
						sorting: debtView.sorting, search: debtView.search, fitHeight: true,
						emptyText: translate("onecOrgFinanceEmpty"),
						footerValues: debts.length ? debtFooter : undefined,
						renderCell: renderMoneyCell,
					})} />
				</>
			)}

			{data && !data.balances.ok && (
				<Notice inline items={[{ type: "attention", text: `${translate("onecOrgBalances")}: ${data.balances.error.message ?? data.balances.error.code ?? ""}` }]} />
			)}
			{data?.balances.ok && (
				<>
					<div className={admin.Hint}>{translate("onecOrgBalances")}</div>
					<Table {...buildStaticTableProps({
						componentName: BALANCES, rows: balanceView.rows, columns: balanceCols, setColumns: setBalanceCols,
						sorting: balanceView.sorting, search: balanceView.search, fitHeight: true,
						emptyText: translate("onecOrgFinanceEmpty"),
						renderCell: renderMoneyCell,
					})} />
				</>
			)}
		</>
	);
};

export default OnecFinanceTab;
