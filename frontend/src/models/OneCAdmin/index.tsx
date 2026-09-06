/**
 * OneCAdmin — администрирование сервера 1С: базы клиентов и их сеансы (E15/A5, P0).
 *
 * Бухгалтерская компания держит до сотни клиентских баз на одном сервере 1С. Панель
 * показывает их состояние и позволяет две операции по сеансам: снять сеанс и закрыть вход
 * в базу. Всё это идёт через AI Service (`/v1/onec/*`) к админ-агенту, который работает с
 * кластером утилитой `rac` — из браузера в кластер никто не ходит.
 *
 * ЧТО ОТКУДА (правило одно на всю панель). В кластер 1С ходит ТОЛЬКО агент, и только по
 * явной команде сервиса; браузер не знает про 1С ничего и разговаривает с `/v1/onec/*`.
 * Данные делятся на три вида, и это определяет, что вызывает обращение к 1С:
 *
 *   1. РЕЕСТР (базы, сводки по расширениям и пользователям) — таблицы БД сервиса.
 *      Наполняются heartbeat'ом агента и результатами команд. Открытие вкладки, прокрутка,
 *      сортировка, поиск и отбор по строке слева читают реестр и в 1С НЕ ходят.
 *   2. ЖИВОЕ СОСТОЯНИЕ (сеансы, соединения, блокировки, процессы, лицензии) — всегда
 *      команда в кластер: список часовой давности здесь бесполезен. Кэша нет (staleTime: 0).
 *   3. СОДЕРЖИМОЕ БАЗЫ (пользователи и расширения конкретной ИБ) — вход в базу, десятки
 *      секунд и занятый сеанс 1С. Само не грузится НИКОГДА: только по кнопкам «Проверить
 *      пользователей» / «Проверить расширения» и «Обновить» в таблице. Прочитанное оседает
 *      в реестре и дальше показывается оттуда — рядом видно, когда его последний раз видели.
 *
 * Итого в 1С стучат ровно четыре жеста: «Обновить из кластера» (полный срез баз),
 * «Проверить пользователей»/«Проверить расширения» (по отмеченным базам), «Обновить» в
 * таблице живого состояния и сама изменяющая команда. Двойной клик по строке и переключение
 * вкладок запросов в кластер не порождают.
 *
 * ПОДТВЕРЖДЕНИЯ. Снятие сеанса и блокировка входа необратимы для того, кто в этот момент
 * работает в базе, поэтому обе операции проходят через модальное окно с явным «Да».
 */
