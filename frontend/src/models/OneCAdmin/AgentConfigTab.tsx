/**
 * «Настройки агента» в карточке (задача агенту §3, выпуск агента 2026-09-20).
 *
 * Настройки живут в `agent.toml` на компьютере агента; панель читает их командой и правит ТОЛЬКО то, что агент
 * сам объявил изменяемым (`editable`): порядок и включение баз, сколько баз он обслуживает одновременно, пределы
 * времени команд, уровень журнала. Базы здесь не заводятся и секреты не правятся — это окно агента на его
 * компьютере; пароли и токены приходят сюда лишь признаком «задан».
 *
 * ПО КНОПКЕ, А НЕ ПРИ ОТКРЫТИИ: чтение — команда агенту, и слать её на каждый взгляд в карточку незачем.
 */
import { FC, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import { Field, FieldSelect } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { asText } from "src/utils/asText";
import { fetchAgentConfig, setAgentConfig, type AgentConfig, type AgentConfigPatch } from "src/services/onec/api";
import { withOp } from "./progress";
import { QueryError } from "./shared";
import { canEditField, configPatch, numberField } from "./agentConfigView";
import styles from "./OneCAdmin.module.scss";

export const AgentConfigTab: FC<{ agentId: string; agentName: string; canManage: boolean }> = ({ agentId, agentName, canManage }) => {
	const qc = useQueryClient();
	const queryKey = ["onec", "agent-config", agentId];
	const cfg = useQuery({
		queryKey,
		queryFn: () => withOp({ kind: "read", title: translate("onecAgentConfig"), target: agentName,
			ref: { endpoint: "onec-agents", uuid: agentId, label: agentName } }, () => fetchAgentConfig(agentId)),
		enabled: false, retry: false, staleTime: Infinity,
	});
	const c = cfg.data;
	// Правки живут до сохранения отдельно от прочитанного: «как у агента» и «как я хочу» — разные состояния.
	const [draft, setDraft] = useState<AgentConfigPatch>({});
	const editable = c?.editable ?? [];

	const save = useMutation({
		// Уходит только годное: пустые поля и мусор в числах агент отверг бы по схеме.
		mutationFn: () => withOp({ kind: "update", title: translate("onecAgentConfig"), target: agentName,
			ref: { endpoint: "onec-agents", uuid: agentId, label: agentName } }, () => setAgentConfig(agentId, configPatch(draft))),
		onSuccess: (fresh: AgentConfig) => {
			qc.setQueryData<AgentConfig>(queryKey, fresh);
			setDraft({});
			showToast(fresh.restartRequired ? translate("onecAgentConfigRestartNeeded") : translate("saved"),
				fresh.restartRequired ? "warning" : "success");
			void qc.invalidateQueries({ queryKey: ["onec", "agents"] });
		},
		onError: (e) => reportError(e, { source: translate("onecAgentConfig") }),
	});

	const num = (field: keyof AgentConfigPatch & ("ibParallel" | "commandTimeoutSecs" | "longCommandTimeoutSecs")) => ({
		value: asText(draft[field] ?? c?.[field] ?? ""),
		disabled: !canManage || !canEditField(editable, field),
		onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [field]: numberField(e.target.value) })),
		error: draft[field] !== undefined && draft[field] === null,
	});

	const bases = c?.bases ?? [];
	const baseDraft = (key: string) => draft.bases?.find((b) => b.key === key);
	const setBase = (key: string, patch: { order?: number; enabled?: boolean }) => setDraft((d) => {
		const list = [...(d.bases ?? [])];
		const i = list.findIndex((b) => b.key === key);
		if (i >= 0) list[i] = { ...list[i], ...patch };
		else list.push({ key, ...patch });
		return { ...d, bases: list };
	});

	const dirty = Object.keys(draft).length > 0;

	return (
		<div className={styles.Instances}>
			<div className={styles.Hint}>{translate("onecAgentConfigHint")}</div>
			<div className={styles.BasesLimits}>
				<Button icon="recalc" variant="primary" disabled={cfg.isFetching} onClick={() => void cfg.refetch()}>
					{c ? translate("onecAgentDiagRefresh") : translate("onecAgentConfigGet")}
				</Button>
				{c && canManage && (
					<Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{translate("save")}</Button>
				)}
				{c && dirty && <Button onClick={() => setDraft({})}>{translate("cancel")}</Button>}
			</div>
			<QueryError error={cfg.error} noticeKey={`agent-config-${agentId}`} source={translate("onecAgentConfig")} />

			{c && (
				<>
					<div className={styles.BasesLimits}>
						<Field name="cfg_parallel" label={translate("onecCfgParallel")} width={FIELD_WIDTH.sm} {...num("ibParallel")} />
						<Field name="cfg_timeout" label={translate("onecCfgTimeout")} width={FIELD_WIDTH.sm} {...num("commandTimeoutSecs")} />
						<Field name="cfg_long_timeout" label={translate("onecCfgLongTimeout")} width={FIELD_WIDTH.sm} {...num("longCommandTimeoutSecs")} />
						<FieldSelect name="cfg_log" label={translate("onecCfgLogLevel")}
							value={asText(draft.logLevel ?? c.logLevel ?? "")}
							disabled={!canManage || !canEditField(editable, "logLevel")}
							onChange={(e) => setDraft((d) => ({ ...d, logLevel: e.target.value }))}
							options={["debug", "info", "warn", "error"].map((l) => ({ value: l, label: l }))} />
					</div>
					{/* Что менять нельзя — тоже ответ: эти поля правят в окне агента на его компьютере. */}
					<div className={styles.Hint}>
						{translate("onecCfgFile")}: {c.configPath || "—"} · {translate("onecCfgService")}: {c.serviceName || "—"}
						{c.cloudUrl ? ` · ${translate("onecCfgCloud")}: ${c.cloudUrl}` : ""}
						{c.secrets ? ` · ${translate("onecCfgSecrets")}: ${Object.entries(c.secrets).filter(([, v]) => v?.set).map(([k]) => k).join(", ") || "—"}` : ""}
					</div>

					{bases.length > 0 && (
						<table className={`${styles.StatsTable} ${styles.ReqTable}`}>
							<thead>
								<tr>
									<th>{translate("onecBase")}</th>
									<th>{translate("onecTransport")}</th>
									<th>{translate("onecCfgAddress")}</th>
									<th>{translate("onecCfgOrder")}</th>
									<th>{translate("onecCfgEnabled")}</th>
									<th>{translate("onecCfgSecrets")}</th>
								</tr>
							</thead>
							<tbody>
								{bases.map((b) => {
									const d = baseDraft(b.key);
									const enabled = d?.enabled ?? b.enabled !== false;
									// База секции [onec] всегда первая: её порядок агент принимает только нулём.
									const orderLocked = !canManage || !canEditField(editable, "bases") || b.main === true;
									return (
										<tr key={b.key}>
											<td className={styles.Mono}>{b.key}{b.main ? ` · ${translate("onecCfgMainBase")}` : ""}</td>
											<td>{b.transport ? b.transport.toUpperCase() : "—"}</td>
											<td className={styles.Mono}>{b.address || "—"}{b.user ? ` · ${b.user}` : ""}</td>
											<td>
												<Field name={`cfg_order_${b.key}`} width={FIELD_WIDTH.sm} disabled={orderLocked}
													value={asText(d?.order ?? b.order ?? "")}
													onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
														const n = numberField(e.target.value);
														if (n !== null) setBase(b.key, { order: n });
													}} />
											</td>
											<td>
												<button type="button" className={styles.LinkButton}
													disabled={!canManage || !canEditField(editable, "bases")}
													onClick={() => setBase(b.key, { enabled: !enabled })}>
													{enabled ? translate("onecCfgOn") : translate("onecCfgOff")}
												</button>
											</td>
											<td className={styles.Hint}>
												{[b.password?.set ? translate("onecCfgPasswordSet") : "", b.token?.set ? translate("onecCfgTokenSet") : ""].filter(Boolean).join(" · ") || "—"}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					)}
					{dirty && <div className={styles.Hint}>{translate("onecCfgWillSend")}: {Object.keys(configPatch(draft)).join(", ")}</div>}
				</>
			)}
		</div>
	);
};

export default AgentConfigTab;
