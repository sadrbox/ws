/**
 * Вкладки карточки агента о его работе (п. 1–3): сводка бизнес-агента, команды агента, журнал действий над ним.
 *
 * СВОДКА БИЗНЕС-АГЕНТА — по кнопке, как «Состояние сервера» у агента кластера: это команда агенту, и слать её на
 * каждое открытие карточки незачем. Команды и журнал — чтения базы сервиса, они грузятся сами.
 *
 * ТАБЛИЦЫ — ОБЩИЕ КОМПОНЕНТЫ (28.09). Команды и журнал — Table: сортировка по колонкам, быстрый поиск, ширины и
 * видимость колонок запоминаются, «Обновить» — кнопкой таблицы. Базы в сводке — SubTableSheets: там таблица стоит
 * среди других блоков вкладки и растёт по содержимому. Самодельные <table> обходили общий вид ячейки (текст —
 * дочерним span у TableBodyCell: на нём держатся отступ от рамки, многоточие и сжатие).
 */
import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import Table from "src/components/Table";
import SubTableSheets from "src/components/SubTableSheets";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { showToast } from "src/components/UIToast";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { reportError } from "src/services/errors/route";
import { asText } from "src/utils/asText";
import { getFormatDate } from "src/utils/datetime";
import { cancelCommands, fetchAgentAudit, fetchAgentCommands, fetchBusinessHealth } from "src/services/onec/api";
import { withOp } from "./progress";
import { QueryError } from "./sharedUi";
import { healthScalars } from "./agentActivityView";
import { auditRows, commandFinishedText, commandRows, healthBaseRows, type CommandRow, type HealthBaseRow } from "./agentTablesView";
import { formatDuration } from "./queueStats";
import styles from "./OneCAdmin.module.scss";

const TONE_CLASS = { wait: styles.ReqWait, ok: styles.ReqOk, bad: styles.ReqBad, off: styles.ReqOff };

// Идентификатор колонки — ключ перевода её заголовка (getTranslateColumn).
const HEALTH_BASE_COLUMNS: TColumn[] = [
	{ identifier: "onecBase", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "status", type: "string", width: "240px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecTransport", type: "string", width: "110px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecExtVersion", type: "string", width: "130px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecHealthLastOk", type: "datetime", width: "150px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecHealthLastError", type: "datetime", width: "320px", minWidth: "160px", alignment: "left", visible: true, inlist: true },
];

const renderHealthBaseCell = (r: TDataItem, col: TColumn) => {
	const row = r as HealthBaseRow;
	if (col.identifier === "onecBase") return <span className={styles.Mono}>{asText(row.onecBase)}</span>;
	if (col.identifier === "status" && row.__over) return <span className={styles.OverLimit}>{asText(row.status)}</span>;
	if (col.identifier === "onecHealthLastOk" && !row.onecHealthLastOk) return "—";
	// Последний отказ — приглушённо: главное в строке — состояние базы, отказ его поясняет.
	if (col.identifier === "onecHealthLastError") return <span className={styles.ReqOff}>{row.__lastError}</span>;
	return undefined;
};

export const BusinessHealthTab: FC<{ agentId: string; agentName: string }> = ({ agentId, agentName }) => {
	const health = useQuery({
		queryKey: ["onec", "agent-health", agentId],
		queryFn: () => withOp({ kind: "read", title: translate("onecAgentHealth"), target: agentName,
			ref: { endpoint: "onec-agents", uuid: agentId, label: agentName } }, () => fetchBusinessHealth(agentId)),
		enabled: false, retry: false, staleTime: Infinity,
	});
	const h = health.data;
	const baseRows = useMemo(() => healthBaseRows(Array.isArray(h?.bases) ? h.bases : []), [h]);
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
								{/* Сводку шлёт сам агент: лимит БИН в ней остаётся у старых сборок, сервис его больше не задаёт (В8). */}
								<td>{`maxBases ${h.limits.maxBases ?? "—"}`}</td>
							</tr>
						)}
					</tbody>
				</table>
			)}
			{/* Базы сводки (28.09) — SubTableSheets: стоит среди других блоков вкладки и растёт по строкам. */}
			{baseRows.length > 0 && (
				<SubTableSheets columns={HEALTH_BASE_COLUMNS} rows={baseRows} renderCell={renderHealthBaseCell} />
			)}
		</div>
	);
};

const COMMANDS = "OneCAdmin_agent_commands";

