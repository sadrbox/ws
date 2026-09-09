/**
 * «Прогресс запросов и команд» — что сейчас делает экран «Пользователи баз».
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ ВКЛАДКА. Проверка сотни баз и запись прав идут минутами. Держать это в
 * тулбаре нельзя: спиннер занимает одну кнопку и говорит только «идёт», а параллельных
 * операций может быть несколько. Здесь каждая — строка со счётчиком «сделано из всего»,
 * поэтому видно и то, что работа движется, и то, где она встала.
 *
 * ОТКУДА СОСТОЯНИЕ. Запросы считает клиент (он сам их и делает), команды — сервис: запись
 * связана с заданием, и опрос заданий переносит в неё «выполнено/отказало/в очереди».
 * Опрос ведёт родительский экран, а не эта вкладка: операция не должна замирать оттого,
 * что человек ушёл смотреть на таблицы.
 *
 * ЧЕМ ЭТО НЕ «ЗАДАНИЯ». «Задания» — журнал всех групповых команд организации, с историей.
 * Здесь — только то, что запустили с этого экрана, вместе с чтениями, которых в журнале
 * нет вовсе: заданий они не создают.
 */
import { FC, useMemo, useState } from "react";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { getFormatDate } from "src/utils/datetime";
import { asText } from "src/utils/asText";
import { clearFinished, useOnecOps, type Op } from "./progress";
import styles from "./OneCAdmin.module.scss";

const opColumns = (): TColumn[] => ([
	{ identifier: "opTitle", type: "string", width: "230px", minWidth: "150px", alignment: "left", visible: true, inlist: true },
	{ identifier: "opKind", type: "string", width: "120px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "opTarget", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "opProgress", type: "string", width: "180px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "opState", type: "string", width: "130px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "opStartedAt", type: "string", width: "170px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "opNote", type: "string", width: "320px", minWidth: "150px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const kindLabel = (k: Op["kind"]): string => translate(
	k === "read" ? "onecOpRead" : k === "create" ? "onecOpCreate" : k === "delete" ? "onecOpDelete" : "onecOpUpdate",
);

const stateLabel = (o: Op): string => (
	o.state === "running" ? translate("onecOpRunning")
		: o.state === "failed" ? translate("onecOpFailed")
			: translate("onecOpDone")
);

/** Длительность словами: «сколько уже идёт» важнее точной секунды старта. */
const duration = (o: Op): string => {
	const ms = (o.finishedAt ?? Date.now()) - o.startedAt;
	const s = Math.max(Math.round(ms / 1000), 0);
	return s < 60 ? `${s} ${translate("secShort")}` : `${Math.floor(s / 60)} ${translate("minShort")} ${s % 60} ${translate("secShort")}`;
};

export const ProgressTab: FC<{ onRefresh: () => void; isLoading?: boolean }> = ({ onRefresh, isLoading }) => {
	const ops = useOnecOps();
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(opColumns(), "OneCAdmin_ops"));

	const rows = useMemo(() => ops.map((o, i) => ({
		id: i + 1, uuid: o.id,
		opTitle: o.title,
		opKind: kindLabel(o.kind),
		opTarget: o.target,
		// Значение колонки — текст для поиска и сортировки; полосу рисует renderCell.
		opProgress: o.total ? `${o.done} / ${o.total}` : (o.state === "running" ? "…" : "—"),
		opState: stateLabel(o),
		opStartedAt: getFormatDate(new Date(o.startedAt).toISOString()),
		opNote: o.note || duration(o),
		__percent: o.total ? Math.min(Math.round((o.done / o.total) * 100), 100) : (o.state === "running" ? 0 : 100),
		__state: o.state,
		__failed: o.failed,
	})), [ops]);
	const view = useStaticTableView(rows, {});

	const running = ops.filter((o) => o.state === "running").length;
	const finished = ops.length - running;

	return (
		<Table {...buildStaticTableProps({
			componentName: "OneCAdmin_ops", rows: view.rows, columns: cols, setColumns: setCols,
			sorting: view.sorting, search: view.search, isLoading: !!isLoading,
			onReload: onRefresh,
			renderCell: (r, col) => {
				if (col.identifier !== "opProgress") return undefined;
				const percent = Number(r.__percent ?? 0);
				const state = asText(r.__state);
				const failed = Number(r.__failed ?? 0);
				return (
					<span className={styles.Progress}>
						<span className={styles.ProgressTrack}>
							<span
								className={[
									styles.ProgressFill,
									state === "failed" || failed > 0 ? styles.ProgressFailed : null,
									state === "running" ? styles.ProgressRunning : null,
								].filter(Boolean).join(" ")}
								style={{ width: `${percent}%` }}
							/>
						</span>
						<span className={styles.ProgressValue}>{asText(r.opProgress)}</span>
					</span>
				);
			},
			extraButtons: (
				<Button variant="secondary" disabled={!finished}
					title={finished ? translate("onecOpsClear") : translate("onecOpsNothingToClear")}
					onClick={clearFinished}>
					<Icon name="clear" /> {translate("onecOpsClear")}
				</Button>
			),
		})} />
	);
};

export default ProgressTab;
