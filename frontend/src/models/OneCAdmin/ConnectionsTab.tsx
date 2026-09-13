/**
 * Вкладка «Соединения» (E15): соединения кластера и блокировки.
 *
 * Два разреза рядом намеренно: «база висит» почти всегда означает блокировку, и снимать
 * что-либо, не видя, кто кого держит, — действие наугад. Раньше соединения вообще нигде
 * не показывались, хотя команда для них была.
 *
 * Разрыв соединения необратим — как и снятие сеанса, поэтому через подтверждение и
 * только по отмеченным строкам.
 */
import { FC, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import Modal from "src/components/Modal";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { asText } from "src/utils/asText";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { disconnectConnection, fetchConnections, fetchLocks, type ClusterRow } from "src/services/onec/api";
import { QueryError, VSplit, useOnecWrite } from "./shared";
import { echoList } from "./clusterEcho";
import styles from "./OneCAdmin.module.scss";

const connColumns = (): TColumn[] => ([
	{ identifier: "connId", type: "string", width: "90px", minWidth: "60px", alignment: "left", visible: true, inlist: true },
	{ identifier: "application", type: "string", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "host", type: "string", width: "160px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "sessionNumber", type: "string", width: "110px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "connectedAt", type: "datetime", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const lockColumns = (): TColumn[] => ([
	{ identifier: "session", type: "string", width: "150px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "connection", type: "string", width: "150px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "object", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "locked", type: "string", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const toRows = (items: ClusterRow[], key: string) =>
	items.map((x, i) => ({ id: i + 1, uuid: String(x[key] ?? i), ...x }));

export const ConnectionsTab: FC = () => {
	const canWrite = useOnecWrite();
	const connections = useQuery({ queryKey: ["onec", "connections"], queryFn: () => fetchConnections() });
	const locks = useQuery({ queryKey: ["onec", "locks"], queryFn: () => fetchLocks() });

	const [connCols, setConnCols] = useState<TColumn[]>(() => getModelColumns(connColumns(), "OneCAdmin_connections"));
	const [lockCols, setLockCols] = useState<TColumn[]>(() => getModelColumns(lockColumns(), "OneCAdmin_locks"));
	const [picked, setPicked] = useState<string[]>([]);
	const [confirm, setConfirm] = useState(false);

	const connView = useStaticTableView(toRows(connections.data?.items ?? [], "connection"), { connId: "asc" });
	const lockView = useStaticTableView(toRows(locks.data?.items ?? [], "session"), { session: "asc" });

	const qc = useQueryClient();
	const disconnect = useMutation({
		// Последовательно: операция мгновенная, зато при отказе видно, на каком соединении.
		mutationFn: async (ids: string[]) => {
			let ok = 0; const failed: string[] = [];
			// Список соединений из ответа на разрыв (clusterEcho.echoList) кладём в таблицу сразу.
			// Решает ПОСЛЕДНИЙ успешный разрыв: список от более раннего не знает о следующих.
			let lastEcho: ReturnType<typeof echoList> = null;
			for (const id of ids) {
				try {
					lastEcho = echoList(await disconnectConnection(id), "connections");
					if (lastEcho) qc.setQueryData(["onec", "connections"], { items: lastEcho.items });
					ok += 1;
				} catch { failed.push(id); }
			}
			return { ok, failed, fresh: !!lastEcho };
		},
		onSuccess: (r) => {
			showToast(`${translate("onecDisconnected")}: ${r.ok}${r.failed.length ? ` / ${r.ok + r.failed.length}` : ""}`,
				r.failed.length ? "warning" : "success");
			setPicked([]);
			// Блокировки в ответ не входят и после разрыва, как и прежде, не перечитываются.
			if (!r.fresh) void connections.refetch();
		},
		onError: (e) => reportError(e, { source: translate("onecTabConnections") }),
	});

	return (
		<>
			<VSplit
				storageKey="connections"
				main={<><QueryError error={connections.error} noticeKey="connections" source={translate("onecTabConnections")} />
				<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_connections", rows: connView.rows, columns: connCols, setColumns: setConnCols,
				sorting: connView.sorting, search: connView.search,
				isLoading: connections.isLoading,
				reloading: connections.isFetching,
				onReload: () => void connections.refetch(),
				selectable: true,
				onSelectionChange: (sel, all) =>
					setPicked(all.filter((r: TDataItem) => sel.has(Number(r.id))).map((r) => asText(r.uuid))),
				// Разрыв соединения — вмешательство в работу базы: только полный доступ.
				extraButtons: canWrite && picked.length > 0
					? <Button variant="danger" onClick={() => setConfirm(true)}>
						<Icon name="close" /> {translate("onecDisconnect")} ({picked.length})
					</Button>
					: undefined,
			})} /></>}
				side={<><QueryError error={locks.error} noticeKey="locks" source={translate("onecTabConnections")} />
				<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_locks", rows: lockView.rows, columns: lockCols, setColumns: setLockCols,
				sorting: lockView.sorting, search: lockView.search,
				isLoading: locks.isLoading,
				reloading: locks.isFetching,
				onReload: () => void locks.refetch(),
			})} /></>}
			/>

			{confirm && (
				<Modal title={translate("onecDisconnect")} onClose={() => setConfirm(false)}
					onApply={() => { disconnect.mutate(picked); setConfirm(false); }}>
					<div className={styles.ConfirmText}>
						{translate("onecDisconnectQuestion")}
						<div className={styles.ConfirmDetails}>{translate("onecConnections")}: {picked.length}</div>
						<div className={styles.ConfirmWarning}>{translate("onecTerminateWarning")}</div>
					</div>
				</Modal>
			)}
		</>
	);
};

export default ConnectionsTab;