import React, { FC, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { asText } from "src/utils/asText";
import Table from "src/components/Table";
import Tabs from "src/components/Tabs";
import Modal from "src/components/Modal";
import { Button } from "src/components/Button";
import { Field, FieldSelect } from "src/components/Field";
import { showToast } from "src/components/UIToast";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { getFormatDate } from "src/utils/datetime";
import {
	fetchBases, refreshBases, fetchSessions, terminateSession, setSessionsLock,
	type ClusterRow, type OnecBase,
} from "src/services/onec/api";
import { QueryError } from "./shared";
import { OneCBasesList } from "src/models/OneCBases";
import ConnectionsTab from "./ConnectionsTab";
import ServerTab from "./ServerTab";
import ExtensionsTab from "./ExtensionsTab";
import UsersTab from "./UsersTab";
import BatchesTab from "./BatchesTab";
import AgentsTab from "./AgentsTab";
import styles from "./OneCAdmin.module.scss";
import main from "src/styles/main.module.scss";

type Tab = "bases" | "sessions" | "connections" | "server" | "extensions" | "users" | "batches" | "agents";


const sessionsColumns = (): TColumn[] => ([
	{ identifier: "sessionId", type: "string", width: "90px", minWidth: "60px", alignment: "left", visible: true, inlist: true },
	{ identifier: "userName", type: "string", width: "180px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "appId", type: "string", width: "150px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "host", type: "string", width: "150px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "startedAt", type: "string", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "lastActiveAt", type: "string", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);


/** Дата от rac → формат приложения. Нераспознанное показываем как пришло: лучше сырая
 *  строка, чем «—» вместо реального значения (у разных версий платформы формат разный). */
const onecDate = (v: string | undefined | null): string => {
	if (!v) return "—";
	const t = Date.parse(v);
	return Number.isNaN(t) ? v : getFormatDate(new Date(t).toISOString());
};

/** Ошибку сервиса показываем как есть: её текст написан для человека. */
const toastError = (e: unknown) => showToast(e instanceof Error ? e.message : String(e), "error");

export const OneCAdminList: FC = () => {
	const qc = useQueryClient();
	const [tab, setTab] = useState<Tab>("bases");
	// Запущенное задание открываем сразу: иначе групповая операция уходит «в никуда».
	const [watchBatch, setWatchBatch] = useState<string>("");
	const [baseFilter, setBaseFilter] = useState<string>("");
	const [sessionColumns, setSessionColumns] = useState<TColumn[]>(() => getModelColumns(sessionsColumns(), "OneCAdmin_sessions"));
	const [confirm, setConfirm] = useState<null | { kind: "terminate"; session: ClusterRow } | { kind: "terminateMany"; ids: string[] } | { kind: "lock"; base: OnecBase; enabled: boolean }>(null);
	/** UUID отмеченных сеансов — цель групповой команды «Завершить сеансы». */
	const [pickedSessions, setPickedSessions] = useState<string[]>([]);
	const [lockMessage, setLockMessage] = useState("");

	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases });
	const sessions = useQuery({
		// Срез всего кластера; отбор по базе — ниже, на месте (см. fetchSessions).
		queryKey: ["onec", "sessions"],
		queryFn: fetchSessions,
		enabled: tab === "sessions",
		// Сеансы живут секундами: закэшированный список вводит в заблуждение.
		staleTime: 0,
	});

	const refresh = useMutation({
		mutationFn: refreshBases,
		onSuccess: (data) => {
			qc.setQueryData(["onec", "bases"], data);
			showToast(translate("onecBasesRefreshed"), "success");
		},
		onError: toastError,
	});

	const terminate = useMutation({
		// sessionId здесь — UUID сеанса кластера (см. вызов ниже), а не его номер.
		mutationFn: (p: { sessionId: string; baseKey?: string }) => terminateSession(p.sessionId, p.baseKey),
		onSuccess: () => {
			showToast(translate("onecSessionTerminated"), "success");
			void sessions.refetch();
		},
		onError: toastError,
	});

	/**
	 * Групповое снятие: последовательно, а не пачкой. Каждое снятие — отдельная команда
	 * агенту, и параллелить их незачем: операция мгновенная, зато при ошибке видно,
	 * на каком сеансе споткнулись.
	 */
	const terminateMany = useMutation({
		mutationFn: async (ids: string[]) => {
			let ok = 0;
			const failed: string[] = [];
			for (const id of ids) {
				try { await terminateSession(id, baseFilter || undefined); ok += 1; }
				catch { failed.push(id); }
			}
			return { ok, failed };
		},
		onSuccess: (r) => {
			showToast(r.failed.length
				? `${translate("onecSessionTerminated")}: ${r.ok}/${r.ok + r.failed.length}`
				: `${translate("onecSessionTerminated")}: ${r.ok}`,
				r.failed.length ? "warning" : "success");
			setPickedSessions([]);
			void sessions.refetch();
		},
		onError: toastError,
	});

	const lock = useMutation({
		mutationFn: (p: { baseKey: string; enabled: boolean; message?: string }) => setSessionsLock(p.baseKey, p.enabled, p.message),
		onSuccess: (_d, p) => {
			showToast(p.enabled ? translate("onecLockEnabled") : translate("onecLockDisabled"), "success");
			void bases.refetch();
		},
		onError: toastError,
	});


	// Сеансы выбранной базы: строка кластера ссылается на базу по UUID (поле infobase).
	const sessionSource = useMemo(() => {
		const all = sessions.data?.items ?? [];
		if (!baseFilter) return all;
		const uuid = (bases.data?.items ?? []).find((b) => b.key === baseFilter)?.infobaseId;
		// UUID ещё не знаем (срез кластера не приносил его) — показываем всё, а не пустоту:
		// пустой список выглядел бы как «сеансов нет», что было бы неправдой.
		return uuid ? all.filter((s) => s.infobase === uuid) : all;
	}, [sessions.data, bases.data, baseFilter]);

	const sessionRows = useMemo(() => sessionSource.map((s, i) => ({
		id: i + 1,
		uuid: s.session ?? String(i),
		sessionId: s.sessionId ?? "",
		userName: s.userName || "",
		appId: s.appId || "",
		host: s.host || "",
		startedAt: s.startedAt || "",
		lastActiveAt: s.lastActiveAt || "",
	})), [sessionSource]);

	// Сортировка обеих таблиц — на клиенте: данные целиком в памяти.
	const sessionsSorted = useStaticTableView(sessionRows, { startedAt: "desc" });


	const sessionRowsView = useMemo(() => sessionsSorted.rows.map((r) => ({
		...r,
		sessionId: r.sessionId || "—",
		userName: r.userName || "—",
		appId: r.appId || "—",
		host: r.host || "—",
		// Даты сеансов приходят от rac как есть (ISO); показываем в формате приложения.
		startedAt: onecDate(r.startedAt),
		lastActiveAt: onecDate(r.lastActiveAt),
	})), [sessionsSorted.rows]);


	const askTerminate = useCallback((row: Partial<TDataItem>) => {
		const raw = sessionSource.find((s) => (s.sessionId ?? "") === asText(row.sessionId));
		if (raw) setConfirm({ kind: "terminate", session: raw });
	}, [sessionSource]);


	const selectedBase = useMemo(
		() => (bases.data?.items ?? []).find((b) => b.key === baseFilter) ?? null,
		[bases.data, baseFilter],
	);

	// Таблица баз — одна на оба вида (обычный и раздельный), чтобы колонки, сортировка и
	// набор кнопок не разошлись между ними.
	// Вкладки — общий <Tabs> (тот же вид, что в формах), а не самодельные кнопки.
	// Режим управляемый: клик по базе переводит на её сеансы, а не только клик по вкладке.
	const tabs = useMemo(() => [
		{
			id: "bases",
			label: translate("onecTabBases"),
			// Штатный список: ModelList даёт отметки строк, поиск, сортировку, курсорную
			// подгрузку, предпросмотр по «Переключить вид списка» и открытие карточки
			// отдельным пейном. Своя таблица здесь была ровно тем же, но хуже.
			component: <OneCBasesList />,
		},
		{
			id: "sessions",
			label: translate("onecTabSessions"),
			component: (
				<>
					<QueryError error={sessions.error} />
					<Table
						{...buildStaticTableProps({
							componentName: "OneCAdmin_sessions",
							rows: sessionRowsView,
							sorting: sessionsSorted.sorting,
							search: sessionsSorted.search,
							columns: sessionColumns,
							setColumns: setSessionColumns,
							isLoading: sessions.isLoading || sessions.isFetching || terminate.isPending,
							onReload: () => void sessions.refetch(),
							onRowClick: askTerminate,
							selectable: true,
							// В отметках нужен UUID сеанса (rac адресует им), а не номер.
							onSelectionChange: (sel, all) =>
								setPickedSessions(all.filter((r) => sel.has(Number(r.id))).map((r) => asText(r.uuid))),
							// Фильтр по базе и блокировка входа — в штатный слот кнопок таблицы,
							// а не в отдельную полосу над ней: свой ряд контролов ломал ритм списка.
							extraButtons: (
								<>
									{pickedSessions.length > 0 && (
										<Button size="sm" variant="danger"
											onClick={() => setConfirm({ kind: "terminateMany", ids: pickedSessions })}>
											{translate("onecTerminateMany")} ({pickedSessions.length})
										</Button>
									)}
									<FieldSelect
										name="onec_base_filter"
										value={baseFilter}
										onChange={(e) => setBaseFilter(e.target.value)}
										options={[
											{ value: "", label: translate("onecAllBases") },
											...(bases.data?.items ?? []).map((b) => ({ value: b.key, label: b.key })),
										]}
									// size="sm"
									/>
									{selectedBase && (
										<Button
											onClick={() => { setLockMessage(""); setConfirm({ kind: "lock", base: selectedBase, enabled: true }); }}>
											{translate("onecLockSessions")}
										</Button>
									)}
									{selectedBase && (
										<Button
											onClick={() => setConfirm({ kind: "lock", base: selectedBase, enabled: false })}>
											{translate("onecUnlockSessions")}
										</Button>
									)}
								</>
							),
						})}
					/>
					<div className={styles.Hint}>{translate("onecSessionsHint")}</div>
				</>
			),
		},
		{
			id: "connections",
			label: translate("onecTabConnections"),
			component: <ConnectionsTab />,
		},
		{
			id: "server",
			label: translate("onecTabServer"),
			component: <ServerTab />,
		},
		{
			id: "extensions",
			label: translate("onecTabExtensions"),
			component: <ExtensionsTab onBatchStarted={(id) => { setWatchBatch(id); setTab("batches"); }} />,
		},
		{
			id: "users",
			label: translate("onecTabUsers"),
			component: <UsersTab onBatchStarted={(id) => { setWatchBatch(id); setTab("batches"); }} />,
		},
		{
			id: "batches",
			label: translate("onecTabBatches"),
			component: <BatchesTab watchId={watchBatch} />,
		},
		{
			id: "agents",
			label: translate("onecTabAgents"),
			component: <AgentsTab />,
		},
	], [watchBatch, sessionRowsView, sessionsSorted.sorting, sessionColumns,
		baseFilter, selectedBase, bases, sessions, refresh, terminate.isPending, askTerminate]);

	return (
		<div className={main.PaneFill}>
			<Tabs tabs={tabs} activeTab={tab} onTabChange={(id) => setTab(id as Tab)} />

			{confirm?.kind === "terminate" && (
				<Modal
					title={translate("onecTerminateTitle")}
					onClose={() => setConfirm(null)}
					onApply={() => {
						// rac адресует сеанс UUID (поле `session`), а НЕ номером (`sessionId`):
						// с номером он отвечает «Ошибка разбора параметра: session». Номер
						// оставляем только для показа — человек узнаёт сеанс по нему.
						terminate.mutate({ sessionId: confirm.session.session ?? "", baseKey: baseFilter || undefined });
						setConfirm(null);
					}}
				>
					<div className={styles.ConfirmText}>
						{translate("onecTerminateQuestion")}
						<div className={styles.ConfirmDetails}>
							{translate("onecSessionId")}: {confirm.session.sessionId ?? "—"}
							{" · "}{translate("onecSessionUser")}: {confirm.session.userName || "—"}
							{" · "}{translate("onecSessionHost")}: {confirm.session.host || "—"}
						</div>
						<div className={styles.ConfirmWarning}>{translate("onecTerminateWarning")}</div>
					</div>
				</Modal>
			)}

			{confirm?.kind === "terminateMany" && (
				<Modal
					title={translate("onecTerminateMany")}
					onClose={() => setConfirm(null)}
					onApply={() => { terminateMany.mutate(confirm.ids); setConfirm(null); }}
				>
					<div className={styles.ConfirmText}>
						{translate("onecTerminateQuestion")}
						<div className={styles.ConfirmDetails}>{translate("onecSessions")}: {confirm.ids.length}</div>
						<div className={styles.ConfirmWarning}>{translate("onecTerminateWarning")}</div>
					</div>
				</Modal>
			)}

			{confirm?.kind === "lock" && (
				<Modal
					title={confirm.enabled ? translate("onecLockTitle") : translate("onecUnlockTitle")}
					onClose={() => setConfirm(null)}
					onApply={() => {
						lock.mutate({ baseKey: confirm.base.key, enabled: confirm.enabled, message: confirm.enabled ? lockMessage : undefined });
						setConfirm(null);
					}}
				>
					<div className={styles.ConfirmText}>
						{confirm.enabled ? translate("onecLockQuestion") : translate("onecUnlockQuestion")}
						<div className={styles.ConfirmDetails}>{translate("onecBase")}: {confirm.base.key}</div>
						{confirm.enabled && (
							<>
								<Field
									name="onec_lock_message"
									value={lockMessage}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLockMessage(e.target.value)}
									placeholder={translate("onecLockMessagePlaceholder")}
								/>
								<div className={styles.ConfirmWarning}>{translate("onecLockWarning")}</div>
							</>
						)}
					</div>
				</Modal>
			)}
		</div>
	);
};

export default OneCAdminList;
