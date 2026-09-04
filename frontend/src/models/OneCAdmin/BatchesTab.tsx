/**
 * Вкладка «Задания» (E15/A4): ход групповых операций по базам.
 *
 * Групповая команда не ждёт ответа в HTTP — сто подключений к 1С туда не укладываются.
 * Поэтому сервис отвечает идентификатором задания, а ход виден здесь: сколько готово,
 * сколько не удалось и ЧТО именно ответила каждая база. Последнее и есть главное:
 * «поставлено 100» бесполезно, если в семнадцати базах не нашлось администратора.
 */
import { FC, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { Button } from "src/components/Button";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { asText } from "src/utils/asText";
import { getFormatDate } from "src/utils/datetime";
import { fetchBatches } from "src/services/onec/api";
import { SectionTitle } from "./shared";

const batchColumns = (): TColumn[] => ([
	{ identifier: "createdAt", type: "string", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "type", type: "string", width: "220px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "progress", type: "string", width: "160px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "failedCount", type: "number", width: "120px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[]);

const itemColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "220px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "state", type: "string", width: "130px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "errorText", type: "string", width: "420px", minWidth: "180px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

export const BatchesTab: FC<{ watchId?: string }> = ({ watchId }) => {
	const [opened, setOpened] = useState<string>(watchId ?? "");

	// Пока есть незавершённые — опрашиваем; когда всё стихло, опрос прекращается сам.
	const batches = useQuery({
		queryKey: ["onec", "batches"],
		queryFn: fetchBatches,
		refetchInterval: (q) => {
			const items = (q.state.data as { items?: { pending: number }[] } | undefined)?.items ?? [];
			return items.some((b) => b.pending > 0) ? 3000 : false;
		},
	});

	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(batchColumns(), "OneCAdmin_batches"));
	const [itemCols, setItemCols] = useState<TColumn[]>(() => getModelColumns(itemColumns(), "OneCAdmin_batchItems"));

	const rowsRaw = useMemo(() => (batches.data?.items ?? []).map((b, i) => ({
		id: i + 1, uuid: b.id, batchId: b.id, createdAt: b.createdAt, type: b.type,
		progress: `${b.done + b.failed} / ${b.total}`,
		failedCount: b.failed,
	})), [batches.data]);
	const sorted = useStaticTableView(rowsRaw, { createdAt: "desc" });
	const rows = sorted.rows.map((r) => ({ ...r, createdAt: getFormatDate(String(r.createdAt)) }));

	const current = (batches.data?.items ?? []).find((b) => b.id === opened) ?? null;
	const itemRows = (current?.items ?? []).map((it, i) => ({
		id: i + 1, uuid: `${it.baseKey ?? i}`, baseKey: it.baseKey ?? "—",
		state: it.state, errorText: it.error ? `${it.error.code}: ${it.error.message}` : "—",
	}));
	const itemSorted = useStaticTableView(itemRows, { baseKey: "asc" });

	return (
		<>
			<SectionTitle>{translate("onecBatchesHint")}</SectionTitle>
			<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_batches", rows, columns: cols, setColumns: setCols,
				sorting: sorted.sorting, search: sorted.search, isLoading: batches.isLoading,
				onReload: () => void batches.refetch(),
				onRowClick: (row: Partial<TDataItem>) => setOpened(asText(row.batchId)),
			})} />

			{current && (
				<>
					<SectionTitle>{translate("onecBatchByBase")}: {current.type}</SectionTitle>
					<Table {...buildStaticTableProps({
						componentName: "OneCAdmin_batchItems", rows: itemSorted.rows, columns: itemCols,
						setColumns: setItemCols, sorting: itemSorted.sorting, search: itemSorted.search,
						onReload: () => void batches.refetch(),
						extraButtons: <Button size="sm" onClick={() => setOpened("")}>{translate("onecBackToSummary")}</Button>,
					})} />
				</>
			)}
		</>
	);
};

export default BatchesTab;
