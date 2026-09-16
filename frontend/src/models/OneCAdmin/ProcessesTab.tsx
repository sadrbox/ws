/**
 * «Процессы агента» — что агент запустил на сервере 1С и что из этого зависло.
 *
 * ЗАЧЕМ. Агент работает чужими руками: `rac`, `ibcmd`, конфигуратор `1cv8`, `webinst`,
 * мост PowerShell. Часть этих процессов живёт дольше самой команды — конфигуратор агент
 * НАМЕРЕННО не убивает (прервать применение конфигурации значит оставить базу
 * непригодной), а любой из них переживёт агента, если службу сняли грубо. В диспетчере
 * задач они выглядят ничьими рядом с `rphost`/`rmngr`/`ragent` самого сервера, и
 * разобраться раньше можно было только зайдя на сервер по RDP.
 *
 * ОТКУДА ДАННЫЕ. Из снимка, который агент шлёт с heartbeat: список обновляется сам раз в
 * полминуты и не стоит ни одной команды в 1С. Кнопка «Обновить» спрашивает агента живьём —
 * когда смотришь на зависший процесс, полминуты слишком долго.
 *
 * СНЯТИЕ. Агент снимает только СВОИ процессы: чужой номер он не тронет
 * (`AGENT_PROCESS_NOT_FOUND`) — иначе опечатка в номере остановила бы рабочий `rphost`
 * вместе с сеансами пользователей. Конфигуратор без явного согласия не снимается вовсе:
 * агент отвечает `AGENT_PROCESS_UNSAFE`, и решение принимает человек, а не интерфейс.
 */
