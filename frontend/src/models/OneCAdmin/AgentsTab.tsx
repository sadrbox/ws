/**
 * Вкладка «Агенты» (E15/A5): кто подключён к серверу 1С.
 *
 * СПИСОК — ТОЛЬКО СПИСОК. Команды над агентом переехали в его форму (AgentForm), которая
 * открывается двойным щелчком по строке, как у всех списков приложения. В командной панели
 * действия работали над «выбранной строкой»: какая выбрана — видно плохо, кнопки то гасли,
 * то прятались, а «Сменить токен» стояла между безобидными и однажды отключила живого
 * агента случайным нажатием.
 *
 * ТОКЕН ПОКАЗЫВАЕТСЯ ОДИН РАЗ. В БД лежит только его SHA-256; забыли — значит ротация,
 * а не «посмотреть ещё раз».
 */
import { FC, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import Notice from "src/components/Notice";
import Modal from "src/components/Modal";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import { reportError } from "src/services/errors/route";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { createAgent } from "src/services/onec/api";
import { stateLabel, useOpenAgent } from "./AgentForm";
import { agentBuildLabel } from "./agentHealth";
import {
	QueryError, useAgents, useOnecPermissions,
} from "./shared";
import { agentsAllow } from "./onecPermissions";
import styles from "./OneCAdmin.module.scss";

const columns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "role", type: "string", width: "120px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
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
	const quota = {
		left: limits?.clusterRemaining ?? 0,
		max: limits?.clusterPerMin ?? 0,
		// Порог — пятая часть: раньше поздно, позже бесполезно.
		low: !!limits?.clusterPerMin && (limits.clusterRemaining ?? 0) <= Math.ceil(limits.clusterPerMin / 5),
	};
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(), "OneCAdmin_agents"));
	const [dialog, setDialog] = useState<null | "create">(null);
	const [name, setName] = useState("");
	// Токен живёт только в этом состоянии и только до закрытия окна — на сервере его нет.
	const [issued, setIssued] = useState<{ token: string; name: string } | null>(null);
	const openAgent = useOpenAgent();

	const refresh = () => qc.invalidateQueries({ queryKey: ["onec", "agents"] });

	const create = useMutation({
		mutationFn: () => createAgent(name.trim()),
		onSuccess: (d) => { setDialog(null); setIssued({ token: d.token, name: d.agent.name || name }); void refresh(); },
		onError: (e) => reportError(e, { source: translate("onecTabAgents") }),
	});

	const rowsRaw = useMemo(() => (agents.data?.items ?? []).map((a, i) => ({
		id: i + 1, uuid: a.id, agentId: a.id,
		name: a.name || "—", role: a.role,
		// Отключённый агент не «оффлайн»: его исключили намеренно, и это разные вещи.
		// Три состояния, а не два: «выполняет команду» — не «на связи» (см. stateLabel).
		onlineLabel: stateLabel(a),
		buildLabel: agentBuildLabel(a),
		lastSeenAt: a.lastSeenAt,
		capabilitiesCount: a.capabilities.length,
		// Считаем РАБОТАЮЩИЕ, а не всю историю: идентификатор меняется при каждом
		// перезапуске службы, и за сутки их набирается десяток.
		instancesCount: (a.instances ?? []).filter((i) => i.live).length,
		ownerInstance: a.owner?.instanceId || "—",
	})), [agents.data]);

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
	const view = useStaticTableView(rowsRaw, { name: "asc" });
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
			<QueryError error={agents.error} noticeKey="agents" source={translate("onecTabAgents")} />
			<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_agents", rows, columns: cols, setColumns: setCols,
				sorting: view.sorting, search: view.search,
				isLoading: agents.isLoading, onReload: () => void agents.refetch(),
				// Двойной щелчок открывает форму агента — тот же жест, что во всех списках.
				onRowClick: openAgent,
				// Регистрация агента — это выдача доступа к серверу 1С: только полный доступ (F5).
				extraButtons: !canManage ? undefined : (
					<Button icon="plus" variant="secondary" onClick={() => { setName(""); setDialog("create"); }}>
						{translate("onecAgentCreate")}
					</Button>
				),
			})} />

			{dialog === "create" && (

				<Modal title={translate("onecAgentCreate")} onClose={() => setDialog(null)} onApply={() => create.mutate()}>
					<div className={styles.ModalForm}>
						<Field name="onec_agent_name" label={translate("name")} value={name} noAutofill
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
						<div className={styles.Hint}>{translate("onecAgentCreateHint")}</div>
					</div>
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
