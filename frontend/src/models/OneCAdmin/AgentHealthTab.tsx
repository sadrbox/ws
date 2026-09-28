/**
 * «Состояние сервера» в карточке агента (R1, docs/TASKS_DEV_2026-09-14.md).
 *
 * Сборка, готовность, кластер, процессы и последние ошибки журнала — одной командой агенту
 * (`AGENT_HEALTH`). Раньше за этим шли на сервер: смотреть окно агента или журнал службы.
 *
 * ПО КНОПКЕ, А НЕ ПРИ ОТКРЫТИИ. Вкладки формы отрисованы все сразу, и запрос при монтировании слал бы
 * команду агенту на каждое открытие карточки. Каждое «Обновить» — новая команда; время и отказы
 * команд — на соседней вкладке («Время и отказы»), здесь их не повторяем.
 *
 * Разделы «свойство: значение» — простые таблицы из двух столбцов; процессы — список, он на общем
 * SubTableSheets (28.09): тот же вид ячейки, что у Table, и высота по строкам среди других блоков.
 */
import { useRunningCommand } from "src/components/TechMessages/operations";
import { FC, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import SubTableSheets from "src/components/SubTableSheets";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { getFormatDate } from "src/utils/datetime";
import { asText } from "src/utils/asText";
import { fetchAgentHealth } from "src/services/onec/api";
import { withOp } from "./progress";
import { useAgents } from "./shared";
import { QueryError } from "./sharedUi";
import { healthSections } from "./agentHealth";
import { ageText, processRows, type ProcessRow } from "./agentTablesView";
import styles from "./OneCAdmin.module.scss";
import diag from "./AgentDiag.module.scss";

// Идентификатор колонки — ключ перевода её заголовка (getTranslateColumn).
const PROCESS_COLUMNS: TColumn[] = [
	{ identifier: "pid", type: "number", width: "90px", minWidth: "70px", alignment: "right", visible: true, inlist: true },
	{ identifier: "onecHealthTool", type: "string", width: "140px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecHealthWhat", type: "string", width: "300px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecQueueBase", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecQueueAge", type: "number", width: "110px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
];

const renderProcessCell = (r: TDataItem, col: TColumn) => {
	const row = r as ProcessRow;
	// PID — идентификатор, а не количество: без разрядных пробелов числового формата.
	if (col.identifier === "pid") return asText(row.pid);
	/*
	 * Процесс без команды («сирота») раньше выделялся всей строкой (RowWarn). У SubTableSheets класса строки нет —
	 * тоном предупреждения помечена ячейка «Что делает», где и написано, что он сирота.
	 */
	if (col.identifier === "onecHealthWhat" && row.__orphan) return <span className={styles.ReqWait}>{asText(row.onecHealthWhat)}</span>;
	if (col.identifier === "onecQueueAge") return ageText(row.onecQueueAge);
	return undefined;
};

export const AgentHealthTab: FC<{ agentId: string; agentName: string }> = ({ agentId, agentName }) => {
	const health = useQuery({
		queryKey: ["onec", "agent-health", agentId],
		queryFn: () => withOp({
			kind: "read", title: translate("onecAgentHealth"), target: agentName,
			ref: { endpoint: "onec-agents", uuid: agentId, label: agentName },
		}, () => fetchAgentHealth(agentId)),
		enabled: false,
		retry: false,
		staleTime: Infinity,
	});
	const h = health.data;
	// Сроки сервиса — из списка агентов, который панель и так опрашивает (С24).
	const limits = useAgents().data?.limits;
	const sections = h ? healthSections(h, limits) : [];
	const processes = useMemo(() => processRows(h?.processes ?? []), [h]);
	const problems = h?.logProblems ?? [];

	const healthRunning = useRunningCommand(["AGENT_HEALTH"]);

	return (
		<div className={styles.Instances}>
			<div className={styles.Hint}>{translate("onecAgentHealthHint")}</div>
			<div>
				<Button icon="recalc" variant="primary" disabled={!agentId || health.isFetching || healthRunning} onClick={() => void health.refetch()}>
					{h ? translate("onecAgentDiagRefresh") : translate("onecAgentHealthGet")}
				</Button>
			</div>
			<QueryError error={health.error} noticeKey={`agent-health-${agentId}`} source={translate("onecAgentHealth")} />
			{!h && !health.isFetching && <div className={styles.Hint}>{translate("onecAgentHealthNone")}</div>}
			{h?.collectedAt && (
				<div className={styles.Hint}>{translate("onecAgentCollectedAt")}: {getFormatDate(h.collectedAt)}</div>
			)}

			{sections.map((s) => (
				<div key={s.title}>
					<div className={styles.StatsTitle}>{s.title}</div>
					<table className={styles.StatsTable}>
						<tbody>
							{s.rows.map((r) => (
								<tr key={r.label} className={r.warn ? diag.RowWarn : undefined}>
									<td>{r.label}</td><td>{r.value}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			))}

			{h && (
				<div>
					<div className={styles.StatsTitle}>{translate("onecHealthProcesses")}</div>
					{processes.length ? (
						<SubTableSheets columns={PROCESS_COLUMNS} rows={processes} renderCell={renderProcessCell} />
					) : <div className={styles.Hint}>{translate("onecHealthNoProcesses")}</div>}
				</div>
			)}

			{problems.length > 0 && (
				<div>
					<div className={styles.StatsTitle}>{translate("onecHealthLogProblems")}</div>
					<pre className={diag.LogLines}>{problems.join("\n")}</pre>
				</div>
			)}
		</div>
	);
};

export default AgentHealthTab;
