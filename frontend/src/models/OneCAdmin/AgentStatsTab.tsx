/**
 * ВРЕМЯ И ОТКАЗЫ КОМАНД (S5) — вкладка карточки агента: числами вместо «агент тормозит».
 *
 * Агент считает их сам и шлёт в каждом heartbeat: «IB_BUSY: 87», «IB_LIST_USERS в среднем 28 с». Без этой вкладки
 * каждое «медленно» мерили вручную, а настройке параллельности агента не на что было опереться.
 *
 * ДВЕ ТАБЛИЦЫ — ОБЩИЙ Table (28.09): сортировка по колонкам, быстрый поиск, ширины и видимость колонок
 * запоминаются. Они делят высоту вкладки (`fitHeight`, как «Доступ AI»), и каждая листает свои строки сама.
 * «Обновить» у них нет: числа приходят со списком агентов, который панель и так опрашивает.
 */
import { FC, useMemo, useState } from "react";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import type { OnecAgent } from "src/services/onec/api";
import { durationCellText, durationColumns, durationTableRows, failureTableRows } from "./agentTablesView";
import styles from "./OneCAdmin.module.scss";

const DURATIONS = "OneCAdmin_agent_durations";
const FAILURES = "OneCAdmin_agent_failures";

// Идентификатор колонки — ключ перевода её заголовка (getTranslateColumn).
const failureColumns = (): TColumn[] => [
	{ identifier: "onecStatCode", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecStatCount", type: "number", width: "120px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
];

/** `agentId` — чей это снимок: поиск в таблицах относится к этому агенту и в карточку другого не переносится. */
export const AgentStatsTab: FC<{ stats: OnecAgent["commandStats"]; agentId?: string }> = ({ stats, agentId }) => {
	// Самое медленное — сверху: вопрос «что тормозит» задают о нём; отказы — самые частые сверху.
	const durationView = useStaticTableView(useMemo(() => durationTableRows(stats?.durationsByType), [stats]), { onecStatAvg: "desc" }, DURATIONS, { scope: agentId });
	const failureView = useStaticTableView(useMemo(() => failureTableRows(stats?.failuresByCode), [stats]), { onecStatCount: "desc" }, FAILURES, { scope: agentId });
	const [durationCols, setDurationCols] = useState<TColumn[]>(() => getModelColumns(durationColumns(), DURATIONS));
	const [failureCols, setFailureCols] = useState<TColumn[]>(() => getModelColumns(failureColumns(), FAILURES));

	if (!stats) {
		return (
			<div className={styles.Instances}>
				<div className={styles.Hint}>{translate("onecAgentStatsHint")}</div>
				<div className={styles.Hint}>{translate("onecAgentStatsNone")}</div>
			</div>
		);
	}

	return (
		<div className={styles.SplitTabs}>
			<div className={styles.Hint}>{translate("onecAgentStatsHint")}</div>
			<section className={styles.SplitHalf}>
				<div className={styles.StatsTitle}>{translate("onecStatDurations")}</div>
				<Table {...buildStaticTableProps({
					componentName: DURATIONS, rows: durationView.rows, columns: durationCols, setColumns: setDurationCols,
					sorting: durationView.sorting, search: durationView.search, fitHeight: true,
					emptyText: translate("onecStatNoDurations"),
					renderCell: durationCellText,
				})} />
			</section>
			<section className={styles.SplitHalf}>
				<div className={styles.StatsTitle}>{translate("onecStatFailures")}</div>
				<Table {...buildStaticTableProps({
					componentName: FAILURES, rows: failureView.rows, columns: failureCols, setColumns: setFailureCols,
					sorting: failureView.sorting, search: failureView.search, fitHeight: true,
					emptyText: translate("onecStatNoFailures"),
				})} />
			</section>
		</div>
	);
};

export default AgentStatsTab;