const commandColumns = (): TColumn[] => [
	{ identifier: "onecCmdCreated", type: "datetime", width: "150px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecCmdType", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecBase", type: "string", width: "180px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "status", type: "string", width: "300px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecCmdFinished", type: "datetime", width: "180px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
];

/**
 * Отметка «снять с очереди» — служебная колонка (`__`): без заголовка, в настройку колонок и сохранённые ширины не
 * попадает (getModelColumns, TableHeader). Не отметки самой Table: те дали бы отметить и начатые команды, которые
 * снять уже нельзя.
 */
const PICK_COLUMN: TColumn = {
	identifier: "__pick", type: "string", width: "40px", minWidth: "40px", alignment: "center", sortable: false, visible: true, inlist: true,
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

	// Отметка — в данных строки, а не только в замыкании renderCell: строки Table перерисовываются по своим данным.
	const rowsRaw = useMemo(
		() => commandRows(items).map((r) => ({ ...r, __picked: picked.includes(asText(r.uuid)) })),
		[items, picked],
	);
	const view = useStaticTableView(rowsRaw, { onecCmdCreated: "desc" }, COMMANDS, { scope: agentId });
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(commandColumns(), COMMANDS));
	// Колонка отметки — только тому, кто вправе снимать; назад в состояние колонок она не попадает.
	const shownCols = useMemo(() => (canManage ? [PICK_COLUMN, ...cols] : cols), [canManage, cols]);
	const setShownCols = useCallback((next: TColumn[]) => setCols(next.filter((c) => c.identifier !== PICK_COLUMN.identifier)), []);
	const togglePick = (id: string, on: boolean) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));

	const renderCell = (r: TDataItem, col: TColumn) => {
		const row = r as CommandRow & { __picked: boolean };
		switch (col.identifier) {
			case PICK_COLUMN.identifier:
				// Отметка есть только у не начатой команды: начатую снять с очереди уже нельзя.
				return row.__state === "queued" && canManage ? (
					<input type="checkbox" aria-label={row.uuid} checked={row.__picked}
						onChange={(e) => togglePick(row.uuid, e.target.checked)} />
				) : null;
			// Тип и ключ базы читают посимвольно — моноширинным.
			case "onecCmdType":
			case "onecBase":
				return <span className={styles.Mono}>{asText(row[col.identifier])}</span>;
			case "status":
				// Состояние словом и тоном, отказ — под ним приглушённо (в режиме переноса вложенные span идут строками).
				return (
					<span>
						<span className={TONE_CLASS[row.__tone]}>{asText(row.status)}</span>
						{row.__error && <span className={styles.ReqOff}>{row.__error}</span>}
					</span>
				);
			case "onecCmdFinished":
				return commandFinishedText(row);
			default:
				return undefined;
		}
	};

	return (
		<>
			<div className={styles.Hint}>{translate("onecAgentCommandsHint")}</div>
			<div className={styles.Hint}>
				{translate("onecCmdQueued")}: {queued.length} · {translate("onecCmdRunning")}: {items.filter((c) => c.state === "dispatched").length}
			</div>
			<QueryError error={list.error} noticeKey={`agent-commands-${agentId}`} source={translate("onecAgentCommands")} />
			<Table {...buildStaticTableProps({
				componentName: COMMANDS, rows: view.rows, columns: shownCols, setColumns: setShownCols,
				sorting: view.sorting, search: view.search,
				isLoading: list.isLoading, reloading: list.isFetching && !list.isLoading,
				onReload: () => void list.refetch(),
				emptyText: list.data ? translate("onecAgentCommandsNone") : undefined,
				// Текст отказа — предложение, а не значение: переносится, а не режется многоточием.
				wrapCells: true,
				renderCell,
				extraButtons: canManage ? (
					<Button variant="danger" disabled={!picked.length || cancel.isPending} onClick={() => cancel.mutate()}>
						{translate("onecAgentCommandsCancel")}{picked.length ? ` (${picked.length})` : ""}
					</Button>
				) : undefined,
			})} />
		</>
	);
};

const AUDIT = "OneCAdmin_agent_audit";

const auditColumns = (): TColumn[] => [
	{ identifier: "onecAuditAt", type: "datetime", width: "150px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecAuditEvent", type: "string", width: "240px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecAuditWho", type: "string", width: "180px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecAuditDetails", type: "string", width: "440px", minWidth: "160px", alignment: "left", visible: true, inlist: true },
];

export const AgentAuditTab: FC<{ agentId: string }> = ({ agentId }) => {
	const list = useQuery({ queryKey: ["onec", "agent-audit", agentId], queryFn: () => fetchAgentAudit(agentId), enabled: !!agentId });
	const rowsRaw = useMemo(() => auditRows(list.data?.items ?? []), [list.data]);
	const view = useStaticTableView(rowsRaw, { onecAuditAt: "desc" }, AUDIT, { scope: agentId });
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(auditColumns(), AUDIT));
	return (
		<>
			<div className={styles.Hint}>{translate("onecAgentAuditHint")}</div>
			<QueryError error={list.error} noticeKey={`agent-audit-${agentId}`} source={translate("onecAgentAudit")} />
			<Table {...buildStaticTableProps({
				componentName: AUDIT, rows: view.rows, columns: cols, setColumns: setCols,
				sorting: view.sorting, search: view.search,
				isLoading: list.isLoading, reloading: list.isFetching && !list.isLoading,
				onReload: () => void list.refetch(),
				emptyText: list.data ? translate("onecAgentAuditNone") : undefined,
				wrapCells: true,
				// Подробности — приглушённо: событие и автор важнее, подробности их поясняют.
				renderCell: (r, col) => (col.identifier === "onecAuditDetails"
					? <span className={styles.ReqOff}>{asText(r.onecAuditDetails)}</span>
					: undefined),
			})} />
		</>
	);
};
