/**
 * «Состояние сервера» в карточке агента (R1, docs/TASKS_DEV_2026-09-14.md).
 *
 * Сборка, готовность, кластер, процессы и последние ошибки журнала — одной командой агенту
 * (`AGENT_HEALTH`). Раньше за этим шли на сервер: смотреть окно агента или журнал службы.
 *
 * ПО КНОПКЕ, А НЕ ПРИ ОТКРЫТИИ. Вкладки формы отрисованы все сразу, и запрос при монтировании слал бы
 * команду агенту на каждое открытие карточки. Каждое «Обновить» — новая команда; время и отказы
 * команд — на соседней вкладке («Время и отказы»), здесь их не повторяем.
 */
import { useRunningCommand } from "src/components/TechMessages/operations";
import { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import { getFormatDate } from "src/utils/datetime";
import { fetchAgentHealth } from "src/services/onec/api";
import { withOp } from "./progress";
import { QueryError, useAgents } from "./shared";
import { healthSections } from "./agentHealth";
import { formatDuration } from "./queueStats";
import styles from "./OneCAdmin.module.scss";
import diag from "./AgentDiag.module.scss";

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
	const processes = h?.processes ?? [];
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
						<table className={styles.StatsTable}>
							<thead>
								<tr>
									<th>PID</th>
									<th>{translate("onecHealthTool")}</th>
									<th>{translate("onecHealthWhat")}</th>
									<th>{translate("onecQueueBase")}</th>
									<th>{translate("onecQueueAge")}</th>
								</tr>
							</thead>
							<tbody>
								{processes.map((p) => (
									<tr key={p.pid} className={p.orphan ? diag.RowWarn : undefined}>
										<td>{p.pid}</td>
										<td>{p.tool ?? "—"}</td>
										<td>{p.what ?? "—"}{p.orphan ? ` (${translate("onecHealthOrphan")})` : ""}</td>
										<td>{p.base ?? "—"}</td>
										<td>{typeof p.ageSecs === "number" ? (formatDuration(p.ageSecs) || `0 ${translate("secShort")}`) : "—"}</td>
									</tr>
								))}
							</tbody>
						</table>
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
