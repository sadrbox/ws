/**
 * Вкладки карточки агента о его работе (п. 1–3): сводка бизнес-агента, команды агента, журнал действий над ним.
 *
 * СВОДКА БИЗНЕС-АГЕНТА — по кнопке, как «Состояние сервера» у агента кластера: это команда агенту, и слать её на
 * каждое открытие карточки незачем. Команды и журнал — чтения базы сервиса, они грузятся сами.
 */
import { FC, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { getFormatDate } from "src/utils/datetime";
import { cancelCommands, fetchAgentAudit, fetchAgentCommands, fetchBusinessHealth } from "src/services/onec/api";
import { withOp } from "./progress";
import { QueryError } from "./shared";
import { auditEventLabel, auditDetailsText, commandStateLabel, commandStateTone, healthBaseState, healthScalars } from "./agentActivityView";
import { formatDuration } from "./queueStats";
import styles from "./OneCAdmin.module.scss";

const TONE_CLASS = { wait: styles.ReqWait, ok: styles.ReqOk, bad: styles.ReqBad, off: styles.ReqOff };

export const BusinessHealthTab: FC<{ agentId: string; agentName: string }> = ({ agentId, agentName }) => {
	const health = useQuery({
		queryKey: ["onec", "agent-health", agentId],
		queryFn: () => withOp({ kind: "read", title: translate("onecAgentHealth"), target: agentName,
			ref: { endpoint: "onec-agents", uuid: agentId, label: agentName } }, () => fetchBusinessHealth(agentId)),
		enabled: false, retry: false, staleTime: Infinity,
	});
	const h = health.data;
	const bases = Array.isArray(h?.bases) ? h.bases : [];
	return (
		<div className={styles.Instances}>
			<div className={styles.Hint}>{translate("onecBusinessHealthHint")}</div>
			<div>
				<Button icon="recalc" variant="primary" disabled={!agentId || health.isFetching} onClick={() => void health.refetch()}>
					{h ? translate("onecAgentDiagRefresh") : translate("onecAgentHealthGet")}
				</Button>
			</div>
			<QueryError error={health.error} noticeKey={`agent-health-${agentId}`} source={translate("onecAgentHealth")} />
			{/* Сама служба — строкой над таблицей: сборка, сколько работает, какой экземпляр отвечает (СП2). */}
			{h?.agent && (
				<div className={styles.Hint}>
					{[h.agent.version || h.agent.build, h.agent.os,
						h.agent.uptimeSecs != null ? `${translate("onecAgentUptime")}: ${formatDuration(h.agent.uptimeSecs)}` : "",
						h.agent.startedAt ? `${translate("onecAgentStartedAt")}: ${getFormatDate(h.agent.startedAt)}` : "",
						h.agent.instanceId ? `${translate("onecAgentInstance")}: ${h.agent.instanceId}` : "",
					].filter(Boolean).join(" · ")}
				</div>
			)}
			{h && (
				<table className={`${styles.StatsTable} ${styles.ReqTable}`}>
					<tbody>
						{healthScalars(h).map(([k, v]) => (
							<tr key={k}><td>{k}</td><td>{v}</td></tr>
						))}
						{h.limits && (
							<tr>
								<td>limits</td>
								<td>{`maxBases ${h.limits.maxBases ?? "—"} · maxBins ${h.limits.maxBins ?? "—"}${h.limits.activeBins ? ` · activeBins ${h.limits.activeBins.length}` : ""}`}</td>
							</tr>
						)}
					</tbody>
				</table>
			)}
			{bases.length > 0 && (
				<table className={`${styles.StatsTable} ${styles.ReqTable}`}>
					<thead>
						<tr>
							<th>{translate("onecBase")}</th>
							<th>{translate("status")}</th>
							<th>{translate("onecTransport")}</th>
							<th>{translate("onecExtVersion")}</th>
							{/* Недоступная база без времени выглядит одинаково и через минуту молчания, и через неделю. */}
							<th>{translate("onecHealthLastOk")}</th>
							<th>{translate("onecHealthLastError")}</th>
						</tr>
					</thead>
					<tbody>
						{bases.map((b, i) => (
							<tr key={`${b.baseKey ?? b.key ?? ""}-${i}`}>
								<td className={styles.Mono}>{b.baseKey ?? b.key ?? "—"}</td>
								<td className={b.overLimit || b.status === "OVER_LIMIT" ? styles.OverLimit : undefined}>
									{healthBaseState(b)}{b.error ? ` · ${b.error}` : ""}
								</td>
								<td>{b.transport ? b.transport.toUpperCase() : "—"}</td>
								<td>{b.extVersion ?? "—"}</td>
								<td>{b.lastOkAt ? getFormatDate(b.lastOkAt) : "—"}</td>
								<td className={styles.Hint}>
									{b.lastError?.at ? getFormatDate(b.lastError.at) : ""}
									{b.lastError?.message ? ` ${b.lastError.message}` : (b.lastError?.at ? "" : "—")}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
};

/**
 * Команды агента: не начатые можно снять с очереди — это делает сервис и годится для любого агента. Прервать уже
 * начатую умеет только агент кластера (вкладка «Прогресс»); бизнес-агенту это — задача на стороне агента.
 */
export const AgentCommandsTab: FC<{ agentId: string; canManage: boolean }> = ({ agentId, canManage }) => {
	const qc = useQueryClient();
	const queryKey = ["onec", "agent-commands", agentId];
	/*
	 * БЕЗ ФОНОВОГО ОПРОСА. Вкладки карточки монтируются все сразу (components/Tabs), и опрос шёл даже у вкладки,
	 * которую не открывали. Список читается при открытии карточки и по кнопке «Обновить» (аудит 21.09).
	 */
	const list = useQuery({ queryKey, queryFn: () => fetchAgentCommands(agentId, 50), enabled: !!agentId });
	const items = useMemo(() => list.data?.items ?? [], [list.data]);
	const [picked, setPicked] = useState<string[]>([]);
	const queued = useMemo(() => items.filter((c) => c.state === "queued"), [items]);
	// Команда ушла из очереди — отметка с ней: иначе кнопка обещает снять то, чего уже нет (аудит 21.09).
	useEffect(() => {
		setPicked((p) => {
			const live = p.filter((id) => queued.some((c) => c.id === id));
			return live.length === p.length ? p : live;
		});
	}, [queued]);
	const cancel = useMutation({
		mutationFn: () => cancelCommands(picked),
		onSuccess: (r) => {
			setPicked([]);
			showToast(`${translate("onecAgentCommandsCanceled")}: ${r.canceled} / ${r.asked}`, r.canceled === r.asked ? "success" : "warning");
			void qc.invalidateQueries({ queryKey });
		},
		onError: (e) => reportError(e, { source: translate("onecAgentCommands") }),
	});
	return (
		<div className={styles.Instances}>
			<div className={styles.Hint}>{translate("onecAgentCommandsHint")}</div>
			<div className={styles.BasesLimits}>
				<span className={styles.Hint}>
					{translate("onecCmdQueued")}: {queued.length} · {translate("onecCmdRunning")}: {items.filter((c) => c.state === "dispatched").length}
				</span>
				<Button icon="recalc" onClick={() => void list.refetch()} disabled={list.isFetching}>{translate("refresh")}</Button>
				{canManage && (
					<Button variant="danger" disabled={!picked.length || cancel.isPending} onClick={() => cancel.mutate()}>
						{translate("onecAgentCommandsCancel")}{picked.length ? ` (${picked.length})` : ""}
					</Button>
				)}
			</div>
			<QueryError error={list.error} noticeKey={`agent-commands-${agentId}`} source={translate("onecAgentCommands")} />
			{list.data && !items.length && <div className={styles.Hint}>{translate("onecAgentCommandsNone")}</div>}
			{items.length > 0 && (
				<table className={`${styles.StatsTable} ${styles.ReqTable}`}>
					<thead>
						<tr>
							<th />
							<th>{translate("onecCmdCreated")}</th>
							<th>{translate("onecCmdType")}</th>
							<th>{translate("onecBase")}</th>
							<th>{translate("status")}</th>
							<th>{translate("onecCmdFinished")}</th>
						</tr>
					</thead>
					<tbody>
						{items.map((c) => (
							<tr key={c.id}>
								<td>
									{c.state === "queued" && canManage && (
										<input type="checkbox" aria-label={c.id} checked={picked.includes(c.id)}
											onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
									)}
								</td>
								<td>{getFormatDate(c.createdAt)}</td>
								<td className={styles.Mono}>{c.type}</td>
								<td className={styles.Mono}>{c.baseKey || "—"}</td>
								<td>
									<div className={TONE_CLASS[commandStateTone(c.state)]}>{commandStateLabel(c.state)}</div>
									{c.error?.message && <div className={styles.Hint}>{c.error.code ? `${c.error.code}: ` : ""}{c.error.message}</div>}
								</td>
								<td>{c.finishedAt ? getFormatDate(c.finishedAt) : c.dispatchedAt ? `${translate("onecCmdStartedAt")} ${getFormatDate(c.dispatchedAt)}` : "—"}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
};

export const AgentAuditTab: FC<{ agentId: string }> = ({ agentId }) => {
	const list = useQuery({ queryKey: ["onec", "agent-audit", agentId], queryFn: () => fetchAgentAudit(agentId), enabled: !!agentId });
	const items = list.data?.items ?? [];
	return (
		<div className={styles.Instances}>
			<div className={styles.Hint}>{translate("onecAgentAuditHint")}</div>
			<div><Button icon="recalc" onClick={() => void list.refetch()} disabled={list.isFetching}>{translate("refresh")}</Button></div>
			<QueryError error={list.error} noticeKey={`agent-audit-${agentId}`} source={translate("onecAgentAudit")} />
			{list.data && !items.length && <div className={styles.Hint}>{translate("onecAgentAuditNone")}</div>}
			{items.length > 0 && (
				<table className={`${styles.StatsTable} ${styles.ReqTable}`}>
					<thead>
						<tr>
							<th>{translate("onecAuditAt")}</th>
							<th>{translate("onecAuditEvent")}</th>
							<th>{translate("onecAuditWho")}</th>
							<th>{translate("onecAuditDetails")}</th>
						</tr>
					</thead>
					<tbody>
						{items.map((x, i) => (
							<tr key={`${x.at}-${i}`}>
								<td>{getFormatDate(x.at)}</td>
								<td>{auditEventLabel(x.event)}</td>
								<td>{x.userName || translate("onecAuditSystem")}</td>
								<td className={styles.Hint}>{auditDetailsText(x.details)}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
};
