/**
 * Базы 1С — ШТАТНЫЙ список и форма элемента (E15/L2–L5).
 *
 * Раньше базы жили самодельной таблицей внутри «Администрирования 1С»: своё открытие
 * элемента, свой предпросмотр, свой множественный выбор. Здесь то же самое сделано общим
 * паттерном — `ModelList` + `ModelForm`, — поэтому список ведёт себя как все остальные:
 * курсорная подгрузка, поиск, сортировка, отметки строк, split-предпросмотр по кнопке
 * «Переключить вид списка», открытие элемента отдельным пейном и «Показать в списке».
 *
 * СОЗДАНИЕ И УДАЛЕНИЕ НЕПРИМЕНИМЫ: базы заводят и удаляют в кластере 1С, а не в панели.
 * Отсюда `hideAddDelete` — тот же режим, что у справочников, наполняемых системой.
 */
import { FC, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ModelList from "src/components/ModelList";
import ModelForm from "src/components/ModelForm";
import Table from "src/components/Table";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import { GroupCol, GroupRow } from "src/components/UI";
import { translate } from "src/i18";
import { asText } from "src/utils/asText";
import { getFormatDate } from "src/utils/datetime";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { fetchBaseExtensions, fetchBaseUsers, fetchSessions } from "src/services/onec/api";
import { QueryError, publishLabel } from "src/models/OneCAdmin/shared";
import BaseGroupCommands from "src/models/OneCAdmin/BaseGroupCommands";
import columnsJson from "./columns.json";

const ENDPOINT = "onec-bases";
const LIST_NAME = "OneCBasesList";

/** Статус базы человеческим языком (значения приходят из реестра сервиса). */
const statusLabel = (v: string): string => {
	const key = { ONLINE: "onecBaseOnline", MISSING: "onecBaseMissing", DISABLED: "onecBaseDisabled", UNKNOWN: "onecBaseUnknown" }[v];
	return key ? translate(key) : v;
};

const extColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "version", type: "string", width: "130px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "purpose", type: "string", width: "150px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "safeMode", type: "string", width: "140px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const userColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "220px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "fullName", type: "string", width: "240px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "disabledLabel", type: "string", width: "120px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "rolesLabel", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const sessionColumns = (): TColumn[] => ([
	{ identifier: "sessionId", type: "string", width: "90px", minWidth: "60px", alignment: "left", visible: true, inlist: true },
	{ identifier: "userName", type: "string", width: "180px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "appId", type: "string", width: "150px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "host", type: "string", width: "150px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "startedAt", type: "string", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Сеансы базы — из общего среза кластера, по UUID базы. Отдельной команды не нужно. */
function useBaseSessions(infobaseId: string) {
	const sessions = useQuery({ queryKey: ["onec", "sessions"], queryFn: fetchSessions });
	return useMemo(
		() => (infobaseId ? (sessions.data?.items ?? []).filter((s) => s.infobase === infobaseId) : []),
		[sessions.data, infobaseId],
	);
}

/**
 * Вкладки формы и предпросмотра — один и тот же набор: в split-виде показывается ровно то,
 * что откроется в форме, без расхождений.
 *
 * Расширения и пользователи НЕ грузятся сами: каждый такой запрос — вход в базу, десятки
 * секунд и занятый сеанс 1С. Их читают кнопкой.
 */
const useBaseTabs = (row: TDataItem) => {
	const baseKey = asText(row.baseKey);
	const [loadExt, setLoadExt] = useState(false);
	const [loadUsers, setLoadUsers] = useState(false);

	// enabled требует ключа базы: без него запрос уходил бы в `/bases//extensions`.
	const ext = useQuery({ queryKey: ["onec", "base-ext", baseKey], queryFn: () => fetchBaseExtensions(baseKey), enabled: loadExt && !!baseKey, staleTime: 0 });
	const users = useQuery({ queryKey: ["onec", "base-users", baseKey], queryFn: () => fetchBaseUsers(baseKey), enabled: loadUsers && !!baseKey, staleTime: 0 });

	const [extCols, setExtCols] = useState<TColumn[]>(() => getModelColumns(extColumns(), "OneCBases_ext"));
	const [userCols, setUserCols] = useState<TColumn[]>(() => getModelColumns(userColumns(), "OneCBases_users"));
	const [sesCols, setSesCols] = useState<TColumn[]>(() => getModelColumns(sessionColumns(), "OneCBases_sessions"));

	const extRows = (ext.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: x.name, name: x.name, version: x.version ?? "—", purpose: x.purpose ?? "—",
		safeMode: x.safeMode == null ? "—" : x.safeMode ? translate("yes") : translate("no"),
	}));
	const extView = useStaticTableView(extRows, { name: "asc" });

	const userRows = (users.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: x.name, name: x.name, fullName: x.fullName || "—",
		disabledLabel: x.disabled ? translate("onecUserDisabled") : translate("onecUserActive"),
		rolesLabel: (x.roles ?? []).join(", ") || "—",
	}));
	const userView = useStaticTableView(userRows, { name: "asc" });

	const own = useBaseSessions(asText(row.infobaseId));
	const sesRows = own.map((s, i) => ({
		id: i + 1, uuid: s.session ?? String(i), sessionId: s.sessionId || "—",
		userName: s.userName || "—", appId: s.appId || "—", host: s.host || "—",
		startedAt: s.startedAt ? getFormatDate(s.startedAt) : "—",
	}));
	const sesView = useStaticTableView(sesRows, { sessionId: "asc" });

	return [
		{
			id: "ext", label: translate("onecTabExtensions"),
			component: (
				<>
				<QueryError error={ext.error} />
				<Table {...buildStaticTableProps({
					componentName: "OneCBases_ext", rows: extView.rows, columns: extCols, setColumns: setExtCols,
					sorting: extView.sorting, search: extView.search,
					isLoading: ext.isLoading || ext.isFetching,
					onReload: () => (loadExt ? void ext.refetch() : setLoadExt(true)),
					extraButtons: loadExt ? undefined : <Button size="sm" onClick={() => setLoadExt(true)}>{translate("onecExtCheck")}</Button>,
				})} />
				</>
			),
		},
		{
			id: "users", label: translate("onecTabUsers"),
			component: (
				<>
				<QueryError error={users.error} />
				<Table {...buildStaticTableProps({
					componentName: "OneCBases_users", rows: userView.rows, columns: userCols, setColumns: setUserCols,
					sorting: userView.sorting, search: userView.search,
					isLoading: users.isLoading || users.isFetching,
					onReload: () => (loadUsers ? void users.refetch() : setLoadUsers(true)),
					extraButtons: loadUsers ? undefined : <Button size="sm" onClick={() => setLoadUsers(true)}>{translate("onecUsersCheck")}</Button>,
				})} />
				</>
			),
		},
		{
			id: "sessions", label: translate("onecTabSessions"),
			component: (
				<Table {...buildStaticTableProps({
					componentName: "OneCBases_sessions", rows: sesView.rows, columns: sesCols, setColumns: setSesCols,
					sorting: sesView.sorting, search: sesView.search,
				})} />
			),
		},
	];
};

