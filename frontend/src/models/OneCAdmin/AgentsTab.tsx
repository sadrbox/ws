/**
 * Вкладка «Агенты» (E15/A5): кто подключён к серверу 1С.
 *
 * СПИСОК — ТОЛЬКО СПИСОК. Команды над агентом переехали в его форму (AgentForm), которая
 * открывается двойным щелчком по строке, как у всех списков приложения. В командной панели
 * действия работали над «выбранной строкой»: какая выбрана — видно плохо, кнопки то гасли,
 * то прятались, а «Сменить токен» стояла между безобидными и однажды отключила живого
 * агента случайным нажатием.
 *
 * КОМАНДЫ НАД ОТМЕЧЕННЫМИ — ОДНОЙ КНОПКОЙ «ОПЕРАЦИИ» (28.09), как у списка баз кластера: разделы, опасное последним,
 * у каждого пункта подсказка — что он сделает или почему недоступен (agentsOperations.ts).
 *
 * ТОКЕН ПОКАЗЫВАЕТСЯ ОДИН РАЗ. В БД лежит только его SHA-256; забыли — значит ротация,
 * а не «посмотреть ещё раз».
 */
import { FC, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import Notice from "src/components/Notice";
import Modal from "src/components/Modal";
import ActionsDropdownButton from "src/components/Toolbar/ActionsDropdownButton";
import { Field, FieldSelect } from "src/components/Field";
import { SegmentedControl, type SegmentOption } from "src/components/SegmentedControl";
import { showToast } from "src/components/UIToast";
import { getFormatDate } from "src/utils/datetime";
import { reportError } from "src/services/errors/route";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { createAgent, fetchServers, restartAgent, setAgentDisabled, updateAgent, type OnecAgent } from "src/services/onec/api";
import EnrollmentsTab from "./EnrollmentsTab";
import { agentMatches, agentOfflineSummary, type AgentRoleFilter, type AgentStateFilter } from "./agentsView";
import { withStableIds } from "src/utils/stableRowId";
import { stateLabel, useOpenAgent } from "./AgentForm";
import { agentBuildLabel } from "./agentHealth";
import { useAgents, useOnecPermissions } from "./shared";
import { QueryError } from "./sharedUi";
import { agentsAllow } from "./onecPermissions";
import { agentOperationsMenu, agentOpTargets, type AgentOp } from "./agentsOperations";
import styles from "./OneCAdmin.module.scss";

const columns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "role", type: "string", width: "150px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	// ЗА ЧТО ОТВЕЧАЕТ АГЕНТ: админ-агент — за свой кластер (сервер 1С целиком), бизнес-агент — за базы своей
	// организации ERP. Это главное различие ролей, и в списке оно должно читаться без открытия карточки.
	{ identifier: "agentScope", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	// Что сервис знает об агенте (п. 6): ОС, доступна ли 1С, базы бизнес-агента, счётчики команд с запуска службы.
	{ identifier: "agentOs", type: "string", width: "160px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "agentOnecLabel", type: "string", width: "110px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "agentBasesLabel", type: "string", width: "110px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
	{ identifier: "agentCommandsLabel", type: "string", width: "140px", minWidth: "90px", alignment: "right", visible: true, inlist: true },
	{ identifier: "onlineLabel", type: "string", width: "130px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	// Сборка агента и «Устарел» (R3).
	{ identifier: "buildLabel", type: "string", width: "190px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "lastSeenAt", type: "datetime", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "capabilitiesCount", type: "number", width: "130px", minWidth: "90px", alignment: "right", visible: true, inlist: true },
	{ identifier: "instancesCount", type: "number", width: "140px", minWidth: "90px", alignment: "right", visible: true, inlist: true },
	// Владелец токена: под ним и работает агент; остальные экземпляры получают отказ.
	{ identifier: "ownerInstance", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

export const AgentsTab: FC = () => {
	const canManage = agentsAllow(useOnecPermissions(), "manage");
	const qc = useQueryClient();
	const agents = useAgents();
	const limits = agents.data?.limits;
	// Имена кластеров — справочник панели: в списке агентов нужны только подписи.
	const servers = useQuery({ queryKey: ["onec", "servers"], queryFn: fetchServers, staleTime: 60_000 });
	const serverNames = useMemo(() => new Map((servers.data?.items ?? []).map((s) => [s.id, s.name])), [servers.data]);
	const quota = {
		left: limits?.clusterRemaining ?? 0,
		max: limits?.clusterPerMin ?? 0,
		// Порог — пятая часть: раньше поздно, позже бесполезно.
		low: !!limits?.clusterPerMin && (limits.clusterRemaining ?? 0) <= Math.ceil(limits.clusterPerMin / 5),
	};
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(), "OneCAdmin_agents"));
	const [dialog, setDialog] = useState<null | "create" | "enroll" | "disable" | "enable" | "restart" | "update">(null);
	const [roleFilter, setRoleFilter] = useState<AgentRoleFilter>("");
	const [stateFilter, setStateFilter] = useState<AgentStateFilter>("");
	// Отборы — плашками, как заявки на подключение (SegmentedControl): вариантов мало, переключают часто.
	// У состояний — число агентов в каждом: «Не на связи 2» видно до того, как переключишь отбор.
	const roleOptions = useMemo<SegmentOption<AgentRoleFilter>[]>(() => [
		{ value: "", label: translate("onecAgentsAllRoles"), tone: "all" },
		{ value: "business", label: translate("onecRoleBusiness") },
		{ value: "admin", label: translate("onecRoleAdmin") },
	], []);
	const stateOptions = useMemo<SegmentOption<AgentStateFilter>[]>(() => {
		const all = agents.data?.items ?? [];
		const count = (state: AgentStateFilter) => all.filter((a) => agentMatches(a, roleFilter, state)).length;
		return [
			{ value: "", label: translate("onecAgentsAllStates"), tone: "all" },
			{ value: "online", label: translate("onecAgentOnline"), tone: "ok", count: count("online") },
			{ value: "offline", label: translate("onecAgentOffline"), tone: "bad", count: count("offline") },
			{ value: "disabled", label: translate("onecAgentDisabled"), tone: "off", count: count("disabled") },
		];
	}, [agents.data, roleFilter]);
	const [selected, setSelected] = useState<string[]>([]);
	const [name, setName] = useState("");
	// Агент кластера заводится без организации: он обслуживает сервер целиком (см. подсказку в окне).
	const [cluster, setCluster] = useState(false);
	// Токен живёт только в этом состоянии и только до закрытия окна — на сервере его нет.
	const [issued, setIssued] = useState<{ token: string; name: string } | null>(null);
	const openAgent = useOpenAgent();

	const refresh = () => qc.invalidateQueries({ queryKey: ["onec", "agents"] });

	const create = useMutation({
		mutationFn: () => createAgent(name.trim(), cluster),
		onSuccess: (d) => { setDialog(null); setCluster(false); setIssued({ token: d.token, name: d.agent.name || name }); void refresh(); },
		onError: (e) => reportError(e, { source: translate("onecTabAgents") }),
	});

	const selectedAgents = useMemo(
		() => (agents.data?.items ?? []).filter((a) => selected.includes(a.id)),
		[agents.data, selected],
	);
	// Кому какая команда уйдёт: умеет ли, на связи ли, включён ли (agentsOperations.ts) — меню, окна и сами запросы
	// считают по одному правилу. Молчащему агенту команда ушла бы в очередь и умерла по сроку.
	const targets = useMemo(() => agentOpTargets(selectedAgents), [selectedAgents]);

	/*
	 * ГРУППОВОЕ ВКЛЮЧЕНИЕ И ОТКЛЮЧЕНИЕ (п. 5) — по отмеченным строкам, с подтверждением. Перевыпуск токенов группой
	 * не делаем: каждый новый токен показывается один раз и его надо вписать на своём компьютере — это работа по одному.
	 */
	const bulk = useMutation({
		// Только тем, чьё состояние меняется (agentOpTargets): отключать отключённого — лишний запрос и лишняя строка в журнале.
		mutationFn: async (disabled: boolean) => {
			const results = await Promise.allSettled(targets[disabled ? "disable" : "enable"].map((a) => setAgentDisabled(a.id, disabled)));
			return { ok: results.filter((r) => r.status === "fulfilled").length, failed: results.filter((r) => r.status === "rejected").length };
		},
		onSuccess: (r) => {
			setDialog(null);
			showToast(`${translate("saved")}: ${r.ok}${r.failed ? `, ${translate("onecAgentsBulkFailed")}: ${r.failed}` : ""}`, r.failed ? "warning" : "success");
			void refresh();
		},
		onError: (e) => reportError(e, { source: translate("onecTabAgents") }),
	});

	/*
	 * ПЕРЕЗАПУСК И ОБНОВЛЕНИЕ ГРУППОЙ (задача агенту §2). Только тем из отмеченных, кто это умеет: способность
	 * агент объявляет, лишь когда запущен службой. Занятый изменяющей командой откажет сам — это видно в итоге.
	 */
	const service = useMutation({
		mutationFn: async (what: "restart" | "update") => {
			const list = targets[what];
			const results = await Promise.allSettled(list.map((a) => (what === "restart"
				? restartAgent(a.id, translate("onecAgentRestartReason"))
				: updateAgent(a.id))));
			const failures = results.flatMap((r, i) => (r.status === "rejected"
				? [`${list[i].name || list[i].id.slice(0, 8)}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`]
				: []));
			return { ok: results.length - failures.length, failures, skipped: selectedAgents.length - list.length };
		},
		onSuccess: (r) => {
			setDialog(null);
			showToast(`${translate("onecAgentsBulkSent")}: ${r.ok}`
				+ (r.skipped ? `, ${translate("onecAgentsBulkSkipped")}: ${r.skipped}` : ""), r.failures.length ? "warning" : "success");
			// Причина отказа — сама по себе ответ: «не удалось у двоих» без слов не говорит ничего.
			for (const text of r.failures.slice(0, 5)) showToast(text, "error");
			void refresh();
		},
		onError: (e) => reportError(e, { source: translate("onecTabAgents") }),
	});

	const filtered = useMemo(
		() => (agents.data?.items ?? []).filter((a) => agentMatches(a, roleFilter, stateFilter)),
		[agents.data, roleFilter, stateFilter],
	);
	const offlineSummary = useMemo(() => agentOfflineSummary(agents.data?.items ?? []), [agents.data]);

	// Номер строки — из идентификатора агента (utils/stableRowId): таблица не пересчитывает отметки при обновлении
	// списка, и на порядковых номерах галочка «переезжала» на другого агента (аудит 21.09).
	const rowsRaw = useMemo(() => withStableIds(filtered.map((a: OnecAgent) => ({
		uuid: a.id, agentId: a.id,
		name: a.name || "—", role: a.role === "admin" ? translate("onecRoleAdminFull") : translate("onecRoleBusinessFull"),
		agentScope: a.role === "admin"
			? `${translate("onecServer")}: ${(a.serverId && serverNames.get(a.serverId)) || a.serverId?.slice(0, 8) || "—"}`
			// «Обслуживает» (В6, 28.09): организации у агента нет — кого он обслуживает, говорят его базы.
			: `${translate("onecAgentServesOrgs")}: ${a.organizationsCount ?? 0} · ${translate("onecAgentServesBases")}: ${a.basesCount ?? 0}`,
		// Отключённый агент не «оффлайн»: его исключили намеренно, и это разные вещи.
		// Три состояния, а не два: «выполняет команду» — не «на связи» (см. stateLabel).
		onlineLabel: stateLabel(a),
		buildLabel: agentBuildLabel(a),
		lastSeenAt: a.lastSeenAt,
		agentOs: a.os || "—",
		agentOnecLabel: a.onecReachable === undefined ? "—" : a.onecReachable ? translate("yes") : translate("no"),
		agentBasesLabel: a.role !== "business" ? "—"
			: `${a.basesCount ?? 0}${a.limits?.maxBases != null ? ` / ${a.limits.maxBases}` : ""}`,
		agentCommandsLabel: a.commandsDone == null ? "—"
			: `${a.commandsDone}${a.commandsFailed ? ` / ${translate("onecAgentFailedShort")} ${a.commandsFailed}` : ""}`,
		capabilitiesCount: a.capabilities.length,
		// Считаем РАБОТАЮЩИЕ, а не всю историю: идентификатор меняется при каждом
		// перезапуске службы, и за сутки их набирается десяток.
		instancesCount: (a.instances ?? []).filter((i) => i.live).length,
		ownerInstance: a.owner?.instanceId || "—",
	})), (r) => r.uuid), [filtered, serverNames]);

	// Больше одного процесса под одним токеном — предупреждаем прямо в панели. Симптом
	// (команда отказывает через раз, при этом «пароль верный») ни на что другое не похож,
	// но и не подсказывает причину: с сервера видно только чередование ответов.
	const doubled = useMemo(
		() => (agents.data?.items ?? []).filter(
			(a) => !a.disabled && (a.instances ?? []).filter((i) => i.live).length > 1,
		),
		[agents.data],
	);

	// Дату форматирует сама таблица (колонка типа datetime): один формат на приложение и
	// сортировка по значению, а не по тексту.
	const view = useStaticTableView(rowsRaw, { name: "asc" }, "OneCAdmin_agents", { rememberFilters: false });
	const rows = view.rows;

	return (
		<>
			<div className={styles.Hint}>{translate("onecAgentsHint")}</div>
			{/* Остаток общей квоты обращений к кластеру: когда он на исходе, отказ
			    «слишком часто» приходит тому, кто нажал последним, — а причина общая. */}
			{quota.low && (
				<Notice items={[{
					type: "warning",
					text: `${translate("onecClusterQuotaLow")}: ${quota.left} / ${quota.max}`,
				}]} />
			)}
			{doubled.map((a) => {
				// Адреса источников: экземпляры с РАЗНЫХ адресов — это один токен на двух
				// машинах (классика: сервер 1С и машина разработки), и лечится это не
				// «убить лишний процесс», а отдельным агентом со своим токеном.
				const live = a.instances.filter((i) => i.live);
				const addrs = [...new Set(live.map((i) => i.remoteAddr).filter(Boolean))];
				// Два процесса под одним токеном разбирают одну очередь: команды начинают
				// отказывать через раз — это не предупреждение «на будущее», а поломка сейчас.
				return (
					<Notice key={a.id} items={[{
						type: "attention",
						text: `${translate("onecAgentDoubled")}: ${a.name || a.id.slice(0, 8)} — ${live.length}`
							+ (addrs.length > 1 ? ` (${translate("onecAgentFromHosts")}: ${addrs.join(", ")})` : "")
							+ ". " + (addrs.length > 1 ? translate("onecAgentTokenShared") : translate("onecAgentDoubledHint")),
					}]} />
				);
			})}
			{/* Кто пропал со связи (п. 4) — сразу, списком и со временем пропажи: иначе это видно только по слову в строке. */}
			{offlineSummary.length > 0 && (
				<Notice items={[{
					type: "warning",
					text: `${translate("onecAgentsOffline")}: ${offlineSummary.map((a) => `${a.name} (${a.since ? `${translate("onecAgentSince")} ${getFormatDate(a.since)}` : translate("onecAgentNeverSeen")})`).join(", ")}`,
				}]} />
			)}
			<QueryError error={agents.error} noticeKey="agents" source={translate("onecTabAgents")} />
			<div className={styles.StatusFilter}>
				<SegmentedControl name="agents_role" label={translate("role")} value={roleFilter} options={roleOptions}
					onChange={setRoleFilter} />
				<span className={styles.FilterDivider} aria-hidden="true" />
				<SegmentedControl name="agents_state" label={translate("onlineLabel")} value={stateFilter} options={stateOptions}
					onChange={setStateFilter} />
			</div>
			<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_agents", rows, columns: cols, setColumns: setCols,
				sorting: view.sorting, search: view.search,
				isLoading: agents.isLoading, onReload: () => void agents.refetch(),
				// Двойной щелчок открывает форму агента — тот же жест, что во всех списках.
				onRowClick: openAgent,
				// Отметки — для групповых действий (п. 5); по номеру строки берём id агента.
				selectable: canManage,
				/*
				 * ВТОРОЙ АРГУМЕНТ — ВСЕ СТРОКИ ТАБЛИЦЫ, А НЕ ОТМЕЧЕННЫЕ (Table.onSelectionChange: видимые плюс отмеченные скрытые
				 * поиском). Выбор — те из них, чьи номера в первом аргументе. Раньше здесь брались все строки: стоило отметить
				 * одного агента, и «Отключить», «Перезапустить службу», «Обновить агента» уходили всем агентам списка (28.09).
				 */
				onSelectionChange: (ids, all) => setSelected(all.filter((r) => ids.has(Number(r.id))).map((r) => String(r.agentId))),
				// Регистрация агента — это выдача доступа к серверу 1С: только полный доступ (F5). Все команды — одним меню
				// «Операции», как у списка баз кластера: подключение — без отметок, остальное — над отмеченными.
				extraButtons: !canManage ? undefined : (
					<ActionsDropdownButton
						label={translate("onecOperations")}
						icon="settings"
						options={agentOperationsMenu(selectedAgents, agents.data?.limits.latestBuild)}
						title={selectedAgents.length ? `${translate("onecAgentsMarked")}: ${selectedAgents.length}` : translate("onecAgentOpsTitle")}
						onSelect={(id) => {
							const op = id as AgentOp;
							if (op === "create") setName("");
							setDialog(op);
						}}
					/>
				),
			})} />

			{dialog === "create" && (

				<Modal title={translate("onecAgentCreate")} onClose={() => setDialog(null)} onApply={() => create.mutate()}>
					<div className={styles.ModalForm}>
						<Field name="onec_agent_name" label={translate("name")} value={name} noAutofill
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
						<FieldSelect name="onec_agent_kind" label={translate("onecAgentKind")} value={cluster ? "cluster" : "business"}
							onChange={(e) => setCluster(e.target.value === "cluster")}
							options={[
								{ value: "business", label: translate("onecAgentKindBusiness") },
								{ value: "cluster", label: translate("onecAgentKindCluster") },
							]}
							hint={translate(cluster ? "onecEnrollClusterHint" : "onecEnrollBusinessHint")} />
						<div className={styles.Hint}>{translate("onecAgentCreateHint")}</div>
					</div>
				</Modal>
			)}

			{(dialog === "disable" || dialog === "enable") && (
				<Modal title={translate(dialog === "disable" ? "onecAgentDisable" : "onecAgentEnable")} onClose={() => setDialog(null)}
					onApply={() => { if (!bulk.isPending) bulk.mutate(dialog === "disable"); }}>
					<div className={styles.ModalForm}>
						<div>{targets[dialog].map((a) => a.name || a.id.slice(0, 8)).join(", ")}</div>
						{dialog === "disable" && <div className={styles.ConfirmWarning}>{translate("onecAgentsBulkDisableWarning")}</div>}
					</div>
				</Modal>
			)}

			{(dialog === "restart" || dialog === "update") && (
				<Modal title={translate(dialog === "restart" ? "onecAgentRestart" : "onecAgentUpdate")} onClose={() => setDialog(null)}
					onApply={() => { if (!service.isPending) service.mutate(dialog); }}>
					<div className={styles.ModalForm}>
						<div>{targets[dialog].map((a) => a.name || a.id.slice(0, 8)).join(", ")}</div>
						<div className={styles.ConfirmWarning}>
							{translate(dialog === "restart" ? "onecAgentRestartWarning" : "onecAgentUpdateWarning")}
						</div>
						{dialog === "update" && agents.data?.limits.latestBuild && (
							<div>{translate("onecAgentUpdateTo")}: {agents.data.limits.latestBuild}</div>
						)}
					</div>
				</Modal>
			)}

			{dialog === "enroll" && (
				<Modal title={translate("onecEnrollByCode")} onClose={() => setDialog(null)} style={{ width: "min(1100px, 96vw)" }}>
					<div className={styles.EmbeddedTable}><EnrollmentsTab /></div>
				</Modal>
			)}

			{issued && (
				<Modal title={translate("onecAgentToken")} onClose={() => setIssued(null)}>
					<div className={styles.ModalForm}>
						<div>{issued.name}</div>
						<Field name="onec_agent_token" value={issued.token} onChange={() => {}} />
						<div className={styles.ConfirmWarning}>{translate("onecAgentTokenWarning")}</div>
					</div>
				</Modal>
			)}
		</>
	);
};

export default AgentsTab;
