/**
 * ЖУРНАЛ ЗАМЕТОК — все заметки одним списком (25.09).
 *
 * ЧЕГО НЕ ХВАТАЛО. Заметки писались в двух местах: кнопкой в форме записи («что важно помнить
 * про эту реализацию») и в области-спутнике по организации. Прочитать их можно было только там
 * же — то есть нужно было ЗАРАНЕЕ знать, к какой записи заметка привязана. А заметка тем и
 * ценна, что пишется мимоходом: через неделю помнят содержание, а не документ, у которого её
 * оставили. Журнала не было вовсе, и найти такую заметку было негде.
 *
 * ЧТО ЗДЕСЬ. Общий список: когда, кто, к какому разделу и записи, текст. Поиск по тексту и
 * автору делает сервер (`GET /notes?search=`) — заметок за год набирается много, и отбирать их
 * в браузере значило бы возить всё подряд.
 *
 * ОТКРЫТЬ ЗАПИСЬ. Заметка хранит endpoint и uuid, а имя раздела и форму по endpoint знает
 * реестр моделей. Поэтому двойной щелчок открывает ту самую запись — ради этого журнал и нужен:
 * «нашёл заметку → попал в документ». Раздел, которого в реестре нет (заметка к организации,
 * например), просто не открывается: ссылка в никуда хуже её отсутствия.
 */
import { FC, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { withStableIds } from "src/utils/stableRowId";
import { asText } from "src/utils/asText";
import { getByEndpoint } from "src/registry/modelRegistry";
import { restorePane } from "src/app/paneRestore";
import { useAppContext } from "src/app/context";
import apiClient from "src/services/api/client";
import main from "src/styles/main.module.scss";

const COMPONENT = "NotesList";

type NoteRow = {
	uuid: string;
	entityType: string;
	entityUuid: string;
	body: string;
	authorName: string | null;
	organizationUuid: string | null;
	createdAt: string;
};

const columns = (): TColumn[] => ([
	{ identifier: "createdAt", type: "datetime", width: "170px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "authorName", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "entityLabel", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "body", type: "string", width: "520px", minWidth: "200px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

export const NotesList: FC = () => {
	const { windows } = useAppContext();
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(), COMPONENT));
	const [search, setSearch] = useState("");

	const q = useQuery({
		queryKey: ["notes", "journal", search],
		queryFn: async () => {
			const r = await apiClient.get<{ items?: NoteRow[] }>("notes", {
				params: search ? { search } : undefined,
			});
			return r.data?.items ?? [];
		},
		staleTime: 30_000,
	});

	const rows = useMemo(() => withStableIds((q.data ?? []).map((n) => {
		const entry = getByEndpoint(n.entityType);
		return {
			uuid: n.uuid,
			createdAt: n.createdAt,
			authorName: n.authorName || "—",
			// Имя раздела знает реестр; сам endpoint показываем, когда раздела в нём нет:
			// «organizations» понятнее, чем пустая клетка.
			entityLabel: entry?.label || n.entityType,
			body: n.body,
			__endpoint: n.entityType,
			__entityUuid: n.entityUuid,
		};
	}), (r) => r.uuid), [q.data]);

	const view = useStaticTableView(rows, { createdAt: "desc" });

	/**
	 * Открыть запись, к которой привязана заметка.
	 *
	 * Тем же механизмом, что ссылка из адресной строки (`restorePane`): он уже умеет поднимать
	 * форму по endpoint и uuid, и заводить для журнала второй способ открытия значило бы
	 * получить два поведения, которые разойдутся.
	 */
	const openRecord = (row: Partial<TDataItem>) => {
		const endpoint = asText(row.__endpoint);
		const uuid = asText(row.__entityUuid);
		const entry = getByEndpoint(endpoint);
		// Раздела нет в реестре (например, заметка к организации) — открывать нечего, и ссылка
		// в никуда хуже её отсутствия.
		if (!entry || !uuid) return;
		void restorePane(
			{ uniqId: "", label: entry.label, restore: { kind: "form", endpoint, uuid } },
			windows.addPane,
		);
	};

	return (
		<div className={main.PaneFill}>
			<Table {...buildStaticTableProps({
				componentName: COMPONENT,
				rows: view.rows, columns: cols, setColumns: setCols,
				sorting: view.sorting,
				// Поиск серверный: заметок за год много, и возить их целиком ради фильтра незачем.
				search: { value: search, onChange: setSearch },
				isLoading: q.isLoading,
				reloading: q.isFetching && !q.isLoading,
				onReload: () => void q.refetch(),
				emptyText: translate("notesNone"),
				onRowClick: openRecord,
			})} />
		</div>
	);
};

NotesList.displayName = "NotesList";
export default NotesList;
