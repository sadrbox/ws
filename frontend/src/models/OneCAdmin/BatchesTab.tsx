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
import { cancelCommands, fetchBatches, retryBatch } from "src/services/onec/api";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { reportBatchStart } from "./shared";
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
	// Тип datetime, а не строка: дату форматирует таблица (общая настройка формата), и
	// сортировка идёт по самому значению, а не по «12.09.2026» как по тексту.
	{ identifier: "createdAt", type: "datetime", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/**
 * ЧТО ПОВТОРЯТЬ — по отмеченным строкам, а не по заданиям целиком.
 *
 * Отмечают базы; значит, и повторяться должны отмеченные базы. Пока повтор шёл «по
 * заданию», отметка на него не влияла вовсе: человек отмечал одну базу из десяти, а
 * команда уходила во все десять — и это выглядело как «переключатель срабатывает, но
 * делает не то».
 *
 * СЧИТАЕМ ТОЛЬКО failed и expired — ровно то, что повторяет сервис. Отменённую команду он
 * не повторяет (её остановили намеренно), и обещать её повтор кнопкой было бы враньём.
 */
const RETRIABLE = new Set(["failed", "expired"]);

export function retryTargets(
	items: { id: string; items: { commandId: string | null; baseKey: string | null; state: string }[] }[],
	picked: Set<string>,
): { batchId: string; baseKeys: string[] }[] {
	const out: { batchId: string; baseKeys: string[] }[] = [];
	for (const b of items) {
		const keys = b.items
			.filter((it) => it.commandId && picked.has(it.commandId) && RETRIABLE.has(it.state))
			.map((it) => it.baseKey)
			.filter((k): k is string => !!k);
		if (keys.length) out.push({ batchId: b.id, baseKeys: [...new Set(keys)] });
	}
	return out;
}

/** Состояние команды словами: коды состояний — внутренняя кухня очереди. */
const stateLabel = (state: string): string => translate(
	state === "done" ? "onecBatchDone"
		: state === "failed" ? "onecOpFailed"
			: state === "expired" ? "onecBatchExpired"
				: state === "canceled" ? "onecBatchCanceled"
					// Команду не ставили вовсе: некому, нечем или незачем. Это не «ждёт» и не
					// «не удалось» — работы по этой базе не начиналось.
					: state === "skipped" ? "onecBatchSkipped"
						: state === "dispatched" ? "onecBatchRunning"
							: "onecBatchQueuedState",
);

/** Сколько баз задания остались без команды: их не ставили вовсе. */
const notQueued = (b: { items: { state: string }[] }): number =>
	b.items.filter((i) => i.state === "skipped").length;

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
		mutationFn: (t: { batchId: string; baseKeys: string[] }) => retryBatch(t.batchId, t.baseKeys),
		onSuccess: (d) => {
			void after();
			reportBatchStart(d, translate("onecTabBatches"));
		},
		onError: (e) => reportError(e, { source: translate("onecTabBatches") }),
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
		onError: (e) => reportError(e, { source: translate("onecTabBatches") }),
	});

	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(batchColumns(), "OneCAdmin_batches"));

	const rowsRaw = useMemo(() => items.map((b, i) => ({
		id: i + 1, uuid: b.id, batchId: b.id,
		// Заголовок группы — ТИП задания: по нему их и различают в списке.
		title: b.type,
		progress: `${b.done + b.failed} / ${b.total}`,
		failedCount: b.failed ? String(b.failed) : "—",
		/*
		 * ИТОГ НАЗЫВАЕТ ТО, ЧТО ЕСТЬ. «В работе» пишем, только когда работа действительно
		 * идёт: задание, у которого ни одной команды не поставили (агента не было на связи),
		 * два часа показывало «В работе: 1» — без строк, без базы и без работы. Теперь такие
		 * базы приходят строками «не поставлена», а итог говорит, сколько их.
		 */
		outcome: b.pending
			? `${translate("onecBatchPending")}: ${b.pending}`
			: notQueued(b) === b.total
				? `${translate("onecBatchNotQueued")}: ${notQueued(b)}`
				: (b.failed ? `${translate("onecOpFailed")}: ${b.failed}` : translate("onecBatchDone")),
		createdAt: b.createdAt,
		__cancelable: b.cancelable,
		/*
		 * ЗАДАНИЕ, С КОТОРЫМ УЖЕ НИЧЕГО НЕ СДЕЛАТЬ, чекбокса не получает. Команды живут час
		 * и вычищаются, а задание остаётся навсегда: от такого задания не осталось ни одной
		 * команды — ни отменить, ни повторить (сервис повторяет по существующим командам, а
		 * их нет). Раньше его строка щёлкалась и не значила ничего — чекбокс обещал действие,
		 * которого нет.
		 */
		__inert: !b.items.some((it) => it.commandId),
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
			/*
			 * Отметка живёт в данных потомка — по ней же считается отметка задания
			 * (см. TableBodyRow: группа = «отмечены все вложенные»).
			 *
			 * У базы, для которой команды не создалось вовсе (её отсеяли при постановке —
			 * например, в базу не войти), отмечать НЕЧЕГО, и отметки у неё нет совсем:
			 * `undefined` вместо `false`. Разница не косметическая — строка с `false`
			 * попадала в знаменатель «отмечено всё», которого поэтому нельзя было достичь,
			 * и чекбокс в шапке переставал переключаться.
			 */
			...(it.commandId ? { __selected: picked.has(it.commandId) } : {}),
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

	/** Что именно повторится: отмеченные базы, чьи команды не удались. */
	const targets = useMemo(() => retryTargets(items, picked), [items, picked]);
	const retryCount = useMemo(() => targets.reduce((n, t) => n + t.baseKeys.length, 0), [targets]);

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
							disabled={!retryCount || retry.isPending}
							title={retryCount
								? `${translate("onecBatchRetryFailed")}: ${retryCount}`
								: translate("onecBatchNothingToRetry")}
							onClick={() => targets.forEach((t) => retry.mutate(t))}>
							<Icon name="restore" /> {translate("onecBatchRetryFailed")}
							{retryCount ? ` (${retryCount})` : ""}
						</Button>
					</>
				),
			})} />
		</>
	);
};

export default BatchesTab;
