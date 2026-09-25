/**
 * Вкладка «История» задачи (E17 СК1): журнал событий и наблюдатели.
 *
 * Журнал — одна таблица на все события задачи (принята, передана, напоминание клиента, возврат
 * «не выполнено», «Нужна помощь», эскалация, результат, оценка): это история ОДНОЙ задачи, и
 * читают её подряд. Наблюдатели — те, кто передал задачу и остаётся на связи до её закрытия
 * (п. 22: «я передала» не означает «выполнено»).
 *
 * Грузится, только когда вкладку открыли: все вкладки формы смонтированы сразу, и без этого
 * каждое открытие задачи ходило бы за журналом, который никто не смотрит.
 */
import { FC, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { withStableIds } from "src/utils/stableRowId";
import { getFormatDate } from "src/utils/datetime";
import { fetchTodoHistory } from "src/services/quality/api";
import { historyRows, watcherViews } from "./todoRules";
import styles from "./Todos.module.scss";

const COMPONENT_NAME = "TodoHistory";

const columns = (): TColumn[] => [
	{ identifier: "todoEventAt", type: "datetime", width: "150px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "todoEventType", type: "string", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "todoEventActor", type: "string", width: "160px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "todoEventDetails", type: "string", width: "240px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "comment", type: "string", width: "320px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "todoEventChannel", type: "string", width: "110px", minWidth: "80px", alignment: "left", visible: false, inlist: true },
];

export const TodoHistory: FC<{
	uuid: string;
	/** Вкладку открывали — можно грузить журнал. */
	active: boolean;
	/** Подпись статуса по коду (справочник статусов формы). */
	statusName: (code: string) => string;
}> = ({ uuid, active, statusName }) => {
	const q = useQuery({
		// Под ключом ["todos", …]: действия над задачей инвалидируют ["todos"] — журнал
		// перечитается вместе со списком и доской.
		queryKey: ["todos", uuid, "history"],
		queryFn: () => fetchTodoHistory(uuid),
		enabled: active && !!uuid,
		staleTime: 10_000,
	});
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(), COMPONENT_NAME));

	const rowsRaw = useMemo(
		() => withStableIds(historyRows(q.data?.events ?? [], statusName), (r) => r.uuid),
		[q.data, statusName],
	);
	const view = useStaticTableView(rowsRaw, { todoEventAt: "desc" });
	const watchers = useMemo(() => watcherViews(q.data?.watchers ?? []), [q.data]);

	return (
		<div className={styles.HistoryPane}>
			{watchers.length > 0 && (
				<div className={styles.Watchers}>
					<span className={styles.WatchersLabel}>{translate("todoWatchers")}:</span>
					{watchers.map((w) => (
						<span key={w.uuid} className={styles.WatcherChip} title={`${w.reason} · ${getFormatDate(w.since)}`}>
							{w.name}
						</span>
					))}
				</div>
			)}
			<div className={styles.HistoryTable}>
				<Table {...buildStaticTableProps({
					componentName: COMPONENT_NAME, rows: view.rows, columns: cols, setColumns: setCols,
					sorting: view.sorting, search: view.search,
					isLoading: q.isLoading, reloading: q.isFetching && !q.isLoading,
					onReload: () => void q.refetch(),
					// Отказ показываем словами на месте таблицы: вкладку открыли ради журнала.
					emptyText: q.isError ? translate("todoHistoryError") : translate("todoHistoryEmpty"),
					wrapCells: true,
				})} />
			</div>
		</div>
	);
};
TodoHistory.displayName = "TodoHistory";

export default TodoHistory;