/**
 * Форма элемента: шапка полями + вложенные таблицы во вкладках. Только чтение.
 *
 * Пейн передаёт компоненту СЕБЯ (`<Component {...pane} />`), поэтому строка лежит в
 * `data`, а не в корне пропсов: читать props как строку — значит получить пустые поля
 * и пустой ключ базы, с которым запросы уходят в `/bases//extensions`.
 */
export const OneCBasesForm: FC<Partial<TPane>> = (paneProps) => {
	const row = (paneProps.data ?? {}) as TDataItem;
	const tabs = useBaseTabs(row);

	return (
		<ModelForm
			paneId={paneProps.uniqId}
			endpoint={ENDPOINT}
			readonly
			isLoading={false}
			// Реестр наполняется кластером и агентом — править и сохранять нечего.
			onSave={() => {}} onSaveAndClose={() => {}} onClose={() => {}}
			tabs={[
				{
					id: "main", label: translate("general"),
					component: (
						<GroupCol>
							<GroupRow>
								<Field name="ob_key" label={translate("baseKey")} value={asText(row.baseKey)} disabled onChange={() => {}} width="220px" />
								<Field name="ob_name" label={translate("name")} value={asText(row.name) || "—"} disabled onChange={() => {}} />
								<Field name="ob_status" label={translate("status")} value={statusLabel(asText(row.status))} disabled onChange={() => {}} width="170px" />
							</GroupRow>
							<GroupRow>
								<Field name="ob_server" label={translate("onecServer")} value={asText(row.serverName) || "—"} disabled onChange={() => {}} width="220px" />
								<Field name="ob_platform" label={translate("onecVersion")} value={asText(row.onecVersion) || "—"} disabled onChange={() => {}} width="170px" />
								<Field name="ob_ext" label={translate("extensionsCount")}
									value={row.extensionsCount == null ? translate("onecExtNotChecked") : asText(row.extensionsCount)}
									disabled onChange={() => {}} width="170px" />
								<Field name="ob_published" label={translate("onecPublication")}
									value={publishLabel(row.published as boolean | null)} disabled onChange={() => {}} width="170px" />
								<Field name="ob_seen" label={translate("lastSeenAt")}
									value={row.lastSeenAt ? getFormatDate(asText(row.lastSeenAt)) : "—"} disabled onChange={() => {}} width="190px" />
							</GroupRow>
						</GroupCol>
					),
				},
				...tabs,
			]}
		/>
	);
};
OneCBasesForm.displayName = "OneCBasesForm";

/** Вкладки предпросмотра в split-виде — те же, что и в форме. */
const PreviewTabs: FC<{ row: TDataItem }> = ({ row }) => <>{useBaseTabs(row)[0].component}</>;

export const OneCBasesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant, onSelectItem }) => (
	<ModelList
		endpoint={ENDPOINT}
		listName={LIST_NAME}
		columnsJson={columnsJson}
		FormComponent={OneCBasesForm as never}
		getLabel={(d) => asText(d?.baseKey)}
		defaultSort={{ baseKey: "asc" }}
		// Создание и удаление неприменимы: базы приходят из кластера 1С.
		hideAddDelete
		variant={variant}
		onSelectItem={onSelectItem}
		// Состояние публикации хранится булевым (с «не проверялась» = null), а подпись
		// к нему — дело интерфейса: в API текста для человека быть не должно.
		// Значение обёрнуто в <span>, как и штатный рендер ячейки: голая строка ложится
		// прямым потомком ячейки и выпадает из общей вёрстки (обрезка, выравнивание).
		renderCell={(row, col) => (col.identifier === "published"
			? <span>{publishLabel(row.published as boolean | null)}</span>
			: undefined)}
		previewTabs={(row) => [{ id: "ext", label: translate("onecTabExtensions"), component: <PreviewTabs row={row} /> }]}
		// Групповые команды по отмеченным базам: публикация и её снятие, пользователи,
		// расширения. Здесь набор баз уже выбран — уходить за ним на другую вкладку незачем.
		extraButtons={(selected) => <BaseGroupCommands selected={selected} />}
	/>
);
OneCBasesList.displayName = "OneCBasesList";

export default OneCBasesList;
