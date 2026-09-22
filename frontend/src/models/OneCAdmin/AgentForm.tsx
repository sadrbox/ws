/**
 * Форма агента — всё об одном агенте и все действия над ним в одном месте.
 *
 * ЗАЧЕМ. Действия жили в командной панели списка и работали над «выбранной строкой»:
 * какая строка выбрана, было видно плохо, кнопки то гасли, то прятались, а «Сменить токен»
 * стояла между безобидными — и однажды отключила живого агента случайным нажатием.
 * В списках приложения элемент открывают двойным щелчком и правят в его форме; агент
 * ничем не особеннее прочих.
 *
 * ТОЛЬКО ЧТЕНИЕ РЕКВИЗИТОВ. Имя и роль приходят от самого агента при регистрации, панель их
 * не назначает. Здесь — состояние, способности, экземпляры и команды над ними.
 */
import { FC, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "src/app/context";
import { withOp } from "./progress";
import ServerParams from "./ServerParams";
import ModelForm from "src/components/ModelForm";
import Modal from "src/components/Modal";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import Notice from "src/components/Notice";
import { FormArea, GroupCol, GroupRow } from "src/components/UI";
import { durationRows, failureRows } from "./agentStats";
import { agentBuildLabel, featureLabels } from "./agentHealth";
import AgentHealthTab from "./AgentHealthTab";
import AgentLogTab from "./AgentLogTab";
import AgentBasesTab from "./AgentBasesTab";
import { AgentAuditTab, AgentCommandsTab, BusinessHealthTab } from "./AgentActivityTabs";
import AgentConfigTab from "./AgentConfigTab";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { useScopeObject } from "src/components/TechMessages/store";
import { translate } from "src/i18";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { asText } from "src/utils/asText";
import { getFormatDate } from "src/utils/datetime";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import {
	deleteAgent, fetchServers, releaseAgentInstance, renameAgent, restartAgent, rotateAgentToken,
	setAgentDisabled, setAgentOwner, updateAgent,
} from "src/services/onec/api";
import {
	QueryError, useAgents, useOnecPermissions,
} from "./shared";
import { agentsAllow } from "./onecPermissions";
import main from "src/styles/main.module.scss";
import styles from "./OneCAdmin.module.scss";

/** Состояние агента одним словом: отключён — это не «оффлайн», а решение администратора. */
/**
 * Состояние агента: три ответа, а не два.
 *
 * «Выполняет команду» — не то же самое, что «на связи»: агент как раз молчит, и молчание
 * ожидаемо, пока идёт взятая им работа. Пока оба состояния назывались «на связи», человек,
 * остановивший службу посреди команды, видел «на связи» и не понимал, почему ничего не
 * происходит; а пока оба назывались «не на связи» — панель отказывала в командах занятому
 * агенту. Разные состояния — разные слова.
 */
export const stateLabel = (a: { disabled: boolean; online: boolean; busy?: boolean }): string =>
	a.disabled ? translate("onecAgentDisabled")
		: a.busy ? translate("onecAgentBusy")
			: a.online ? translate("onecAgentOnline") : translate("onecAgentOffline");

export const AgentForm: FC<Partial<TPane>> = (paneProps) => {
	const perms = useOnecPermissions();
	const canEditAgent = agentsAllow(perms, "edit");
	const canManageAgent = agentsAllow(perms, "manage");
	const row = (paneProps.data ?? {}) as TDataItem;
	const agentId = asText(row.agentId) || asText(row.uuid);
	const qc = useQueryClient();
	const [confirm, setConfirm] = useState<null | "rotate" | "release" | "delete" | "restart" | "update">(null);
	// Имя правится прямо здесь: агент присылает своё при регистрации, но подпись для
	// человека — дело панели.
	/*
	 * ИМЯ: ЧЕРНОВИК ОТДЕЛЬНО ОТ ЗНАЧЕНИЯ (А3, аудит 21.09). Раньше пустое поле подставляло прежнее имя — стереть
	 * его было нельзя, и поле выглядело сломанным. `null` — «не трогали», строка (в том числе пустая) — правка.
	 */
	const [name, setName] = useState<string | null>(null);
	const [showHistory, setShowHistory] = useState(false);
	// Токен живёт только в этом состоянии и только до закрытия окна — на сервере его нет.
	const [issued, setIssued] = useState<string>("");

	const agents = useAgents();
	const agent = useMemo(
		() => (agents.data?.items ?? []).find((a) => a.id === agentId) ?? null,
		[agents.data, agentId],
	);

	const refresh = () => qc.invalidateQueries({ queryKey: ["onec", "agents"] });
	const fail = (e: unknown) => reportError(e, { source: translate("onecTabAgents") });

	/** Над кем операция — в реестре прогресса это единственный ориентир. */
	const agentName = agent?.name || agentId.slice(0, 8);
	/** Объект карточки: по нему итоги операций и сообщения открывают именно её. */
	const agentRef = useMemo(
		() => (agentId ? { endpoint: "onec-agents", uuid: agentId, label: agentName } : undefined),
		[agentId, agentName],
	);
	useScopeObject(agentRef);

	// Сервер этого агента — из общего списка серверов: один источник на всю панель.
	const servers = useQuery({ queryKey: ["onec", "servers"], queryFn: fetchServers });
	const server = (servers.data?.items ?? []).find((s) => s.id === agent?.serverId) ?? null;

	const rotate = useMutation({
		mutationFn: () => withOp({ kind: "update", title: translate("onecAgentRotate"), target: agentName, ref: agentRef },
			() => rotateAgentToken(agentId)),
		onSuccess: (d) => { setConfirm(null); setIssued(d.token); void refresh(); },
		onError: fail,
	});
	const toggle = useMutation({
		mutationFn: (disabled: boolean) => withOp(
			{ kind: "update", title: translate(disabled ? "onecAgentDisable" : "onecAgentEnable"), target: agentName, ref: agentRef },
			() => setAgentDisabled(agentId, disabled)),
		onSuccess: () => { showToast(translate("saved"), "success"); void refresh(); },
		onError: fail,
	});
	const release = useMutation({
		mutationFn: () => withOp({ kind: "update", title: translate("onecAgentReleaseInstance"), target: agentName, ref: agentRef },
			() => releaseAgentInstance(agentId)),
		onSuccess: () => { setConfirm(null); showToast(translate("saved"), "success"); void refresh(); },
		onError: fail,
	});
	const rename = useMutation({
		mutationFn: () => withOp({ kind: "update", title: translate("onecAgentRename"), target: agentName, ref: agentRef },
			() => renameAgent(agentId, (name ?? "").trim())),
		onSuccess: () => { setName(null); showToast(translate("saved"), "success"); void refresh(); },
		onError: fail,
	});
	const remove = useMutation({
		mutationFn: () => withOp({ kind: "delete", title: translate("onecAgentDelete"), target: agentName, ref: agentRef },
			() => deleteAgent(agentId)),
		onSuccess: () => {
			setConfirm(null);
			showToast(translate("saved"), "success");
			void refresh();
			// Удалённого показывать нечего: закрываем пейн.
			void paneProps.onClose?.();
		},
		onError: fail,
	});

	/*
	 * ПЕРЕЗАПУСК И ОБНОВЛЕНИЕ. Агент отвечает сразу, а работу делает сам: панель показывает ход обновления по
	 * heartbeat (поле `update` в списке агентов), а не ждёт ответа команды.
	 */
	const restart = useMutation({
		mutationFn: () => withOp({ kind: "update", title: translate("onecAgentRestart"), target: agentName, ref: agentRef },
			() => restartAgent(agentId, translate("onecAgentRestartReason"))),
		onSuccess: () => { setConfirm(null); showToast(translate("onecAgentRestartSent"), "success"); void refresh(); },
		onError: fail,
	});
	const update = useMutation({
		mutationFn: () => withOp({ kind: "update", title: translate("onecAgentUpdate"), target: agentName, ref: agentRef },
			() => updateAgent(agentId)),
		onSuccess: () => { setConfirm(null); showToast(translate("onecAgentUpdateSent"), "success"); void refresh(); },
		onError: fail,
	});

	const assign = useMutation({
		mutationFn: (instanceId: string) => setAgentOwner(agentId, instanceId),
		onSuccess: () => { showToast(translate("saved"), "success"); void refresh(); },
		onError: fail,
	});

	const all = agent?.instances ?? [];
	const live = all.filter((i) => i.live);
	// Прежние запуски прячем: их за сутки десяток, а нужны они редко — назначить
	// владельцем молчащий процесс. Список из десяти похожих строк, где девять мертвы,
	// читается как «запущено десять экземпляров» — ровно то, чего мы избегаем.
	const instances = showHistory ? all : (live.length ? live : all.slice(0, 1));

	// «Закрыть» в командной панели формы НИЧЕГО не делала: обработчик был пустой
	// заглушкой. Кнопка, которая рисуется и не работает, хуже отсутствующей.
	const { requestClose } = useAppContext().windows;
	const closeCard = useCallback(() => {
		if (paneProps.uniqId) void requestClose(paneProps.uniqId);
	}, [requestClose, paneProps.uniqId]);

	return (
		<>
			<ModelForm
				paneId={paneProps.uniqId}
				// endpoint не передаём: у агентов нет эндпойнта ERP, а он нужен ModelForm
				// только для кнопок шапки («Показать в списке», заметки) — которым здесь
				// нечего показывать. Выдуманный адрес рано или поздно ушёл бы в запрос.
				readonly
				isLoading={agents.isLoading}
				// Реквизиты присылает сам агент — сохранять нечего.
				onSave={() => {}} onSaveAndClose={() => {}} onClose={closeCard}
				tabs={[
					{
						id: "main", label: translate("general"),
						// Каркас — общий для форм приложения (см. SalesForm).
						component: (
							<div className={main.FormContainer}>
								<div className={main.FormWrapper}>
									<GroupCol className={main.Form}>
										{/*
										  * Области — как в остальных карточках панели: реквизиты агента,
										  * его экземпляр, команды над ним. Раньше пять полей и кнопка
										  * стояли одной строкой, и колонки не совпадали ни с одной другой
										  * формой: поля разъезжались по ширине содержимого.
										  */}
										<FormArea title={translate("onecAgent")}>
											<GroupCol>
												<GroupRow>
													{/* Имя — единственный правимый реквизит: остальное присылает агент. */}
													<Field name="ag_name" label={translate("name")} noAutofill
														width={FIELD_WIDTH.wide}
														value={name ?? agent?.name ?? ""}
														error={name !== null && !name.trim()}
														hint={name !== null && !name.trim() ? translate("onecAgentNameEmpty") : undefined}
														onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
													<Field name="ag_role" label={translate("role")} value={agent?.role ?? "—"}
														disabled onChange={() => {}} width={FIELD_WIDTH.md} />
													<Field name="ag_state" label={translate("status")} value={agent ? stateLabel(agent) : "—"}
														disabled onChange={() => {}} width={FIELD_WIDTH.md} />
												</GroupRow>
												<GroupRow>
													<Field name="ag_seen" label={translate("lastSeenAt")}
														value={agent?.lastSeenAt ? getFormatDate(agent.lastSeenAt) : "—"}
														disabled onChange={() => {}} width={FIELD_WIDTH.date} />
													{/* Что сервис знает об агенте и раньше не показывал (п. 6). */}
													<Field name="ag_os" label={translate("agentOs")} value={agent?.os || "—"}
														disabled onChange={() => {}} width={FIELD_WIDTH.md} />
													<Field name="ag_onec" label={translate("agentOnecLabel")}
														value={agent?.onecReachable === undefined ? "—" : agent.onecReachable ? translate("yes") : translate("no")}
														disabled onChange={() => {}} width={FIELD_WIDTH.sm} />
													{/* Переименование агента — изменение: правом «просмотр» карточка читается. */}
													{canEditAgent && (
														<Button icon="editInline"
															disabled={rename.isPending || name === null || !name.trim() || name.trim() === agent?.name}
															onClick={() => rename.mutate()}>
															{translate("onecAgentRename")}
														</Button>
													)}
												</GroupRow>
											</GroupCol>
										</FormArea>

										<FormArea title={translate("onecAgentInstance")}>
											<GroupRow>
												<Field name="ag_id" label={translate("id")} value={agentId} disabled
													onChange={() => {}} width={FIELD_WIDTH.lg} />
												<Field name="ag_registered" label={translate("onecAgentRegistered")}
													value={agent?.registeredAt ? getFormatDate(agent.registeredAt) : "—"}
													disabled onChange={() => {}} width={FIELD_WIDTH.date} />
												<Field name="ag_cmds" label={translate("agentCommandsLabel")}
													value={agent?.commandsDone == null ? "—"
														: `${agent.commandsDone}${agent.commandsFailed ? ` / ${translate("onecAgentFailedShort")} ${agent.commandsFailed}` : ""}`}
													disabled onChange={() => {}} width={FIELD_WIDTH.md} />
												<Field name="ag_owner" label={translate("ownerInstance")}
													value={agent?.owner?.instanceId || "—"} disabled
													onChange={() => {}} width={FIELD_WIDTH.lg} />
											</GroupRow>
										</FormArea>

										{/* Команды над агентом — здесь, а не в командной панели списка: тут
										    видно, НАД КЕМ они выполняются.
										    Все они — про доступ к серверу 1С (токен, отключение, удаление),
										    поэтому праву «только просмотр» области не видно вовсе (F5). */}
										{canManageAgent && (
										<FormArea title={translate("onecCommands")}>
											<GroupRow>
												<Button icon="link" variant="danger" disabled={rotate.isPending} onClick={() => setConfirm("rotate")}>
													{translate("onecAgentRotate")}
												</Button>
												<Button disabled={toggle.isPending || !agent}
													onClick={() => agent && toggle.mutate(!agent.disabled)}>
													{agent?.disabled ? translate("onecAgentEnable") : translate("onecAgentDisable")}
												</Button>
												<Button icon="trash" variant="danger"
													disabled={remove.isPending || !agent || !agent.disabled}
													title={agent && !agent.disabled ? translate("onecAgentDeleteHint") : undefined}
													onClick={() => setConfirm("delete")}>
													{translate("onecAgentDelete")}
												</Button>
												{/*
												  * ПЕРЕЗАПУСК И ОБНОВЛЕНИЕ СЛУЖБЫ (задача агенту §2) — только у агентов, которые это
												  * объявили: способность агент обещает лишь запущенный службой Windows. Занятый
												  * изменяющей командой агент откажет сам (AGENT_BUSY) — ждать конца выгрузки решает он.
												  */}
												{agent?.capabilities.includes("agent.restart") && (
													<Button icon="recalc" variant="danger" disabled={restart.isPending}
														onClick={() => setConfirm("restart")}>
														{translate("onecAgentRestart")}
													</Button>
												)}
												{agent?.capabilities.includes("agent.update") && (
													<Button icon="download" variant="danger" disabled={update.isPending}
														title={agents.data?.limits.latestBuild ? `${translate("onecAgentUpdateTo")}: ${agents.data.limits.latestBuild}` : undefined}
														onClick={() => setConfirm("update")}>
														{translate("onecAgentUpdate")}
													</Button>
												)}
												<Button icon="clear"
													disabled={release.isPending || !agent?.owner?.instanceId}
													title={agent?.owner?.instanceId
														? `${translate("ownerInstance")}: ${agent.owner.instanceId}`
														: translate("onecAgentNoOwnerHint")}
													onClick={() => setConfirm("release")}>
													{translate("onecAgentReleaseInstance")}
												</Button>
											</GroupRow>
										</FormArea>
										)}
									</GroupCol>

									<GroupCol className={main.FormNotice}>
										{/* Подсказка стала сообщением: .Hint серым мелким шрифтом под полями
										    читался как «служебная надпись», хотя это ответ на вопрос
										    «а что этот агент вообще умеет». */}
										<QueryError error={agents.error} noticeKey="agent-card" source={translate("onecAgent")} />
										{/* ПОЯСНЕНИЕ, А НЕ СООБЩЕНИЕ: оно описывает объект на экране и верно,
										    пока карточка открыта. В области «Технических сообщений» такие
										    строки висели бы вечно и не убирались очисткой — она щадит то,
										    что источник продолжает сообщать. Рисуем на месте: колонка под
										    пояснения в форме и так отведена, разметка не двигается. */}
										<Notice inline items={[
											{
												type: "info",
												text: `${translate("onecAgentCapabilities")}: ${agent?.capabilities.join(", ") || "—"}`,
											},
											// Сборка и чего в ней нет (R3): «Устарел» — по эталону сервиса, недостающее — по
											// способностям. Иначе «кнопка не работает» читается как поломка, а не как старая сборка.
											...(agent?.build ? [{ type: "info" as const, text: `${translate("buildLabel")}: ${agentBuildLabel(agent)}` }] : []),
											// Ход обновления службы: он идёт минутами и виден только по heartbeat.
											...(agent?.update?.state ? [{
												type: agent.update.state === "failed" ? "attention" as const : agent.update.state === "done" ? "info" as const : "warning" as const,
												text: `${translate("onecAgentUpdateState")}: ${translate(`onecUpd_${agent.update.state}`)}`
													+ (agent.update.build ? ` · ${agent.update.build}` : "")
													+ (agent.update.error ? ` · ${agent.update.error}` : ""),
											}] : []),
											...(agent?.missingFeatures?.length ? [{
												type: "warning" as const,
												text: `${translate("onecAgentMissing")}: ${featureLabels(agent.missingFeatures).join(", ")}. ${translate("onecAgentUpdateHint")}`,
											}] : []),
										]} />
									</GroupCol>
								</div>
							</div>
						),
					},
					{
						/*
						 * ПАРАМЕТРЫ — не агента, а СЕРВЕРА, за которым он закреплён.
						 *
						 * У самого агента настраивать нечего: имя правится на «Основном», роль
						 * задаётся при регистрации и менять её в панели нельзя (это разные
						 * службы под разными учётками ОС), способности он объявляет сам —
						 * спорить с ними бессмысленно, а токен и включение — действия, а не
						 * параметры. Настраивается то, чего агент не знает (под каким именем
						 * сервер виден снаружи) или знает не всегда (адрес службы RAS).
						 *
						 * ЭТО ЕДИНСТВЕННОЕ МЕСТО, где они правятся: прежняя вкладка «Настройки»
						 * панели держала ровно те же поля, и два редактора одних и тех же
						 * значений рано или поздно начинают расходиться.
						 */
						id: "params", label: translate("onecTabParams"),
						component: (
							<div className={main.FormContainer}>
								<div className={main.FormWrapper}>
									<GroupCol className={main.Form}>
										{server
											? <ServerParams server={server} />
											: (
												<Notice inline items={[{
													type: "info",
													text: translate(servers.error
														? "onecSettingsUnavailable"
														: "onecAgentNoServer"),
												}]} />
											)}
									</GroupCol>
									<GroupCol className={main.FormNotice}>
										{/* Пояснение к полям — на месте: это текст интерфейса, а не событие. */}
										<Notice inline items={[{ type: "info", text: translate("onecSettingsPublicHostHint") }]} />
									</GroupCol>
								</div>
							</div>
						),
					},
					{
						id: "instances", label: translate("onecAgentInstances"),
						component: (
							<div className={styles.Instances}>
								<div className={styles.Hint}>{translate("onecAgentInstancesHint")}</div>
								<GroupRow>
									<span className={styles.Hint}>
										{translate("onecAgentLive")}: {live.length} · {translate("onecAgentInstances")}: {all.length}
									</span>
									{all.length > live.length && (
										<Button active={showHistory} onClick={() => setShowHistory((v) => !v)}>
											{translate("onecAgentHistory")}
										</Button>
									)}
								</GroupRow>
								{instances.map((inst) => {
									const isOwner = agent?.owner?.instanceId === inst.instanceId;
									return (
										<div key={inst.instanceId}
											className={[styles.InstanceRow, isOwner ? styles.InstanceOwner : ""].filter(Boolean).join(" ")}>
											<span className={styles.InstanceName}>{inst.instanceId}</span>
											<span>{inst.remoteAddr ?? "—"}</span>
											{/* Версия экземпляра (п. 6): два процесса разных сборок под одним токеном — частая причина «через раз». */}
											<span>{inst.version ?? "—"}</span>
											<span>{getFormatDate(inst.lastSeenAt)}</span>
											<span>{inst.live ? translate("onecAgentOnline") : translate("onecAgentOffline")}</span>
											{isOwner
												? <span className={styles.InstanceOwnerMark}>{translate("onecAgentOwnerNow")}</span>
												: canManageAgent && (
													<Button icon="makePrimary" variant="primary" disabled={assign.isPending}
														onClick={() => assign.mutate(inst.instanceId)}>
														{translate("onecAgentMakeOwner")}
													</Button>
												)}
										</div>
									);
								})}
								{!instances.length && <div className={styles.Hint}>{translate("onecAgentNoInstances")}</div>}
							</div>
						),
					},
					{
						/*
						 * ВРЕМЯ И ОТКАЗЫ КОМАНД (S5) — числами вместо «агент тормозит».
						 *
						 * Агент считает их сам и шлёт в каждом heartbeat: «IB_BUSY: 87», «IB_LIST_USERS
						 * в среднем 28 с». Без этой вкладки каждое «медленно» мерили вручную, а
						 * настройке параллельности агента не на что было опереться.
						 */
						id: "stats", label: translate("onecAgentStats"),
						component: (
							<div className={styles.Instances}>
								<div className={styles.Hint}>{translate("onecAgentStatsHint")}</div>
								{!agent?.commandStats
									? <div className={styles.Hint}>{translate("onecAgentStatsNone")}</div>
									: (() => {
										const durations = durationRows(agent.commandStats.durationsByType);
										const failures = failureRows(agent.commandStats.failuresByCode);
										return (
											<>
												<div className={styles.StatsTitle}>{translate("onecStatDurations")}</div>
												{durations.length ? (
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
															{durations.map((r) => (
																<tr key={r.type}>
																	<td>{r.type}</td><td>{r.count}</td><td>{r.avg}</td><td>{r.p95}</td><td>{r.max}</td>
																</tr>
															))}
														</tbody>
													</table>
												) : <div className={styles.Hint}>{translate("onecStatNoDurations")}</div>}

												<div className={styles.StatsTitle}>{translate("onecStatFailures")}</div>
												{failures.length ? (
													<table className={styles.StatsTable}>
														<thead>
															<tr><th>{translate("onecStatCode")}</th><th>{translate("onecStatCount")}</th></tr>
														</thead>
														<tbody>
															{failures.map((r) => (
																<tr key={r.code}><td>{r.code}</td><td>{r.count}</td></tr>
															))}
														</tbody>
													</table>
												) : <div className={styles.Hint}>{translate("onecStatNoFailures")}</div>}
											</>
										);
									})()}
							</div>
						),
					},
					// Базы и лимит тарифа — у бизнес-агента: одна служба обслуживает много баз своего компьютера (ПН, 19.09).
					...(agent?.role === "business" ? [{
						id: "bases", label: translate("onecAgentBases"),
						component: <AgentBasesTab agentId={agentId} agentName={agentName} />,
					}] : []),
					{
						// Состояние сервера (R1) и журнал агента (R2) — по кнопке: вкладки формы отрисованы
						// все сразу, и запрос при открытии карточки слал бы команду агенту на каждый взгляд.
						// У бизнес-агента своя сводка — его команда HEALTH (п. 1).
						id: "health", label: translate("onecAgentHealth"),
						component: agent?.role === "business"
							? <BusinessHealthTab agentId={agentId} agentName={agentName} />
							: <AgentHealthTab agentId={agentId} agentName={agentName} />,
					},
					// Журнал службы читают обе роли с выпуска агента 2026-09-20; старая сборка способности не объявит —
					// тогда вкладки нет, а не вкладка с отказом.
					...(agent && !agent.capabilities.includes("agent.procs") ? [] : [{
						id: "log", label: translate("onecAgentLog"),
						component: <AgentLogTab agentId={agentId} agentName={agentName} />,
					}]),
					// Настройки самой службы (задача агенту §3) — только у агентов, которые это умеют.
					...(agent?.capabilities.includes("agent.config") ? [{
						id: "config", label: translate("onecAgentConfig"),
						component: <AgentConfigTab agentId={agentId} agentName={agentName} canManage={canManageAgent} />,
					}] : []),
					{
						// Очередь и итоги команд агента (п. 2): что ждёт, что выполняется, чем кончилось.
						id: "commands", label: translate("onecAgentCommands"),
						component: <AgentCommandsTab agentId={agentId} canManage={canManageAgent} />,
					},
					{
						// Кто и что делал с агентом (п. 3): переименование, отключение, токен, лимиты, подключение по коду.
						id: "audit", label: translate("onecAgentAudit"),
						component: <AgentAuditTab agentId={agentId} />,
					},
				]}
			/>

			{confirm === "rotate" && (
				<Modal title={translate("onecAgentRotate")} onClose={() => setConfirm(null)} onApply={() => rotate.mutate()}>
					<div className={styles.ModalForm}>
						<div>{agent?.name || agentId.slice(0, 8)}</div>
						<div className={styles.ConfirmWarning}>{translate("onecAgentRotateWarning")}</div>
					</div>
				</Modal>
			)}

			{confirm === "release" && (
				<Modal title={translate("onecAgentReleaseInstance")} onClose={() => setConfirm(null)} onApply={() => release.mutate()}>
					<div className={styles.ModalForm}>
						<div>{translate("ownerInstance")}: {agent?.owner?.instanceId || "—"}</div>
						<div className={styles.ConfirmWarning}>{translate("onecAgentReleaseWarning")}</div>
					</div>
				</Modal>
			)}

			{confirm === "restart" && (
				<Modal title={translate("onecAgentRestart")} onClose={() => setConfirm(null)} onApply={() => restart.mutate()}>
					<div className={styles.ModalForm}>
						<div>{agentName}</div>
						<div className={styles.ConfirmWarning}>{translate("onecAgentRestartWarning")}</div>
					</div>
				</Modal>
			)}

			{confirm === "update" && (
				<Modal title={translate("onecAgentUpdate")} onClose={() => setConfirm(null)} onApply={() => update.mutate()}>
					<div className={styles.ModalForm}>
						<div>{agentName}: {agent ? agentBuildLabel(agent) : "—"} → {agents.data?.limits.latestBuild || "—"}</div>
						<div className={styles.ConfirmWarning}>{translate("onecAgentUpdateWarning")}</div>
						{!agents.data?.limits.updateUrl && <div className={styles.ConfirmWarning}>{translate("onecAgentUpdateNoSource")}</div>}
					</div>
				</Modal>
			)}

			{confirm === "delete" && (
				<Modal title={translate("onecAgentDelete")} onClose={() => setConfirm(null)} onApply={() => remove.mutate()}>
					<div className={styles.ModalForm}>
						<div>{agent?.name || agentId.slice(0, 8)}</div>
						<div className={styles.ConfirmWarning}>{translate("onecAgentDeleteWarning")}</div>
					</div>
				</Modal>
			)}

			{issued && (
				// Токен показывается ОДИН раз: в БД лежит только его SHA-256.
				<Modal title={translate("onecAgentToken")} onClose={() => setIssued("")}>
					<div className={styles.ModalForm}>
						<Field name="ag_token" value={issued} onChange={() => {}} />
						<div className={styles.ConfirmWarning}>{translate("onecAgentTokenOnce")}</div>
					</div>
				</Modal>
			)}
		</>
	);
};
AgentForm.displayName = "AgentForm";

/** Открыть форму агента отдельным пейном — двойным щелчком по строке списка. */
export function useOpenAgent() {
	const { addPane } = useAppContext().windows;
	return (row: Partial<TDataItem>) => addPane({
		label: `${translate("onecTabAgents")}: ${asText(row.name) || asText(row.agentId).slice(0, 8)}`,
		component: AgentForm as never,
		data: row as TDataItem,
	});
}

export default AgentForm;
