/**
 * «Сеансы» — живое состояние кластера 1С: кто сейчас в базах.
 *
 * Выделено из index.tsx, когда три вкладки одного предмета («Сеансы», «Соединения»,
 * «Сервер») собрали в раздел «Кластер»: они об одном и том же — о работе сервера здесь и
 * сейчас, читаются одной утилитой `rac` и отвечают за секунды. Держать их тремя вкладками
 * верхнего уровня значило заставлять человека помнить, в какой из них какая половина
 * ответа.
 *
 * Данные ЖИВЫЕ: staleTime 0, кэша нет. Список часовой давности здесь не просто бесполезен —
 * он вреден: по нему снимают сеансы.
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
import { Button } from "src/components/Button";
import { Field, FieldSelect } from "src/components/Field";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import {
	fetchBases, fetchSessions, setSessionsLock, terminateSession,
	type ClusterRow, type OnecBase,
} from "src/services/onec/api";
import { errorNotice, useNoticeReport, useNoticeScope } from "src/components/TechMessages/store";
import { finishOp, startOp } from "./progress";
import { sessionsLockView } from "./sessionsLock";
import { StateChip } from "src/components/StateChip";
import { echoList } from "./clusterEcho";
import { useOnecWrite } from "./shared";
import styles from "./OneCAdmin.module.scss";

const sessionsColumns = (): TColumn[] => ([
	{ identifier: "sessionId", type: "string", width: "90px", minWidth: "60px", alignment: "left", visible: true, inlist: true },
	// База, в которой работает сеанс. Срез приходит по всему кластеру, и без этой колонки
	// список из сотни сеансов не отвечал на первый же вопрос — «а это чья база?».
	{ identifier: "baseKey", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "userName", type: "string", width: "180px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "appId", type: "string", width: "150px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "host", type: "string", width: "150px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "startedAt", type: "datetime", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "lastActiveAt", type: "datetime", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Дата от rac → формат приложения. Нераспознанное показываем как пришло: лучше сырая
 *  строка, чем «—» вместо реального значения (у разных версий платформы формат разный). */
