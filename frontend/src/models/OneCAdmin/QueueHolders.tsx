/**
 * «Кто держит очередь» и среднее время по типам — над таблицей «Прогресса» (R5, docs/TASKS_DEV_2026-09-14.md).
 *
 * Строка очереди говорила «идёт: 1», но не что именно и сколько: зависшее чтение и четырёхчасовая
 * загрузка выглядели одинаково, а прервать зависшее можно было только из «Заданий». Здесь — выданные
 * агентам и ещё не ответившие команды; «Прервать» — только у чтений (обрыв загрузки или обновления
 * оставляет базу в промежуточном состоянии — так же решает и сервис).
 *
 * Время по типам — сводно по снимкам агентов: рядом с оценкой «сколько ждать» видно, из чего она.
 *
 * ОБЕ ТАБЛИЦЫ — SubTableSheets (28.09): виджет стоит над таблицей «Прогресса», и ему нужна простыня, растущая по
 * строкам, а не второй список с тулбаром. Вид ячейки — общий с Table.
 */
import { FC, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import SubTableSheets from "src/components/SubTableSheets";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { abortCommand, type OnecQueueStats } from "src/services/onec/api";
import { ageText, durationCellText, durationColumns, durationTableRows, holderRows, type HolderRow } from "./agentTablesView";
import {
	useOnecPermissions,
} from "./shared";
import { agentsAllow } from "./onecPermissions";
import styles from "./OneCAdmin.module.scss";
import diag from "./AgentDiag.module.scss";

// Идентификатор колонки — ключ перевода её заголовка (getTranslateColumn).
const HOLDER_COLUMNS: TColumn[] = [
	{ identifier: "onecStatType", type: "string", width: "220px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecQueueBase", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecQueueAge", type: "number", width: "110px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
];
/** Кнопка «Прервать» — служебная колонка (`__`, без заголовка): только у того, кто вправе прерывать. */
const ABORT_COLUMN: TColumn = {
	identifier: "__abort", type: "string", width: "130px", minWidth: "110px", alignment: "left", sortable: false, visible: true, inlist: true,
};
const TIME_COLUMNS = durationColumns();

export const QueueHolders: FC<{ stats: OnecQueueStats | undefined }> = ({ stats }) => {
	const canAbort = agentsAllow(useOnecPermissions(), "manage");
	const qc = useQueryClient();
	const [showTimes, setShowTimes] = useState(false);

	const abort = useMutation({
		mutationFn: (commandId: string) => abortCommand(commandId),
		onSuccess: (r) => {
			showToast(r.aborted
				? [translate("onecQueueAborted"), r.killed ? translate("onecAbortKilled") : "", r.note ?? ""].filter(Boolean).join(". ")
				: translate("onecQueueAbortNotRunning"),
				r.aborted ? "success" : "warning");
			void qc.invalidateQueries({ queryKey: ["onec", "queue-stats"] });
		},
		onError: (e) => reportError(e, { source: translate("onecQueueHolders") }),
	});

	const holders = useMemo(() => holderRows(stats?.runningCommands ?? []), [stats]);
	const times = useMemo(() => durationTableRows(stats?.agentDurations), [stats]);
	const holderColumns = useMemo(() => (canAbort ? [...HOLDER_COLUMNS, ABORT_COLUMN] : HOLDER_COLUMNS), [canAbort]);
	if (!holders.length && !times.length) return null;

	const renderHolderCell = (r: TDataItem, col: TColumn) => {
		const row = r as HolderRow;
		if (col.identifier === "onecQueueAge") return ageText(row.onecQueueAge);
		if (col.identifier !== ABORT_COLUMN.identifier) return undefined;
		// «Прервать» — только у чтений: обрыв загрузки или обновления оставил бы базу в промежуточном состоянии.
		return row.__abortable && canAbort ? (
			<Button variant="secondary" disabled={abort.isPending} onClick={() => abort.mutate(row.uuid)}>
				{translate("onecQueueAbort")}
			</Button>
		) : null;
	};

	return (
		<div className={diag.QueueHolders}>
			{holders.length > 0 && (
				<>
					<div className={styles.StatsTitle}>{translate("onecQueueHolders")}</div>
					<SubTableSheets className={diag.QueueSheet} columns={holderColumns} rows={holders} renderCell={renderHolderCell} />
				</>
			)}
			{times.length > 0 && (
				<>
					<Button variant="secondary" active={showTimes} onClick={() => setShowTimes((v) => !v)}>
						{translate("onecQueueTypeTimes")}
					</Button>
					{showTimes && (
						<SubTableSheets className={diag.QueueSheet} columns={TIME_COLUMNS} rows={times} renderCell={durationCellText} defaultSort={{ onecStatAvg: "desc" }} />
					)}
				</>
			)}
		</div>
	);
};

export default QueueHolders;
