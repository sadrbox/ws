/**
 * «Администрирование» → «Кластеры 1С» (21.09).
 *
 * ВЫБОР КЛАСТЕРА — В ТУЛБАРЕ ПАНЕЛИ. Сначала сервер выбирался полем сбоку от вкладок, потом списком в левой
 * половине экрана. Оба раза вопрос «над каким кластером я сейчас работаю» решался памятью: поле стояло в стороне,
 * а список при узкой левой половине превращался в четыре колонки мелкого текста. Здесь выбранный кластер стоит
 * ПЕРВЫМ элементом тулбара панели — там же, где у списков лежат их команды, — и рядом с ним состояние его
 * админ-агента и адрес: то есть и «чей это кластер», и «есть ли кому выполнять команды», видно не отводя глаз от
 * кнопок. Выбор строкой и есть выбор сервера для всех запросов панели (serverScope → заголовок X-Onec-Server).
 *
 * РЕЕСТР КЛАСТЕРОВ — ОТДЕЛЬНЫЙ ВИД той же панели (кнопка в тулбаре): там сравнивают серверы между собой, ищут и
 * сортируют. Данные кластера от этого получают всю ширину окна — раньше треть её занимал список из трёх строк.
 *
 * Кластер в панели — это сервер 1С из реестра: его базы, сеансы, соединения, расписание обслуживания и его
 * админ-агент. Агенты как таковые живут в соседнем разделе «Агенты»: там их роли, подключение и настройки.
 */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Tabs from "src/components/Tabs";
import Table from "src/components/Table";
import Toolbar from "src/components/Toolbar";
import { Button } from "src/components/Button";
import { FieldSelect } from "src/components/Field";
import { OneCBasesList } from "src/models/OneCBases";
import SessionsTab from "./SessionsTab";
import ConnectionsTab from "./ConnectionsTab";
import ServerTab from "./ServerTab";
import ExtensionsTab from "./ExtensionsTab";
import UsersTab from "./UsersTab";
import BatchesTab from "./BatchesTab";
import SchedulesTab from "./SchedulesTab";
import ProgressTab from "./ProgressTab";
import { useBatchWatch } from "./progress";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { asText } from "src/utils/asText";
import { withStableIds } from "src/utils/stableRowId";
import { usePaneToolbar } from "src/hooks/usePaneToolbar";
import { fetchServers } from "src/services/onec/api";
import { getOnecServer, setOnecServer } from "src/services/onec/serverScope";
import { ReadonlyNotice, QueryError, useAgents } from "./shared";
import { clusterOptions, clusterRows, clusterSubtitle, pickCluster } from "./clustersView";
import main from "src/styles/main.module.scss";
import styles from "./OneCAdmin.module.scss";

type ClusterTab = "bases" | "cluster" | "extensions" | "users" | "schedules" | "progress";
/** Что показано в теле панели: данные выбранного кластера или реестр самих кластеров. */
type PaneView = "data" | "registry";

