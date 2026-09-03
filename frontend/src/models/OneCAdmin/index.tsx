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
import Modal from "src/components/Modal";
import { Field } from "src/components/Field";
import Notice, { type NoticeItem } from "src/components/Notice";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { getFormatDate } from "src/utils/datetime";
import {
	fetchBases, refreshBases, fetchSessions, terminateSession, setSessionsLock,
	type ClusterRow, type OnecBase,
} from "src/services/onec/api";
import styles from "./OneCAdmin.module.scss";

type Tab = "bases" | "sessions";

const basesColumns = (): TColumn[] => ([
	{ identifier: "key", type: "string", width: "200px", minWidth: "120px", alignment: "left", hint: translate("onecBaseKey"), visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "220px", minWidth: "120px", alignment: "left", hint: translate("name"), visible: true, inlist: true },
	{ identifier: "status", type: "string", width: "110px", minWidth: "80px", alignment: "left", hint: translate("status"), visible: true, inlist: true },
	{ identifier: "sessionsCount", type: "number", width: "100px", minWidth: "70px", alignment: "right", hint: translate("onecSessions"), visible: true, inlist: true },
	{ identifier: "onecVersion", type: "string", width: "120px", minWidth: "80px", alignment: "left", hint: translate("onecPlatform"), visible: true, inlist: true },
	{ identifier: "extVersion", type: "string", width: "120px", minWidth: "80px", alignment: "left", hint: translate("onecExtension"), visible: true, inlist: true },
	{ identifier: "lastSeenAt", type: "string", width: "160px", minWidth: "110px", alignment: "left", hint: translate("onecLastSeen"), visible: true, inlist: true },
] as unknown as TColumn[]);

const sessionsColumns = (): TColumn[] => ([
	{ identifier: "sessionId", type: "string", width: "90px", minWidth: "60px", alignment: "left", hint: translate("onecSessionId"), visible: true, inlist: true },
	{ identifier: "userName", type: "string", width: "180px", minWidth: "110px", alignment: "left", hint: translate("onecSessionUser"), visible: true, inlist: true },
	{ identifier: "appId", type: "string", width: "150px", minWidth: "90px", alignment: "left", hint: translate("onecSessionApp"), visible: true, inlist: true },
	{ identifier: "host", type: "string", width: "150px", minWidth: "90px", alignment: "left", hint: translate("onecSessionHost"), visible: true, inlist: true },
	{ identifier: "startedAt", type: "string", width: "170px", minWidth: "110px", alignment: "left", hint: translate("onecSessionStarted"), visible: true, inlist: true },
	{ identifier: "lastActiveAt", type: "string", width: "170px", minWidth: "110px", alignment: "left", hint: translate("onecSessionActive"), visible: true, inlist: true },
] as unknown as TColumn[]);

/** Ошибку сервиса показываем как есть: её текст написан для человека. */
const errorNotice = (e: unknown): NoticeItem => ({ type: "error", text: e instanceof Error ? e.message : String(e) });

