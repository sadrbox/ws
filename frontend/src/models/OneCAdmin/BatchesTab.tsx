/**
 * «Задания» — групповые операции по базам: ход, итог и управление очередью.
 *
 * Групповая команда не ждёт ответа в HTTP: сто подключений к 1С туда не укладываются.
 * Сервис отвечает идентификатором задания, а ход виден здесь — сколько готово, сколько не
 * удалось и ЧТО именно ответила каждая база. Последнее и есть главное: «поставлено 100»
 * бесполезно, если в семнадцати базах не нашлось администратора.
 *
 * СТРОКА — ЗАДАНИЕ, ВЛОЖЕННЫЕ СТРОКИ — БАЗЫ. Раньше это были две отдельные таблицы:
 * список заданий сверху и разбор выбранного снизу. Чтобы увидеть, где именно отказало,
 * приходилось щёлкать по заданию и терять из виду остальные; сравнить два задания было
 * нельзя вовсе. Теперь задание раскрывается своими базами на месте.
 *
 * ОТМЕНА — ТОЛЬКО ДО НАЧАЛА ВЫПОЛНЕНИЯ, и это видно построчно. Команду, которую агент уже
 * забрал, останавливает он сам на сервере 1С; назвать отменой прекращение ожидания значило
 * бы соврать о состоянии чужой системы. Поэтому в строке базы отмена доступна, пока команда
 * `queued`, а у задания кнопка называет, сколько команд ещё можно отменить.
 */
