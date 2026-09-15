/**
 * «Кто держит очередь» и среднее время по типам — над таблицей «Прогресса» (R5, docs/TASKS_DEV_2026-09-14.md).
 *
 * Строка очереди говорила «идёт: 1», но не что именно и сколько: зависшее чтение и четырёхчасовая
 * загрузка выглядели одинаково, а прервать зависшее можно было только из «Заданий». Здесь — выданные
 * агентам и ещё не ответившие команды; «Прервать» — только у чтений (обрыв загрузки или обновления
 * оставляет базу в промежуточном состоянии — так же решает и сервис).
 *
 * Время по типам — сводно по снимкам агентов: рядом с оценкой «сколько ждать» видно, из чего она.
 */
import { FC, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { abortCommand, type OnecQueueStats } from "src/services/onec/api";
import { durationRows } from "./agentStats";
import { formatDuration } from "./queueStats";
import { useOnecWrite } from "./shared";
import styles from "./OneCAdmin.module.scss";
import diag from "./AgentDiag.module.scss";

export const QueueHolders: FC<{ stats: OnecQueueStats | undefined }> = ({ stats }) => {
	const canWrite = useOnecWrite();
	const qc = useQueryClient();
	const [showTimes, setShowTimes] = useState(false);

	const abort = useMutation({
		mutationFn: (commandId: string) => abortCommand(commandId),
		onSuccess: (r) => {
			showToast(r.aborted
				? [translate("onecQueueAborted"), r.killed ? translate("onecAbortKilled") : "", r.note ?? ""].filter(Boolean).join(". ")
				: translate("onecQueueAbortNotRunning"),
				r.aborted ? "success" : "warning");
			void qc.invalidateQueries({ queryKey: ["onec", "queue-stats"] });
		},
		onError: (e) => reportError(e, { source: translate("onecQueueHolders") }),
	});

	const holders = stats?.runningCommands ?? [];
	const times = durationRows(stats?.agentDurations);
	if (!holders.length && !times.length) return null;

	return (
		<div className={diag.QueueHolders}>
			{holders.length > 0 && (
				<>
					<div className={styles.StatsTitle}>{translate("onecQueueHolders")}</div>
					<table className={styles.StatsTable}>
						<thead>
							<tr>
								<th>{translate("onecStatType")}</th>
								<th>{translate("onecQueueBase")}</th>
								<th>{translate("onecQueueAge")}</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{holders.map((c) => (
								<tr key={c.commandId}>
									<td>{c.type}</td>
									<td>{c.baseKey ?? "—"}</td>
									<td>{formatDuration(c.ageSecs) || `0 ${translate("secShort")}`}</td>
									<td>
										{c.abortable && canWrite && (
											<Button variant="secondary" disabled={abort.isPending}
												onClick={() => abort.mutate(c.commandId)}>
												{translate("onecQueueAbort")}
											</Button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</>
			)}
			{times.length > 0 && (
				<>
					<Button variant="secondary" active={showTimes} onClick={() => setShowTimes((v) => !v)}>
						{translate("onecQueueTypeTimes")}
					</Button>
					{showTimes && (
						<table className={styles.StatsTable}>
							<thead>
								<tr>
									<th>{translate("onecStatType")}</th>
									<th>{translate("onecStatCount")}</th>
									<th>{translate("onecStatAvg")}</th>
									<th>{translate("onecStatP95")}</th>
									<th>{translate("onecStatMax")}</th>
								</tr>
							</thead>
							<tbody>
								{times.map((r) => (
									<tr key={r.type}>
										<td>{r.type}</td><td>{r.count}</td><td>{r.avg}</td><td>{r.p95}</td><td>{r.max}</td>
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

export default QueueHolders;