export const OneCAdminList: FC = () => {
	const qc = useQueryClient();
	const [tab, setTab] = useState<Tab>("bases");
	const [baseFilter, setBaseFilter] = useState<string>("");
	const [notices, setNotices] = useState<NoticeItem[]>([]);
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
			setNotices([{ type: "success", text: translate("onecBasesRefreshed") }]);
		},
		onError: (e) => setNotices([errorNotice(e)]),
	});

	const terminate = useMutation({
		mutationFn: (p: { sessionId: string; baseKey?: string }) => terminateSession(p.sessionId, p.baseKey),
		onSuccess: () => {
			setNotices([{ type: "success", text: translate("onecSessionTerminated") }]);
			void sessions.refetch();
		},
		onError: (e) => setNotices([errorNotice(e)]),
	});

	const lock = useMutation({
		mutationFn: (p: { baseKey: string; enabled: boolean; message?: string }) => setSessionsLock(p.baseKey, p.enabled, p.message),
		onSuccess: (_d, p) => {
			setNotices([{ type: "success", text: p.enabled ? translate("onecLockEnabled") : translate("onecLockDisabled") }]);
			void bases.refetch();
		},
		onError: (e) => setNotices([errorNotice(e)]),
	});

	const baseRows = useMemo(() => (bases.data?.items ?? []).map((b, i) => ({
		id: i + 1,
		uuid: b.id,
		key: b.key,
		name: b.name || "—",
		status: b.status,
		sessionsCount: b.sessionsCount ?? "—",
		onecVersion: b.onecVersion ?? "—",
		extVersion: b.extVersion ?? translate("onecExtensionMissing"),
		lastSeenAt: b.lastSeenAt ? getFormatDate(b.lastSeenAt) : "—",
	})), [bases.data]);

	const sessionRows = useMemo(() => (sessions.data?.items ?? []).map((s, i) => ({
		id: i + 1,
		uuid: s.session ?? String(i),
		sessionId: s.sessionId ?? "—",
		userName: s.userName || "—",
		appId: s.appId || "—",
		host: s.host || "—",
		startedAt: s.startedAt || "—",
		lastActiveAt: s.lastActiveAt || "—",
	})), [sessions.data]);

	// Клик по базе — переход к её сеансам: это первое, что нужно, когда база «висит».
	const openSessions = useCallback((row: Partial<TDataItem>) => {
		setBaseFilter(asText(row.key));
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

	return (
		<div className={styles.Root}>
			<div className={styles.Tabs}>
				<button type="button" className={tab === "bases" ? styles.TabActive : styles.Tab} onClick={() => setTab("bases")}>
					{translate("onecTabBases")}
				</button>
				<button type="button" className={tab === "sessions" ? styles.TabActive : styles.Tab} onClick={() => setTab("sessions")}>
					{translate("onecTabSessions")}
				</button>
			</div>

			{notices.length > 0 && <Notice items={notices} className={styles.Notice} />}

			{tab === "bases" && (
				<div className={styles.TableWrap}>
					<Table
						{...buildStaticTableProps({
							componentName: "OneCAdmin_bases",
							rows: baseRows,
							columns: baseColumns,
							setColumns: setBaseColumns,
							isLoading: bases.isLoading || refresh.isPending,
							onReload: () => void bases.refetch(),
							onRowClick: openSessions,
							extraButtons: (
								<button type="button" className={styles.Action} disabled={refresh.isPending} onClick={() => refresh.mutate()}>
									{translate("onecRefreshFromCluster")}
								</button>
							),
						})}
					/>
				</div>
			)}

			{tab === "sessions" && (
				<div className={styles.TableWrap}>
					<div className={styles.Filter}>
						<label className={styles.FilterLabel} htmlFor="onec_base_filter">{translate("onecBase")}</label>
						<select
							id="onec_base_filter"
							className={styles.Select}
							value={baseFilter}
							onChange={(e) => setBaseFilter(e.target.value)}
						>
							<option value="">{translate("onecAllBases")}</option>
							{(bases.data?.items ?? []).map((b) => <option key={b.id} value={b.key}>{b.key}</option>)}
						</select>
						{selectedBase && (
							<button
								type="button"
								className={styles.Action}
								onClick={() => { setLockMessage(""); setConfirm({ kind: "lock", base: selectedBase, enabled: true }); }}
							>
								{translate("onecLockSessions")}
							</button>
						)}
						{selectedBase && (
							<button
								type="button"
								className={styles.Action}
								onClick={() => setConfirm({ kind: "lock", base: selectedBase, enabled: false })}
							>
								{translate("onecUnlockSessions")}
							</button>
						)}
					</div>
					<Table
						{...buildStaticTableProps({
							componentName: "OneCAdmin_sessions",
							rows: sessionRows,
							columns: sessionColumns,
							setColumns: setSessionColumns,
							isLoading: sessions.isLoading || sessions.isFetching || terminate.isPending,
							onReload: () => void sessions.refetch(),
							onRowClick: askTerminate,
						})}
					/>
					<div className={styles.Hint}>{translate("onecSessionsHint")}</div>
				</div>
			)}

			{confirm?.kind === "terminate" && (
				<Modal
					title={translate("onecTerminateTitle")}
					onClose={() => setConfirm(null)}
					onApply={() => {
						terminate.mutate({ sessionId: confirm.session.sessionId ?? "", baseKey: baseFilter || undefined });
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
