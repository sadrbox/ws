/**
 * Вкладка «Агенты» (E15/A5): кто подключён к серверу 1С и чем управляет.
 *
 * ЗАЧЕМ В ПАНЕЛИ. Агента заводили консольной командой с `AGENT_ADMIN_KEY` — то есть
 * человек с правом «Администрирование 1С» всё равно шёл к тому, у кого есть доступ к
 * серверу. Здесь те же операции под тем же правом, что и остальная панель.
 *
 * ТОКЕН ПОКАЗЫВАЕТСЯ ОДИН РАЗ. В БД лежит только его SHA-256; забыли — значит ротация,
 * а не «посмотреть ещё раз». Поэтому окно с токеном нельзя закрыть случайно: копирование
 * и явное подтверждение.
 */
import { FC, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import Modal from "src/components/Modal";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import { showToast } from "src/components/UIToast";
import { asText } from "src/utils/asText";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { getFormatDate } from "src/utils/datetime";
import { createAgent, fetchAgents, releaseAgentInstance, rotateAgentToken, setAgentDisabled, setAgentOwner } from "src/services/onec/api";
import { QueryError } from "./shared";
import styles from "./OneCAdmin.module.scss";

const columns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "role", type: "string", width: "120px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onlineLabel", type: "string", width: "130px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "lastSeenAt", type: "string", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "capabilitiesCount", type: "number", width: "130px", minWidth: "90px", alignment: "right", visible: true, inlist: true },
	{ identifier: "instancesCount", type: "number", width: "140px", minWidth: "90px", alignment: "right", visible: true, inlist: true },
	// Владелец токена: под ним и работает агент; остальные экземпляры получают отказ.
	{ identifier: "ownerInstance", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

export const AgentsTab: FC = () => {
	const qc = useQueryClient();
	const agents = useQuery({ queryKey: ["onec", "agents"], queryFn: fetchAgents });
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(), "OneCAdmin_agents"));
	const [selected, setSelected] = useState<string>("");
	const [dialog, setDialog] = useState<null | "create">(null);
	const [name, setName] = useState("");
	// Токен живёт только в этом состоянии и только до закрытия окна — на сервере его нет.
	const [issued, setIssued] = useState<{ token: string; name: string } | null>(null);

	const refresh = () => qc.invalidateQueries({ queryKey: ["onec", "agents"] });

	const create = useMutation({
		mutationFn: () => createAgent(name.trim()),
		onSuccess: (d) => { setDialog(null); setIssued({ token: d.token, name: d.agent.name || name }); void refresh(); },
		onError: (e) => showToast(e instanceof Error ? e.message : translate("unknownError"), "error"),
	});

	const rotate = useMutation({
		mutationFn: (id: string) => rotateAgentToken(id),
		onSuccess: (d, id) => {
			const a = (agents.data?.items ?? []).find((x) => x.id === id);
			setIssued({ token: d.token, name: a?.name ?? "" });
			void refresh();
		},
		onError: (e) => showToast(e instanceof Error ? e.message : translate("unknownError"), "error"),
	});

	// Снятие владения: следующий запустившийся экземпляр займёт место. Нужно там, где
	// владелец не отдал его сам — машину выключили, службу перенесли.
	const release = useMutation({
		mutationFn: (id: string) => releaseAgentInstance(id),
		onSuccess: () => { showToast(translate("saved"), "success"); void refresh(); },
		onError: (e) => showToast(e instanceof Error ? e.message : translate("unknownError"), "error"),
	});

	const assign = useMutation({
		mutationFn: (p: { id: string; instanceId: string }) => setAgentOwner(p.id, p.instanceId),
		onSuccess: () => { showToast(translate("saved"), "success"); void refresh(); },
		onError: (e) => showToast(e instanceof Error ? e.message : translate("unknownError"), "error"),
	});

	const toggle = useMutation({
		mutationFn: (p: { id: string; disabled: boolean }) => setAgentDisabled(p.id, p.disabled),
		onSuccess: () => { showToast(translate("saved"), "success"); void refresh(); },
		onError: (e) => showToast(e instanceof Error ? e.message : translate("unknownError"), "error"),
	});

	const rowsRaw = useMemo(() => (agents.data?.items ?? []).map((a, i) => ({
		id: i + 1, uuid: a.id, agentId: a.id,
		name: a.name || "—", role: a.role,
		// Отключённый агент не «оффлайн»: его исключили намеренно, и это разные вещи.
		onlineLabel: a.disabled ? translate("onecAgentDisabled") : a.online ? translate("onecAgentOnline") : translate("onecAgentOffline"),
		lastSeenAt: a.lastSeenAt,
		capabilitiesCount: a.capabilities.length,
		instancesCount: a.instances?.length ?? 0,
		ownerInstance: a.owner?.instanceId || "—",
	})), [agents.data]);

	// Больше одного процесса под одним токеном — предупреждаем прямо в панели. Симптом
	// (команда отказывает через раз, при этом «пароль верный») ни на что другое не похож,
	// но и не подсказывает причину: с сервера видно только чередование ответов.
	const doubled = useMemo(
		() => (agents.data?.items ?? []).filter((a) => !a.disabled && (a.instances?.length ?? 0) > 1),
		[agents.data],
	);

	const view = useStaticTableView(rowsRaw, { name: "asc" });
	const rows = view.rows.map((r) => ({ ...r, lastSeenAt: r.lastSeenAt ? getFormatDate(String(r.lastSeenAt)) : "—" }));

	const current = (agents.data?.items ?? []).find((a) => a.id === selected) ?? null;

	return (
		<>
			<div className={styles.Hint}>{translate("onecAgentsHint")}</div>
			{doubled.map((a) => {
				// Адреса источников: экземпляры с РАЗНЫХ адресов — это один токен на двух
				// машинах (классика: сервер 1С и машина разработки), и лечится это не
				// «убить лишний процесс», а отдельным агентом со своим токеном.
				const addrs = [...new Set(a.instances.map((i) => i.remoteAddr).filter(Boolean))];
				return (
					<div key={a.id} className={styles.Blocked}>
						{translate("onecAgentDoubled")}: {a.name || a.id.slice(0, 8)} — {a.instances.length}
						{addrs.length > 1 ? ` (${translate("onecAgentFromHosts")}: ${addrs.join(", ")})` : ""}.{" "}
						{addrs.length > 1 ? translate("onecAgentTokenShared") : translate("onecAgentDoubledHint")}
					</div>
				);
			})}
			<QueryError error={agents.error} />
			<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_agents", rows, columns: cols, setColumns: setCols,
				sorting: view.sorting, search: view.search,
				isLoading: agents.isLoading, onReload: () => void agents.refetch(),
				onRowClick: (row: Partial<TDataItem>) => setSelected(asText(row.agentId)),
				extraButtons: (
					<>
						<Button size="sm" onClick={() => { setName(""); setDialog("create"); }}>
							{translate("onecAgentCreate")}
						</Button>
						{current && (
							<Button size="sm" disabled={rotate.isPending} onClick={() => rotate.mutate(current.id)}>
								{translate("onecAgentRotate")}
							</Button>
						)}
						{current && (
							// Не прячем, а гасим: спрятанная кнопка выглядит как отсутствующая
							// возможность, и её начинают искать в другом месте.
							<Button size="sm"
								disabled={release.isPending || !current.owner?.instanceId}
								onClick={() => release.mutate(current.id)}>
								{translate("onecAgentReleaseInstance")}
							</Button>
						)}
						{current && (
							<Button size="sm" disabled={toggle.isPending}
								onClick={() => toggle.mutate({ id: current.id, disabled: !current.disabled })}>
								{current.disabled ? translate("onecAgentEnable") : translate("onecAgentDisable")}
							</Button>
						)}
					</>
				),
			})} />

			{current && (
				// Экземпляры выбранного агента: кто держит аренду и кого можно назначить.
				// «Кто первым пришёл» — правило для машин: выиграть может машина разработки,
				// и тогда боевой агент заблокирован. Здесь это решается одним нажатием.
				<div className={styles.Instances}>
					<div className={styles.Hint}>
						{translate("onecAgentInstances")}: {current.instances?.length ?? 0}
						{current.owner?.instanceId ? ` · ${translate("ownerInstance")}: ${current.owner.instanceId}` : ""}
					</div>
					{(current.instances ?? []).map((inst) => (
						<div key={inst.instanceId} className={styles.InstanceRow}>
							<span>{inst.instanceId}</span>
							<span>{inst.remoteAddr ?? "—"}</span>
							<span>{getFormatDate(inst.lastSeenAt)}</span>
							{current.owner?.instanceId === inst.instanceId
								? <span>{translate("onecAgentOwnerNow")}</span>
								: (
									<Button size="sm" disabled={assign.isPending}
										onClick={() => assign.mutate({ id: current.id, instanceId: inst.instanceId })}>
										{translate("onecAgentMakeOwner")}
									</Button>
								)}
						</div>
					))}
				</div>
			)}

			{current && (
				// Способности выбранного агента — одной строкой под таблицей: отдельный
				// заголовок над ними только съедал высоту, а подпись и так в тексте.
				<div className={styles.Hint}>
					{translate("onecAgentCapabilities")} ({current.name || current.id.slice(0, 8)}):{" "}
					{current.capabilities.join(", ") || "—"}
				</div>
			)}

			{dialog === "create" && (
				<Modal title={translate("onecAgentCreate")} onClose={() => setDialog(null)} onApply={() => create.mutate()}>
					<div className={styles.ModalForm}>
						<Field name="onec_agent_name" label={translate("name")} value={name}
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