import { FC, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { asText } from "src/utils/asText";
import { getFormatDate } from "src/utils/datetime";
import {
	cancelBatch, cancelCommands, fetchBatches, retryBatch, type BatchProgress,
} from "src/services/onec/api";
import { showToast } from "src/components/UIToast";
import styles from "./OneCAdmin.module.scss";

/**
 * Колонки одни на задание и на базу: вложенные строки рисуются тем же TableBodyRow.
 * «Задание» у потомка показывает базу, «Ход» — её состояние, «Итог» — ответ или ошибку.
 */
const batchColumns = (): TColumn[] => ([
	{ identifier: "title", type: "string", width: "280px", minWidth: "160px", alignment: "left", visible: true, inlist: true },
	{ identifier: "progress", type: "string", width: "150px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "failedCount", type: "string", width: "120px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "outcome", type: "string", width: "420px", minWidth: "180px", alignment: "left", visible: true, inlist: true },
	{ identifier: "createdAt", type: "string", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Состояние команды словами: коды состояний — внутренняя кухня очереди. */
const stateLabel = (state: string): string => translate(
	state === "done" ? "onecBatchDone"
		: state === "failed" ? "onecOpFailed"
			: state === "expired" ? "onecBatchExpired"
				: state === "canceled" ? "onecBatchCanceled"
					: state === "dispatched" ? "onecBatchRunning"
						: "onecBatchQueuedState",
);

export const BatchesTab: FC = () => {
	const qc = useQueryClient();
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	/** Отмеченные задания — цель групповых действий панели («Отменить», «Повторить»). */
	const [picked, setPicked] = useState<BatchProgress[]>([]);

	// Пока есть незавершённые — опрашиваем; когда всё стихло, опрос прекращается сам.
	const batches = useQuery({
		queryKey: ["onec", "batches"],
		queryFn: fetchBatches,
		refetchInterval: (q) => {
			const items = (q.state.data as { items?: { pending: number }[] } | undefined)?.items ?? [];
			return items.some((b) => b.pending > 0) ? 3000 : false;
		},
	});
	const items = useMemo(() => batches.data?.items ?? [], [batches.data]);

	const after = useCallback(async () => {
		await batches.refetch();
		// Результат команды меняет реестр: список баз и сводки перечитываем.
		void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
	}, [batches, qc]);

	// Повтор только неуспешных: при ста базах пересобрать десяток отказов руками нереально.
	const retry = useMutation({
		mutationFn: retryBatch,
		onSuccess: (d) => {
			void after();
			showToast(`${translate("onecBatchQueued")}: ${d.queued}/${d.total}`, d.queued ? "success" : "warning");
		},
		onError: (e) => showToast(e instanceof Error ? e.message : translate("unknownError"), "error"),
	});

	const cancel = useMutation({
		mutationFn: async (batchIds: string[]) => {
			let canceled = 0;
			for (const id of batchIds) canceled += (await cancelBatch(id)).canceled;
			return canceled;
		},
		onSuccess: (n) => {
			void after();
			showToast(n ? `${translate("onecOpCanceled")}: ${n}` : translate("onecOpCancelTooLate"),
				n ? "success" : "warning");
		},
		onError: (e) => showToast(e instanceof Error ? e.message : translate("unknownError"), "error"),
	});

	/** Отмена ОДНОЙ базы задания: её команда ещё не начата. */
	const cancelOne = useMutation({
		mutationFn: (commandId: string) => cancelCommands([commandId]),
		onSuccess: (r) => {
			void after();
			showToast(r.canceled ? `${translate("onecOpCanceled")}: ${r.canceled}` : translate("onecOpCancelTooLate"),
				r.canceled ? "success" : "warning");
		},
		onError: (e) => showToast(e instanceof Error ? e.message : translate("unknownError"), "error"),
	});

	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(batchColumns(), "OneCAdmin_batches"));

	const rowsRaw = useMemo(() => items.map((b, i) => ({
		id: i + 1, uuid: b.id, batchId: b.id,
		// Заголовок группы — ТИП задания: по нему их и различают в списке.
		title: b.type,
		progress: `${b.done + b.failed} / ${b.total}`,
		failedCount: b.failed ? String(b.failed) : "—",
		outcome: b.pending
			? `${translate("onecBatchPending")}: ${b.pending}`
			: (b.failed ? `${translate("onecOpFailed")}: ${b.failed}` : translate("onecBatchDone")),
		createdAt: getFormatDate(b.createdAt),
		__cancelable: b.cancelable,
	})), [items]);
	const view = useStaticTableView(rowsRaw, { createdAt: "desc" });

	/**
	 * Вложенные строки — базы задания. Рисуются тем же TableBodyRow и в тех же колонках,
	 * поэтому «Задание» у потомка показывает базу, а «Итог» — ответ или ошибку.
	 */
	const childRows = useCallback((r: TDataItem): TDataItem[] => {
		const b = items.find((x) => x.id === asText(r.batchId));
		if (!b) return [];
		return b.items.map((it, i) => ({
			// Отрицательные идентификаторы: пространство строк у потомков своё и не должно
			// пересечься с идентификаторами заданий.
			id: -(i + 1), uuid: `${b.id}|${it.baseKey ?? i}`,
			title: it.baseKey ?? "—",
			progress: stateLabel(it.state),
			failedCount: "",
			outcome: it.error ? `${it.error.code}: ${it.error.message}` : (it.outcome || "—"),
			createdAt: "",
			__commandId: it.commandId ?? "",
			// Отменить можно только не начатое: агент ещё не забирал эту команду.
			__cancelable: it.state === "queued" ? 1 : 0,
		}));
	}, [items]);

	/** Активная строка: по ней работают кнопки, действующие на одну запись. */
	const [active, setActive] = useState<TDataItem | null>(null);
	const activeCancelable = Number(active?.__cancelable ?? 0) > 0;
	const activeCommand = asText(active?.__commandId);

	const pickedCancelable = picked.reduce((n, b) => n + (b.cancelable ?? 0), 0);
	const pickedFailed = picked.reduce((n, b) => n + b.failed, 0);

	return (
		<>
			<div className={styles.Hint}>{translate("onecBatchesHint")}</div>
			<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_batches", rows: view.rows, columns: cols, setColumns: setCols,
				sorting: view.sorting, search: view.search,
				isLoading: batches.isLoading, reloading: batches.isFetching,
				onReload: () => void batches.refetch(),
				// Отметки — для действий сразу над несколькими заданиями.
				selectable: true,
				onSelectionChange: (sel, all) => setPicked(
					all.filter((r) => sel.has(Number(r.id)))
						.map((r) => items.find((b) => b.id === asText(r.batchId)))
						.filter((b): b is BatchProgress => !!b),
				),
				onActiveRowChange: (r) => setActive(r ?? null),
				// Раскрывает задание базами шеврон в ячейке группы: одиночный клик по строке
				// не должен разворачивать группы — им ходят по списку, в том числе стрелками.
				expandedRowIds: expanded,
				onToggleExpand: (r) => setExpanded((prev) => {
					const key = asText(r.uuid);
					const next = new Set(prev);
					if (!next.delete(key)) next.add(key);
					return next;
				}),
				childRows,
				extraButtons: (
					<>
						{/* Отмена ОДНОЙ базы — когда выбрана вложенная строка. */}
						{activeCommand && (
							<Button variant="danger" disabled={!activeCancelable || cancelOne.isPending}
								title={activeCancelable
									? `${translate("onecOpCancel")}: ${asText(active?.title)}`
									: translate("onecOpCancelTooLate")}
								onClick={() => cancelOne.mutate(activeCommand)}>
								<Icon name="close" /> {translate("onecOpCancel")}: {asText(active?.title)}
							</Button>
						)}
						<Button variant="danger" disabled={!pickedCancelable || cancel.isPending}
							title={picked.length
								? (pickedCancelable ? `${translate("onecOpCancel")}: ${pickedCancelable}` : translate("onecOpCancelTooLate"))
								: translate("onecBatchPickFirst")}
							onClick={() => cancel.mutate(picked.map((b) => b.id))}>
							<Icon name="close" /> {translate("onecBatchCancelQueued")}
							{pickedCancelable ? ` (${pickedCancelable})` : ""}
						</Button>
						<Button variant="secondary" disabled={!pickedFailed || retry.isPending}
							title={pickedFailed
								? `${translate("onecBatchRetryFailed")}: ${pickedFailed}`
								: translate("onecBatchNothingToRetry")}
							onClick={() => picked.forEach((b) => retry.mutate(b.id))}>
							<Icon name="restore" /> {translate("onecBatchRetryFailed")}
							{pickedFailed ? ` (${pickedFailed})` : ""}
						</Button>
					</>
				),
			})} />
		</>
	);
};

export default BatchesTab;
