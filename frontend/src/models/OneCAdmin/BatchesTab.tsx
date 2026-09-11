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
 * ОТМЕЧАЮТ БАЗЫ, А НЕ ЗАДАНИЯ. Отменить нужно бывает и всю операцию, и несколько баз
 * внутри неё — а команда в очереди у каждой базы своя, и отменяются именно они. Поэтому
 * отметка живёт на строке базы, а отметка задания означает «все его базы»: поставили —
 * отметились все, часть — промежуточное состояние. Иначе у задания и его баз было бы две
 * независимые правды, и человеку пришлось бы гадать, что именно отменится.
 *
 * ОТМЕНА — ТОЛЬКО ДО НАЧАЛА ВЫПОЛНЕНИЯ. Команду, которую агент уже забрал, останавливает
 * он сам на сервере 1С; назвать отменой прекращение ожидания значило бы соврать о
 * состоянии чужой системы. Поэтому кнопка называет, сколько из отмеченного ещё можно
 * отменить, и гаснет, когда таких нет.
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
import { cancelCommands, fetchBatches, retryBatch } from "src/services/onec/api";
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
	/**
	 * Отмеченные КОМАНДЫ (по идентификатору): цель отмены. Отмечают базы, а не задания —
	 * отменяется команда конкретной базы, и выбор обязан быть такой же точности.
	 */
	const [picked, setPicked] = useState<Set<string>>(new Set());

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

	/**
	 * Отмена отмеченного — ОДНИМ запросом по списку команд.
	 *
	 * И для всей операции, и для нескольких баз внутри неё это одно и то же действие:
	 * отменить перечисленные команды. Отдельного пути «отменить задание целиком» больше
	 * нет — отметка задания и так означает все его базы, а два пути к одному результату
	 * рано или поздно начинают различаться.
	 */
	const cancel = useMutation({
		mutationFn: (commandIds: string[]) => cancelCommands(commandIds),
		onSuccess: (r) => {
			void after();
			setPicked(new Set());
			showToast(r.canceled
				? `${translate("onecOpCanceled")}: ${r.canceled} / ${r.asked}`
				: translate("onecOpCancelTooLate"),
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
			// Отметка живёт в данных потомка — по ней же считается отметка задания
			// (см. TableBodyRow: группа = «отмечены все вложенные»).
			__selected: !!it.commandId && picked.has(it.commandId),
			__batchId: b.id,
		}));
	}, [items, picked]);

	const toggleChild = useCallback((child: TDataItem, next: boolean) => {
		const id = asText(child.__commandId);
		if (!id) return;
		setPicked((prev) => {
			const nextSet = new Set(prev);
			if (next) nextSet.add(id); else nextSet.delete(id);
			return nextSet;
		});
	}, []);

	/** Что из отмеченного реально отменится: команды, которых агент ещё не забрал. */
	const cancelable = useMemo(() => {
		const ids: string[] = [];
		for (const b of items) {
			for (const it of b.items) {
				if (it.commandId && picked.has(it.commandId) && it.state === "queued") ids.push(it.commandId);
			}
		}
		return ids;
	}, [items, picked]);

	/** Задания, которых коснулась отметка, — цель повтора неуспешных. */
	const touchedBatches = useMemo(() => items.filter(
		(b) => b.items.some((it) => it.commandId && picked.has(it.commandId)),
	), [items, picked]);

	return (
		<>
			<div className={styles.Hint}>{translate("onecBatchesHint")}</div>
			<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_batches", rows: view.rows, columns: cols, setColumns: setCols,
				sorting: view.sorting, search: view.search,
				isLoading: batches.isLoading, reloading: batches.isFetching,
				onReload: () => void batches.refetch(),
				/*
				 * Отмечают БАЗЫ. Отметка задания означает «все его базы» — так устроена
				 * групповая отметка в <Table />, и это ровно то, что нужно: отменить можно и
				 * всю операцию, и несколько баз внутри неё, а отменяются в обоих случаях
				 * команды конкретных баз.
				 */
				selectable: true,
				disableActiveRow: true,
				expandedRowIds: expanded,
				onToggleExpand: (r) => setExpanded((prev) => {
					const key = asText(r.uuid);
					const next = new Set(prev);
					if (!next.delete(key)) next.add(key);
					return next;
				}),
				childRows,
				onChildToggle: (_parent, child, next) => toggleChild(child, next),
				extraButtons: (
					<>
						<Button variant="danger" disabled={!cancelable.length || cancel.isPending}
							title={picked.size
								? (cancelable.length
									? `${translate("onecOpCancel")}: ${cancelable.length} / ${picked.size}`
									: translate("onecOpCancelTooLate"))
								: translate("onecBatchPickFirst")}
							onClick={() => cancel.mutate(cancelable)}>
							<Icon name="close" /> {translate("onecBatchCancelQueued")}
							{cancelable.length ? ` (${cancelable.length})` : ""}
						</Button>
						<Button variant="secondary"
							disabled={!touchedBatches.some((b) => b.failed > 0) || retry.isPending}
							title={touchedBatches.some((b) => b.failed > 0)
								? translate("onecBatchRetryFailed")
								: translate("onecBatchNothingToRetry")}
							onClick={() => touchedBatches.filter((b) => b.failed > 0).forEach((b) => retry.mutate(b.id))}>
							<Icon name="restore" /> {translate("onecBatchRetryFailed")}
						</Button>
					</>
				),
			})} />
		</>
	);
};

export default BatchesTab;