export const SessionsTab: FC = () => {
	const canWrite = useOnecWrite();
	const [baseFilter, setBaseFilter] = useState<string>("");
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(sessionsColumns(), "OneCAdmin_sessions"));
	const [confirm, setConfirm] = useState<
		null
		| { kind: "terminate"; session: ClusterRow }
		| { kind: "terminateMany"; ids: string[] }
		| { kind: "lock"; base: OnecBase; enabled: boolean }
	>(null);
	/** UUID отмеченных сеансов — цель групповой команды «Завершить сеансы». */
	const [pickedSessions, setPickedSessions] = useState<string[]>([]);
	const [lockMessage, setLockMessage] = useState("");

	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases });
	const sessions = useQuery({
		// Срез всего кластера; отбор по базе — ниже, на месте (см. fetchSessions).
		queryKey: ["onec", "sessions"],
		queryFn: fetchSessions,
		// Сеансы живут секундами: закэшированный список вводит в заблуждение.
		staleTime: 0,
	});

	useNoticeReport(useNoticeScope(), "sessions", translate("onecTabSessions"),
		errorNotice(sessions.error, translate("unknownError")));

	/**
	 * Ошибка команды — через общий маршрутизатор: он сам решает, тост это или запись в
	 * журнал, и не показывает одно и то же дважды. Раньше здесь писалось и туда и туда
	 * дословно, и человек читал один текст в двух местах.
	 */
	const failed = useCallback(
		(e: unknown) => reportError(e, { source: translate("onecTabSessions") }), []);

	const qc = useQueryClient();
	/**
	 * Список из ответа на снятие кладём в таблицу сразу — без второй команды агенту
	 * (clusterEcho.echoList). Вернёт false — списка в ответе нет, перечитывать вызывающему.
	 */
	const applyEcho = useCallback((r: Parameters<typeof echoList>[0]) => {
		const echo = echoList(r, "sessions");
		if (echo) qc.setQueryData(["onec", "sessions"], { items: echo.items });
		return echo;
	}, [qc]);

	const terminate = useMutation({
		// sessionId здесь — UUID сеанса кластера (см. вызов ниже), а не его номер.
		mutationFn: (p: { sessionId: string; baseKey?: string }) => {
			const op = startOp({
				kind: "delete", title: translate("onecTerminateTitle"),
				target: p.baseKey || translate("onecSessions"), total: 1,
				scope: { bases: p.baseKey ? [p.baseKey] : [] },
			});
			return terminateSession(p.sessionId, p.baseKey)
				.then((r) => { finishOp(op); return r; })
				.catch((e: unknown) => { finishOp(op, { failed: 1, note: e instanceof Error ? e.message : String(e), error: e }); throw e; });
		},
		onSuccess: (r) => {
			const echo = applyEcho(r);
			if (!echo) void sessions.refetch();
			// Строка ещё в списке кластера — «сеанс снят» над ней звучало бы ложью, и человек
			// снял бы его ещё раз.
			// Сеанса уже не было (повтор после 202, двойное нажатие) — успех, а не отказ (С30).
			showToast(
				translate(r.alreadyGone ? "onecSessionAlreadyGone" : echo?.stillListed ? "onecSessionStillListed" : "onecSessionTerminated"),
				echo?.stillListed && !r.alreadyGone ? "warning" : "success",
			);
		},
		onError: failed,
	});

	/**
	 * Групповое снятие: последовательно, а не пачкой. Каждое снятие — отдельная команда
	 * агенту, и параллелить их незачем: операция мгновенная, зато при ошибке видно,
	 * на каком сеансе споткнулись.
	 */
	const terminateMany = useMutation({
		mutationFn: async (ids: string[]) => {
			// База у каждого сеанса своя: список приходит по всему кластеру, и отбор в
			// панели мог быть снят. Раньше сюда шёл baseFilter — то есть при снятом отборе
			// база не передавалась вовсе, а при включённом навязывалась всем отмеченным.
			const op = startOp({
				kind: "delete", title: translate("onecTerminateMany"),
				target: `${translate("onecSessions")}: ${ids.length}`, total: ids.length,
				scope: { bases: [] },
			});
			let ok = 0;
			const failedIds: string[] = [];
			// Решает ПОСЛЕДНЕЕ успешное снятие: список от более раннего не знает о следующих.
			let lastEcho: ReturnType<typeof echoList> = null;
			for (const id of ids) {
				try {
					// Строки пропадают по мере работы, а не все разом в конце.
					lastEcho = applyEcho(await terminateSession(id, sessionBase(id)));
					ok += 1;
				} catch { failedIds.push(id); }
			}
			finishOp(op, { failed: failedIds.length });
			return { ok, failed: failedIds, fresh: !!lastEcho };
		},
		onSuccess: (r) => {
			showToast(r.failed.length
				? `${translate("onecSessionTerminated")}: ${r.ok}/${r.ok + r.failed.length}`
				: `${translate("onecSessionTerminated")}: ${r.ok}`,
				r.failed.length ? "warning" : "success");
			setPickedSessions([]);
			if (!r.fresh) void sessions.refetch();
		},
		onError: failed,
	});

	const lock = useMutation({
		mutationFn: (p: { baseKey: string; enabled: boolean; message?: string }) => {
			const op = startOp({
				kind: "update", title: translate(p.enabled ? "onecLockTitle" : "onecUnlockTitle"),
				target: p.baseKey, total: 1, scope: { bases: [p.baseKey] },
			});
			return setSessionsLock(p.baseKey, p.enabled, p.message)
				.then((r) => { finishOp(op); return r; })
				.catch((e: unknown) => { finishOp(op, { failed: 1, note: e instanceof Error ? e.message : String(e), error: e }); throw e; });
		},
		onSuccess: (r, p) => {
			// Кластер прочитал состояние после команды (агент E1) и оно не то, что просили, —
			// говорим это, а не «вход закрыт»: иначе человек уйдёт с открытой базой.
			const echo = r?.state?.lock;
			// Кластер не отдал состояние после записи (агент 23:45) — это «не проверено», а не «применено» (П30).
			if (r?.unverified?.includes("enabled")) showToast(r.caveat || translate("onecLockUnverified"), "warning");
			else if (echo && echo.enabled !== p.enabled) showToast(translate("onecLockNotApplied"), "warning");
			// Включили, но вход не закрыт (агент 23:16): осталось окно прошлой блокировки. Текст агента
			// называет это окно; нет текста — наш. И сброшено ли прежнее (П10, агент 23:52): не `all` —
			// прежние окно, сообщение или код разрешения остались, и человек должен об этом знать.
			else if (p.enabled && (r?.warning || echo?.active === false || (r?.reset && r.reset !== "all"))) {
				showToast([
					r?.warning || (echo?.active === false ? translate("onecLockNotActive") : translate("onecLockEnabled")),
					r?.reset && r.reset !== "all" ? (r.note || translate("onecLockResetPartial")) : "",
				].filter(Boolean).join(". "), "warning");
			} else showToast(p.enabled ? translate("onecLockEnabled") : translate("onecLockDisabled"), "success");
			// Реестр сервис уже обновил — перечитываем, и метка покажет новое состояние.
			void bases.refetch();
		},
		onError: failed,
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

	// UUID базы → её имя в кластере: сеанс знает базу только по UUID (поле infobase),
	// а человеку нужно имя. Карта строится один раз на список баз, а не на каждую строку.
	const baseByUuid = useMemo(() => {
		const m = new Map<string, string>();
		for (const b of bases.data?.items ?? []) if (b.infobaseId) m.set(b.infobaseId, b.key);
		return m;
	}, [bases.data]);

	/** База сеанса по его UUID — для команд, которые адресуются базой (снятие сеанса). */
	const sessionBase = useCallback((sessionUuid: string): string | undefined => {
		const raw = (sessions.data?.items ?? []).find((s) => s.session === sessionUuid);
		return baseByUuid.get(raw?.infobase ?? "") || undefined;
	}, [sessions.data, baseByUuid]);

	const sessionRows = useMemo(() => sessionSource.map((s, i) => ({
		id: i + 1,
		uuid: s.session ?? String(i),
		sessionId: s.sessionId ?? "",
		baseKey: baseByUuid.get(s.infobase ?? "") ?? "",
		userName: s.userName || "",
		appId: s.appId || "",
		host: s.host || "",
		startedAt: s.startedAt || "",
		lastActiveAt: s.lastActiveAt || "",
	})), [sessionSource, baseByUuid]);

	// Сортировка — на клиенте: данные целиком в памяти.
	const sorted = useStaticTableView(sessionRows, { startedAt: "desc" });

	const rowsView = useMemo(() => sorted.rows.map((r) => ({
		...r,
		sessionId: r.sessionId || "—",
		// Базы нет в реестре — показываем это прямо, а не пустой ячейкой: сеанс в базе,
		// о которой мы не знаем, сам по себе повод разобраться.
		baseKey: r.baseKey || translate("onecBaseUnknown"),
		userName: r.userName || "—",
		appId: r.appId || "—",
		host: r.host || "—",
		// Даты сеансов приходят от rac как есть (ISO); показываем в формате приложения.
		// Дату рисует таблица (колонки типа datetime): формат один на всё приложение.
		startedAt: r.startedAt,
		lastActiveAt: r.lastActiveAt,
	})), [sorted.rows]);

	const selectedBase = useMemo(
		() => (bases.data?.items ?? []).find((b) => b.key === baseFilter) ?? null,
		[bases.data, baseFilter],
	);

	return (
		<>
			<Table
				{...buildStaticTableProps({
					componentName: "OneCAdmin_sessions",
					rows: rowsView,
					sorting: sorted.sorting,
					search: sorted.search,
					columns,
					setColumns,
					isLoading: sessions.isLoading,
					reloading: sessions.isFetching || terminate.isPending,
					onReload: () => void sessions.refetch(),
					// Двойной щелчок НЕ завершает сеанс: этот жест значит «открыть элемент»,
					// и запускать им разрушающую операцию нельзя — у сеанса и карточки-то нет.
					// Завершение живёт в командной панели, где его видно.
					selectable: true,
					// В отметках нужен UUID сеанса (rac адресует им), а не номер.
					onSelectionChange: (sel, all) =>
						setPickedSessions(all.filter((r) => sel.has(Number(r.id))).map((r) => asText(r.uuid))),
					// Фильтр по базе и блокировка входа — в штатный слот кнопок таблицы,
					// а не в отдельную полосу над ней: свой ряд контролов ломал ритм списка.
					extraButtons: (
						<>
							{/* Снятие сеансов и блокировка входа — вмешательство в работу людей в
							    базе: правом «только просмотр» их не делают (см. useOnecWrite). */}
							{canWrite && pickedSessions.length > 0 && (
								<Button variant="danger"
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
								// Тот же компактный размер, что у кнопок рядом: тулбар таблицы
								// держит одну высоту элементов.
								style={{ width: "200px" }}
							/>
							{/*
							  * СОСТОЯНИЕ ВХОДА — МЕТКОЙ, И КНОПКА ОДНА ПО СОСТОЯНИЮ. Раньше стояли обе
							  * всегда, а включена ли блокировка, не было видно нигде. Состояние
							  * неизвестно (кластер его не сообщал) — обе кнопки, как прежде.
							  */}
							{selectedBase && (() => {
								const lockView = sessionsLockView(selectedBase);
								return (
									<StateChip tone={lockView.tone} title={lockView.details || undefined}>
										{lockView.label}
									</StateChip>
								);
							})()}
							{canWrite && selectedBase && !(sessionsLockView(selectedBase).known && sessionsLockView(selectedBase).enabled) && (
								<Button variant="secondary"
									onClick={() => { setLockMessage(""); setConfirm({ kind: "lock", base: selectedBase, enabled: true }); }}>
									{translate("onecLockSessions")}
								</Button>
							)}
							{canWrite && selectedBase && !(sessionsLockView(selectedBase).known && !sessionsLockView(selectedBase).enabled) && (
								<Button variant="secondary"
									onClick={() => setConfirm({ kind: "lock", base: selectedBase, enabled: false })}>
									{translate("onecUnlockSessions")}
								</Button>
							)}
						</>
					),
				})}
			/>

			{confirm?.kind === "terminate" && (
				<Modal
					title={translate("onecTerminateTitle")}
					onClose={() => setConfirm(null)}
					onApply={() => {
						// rac адресует сеанс UUID (поле `session`), а НЕ номером (`sessionId`):
						// с номером он отвечает «Ошибка разбора параметра: session». Номер
						// оставляем только для показа — человек узнаёт сеанс по нему.
						terminate.mutate({
							sessionId: confirm.session.session ?? "",
							baseKey: baseByUuid.get(confirm.session.infobase ?? "") || undefined,
						});
						setConfirm(null);
					}}
				>
					<div className={styles.ConfirmText}>
						{translate("onecTerminateQuestion")}
						<div className={styles.ConfirmDetails}>
							{translate("baseKey")}: {baseByUuid.get(confirm.session.infobase ?? "") || translate("onecBaseUnknown")}
							{" · "}{translate("onecSessionId")}: {confirm.session.sessionId ?? "—"}
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
									noAutofill
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
		</>
	);
};

export default SessionsTab;