import { useRunningCommand } from "src/components/TechMessages/operations";
import { FC, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import Modal from "src/components/Modal";
import Notice from "src/components/Notice";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { formatDuration } from "./queueStats";
import { asText } from "src/utils/asText";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { fetchAgentProcesses, killAgentProcess } from "src/services/onec/api";
import { AiServiceError } from "src/services/ai/endpoint";
import {
	CapabilityGuard, QueryError, useAgents, useOnecPermissions,
} from "./shared";
import { agentsAllow } from "./onecPermissions";
import styles from "./OneCAdmin.module.scss";

const columns = (): TColumn[] => ([
	{ identifier: "pid", type: "string", width: "90px", minWidth: "70px", alignment: "right", visible: true, inlist: true },
	{ identifier: "tool", type: "string", width: "120px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "what", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "baseKey", type: "string", width: "180px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "age", type: "string", width: "120px", minWidth: "90px", alignment: "right", visible: true, inlist: true },
	{ identifier: "orphanLabel", type: "string", width: "170px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	// Команда сервиса, запустившая процесс (С30): по ней процесс долгой операции находится среди остальных.
	{ identifier: "procCommand", type: "string", width: "190px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Сколько идёт — словами: «14 мин» понятнее, чем 840. */
const age = (secs?: number): string => {
	if (secs == null) return "—";
	if (secs < 60) return `${secs} ${translate("secShort")}`;
	if (secs < 3600) return `${Math.floor(secs / 60)} ${translate("minShort")}`;
	return `${Math.floor(secs / 3600)} ${translate("hourShort")} ${Math.floor((secs % 3600) / 60)} ${translate("minShort")}`;
};

export const ProcessesTab: FC = () => {
	// Снятие процесса — «управление» агентами (вложенное разрешение).
	const canWrite = agentsAllow(useOnecPermissions(), "manage");
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(), "OneCAdmin_procs"));
	const [active, setActive] = useState<number | null>(null);
	const [confirm, setConfirm] = useState<null | { pid: number; force: boolean; note?: string }>(null);

	// Снимок из heartbeat: дешёвое чтение своей базы, поэтому обновляем сами раз в 30 с.
	const procs = useQuery({
		queryKey: ["onec", "agent-processes"],
		queryFn: () => fetchAgentProcesses(false),
		refetchInterval: 30_000,
		staleTime: 0,
	});
	const live = useMutation({
		mutationFn: () => fetchAgentProcesses(true),
		onSuccess: () => void procs.refetch(),
		onError: (e) => reportError(e, { source: translate("onecTabProcesses") }),
	});

	const kill = useMutation({
		mutationFn: (p: { pid: number; force: boolean }) => killAgentProcess(p.pid, p.force),
		onSuccess: (d) => {
			/*
			 * СПИСОК ПОСЛЕ СНЯТИЯ — НЕ СНИМОК ИЗ HEARTBEAT. Снимок отстаёт до следующего heartbeat,
			 * и снятый процесс оставался в таблице. Агент с эхом (E5) приносит список сам — сервис
			 * его уже сохранил; без эха читаем живым запросом (сервис сохраняет и его).
			 */
			const echo = d.state?.processes;
			showToast(echo?.stillRunning ? translate("onecProcStillRunning") : d.note || translate("onecProcKilled"),
				echo?.stillRunning ? "warning" : "success");
			setConfirm(null);
			if (echo) void procs.refetch();
			else live.mutate();
		},
		onError: (e, vars) => {
			const text = e instanceof Error ? e.message : String(e);
			/*
			 * СОГЛАСИЕ — ПО КОДУ ОТКАЗА, А НЕ ПО ТЕКСТУ (П3). Агент не снимает без согласия
			 * конфигуратор (AGENT_PROCESS_UNSAFE) и процесс, которого нет в его списке
			 * (AGENT_PROCESS_NOT_FOUND) — второе раньше не предлагалось вовсе. Показываем ЕГО
			 * объяснение и предлагаем повтор с согласием: решение за человеком. Текст — запасной
			 * путь только для ответа без кода.
			 */
			const code = e instanceof AiServiceError ? e.code : undefined;
			const needsConsent = code
				? code === "AGENT_PROCESS_UNSAFE" || code === "AGENT_PROCESS_NOT_FOUND"
				: /AGENT_PROCESS_UNSAFE|AGENT_PROCESS_NOT_FOUND/.test(text);
			// Процесс уже завершился — снимать нечего (П21). Судим только после `force`: без него агент до 17:30
			// писал «уже завершился» и в обычном отказе, и повтор с согласием не предлагался вовсе.
			const gone = vars.force && /уже заверш/i.test(text);
			if (gone) { showToast(text, "warning"); live.mutate(); return; }
			if (needsConsent && !vars.force) {
				setConfirm({ pid: vars.pid, force: true, note: text });
				return;
			}
			reportError(e, { source: translate("onecTabProcesses") });
		},
	});

	const rows = useMemo(() => (procs.data?.items ?? []).map((p, i) => ({
		id: i + 1, uuid: String(p.pid),
		pid: String(p.pid),
		tool: p.tool,
		what: p.what || "—",
		baseKey: p.base || "—",
		age: age(p.ageSecs),
		orphanLabel: p.orphan ? translate("onecProcOrphan") : "",
		procCommand: p.commandId || "—",
	})), [procs.data]);
	const view = useStaticTableView(rows, { age: "desc" });

	const orphans = (procs.data?.items ?? []).filter((p) => p.orphan).length;

	/*
	 * ЧЕЙ ЭТО СПИСОК И КОГДА СНЯТ.
	 *
	 * Список процессов — СНИМОК, который агент присылает с heartbeat, а не живое состояние
	 * сервера. Пока это не было сказано, снимок выглядел как «сейчас»: агента
	 * перезапускали, панель показывала pid'ы прежнего процесса, человек жал «Снять» и
	 * получал честный отказ — «процесса 10040 нет среди запущенных агентом». Ответ верный,
	 * вопрос был неверный.
	 *
	 * Теперь видно и возраст снимка, и то, что агента нет на связи: в обоих случаях
	 * действовать по этому списку бессмысленно, и кнопка «Снять процесс» гаснет.
	 */
	const agents = useAgents();
	const admin = (agents.data?.items ?? []).find((a) => a.role === "admin" && !a.disabled);
	const offline = !!admin && !admin.online;
	const snapshotAt = (procs.data?.items ?? []).map((p) => p.seenAt).find(Boolean) ?? null;
	const snapshotAgeSecs = snapshotAt ? Math.max(0, Math.round((Date.now() - new Date(snapshotAt).getTime()) / 1000)) : 0;
	// Полторы минуты — тот же срок, после которого сервис объявляет агента офлайн: снимок
	// старше него описывает прошлое, а не настоящее.
	const stale = snapshotAgeSecs > 90;

	const liveRunning = useRunningCommand(["AGENT_LIST_PROCESSES"]);

	return (
		<>
			<CapabilityGuard capability="agent.procs" />

			{offline && (
				<Notice items={[{ type: "attention", text: translate("onecProcAgentOffline") }]} />
			)}
			{!offline && stale && (
				<Notice items={[{
					type: "warning",
					text: `${translate("onecProcSnapshotStale")} (${formatDuration(snapshotAgeSecs)})`,
				}]} />
			)}

			<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_procs", rows: view.rows, columns: cols, setColumns: setCols,
				sorting: view.sorting, search: view.search,
				isLoading: procs.isLoading,
				// Таблица не гаснет: живой опрос идёт секунды, прежний список читаем.
				// Опрос heartbeat идёт по таймеру — вращаем от живого чтения, в том числе начатого до перезагрузки.
				reloading: live.isPending || liveRunning,
				// «Обновить» спрашивает агента живьём — снимок heartbeat приходит и сам.
				onReload: () => live.mutate(),
				reloadTitle: translate("onecProcRefreshLive"),
				onActiveRowChange: (r) => setActive(r ? Number(asText(r.pid)) : null),
				// Снятие процесса на сервере 1С — разрушающее действие: правом «только
				// просмотр» список процессов видно, а снимать их нельзя.
				extraButtons: !canWrite ? undefined : (
					// Пока агента нет на связи, снимать нечего: команда уйдёт в очередь и умрёт
					// по сроку, а список всё равно принадлежит прошлому.
					<Button variant="danger" disabled={!active || kill.isPending || offline}
						title={offline
							? translate("onecProcAgentOffline")
							: active ? `${translate("onecProcKill")}: ${active}` : translate("onecProcPickFirst")}
						onClick={() => active && setConfirm({ pid: active, force: false })}>
						<Icon name="close" /> {translate("onecProcKill")}
					</Button>
				),
			})} />

			<QueryError error={procs.error} noticeKey="agent-processes" source={translate("onecTabProcesses")} />
			{orphans > 0 && (
				<Notice items={[{ type: "warning", text: `${translate("onecProcOrphanHint")} (${orphans})` }]} />
			)}

			{confirm && (
				<Modal title={translate("onecProcKill")} onClose={() => setConfirm(null)}
					onApply={() => kill.mutate({ pid: confirm.pid, force: confirm.force })}>
					<div className={styles.ConfirmText}>
						<div>{translate("onecProcKillQuestion")}: {confirm.pid}</div>
						<Notice inline items={[{
							type: confirm.force ? "attention" : "warning",
							text: confirm.note || translate("onecProcKillWarning"),
						}]} />
					</div>
				</Modal>
			)}
		</>
	);
};

export default ProcessesTab;
