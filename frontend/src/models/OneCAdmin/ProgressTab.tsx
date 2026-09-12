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
import { FC, useCallback, useMemo, useState } from "react";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { showToast } from "src/components/UIToast";
import { asText } from "src/utils/asText";
import {
	abandonOp, cancelOp, clearFinished, opDuration, opKindLabel, opPercent, opStateLabel,
	useOnecOps,
} from "./progress";
import { formatDuration, queueReason, useQueueStats } from "./queueStats";
import styles from "./OneCAdmin.module.scss";

const opColumns = (): TColumn[] => ([
	{ identifier: "opTitle", type: "string", width: "230px", minWidth: "150px", alignment: "left", visible: true, inlist: true },
	{ identifier: "opKind", type: "string", width: "120px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "opTarget", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "opProgress", type: "string", width: "180px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "opState", type: "string", width: "130px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "opStartedAt", type: "datetime", width: "170px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "opNote", type: "string", width: "320px", minWidth: "150px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

export const ProgressTab: FC<{ onRefresh: () => void; isLoading?: boolean }> = ({ onRefresh, isLoading }) => {
	const ops = useOnecOps();
	/*
	 * ЧЕГО ЖДЁТ ОЧЕРЕДЬ. Команда «в очереди» выглядела так же, как выполняющаяся: не
	 * отличить «агент занят другой базой» от «агента нет на связи», хотя чинится это
	 * по-разному — второе на сервере 1С, первое терпением. Строка отвечает на оба вопроса
	 * сразу: сколько стоит, сколько идёт и почему стоит.
	 */
	const stats = useQueueStats();
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(opColumns(), "OneCAdmin_ops"));

	const rows = useMemo(() => ops.map((o, i) => ({
		id: i + 1, uuid: o.id,
		opTitle: o.title,
		opKind: opKindLabel(o.kind),
		opTarget: o.target,
		// Значение колонки — текст для поиска и сортировки; полосу рисует renderCell.
		opProgress: o.total ? `${o.done} / ${o.total}` : (o.state === "running" ? "…" : "—"),
		opState: opStateLabel(o),
		// Дату рисует таблица: колонка типа datetime, значение — как есть.
		opStartedAt: new Date(o.startedAt).toISOString(),
		opNote: o.note || opDuration(o),
		// Неизвестной доли не бывает: у работы без известного объёма полоса стоит на нуле,
		// а «сколько уже идёт» говорит колонка примечания.
		__percent: opPercent(o) ?? 0,
		__state: o.state,
		__failed: o.failed,
		__id: o.id,
		// Отменить можно только НЕ НАЧАТОЕ: ту команду, что агент забрал, останавливает он.
		__cancelable: o.cancelable,
	})), [ops]);
	const view = useStaticTableView(rows, {});

	const running = ops.filter((o) => o.state === "running").length;
	const finished = ops.length - running;
	/** Строка, выбранная щелчком: её и отменяют — кнопка действует на выбранное. */
	const [active, setActive] = useState<{ id: string; cancelable: number; state: string } | null>(null);

	const cancel = useCallback(async () => {
		if (!active?.cancelable) return;
		const n = await cancelOp(active.id);
		showToast(n
			? `${translate("onecOpCanceled")}: ${n}`
			: translate("onecOpCancelTooLate"), n ? "success" : "warning");
		setActive((a) => (a ? { ...a, cancelable: 0 } : a));
	}, [active]);

	const queueLine = [
		stats.data?.running ? `${translate("onecBatchRunning")}: ${stats.data.running}` : "",
		stats.data?.queued ? `${translate("onecBatchQueuedState")}: ${stats.data.queued}` : "",
		queueReason(stats.data),
		stats.data?.oldestQueuedSecs
			? `${translate("onecQueueOldest")}: ${formatDuration(stats.data.oldestQueuedSecs)}`
			: "",
	].filter(Boolean).join(" · ");

	return (
		<>
			{/* Строка состояния очереди: молчит, когда очереди нет — сообщать «пусто» незачем. */}
			{queueLine && <div className={styles.Hint}>{translate("onecQueueState")}: {queueLine}</div>}
			<Table {...buildStaticTableProps({
			componentName: "OneCAdmin_ops", rows: view.rows, columns: cols, setColumns: setCols,
			sorting: view.sorting, search: view.search, isLoading: false,
			reloading: !!isLoading,
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
			onActiveRowChange: (r) => setActive(r
				? { id: asText(r.__id), cancelable: Number(r.__cancelable ?? 0), state: asText(r.__state) }
				: null),
			extraButtons: (
				<>
					{/*
					  * Отмена — ДО начала выполнения. Команду, которую агент уже забрал,
					  * останавливает он сам на сервере 1С; назвать отменой прекращение
					  * ожидания значило бы соврать о состоянии чужой системы.
					  */}
					<Button variant="danger" disabled={!active?.cancelable}
						title={!active ? translate("onecOpPickFirst")
							: active.cancelable ? `${translate("onecOpCancel")}: ${active.cancelable}`
								: translate("onecOpCancelTooLate")}
						onClick={() => void cancel()}>
						<Icon name="close" /> {translate("onecOpCancel")}
						{active?.cancelable ? ` (${active.cancelable})` : ""}
					</Button>
					{/*
					  * ПРЕКРАТИТЬ НАБЛЮДЕНИЕ — не то же, что отменить. Отмена останавливает
					  * команду на сервере; это убирает запись с экрана. Нужно, когда запись
					  * зависла и держит карточку запертой: команда давно выполнена, а панель
					  * об этом не узнала (задание не отвечало). Подпись говорит прямо, что на
					  * сервере ничего не изменится.
					  */}
					<Button variant="secondary" disabled={!active || active.state !== "running"}
						title={active?.state === "running"
							? translate("onecOpAbandonHint")
							: translate("onecOpAbandonPick")}
						onClick={() => { if (active) { abandonOp(active.id); setActive(null); } }}>
						<Icon name="clear" /> {translate("onecOpAbandon")}
					</Button>
					<Button variant="secondary" disabled={!finished}
						title={finished ? translate("onecOpsClear") : translate("onecOpsNothingToClear")}
						onClick={clearFinished}>
						<Icon name="clear" /> {translate("onecOpsClear")}
					</Button>
				</>
			),
		})} />
		</>
	);
};

export default ProgressTab;
