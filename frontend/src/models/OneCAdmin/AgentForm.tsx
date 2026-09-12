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
import { Icon } from "src/components/IconButton/icons";
import { Field } from "src/components/Field";
import Notice from "src/components/Notice";
import { FormArea, GroupCol, GroupRow } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { translate } from "src/i18";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { asText } from "src/utils/asText";
import { getFormatDate } from "src/utils/datetime";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import {
	deleteAgent, fetchServers, releaseAgentInstance, renameAgent, rotateAgentToken,
	setAgentDisabled, setAgentOwner,
} from "src/services/onec/api";
import { QueryError, useAgents, useOnecWrite } from "./shared";
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
	const canWrite = useOnecWrite();
	const row = (paneProps.data ?? {}) as TDataItem;
	const agentId = asText(row.agentId) || asText(row.uuid);
	const qc = useQueryClient();
	const [confirm, setConfirm] = useState<null | "rotate" | "release" | "delete">(null);
	// Имя правится прямо здесь: агент присылает своё при регистрации, но подпись для
	// человека — дело панели.
	const [name, setName] = useState("");
	const [showHistory, setShowHistory] = useState(false);
	// Токен живёт только в этом состоянии и только до закрытия окна — на сервере его нет.
	const [issued, setIssued] = useState<string>("");

	const agents = useAgents();
	const agent = useMemo(
		() => (agents.data?.items ?? []).find((a) => a.id === agentId) ?? null,
		[agents.data, agentId],
	);

	const refresh = () => qc.invalidateQueries({ queryKey: ["onec", "agents"] });
	const fail = (e: unknown) => showToast(e instanceof Error ? e.message : translate("unknownError"), "error");

	/** Над кем операция — в реестре прогресса это единственный ориентир. */
	const agentName = agent?.name || agentId.slice(0, 8);

	// Сервер этого агента — из общего списка серверов: один источник на всю панель.
	const servers = useQuery({ queryKey: ["onec", "servers"], queryFn: fetchServers });
	const server = (servers.data?.items ?? []).find((s) => s.id === agent?.serverId) ?? null;

	const rotate = useMutation({
		mutationFn: () => withOp({ kind: "update", title: translate("onecAgentRotate"), target: agentName },
			() => rotateAgentToken(agentId)),
		onSuccess: (d) => { setConfirm(null); setIssued(d.token); void refresh(); },
		onError: fail,
	});
	const toggle = useMutation({
		mutationFn: (disabled: boolean) => withOp(
			{ kind: "update", title: translate(disabled ? "onecAgentDisable" : "onecAgentEnable"), target: agentName },
			() => setAgentDisabled(agentId, disabled)),
		onSuccess: () => { showToast(translate("saved"), "success"); void refresh(); },
		onError: fail,
	});
	const release = useMutation({
		mutationFn: () => withOp({ kind: "update", title: translate("onecAgentReleaseInstance"), target: agentName },
			() => releaseAgentInstance(agentId)),
		onSuccess: () => { setConfirm(null); showToast(translate("saved"), "success"); void refresh(); },
		onError: fail,
	});
	const rename = useMutation({
		mutationFn: () => withOp({ kind: "update", title: translate("onecAgentRename"), target: agentName },
			() => renameAgent(agentId, name.trim())),
		onSuccess: () => { showToast(translate("saved"), "success"); void refresh(); },
		onError: fail,
	});
	const remove = useMutation({
		mutationFn: () => withOp({ kind: "delete", title: translate("onecAgentDelete"), target: agentName },
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
														value={name || agent?.name || ""}
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
													{/* Переименование агента — изменение: правом «просмотр» карточка читается. */}
													{canWrite && (
														<Button disabled={rename.isPending || !name.trim() || name.trim() === agent?.name}
															onClick={() => rename.mutate()}>
															<Icon name="editInline" /> {translate("onecAgentRename")}
														</Button>
													)}
												</GroupRow>
											</GroupCol>
										</FormArea>

										<FormArea title={translate("onecAgentInstance")}>
											<GroupRow>
												<Field name="ag_id" label={translate("id")} value={agentId} disabled
													onChange={() => {}} width={FIELD_WIDTH.lg} />
												<Field name="ag_owner" label={translate("ownerInstance")}
													value={agent?.owner?.instanceId || "—"} disabled
													onChange={() => {}} width={FIELD_WIDTH.lg} />
											</GroupRow>
										</FormArea>

										{/* Команды над агентом — здесь, а не в командной панели списка: тут
										    видно, НАД КЕМ они выполняются.
										    Все они — про доступ к серверу 1С (токен, отключение, удаление),
										    поэтому праву «только просмотр» области не видно вовсе (F5). */}
										{canWrite && (
										<FormArea title={translate("onecCommands")}>
											<GroupRow>
												<Button variant="danger" disabled={rotate.isPending} onClick={() => setConfirm("rotate")}>
													<Icon name="link" /> {translate("onecAgentRotate")}
												</Button>
												<Button disabled={toggle.isPending || !agent}
													onClick={() => agent && toggle.mutate(!agent.disabled)}>
													{agent?.disabled ? translate("onecAgentEnable") : translate("onecAgentDisable")}
												</Button>
												<Button variant="danger"
													disabled={remove.isPending || !agent || !agent.disabled}
													title={agent && !agent.disabled ? translate("onecAgentDeleteHint") : undefined}
													onClick={() => setConfirm("delete")}>
													<Icon name="trash" /> {translate("onecAgentDelete")}
												</Button>
												<Button
													disabled={release.isPending || !agent?.owner?.instanceId}
													title={agent?.owner?.instanceId
														? `${translate("ownerInstance")}: ${agent.owner.instanceId}`
														: translate("onecAgentNoOwnerHint")}
													onClick={() => setConfirm("release")}>
													<Icon name="clear" /> {translate("onecAgentReleaseInstance")}
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
										<Notice inline items={[{
											type: "info",
											text: `${translate("onecAgentCapabilities")}: ${agent?.capabilities.join(", ") || "—"}`,
										}]} />
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
											<span>{getFormatDate(inst.lastSeenAt)}</span>
											<span>{inst.live ? translate("onecAgentOnline") : translate("onecAgentOffline")}</span>
											{isOwner
												? <span className={styles.InstanceOwnerMark}>{translate("onecAgentOwnerNow")}</span>
												: canWrite && (
													<Button variant="primary" disabled={assign.isPending}
														onClick={() => assign.mutate(inst.instanceId)}>
														<Icon name="makePrimary" /> {translate("onecAgentMakeOwner")}
													</Button>
												)}
										</div>
									);
								})}
								{!instances.length && <div className={styles.Hint}>{translate("onecAgentNoInstances")}</div>}
							</div>
						),
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