const columns = (): TColumn[] => ([
	{ identifier: "clusterName", type: "string", width: "220px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "clusterAgent", type: "string", width: "220px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "clusterBases", type: "number", width: "90px", minWidth: "70px", alignment: "right", visible: true, inlist: true },
	{ identifier: "clusterAddress", type: "string", width: "260px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/**
 * «Кластер» — живое состояние сервера: сеансы, соединения, процессы и лицензии. Внутренние вкладки монтируются по
 * одной: каждая при открытии спрашивает кластер, и раздел стоил бы четырёх команд вместо одной нужной.
 */
const ClusterSection: FC = () => {
	const [inner, setInner] = useState<"sessions" | "connections" | "server">("sessions");
	return (
		<Tabs
			activeTab={inner}
			onTabChange={(id) => setInner(id as typeof inner)}
			tabs={[
				{ id: "sessions", label: translate("onecTabSessions"), component: inner === "sessions" ? <SessionsTab /> : null },
				{ id: "connections", label: translate("onecTabConnections"), component: inner === "connections" ? <ConnectionsTab /> : null },
				{ id: "server", label: translate("onecTabServer"), component: inner === "server" ? <ServerTab /> : null },
			]}
		/>
	);
};

/** «Прогресс» кластера: операции панели и задания сервиса. Процессы агентов — в разделе «Агенты», они про службу. */
const ProgressSection: FC<{ watch: ReturnType<typeof useBatchWatch> }> = ({ watch }) => {
	const [inner, setInner] = useState<"ops" | "batches">("ops");
	return (
		<Tabs
			activeTab={inner}
			onTabChange={(id) => setInner(id as typeof inner)}
			tabs={[
				{ id: "ops", label: translate("onecTabProgress"), component: inner === "ops" ? <ProgressTab isLoading={watch.isFetching} onRefresh={watch.refresh} /> : null },
				{ id: "batches", label: translate("onecTabBatches"), component: inner === "batches" ? <BatchesTab /> : null },
			]}
		/>
	);
};

export const OneCClustersList: FC<{ uniqId?: string }> = ({ uniqId }) => {
	const qc = useQueryClient();
	/*
	 * Наблюдение за командами — на уровне раздела, а не вкладки: команда со вкладки «Базы» идёт минутами, и
	 * переход на соседнюю вкладку не должен обрывать ожидание результата.
	 */
	const watch = useBatchWatch();
	const [tab, setTab] = useState<ClusterTab>("bases");
	const [view, setView] = useState<PaneView>("data");
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(), "OneCAdmin_clusters"));
	const [selected, setSelected] = useState<string | null>(getOnecServer());

	const servers = useQuery({ queryKey: ["onec", "servers"], queryFn: fetchServers, staleTime: 60_000 });
	const agents = useAgents();
	// Номер строки — из идентификатора сервера (utils/stableRowId): появление нового кластера не сдвигает прежние.
	const rows = useMemo(
		() => withStableIds(clusterRows(servers.data?.items ?? [], agents.data?.items ?? []), (r) => r.uuid),
		[servers.data, agents.data],
	);

	/*
	 * ВЫБРАННЫЙ КЛАСТЕР — ОДИН НА ПАНЕЛЬ. Он уходит заголовком в каждый запрос (serverScope), поэтому тулбар и
	 * данные под ним не могут разойтись. Прежний выбор переживает перезагрузку; исчез сервер — берём первый.
	 */
	/*
	 * ПЕРЕЧИТАТЬ ВСЁ, ЧТО ЗАВИСИТ ОТ СЕРВЕРА. Ключей два: `onec` (панель) и `onec-bases` (штатный список баз через
	 * прокси ERP) — забыть второй значит оставить на экране базы прежнего кластера (аудит 21.09).
	 */
	const reload = useCallback(() => {
		/*
		 * Содержимое, адресуемое ИМЕНЕМ базы (пользователи, расширения, роли), выбрасываем из кэша целиком: имя
		 * уникально только внутри сервера, и до прихода нового ответа на экране висели бы данные одноимённой базы
		 * прежнего кластера. Списки самой панели (серверы, агенты) общие — их достаточно пометить устаревшими.
		 */
		qc.removeQueries({
			queryKey: ["onec"],
			predicate: (q) => { const part = q.queryKey[1]; return typeof part !== "string" || !["servers", "agents"].includes(part); },
		});
		void qc.invalidateQueries({ queryKey: ["onec"] });
		void qc.invalidateQueries({ queryKey: ["onec-bases"] });
	}, [qc]);

	const apply = useCallback((id: string) => {
		setOnecServer(id);
		reload();
	}, [reload]);

	useEffect(() => {
		if (!rows.length) return;
		const next = pickCluster(rows, selected);
		if (next === selected || !next) return;
		setSelected(next);
		apply(next);
	}, [rows, selected, apply]);

	/*
	 * ВЫБОР СТРОКОЙ РЕЕСТРА ПРИМЕНЯЕТСЯ С ЗАДЕРЖКОЙ. Строка в реестре меняется и стрелками клавиатуры, а применение
	 * выбора перечитывает живое состояние кластера — то есть шлёт команды в rac и тратит общую квоту обращений.
	 * Полсекунды тишины отделяют «просматриваю реестр» от «выбрал этот кластер». Выбор в тулбаре — наоборот,
	 * однократное осознанное действие, и ждать там нечего (см. chooseNow).
	 */
	const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
	const choose = (id: string | null) => {
		if (!id || id === selected) return;
		setSelected(id);
		if (pending.current) clearTimeout(pending.current);
		pending.current = setTimeout(() => apply(id), 500);
	};
	const chooseNow = (id: string) => {
		if (!id || id === selected) return;
		if (pending.current) clearTimeout(pending.current);
		setSelected(id);
		apply(id);
	};

	const tableView = useStaticTableView(rows, { clusterName: "asc" });
	const current = rows.find((r) => r.uuid === selected) ?? null;
	// Пока кластеров нет (до первой регистрации агента) показывать нечего: реестр объясняет, почему он пуст.
	const showRegistry = view === "registry" || !current;

	/*
	 * ТУЛБАР ПАНЕЛИ (эталон — ClassifiersList): выбор кластера, его состояние и команды в одной строке над данными.
	 * Состояние агента стоит сразу за выбором намеренно: кластер без агента на связи принимает выбор, но не
	 * выполнит ни одной команды, и узнать это лучше до нажатия кнопки, а не из отказа.
	 */
	const paneToolbar = usePaneToolbar(uniqId, (
		<Toolbar
			className={main.PaneToolbarFill}
			right={(
				<>
					<Button onClick={() => setView((v) => (v === "registry" ? "data" : "registry"))}>
						<span>{showRegistry ? translate("onecClustersData") : translate("onecClustersRegistry")}</span>
					</Button>
					<Toolbar.ReloadButton
						onClick={() => { void servers.refetch(); void agents.refetch(); }}
						disabled={servers.isFetching || agents.isFetching}
					/>
				</>
			)}
		>
			<span className={styles.ClusterPickLabel}>{translate("onecClusterPick")}</span>
			<FieldSelect
				name="onec-cluster"
				value={selected ?? ""}
				options={rows.length ? clusterOptions(rows) : [{ value: "", label: translate("onecClusterNotChosen") }]}
				onChange={(e) => chooseNow(e.target.value)}
				disabled={!rows.length}
				style={{ minWidth: "220px" }}
			/>
			{current && (
				<span
					className={styles.ClusterState}
					data-online={current.online ? "yes" : "no"}
					title={translate("onecClusterTarget")}
				>
					<span className={styles.ClusterDot} />
					{current.clusterAgent}
				</span>
			)}
			{current && <span className={styles.ClusterAddress}>{clusterSubtitle(current)}</span>}
		</Toolbar>
	));

	const registry = (
		<>
			<div className={styles.Hint}>{translate("onecClustersHint")}</div>
			<QueryError error={servers.error} noticeKey="onec-clusters" source={translate("OneCClusters")} />
			<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_clusters", rows: tableView.rows, columns: cols, setColumns: setCols,
				sorting: tableView.sorting, search: tableView.search,
				isLoading: servers.isLoading,
				reloading: servers.isFetching && !servers.isLoading,
				onReload: () => { void servers.refetch(); void agents.refetch(); },
				emptyText: translate("onecClustersNone"),
				// Один щелчок выбирает кластер: он же адресат всех запросов панели.
				onActiveRowChange: (r) => choose(r ? asText(r.uuid) : null),
				highlightUuid: selected ?? undefined,
			})} />
		</>
	);

	const data = (
		<Tabs
			activeTab={tab}
			onTabChange={(id) => setTab(id as ClusterTab)}
			tabs={[
				{ id: "bases", label: translate("onecTabBases"), component: tab === "bases" ? <OneCBasesList /> : null },
				{ id: "cluster", label: translate("onecTabCluster"), component: tab === "cluster" ? <ClusterSection /> : null },
				{ id: "extensions", label: translate("onecTabExtensions"), component: tab === "extensions" ? <ExtensionsTab /> : null },
				{ id: "users", label: translate("onecTabUsers"), component: tab === "users" ? <UsersTab /> : null },
				{ id: "schedules", label: translate("onecTabSchedules"), component: tab === "schedules" ? <SchedulesTab /> : null },
				{
					id: "progress",
					label: watch.running ? `${translate("onecTabProgress")} (${watch.running})` : translate("onecTabProgress"),
					component: tab === "progress" ? <ProgressSection watch={watch} /> : null,
				},
			]}
		/>
	);

	return (
		<>
			{paneToolbar}
			<div className={main.PaneFill}>
				{/* «Доступ только на просмотр» — один раз на раздел, а не на каждой вкладке. */}
				<ReadonlyNotice />
				{showRegistry ? registry : data}
			</div>
		</>
	);
};

export default OneCClustersList;
