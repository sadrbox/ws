/**
 * Вкладка «Сервер» (E15): состояние самого сервера 1С — рабочие процессы и лицензии.
 *
 * ЗАЧЕМ. Панель знала про базы и сеансы, но ничего про сервер, на котором всё это живёт.
 * Два разреза закрывают главный пробел в диагностике:
 *   • процессы — память и доступность: видно, когда сервер упирается в ресурсы;
 *   • лицензии — кто их держит. Отказы при одновременных подключениях к базам упирались
 *     именно в лицензии, а увидеть это было нечем.
 *
 * Обе команды читающие и идут через rac — в базы не заходят, поэтому отвечают за секунды,
 * в отличие от всего внутрибазового.
 */
import { FC, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { fetchLicenses, fetchProcesses, type ClusterRow } from "src/services/onec/api";
import { QueryError, VSplit } from "./shared";

/** Колонки задаёт rac; берём то, что есть в ответе, остальное скрыто настройкой таблицы. */
const processColumns = (): TColumn[] => ([
	{ identifier: "host", type: "string", width: "160px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "port", type: "string", width: "90px", minWidth: "70px", alignment: "left", visible: true, inlist: true },
	{ identifier: "pid", type: "string", width: "90px", minWidth: "70px", alignment: "left", visible: true, inlist: true },
	{ identifier: "enabled", type: "string", width: "110px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "running", type: "string", width: "110px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "memorySize", type: "number", width: "140px", minWidth: "100px", alignment: "right", visible: true, inlist: true },
	{ identifier: "avgCallTime", type: "string", width: "130px", minWidth: "90px", alignment: "right", visible: true, inlist: true },
	{ identifier: "connections", type: "number", width: "120px", minWidth: "90px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[]);

const licenseColumns = (): TColumn[] => ([
	{ identifier: "userName", type: "string", width: "180px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "host", type: "string", width: "160px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "appId", type: "string", width: "150px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "licenseType", type: "string", width: "150px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "series", type: "string", width: "160px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Строка rac → строка таблицы: ключи как есть, служебные id добавляем сами. */
const toRows = (items: ClusterRow[]) =>
	items.map((x, i) => ({ id: i + 1, uuid: String(x.process ?? x.connection ?? x.session ?? i), ...x }));

export const ServerTab: FC = () => {
	const processes = useQuery({ queryKey: ["onec", "processes"], queryFn: fetchProcesses });
	const licenses = useQuery({ queryKey: ["onec", "licenses"], queryFn: fetchLicenses });

	const [procCols, setProcCols] = useState<TColumn[]>(() => getModelColumns(processColumns(), "OneCAdmin_processes"));
	const [licCols, setLicCols] = useState<TColumn[]>(() => getModelColumns(licenseColumns(), "OneCAdmin_licenses"));

	const procView = useStaticTableView(toRows(processes.data?.items ?? []), { host: "asc" });
	const licView = useStaticTableView(toRows(licenses.data?.items ?? []), { userName: "asc" });

	return (
		<VSplit
			storageKey="server"
			main={<><QueryError error={processes.error} />
			<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_processes", rows: procView.rows, columns: procCols, setColumns: setProcCols,
				sorting: procView.sorting, search: procView.search,
				isLoading: processes.isLoading || processes.isFetching,
				onReload: () => void processes.refetch(),
			})} /></>}
			side={<><QueryError error={licenses.error} />
			<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_licenses", rows: licView.rows, columns: licCols, setColumns: setLicCols,
				sorting: licView.sorting, search: licView.search,
				isLoading: licenses.isLoading || licenses.isFetching,
				onReload: () => void licenses.refetch(),
			})} /></>}
		/>
	);
};

export default ServerTab;
