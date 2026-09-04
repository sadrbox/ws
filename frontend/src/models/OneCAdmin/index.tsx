/**
 * OneCAdmin — администрирование сервера 1С: базы клиентов и их сеансы (E15/A5, P0).
 *
 * Бухгалтерская компания держит до сотни клиентских баз на одном сервере 1С. Панель
 * показывает их состояние и позволяет две операции по сеансам: снять сеанс и закрыть вход
 * в базу. Всё это идёт через AI Service (`/v1/onec/*`) к админ-агенту, который работает с
 * кластером утилитой `rac` — из браузера в кластер никто не ходит.
 *
 * ЧТО ОТКУДА. Список баз берётся из реестра сервиса, а не опросом кластера на каждый показ:
 * состояние приходит с heartbeat агента, а сто баз опрашивать при каждом открытии вкладки
 * незачем. Кнопка «Обновить из кластера» существует для случая, когда ждать heartbeat не
 * хочется. Сеансы, наоборот, всегда спрашиваются вживую: список часовой давности бесполезен.
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
import ExtensionsTab from "./ExtensionsTab";
import UsersTab from "./UsersTab";
import BatchesTab from "./BatchesTab";
import styles from "./OneCAdmin.module.scss";
import main from "src/styles/main.module.scss";

type Tab = "bases" | "sessions" | "extensions" | "users" | "batches";

const basesColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "220px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "status", type: "string", width: "110px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "sessionsCount", type: "number", width: "100px", minWidth: "70px", alignment: "right", visible: true, inlist: true },
	{ identifier: "onecVersion", type: "string", width: "120px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "extensionsCount", type: "number", width: "130px", minWidth: "90px", alignment: "right", visible: true, inlist: true },
	{ identifier: "lastSeenAt", type: "string", width: "160px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

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
	const [baseColumns, setBaseColumns] = useState<TColumn[]>(() => getModelColumns(basesColumns(), "OneCAdmin_bases"));
	const [sessionColumns, setSessionColumns] = useState<TColumn[]>(() => getModelColumns(sessionsColumns(), "OneCAdmin_sessions"));
	const [confirm, setConfirm] = useState<null | { kind: "terminate"; session: ClusterRow } | { kind: "lock"; base: OnecBase; enabled: boolean }>(null);
	const [lockMessage, setLockMessage] = useState("");

	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases });
	const sessions = useQuery({
		queryKey: ["onec", "sessions", baseFilter],
		queryFn: () => fetchSessions(baseFilter || undefined),
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

	const lock = useMutation({
		mutationFn: (p: { baseKey: string; enabled: boolean; message?: string }) => setSessionsLock(p.baseKey, p.enabled, p.message),
		onSuccess: (_d, p) => {
			showToast(p.enabled ? translate("onecLockEnabled") : translate("onecLockDisabled"), "success");
			void bases.refetch();
		},
		onError: toastError,
	});

	// СЫРЫЕ значения — их и сортируем: дату нельзя сортировать после форматирования
	// («04.09.2026» сравнивалось бы посимвольно, т.е. по дню, а не по времени), а
	// прочерк вместо числа сеансов превращал бы числовое сравнение в строковое («10» < «9»).
	// null компаратор отправляет в конец — ровно то, что нужно для «нет данных».
	const baseRowsRaw = useMemo(() => (bases.data?.items ?? []).map((b, i) => ({
		id: i + 1,
		uuid: b.id,
		baseKey: b.key,
		name: b.name || "",
		status: b.status,
		sessionsCount: b.sessionsCount ?? null,
		onecVersion: b.onecVersion ?? null,
		extensionsCount: b.extensionsCount,
		lastSeenAt: b.lastSeenAt ?? null,
	})), [bases.data]);

	const sessionRows = useMemo(() => (sessions.data?.items ?? []).map((s, i) => ({
		id: i + 1,
		uuid: s.session ?? String(i),
		sessionId: s.sessionId ?? "",
		userName: s.userName || "",
		appId: s.appId || "",
		host: s.host || "",
		startedAt: s.startedAt || "",
		lastActiveAt: s.lastActiveAt || "",
	})), [sessions.data]);

	// Сортировка обеих таблиц — на клиенте: данные целиком в памяти.
	const basesSorted = useStaticTableView(baseRowsRaw, { baseKey: "asc" });
	const sessionsSorted = useStaticTableView(sessionRows, { startedAt: "desc" });

	// Формат — ПОСЛЕ сортировки, только для показа.
	const baseRows = useMemo(() => basesSorted.rows.map((r) => ({
		...r,
		name: r.name || "—",
		sessionsCount: r.sessionsCount ?? "—",
		onecVersion: r.onecVersion ?? "—",
		// null ≠ «не установлено»: базу просто ещё не проверяли. Утверждать обратное —
		// врать про сто баз разом.
		extensionsCount: r.extensionsCount ?? translate("onecExtNotChecked"),
		lastSeenAt: r.lastSeenAt ? getFormatDate(r.lastSeenAt) : "—",
	})), [basesSorted.rows]);

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

	// Клик по базе — переход к её сеансам: это первое, что нужно, когда база «висит».
	const openSessions = useCallback((row: Partial<TDataItem>) => {
		setBaseFilter(asText(row.baseKey));
		setTab("sessions");
	}, []);

	const askTerminate = useCallback((row: Partial<TDataItem>) => {
		const raw = (sessions.data?.items ?? []).find((s) => (s.sessionId ?? "") === asText(row.sessionId));
		if (raw) setConfirm({ kind: "terminate", session: raw });
	}, [sessions.data]);

	const selectedBase = useMemo(
		() => (bases.data?.items ?? []).find((b) => b.key === baseFilter) ?? null,
		[bases.data, baseFilter],
	);

	// Вкладки — общий <Tabs> (тот же вид, что в формах), а не самодельные кнопки.
	// Режим управляемый: клик по базе переводит на её сеансы, а не только клик по вкладке.
	const tabs = useMemo(() => [
		{
			id: "bases",
			label: translate("onecTabBases"),
			component: (
				<Table
					{...buildStaticTableProps({
						componentName: "OneCAdmin_bases",
						rows: baseRows,
						sorting: basesSorted.sorting,
						search: basesSorted.search,
						columns: baseColumns,
						setColumns: setBaseColumns,
						isLoading: bases.isLoading || refresh.isPending,
						onReload: () => void bases.refetch(),
						onRowClick: openSessions,
						extraButtons: (
							<Button disabled={refresh.isPending} onClick={() => refresh.mutate()}>
								{translate("onecRefreshFromCluster")}
							</Button>
						),
					})}
				/>
			),
		},
		{
			id: "sessions",
			label: translate("onecTabSessions"),
			component: (
				<>
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
							// Фильтр по базе и блокировка входа — в штатный слот кнопок таблицы,
							// а не в отдельную полосу над ней: свой ряд контролов ломал ритм списка.
							extraButtons: (
								<>
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
	], [watchBatch, baseRows, basesSorted.sorting, baseColumns, sessionRowsView, sessionsSorted.sorting, sessionColumns,
		baseFilter, selectedBase, bases, sessions, refresh, terminate.isPending, openSessions, askTerminate]);

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
