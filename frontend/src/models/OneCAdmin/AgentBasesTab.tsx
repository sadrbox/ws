/**
 * «Базы агента» в карточке бизнес-агента (ПН, docs/TASK_SERVICE_AGENT_BASES_LIMITS.md).
 *
 * Одна служба бизнес-агента обслуживает много баз своего компьютера, каждую по HTTP или COM. Сколько баз и
 * разных БИНов ей можно — решает тариф: сервис считает лимит по порядку баз в настройках агента и команды сверх
 * него отвергает, не ставя в очередь. Здесь видно, что подключено, что из этого сверх лимита и куда уходят
 * команды по организации, которая есть в нескольких базах.
 *
 * Срез хранит сервис (агент шлёт его сам при регистрации и в heartbeat) — это чтение из БД, не команда агенту,
 * поэтому список запрашивается при открытии, а не по кнопке.
 */
import { FC, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import Modal from "src/components/Modal";
import { Field } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { fetchAgentBases, setAgentActiveBins, setAgentLimits, type AgentBasesView } from "src/services/onec/api";
import ActivationRequestsTab from "./ActivationRequestsTab";
import { withOp } from "./progress";
import { QueryError } from "./shared";
import {
	baseState, baseStateLabel, limitInput, overUsage, parseLimitInput, sameLimits, transportLabel, usageText,
} from "./agentBasesView";
import styles from "./OneCAdmin.module.scss";

export const AgentBasesTab: FC<{ agentId: string; agentName: string }> = ({ agentId, agentName }) => {
	const qc = useQueryClient();
	const queryKey = ["onec", "agent-bases", agentId];
	const q = useQuery({
		queryKey,
		queryFn: () => fetchAgentBases(agentId),
		enabled: !!agentId,
		// Срез обновляется heartbeat'ом агента — раз в полминуты достаточно, чтобы увидеть новую базу.
		refetchInterval: 30_000,
	});
	const v = q.data;

	// Черновик лимита: пока поле не трогали — в нём сохранённое значение, после сохранения черновик сбрасывается.
	const [draft, setDraft] = useState<{ bases?: string; bins?: string }>({});
	const maxBases = draft.bases ?? (v ? limitInput(v.limits.maxBases) : "");
	const maxBins = draft.bins ?? (v ? limitInput(v.limits.maxBins) : "");

	const nextBases = parseLimitInput(maxBases);
	const nextBins = parseLimitInput(maxBins);
	const valid = nextBases !== undefined && nextBins !== undefined;
	const changed = !!v && valid && !sameLimits(v.limits, { maxBases: nextBases, maxBins: nextBins });

	const save = useMutation({
		mutationFn: () => withOp(
			{ kind: "update", title: translate("onecAgentLimits"), target: agentName, ref: { endpoint: "onec-agents", uuid: agentId, label: agentName } },
			() => setAgentLimits(agentId, { maxBases: nextBases ?? null, maxBins: nextBins ?? null })),
		onSuccess: (fresh) => {
			// Ответ сервиса — уже новое представление: показываем его сразу, иначе до повторного запроса поля
			// на миг вернулись бы к прежнему лимиту. Права и роль в ответе на запись не приходят — берём прежние.
			qc.setQueryData<AgentBasesView>(queryKey, (old) => (old ? { ...old, ...fresh } : fresh));
			setDraft({});
			showToast(translate("saved"), "success");
			void qc.invalidateQueries({ queryKey });
			void qc.invalidateQueries({ queryKey: ["onec", "agents"] });
		},
		onError: (e) => reportError(e, { source: translate("onecAgentLimits") }),
	});

	/*
	 * АКТИВНЫЕ БИНЫ (СВ4). Список задан — обслуживаются ровно они, порядок баз в настройках агента больше не решает;
	 * нет списка — правило «первые N». «Зафиксировать текущие» записывает то, что агент обслуживает сейчас: так
	 * переходят на список, ничего не выключив.
	 */
	const activeBins = v?.limits.activeBins ?? null;
	const setBins = useMutation({
		mutationFn: (body: { bins: string[] | null } | { fixCurrent: true }) => withOp(
			{ kind: "update", title: translate("onecActiveBins"), target: agentName, ref: { endpoint: "onec-agents", uuid: agentId, label: agentName } },
			() => setAgentActiveBins(agentId, body)),
		onSuccess: (fresh) => {
			qc.setQueryData<AgentBasesView>(queryKey, (old) => (old ? { ...old, ...fresh } : fresh));
			showToast(translate("saved"), "success");
			void qc.invalidateQueries({ queryKey });
			void qc.invalidateQueries({ queryKey: ["onec", "agents"] });
		},
		onError: (e) => reportError(e, { source: translate("onecActiveBins") }),
	});
	// Выключение БИНа — не мелочь: агент сразу перестаёт обслуживать эту организацию, и команды по ней получат
	// отказ. Включение спрашивать незачем — оно ничего не отнимает.
	const [confirmOff, setConfirmOff] = useState<string | null>(null);
	const toggleBin = (bin: string, on: boolean) => {
		const list = activeBins ?? [];
		if (!on) { setConfirmOff(bin); return; }
		setBins.mutate({ bins: [...list, bin] });
	};

	const bases = v?.bases ?? [];
	const anyOver = bases.some((b) => baseState(b) === "overLimit" || (b.organizations ?? []).some((o) => o.overLimit));

	return (
		<div className={styles.Instances}>
			<div className={styles.Hint}>{translate("onecAgentBasesHint")}</div>
			<QueryError error={q.error} noticeKey={`agent-bases-${agentId}`} source={translate("onecAgentBases")} />

			{v && (
				<div className={styles.BasesUsage}>
					<span className={overUsage(v.usage.bases, v.limits.maxBases) ? styles.OverLimit : undefined}>
						{translate("onecAgentBasesCount")}: {usageText(v.usage.bases, v.limits.maxBases)}
					</span>
					<span className={overUsage(v.usage.bins, v.limits.maxBins) ? styles.OverLimit : undefined}>
						{translate("onecAgentBinsCount")}: {usageText(v.usage.bins, v.limits.maxBins)}
					</span>
				</div>
			)}
			{anyOver && <div className={styles.ConfirmWarning}>{translate("onecOverLimitHint")}</div>}

			{v?.canEditLimits && (
				<div className={styles.BasesLimits}>
					<Field name="ag_max_bases" label={translate("onecAgentMaxBases")} width={FIELD_WIDTH.sm}
						value={maxBases} placeholder={translate("onecLimitNone")} error={nextBases === undefined}
						onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, bases: e.target.value }))} />
					<Field name="ag_max_bins" label={translate("onecAgentMaxBins")} width={FIELD_WIDTH.sm}
						value={maxBins} placeholder={translate("onecLimitNone")} error={nextBins === undefined}
						onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, bins: e.target.value }))} />
					<Button variant="primary" disabled={!changed || save.isPending} onClick={() => save.mutate()}>
						{translate("save")}
					</Button>
					<span className={styles.Hint}>{valid ? translate("onecAgentLimitsHint") : translate("onecAgentLimitsInvalid")}</span>
				</div>
			)}

			{v && (
				<div className={styles.BasesLimits}>
					<span className={styles.Hint}>
						{activeBins
							? `${translate("onecActiveBins")}: ${activeBins.length ? activeBins.join(", ") : "—"}`
							: translate("onecActiveBinsNone")}
					</span>
					{v.canEditLimits && !activeBins && (
						<Button disabled={setBins.isPending} onClick={() => setBins.mutate({ fixCurrent: true })}>{translate("onecActiveBinsFix")}</Button>
					)}
					{v.canEditLimits && activeBins && (
						<Button disabled={setBins.isPending} onClick={() => setBins.mutate({ bins: null })}>{translate("onecActiveBinsReset")}</Button>
					)}
				</div>
			)}

			{v && !bases.length && <div className={styles.Hint}>{translate("onecAgentBasesNone")}</div>}
			{bases.length > 0 && (
				<table className={`${styles.StatsTable} ${styles.BasesTable}`}>
					<thead>
						<tr>
							<th>№</th>
							<th>{translate("onecBase")}</th>
							<th>{translate("onecTransport")}</th>
							<th>{translate("onecExtVersion")}</th>
							<th>{translate("organizations")}</th>
							<th>{translate("status")}</th>
						</tr>
					</thead>
					<tbody>
						{bases.map((b, i) => {
							const state = baseState(b);
							return (
								<tr key={b.key} className={state === "overLimit" ? styles.OverLimitRow : undefined}>
									<td>{i + 1}</td>
									<td className={styles.Mono}>{b.key}</td>
									<td>{transportLabel(b.transport)}</td>
									<td>{b.extVersion || "—"}</td>
									<td>
										{b.organizations === null ? <span className={styles.Hint}>{translate("onecOrgsUnknown")}</span>
											: !b.organizations.length ? "—"
												: b.organizations.map((o, k) => (
													<div key={`${o.bin ?? ""}-${o.id ?? k}`} className={styles.BaseOrg}>
														<span>{o.name || "—"}</span>
														{o.bin && <span className={styles.Mono}>{o.bin}</span>}
														{o.overLimit && <span className={styles.OverLimit}>{o.active === false ? translate("onecBinInactive") : translate("onecOverLimit")}</span>}
														{o.active === true && <span className={styles.ReqOk}>{translate("onecBinActive")}</span>}
														{/* Список активных задан — БИН включают и выключают здесь же, без запроса из окна агента. */}
														{v?.canEditLimits && activeBins && o.bin && (
															<button type="button" className={styles.LinkButton} disabled={setBins.isPending}
																onClick={() => toggleBin(o.bin!, !o.active)}>
																{o.active ? translate("onecBinDisable") : translate("onecBinEnable")}
															</button>
														)}
														{/* БИН в нескольких базах: команды уходят в первую по порядку — показываем, в какую. */}
														{!o.overLimit && o.alsoIn.length > 0 && (
															<span className={styles.Hint}>
																{o.usedBase === b.key
																	? `${translate("onecBinAlsoIn")}: ${o.alsoIn.join(", ")}`
																	: `${translate("onecBinCommandsTo")} «${o.usedBase ?? "—"}»`}
															</span>
														)}
													</div>
												))}
									</td>
									<td className={state === "overLimit" ? styles.OverLimit : undefined}
										title={state === "overLimit" ? translate("onecOverLimitHint") : undefined}>
										{baseStateLabel(state)}
										{b.limitMismatch && (
											<div className={styles.Hint} title={translate("onecLimitMismatchHint")}>{translate("onecLimitMismatch")}</div>
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			)}

			{/* Запросы активации этого агента — рядом с его базами: решать удобнее, видя, что он обслуживает. */}
			{confirmOff && (
				<Modal title={translate("onecBinDisable")} onClose={() => setConfirmOff(null)}
					onApply={() => { setBins.mutate({ bins: (activeBins ?? []).filter((b) => b !== confirmOff) }); setConfirmOff(null); }}>
					<div className={styles.ModalForm}>
						<div className={styles.Mono}>{confirmOff}</div>
						<div className={styles.ConfirmWarning}>{translate("onecBinDisableWarning")}</div>
					</div>
				</Modal>
			)}

			{v && <div className={styles.SectionTitle}>{translate("onecReqActivation")}</div>}
			{v && <div className={styles.EmbeddedTable}><ActivationRequestsTab agentId={agentId} /></div>}
		</div>
	);
};

export default AgentBasesTab;
