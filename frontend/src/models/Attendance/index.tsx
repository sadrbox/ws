/**
 * Трудовая дисциплина (E17 СК6, пп. 32–34 стандарта).
 *
 *  • «Мой день» — у каждого сотрудника: график, отметка «Начал работу», мои заявки.
 *  • «Посещаемость» — у главбуха, руководителя, администратора: журнал дня с вердиктами,
 *    заявки на решение, графики сотрудников.
 *  • AbsenceRequestsForm — карточка заявки: сюда ведёт уведомление «Заявка: …» (link.endpoint
 *    "absence-requests").
 *
 * Первая отметка дня окончательная: повторное нажатие её не сдвигает (сервер). Заявку подают
 * ДО начала дня, иначе это п. 34 — кроме непредвиденной причины, которую отмечает согласующий.
 *
 * Решено 25.09: праздники и переносы — по производственному календарю («Качество → Производственный
 * календарь»); приход — кнопкой или первым входом в ERP, что раньше (настройка attendance.source = both).
 */
import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TPane } from "src/app/types";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table from "src/components/Table";
import Tabs from "src/components/Tabs";
import Toolbar from "src/components/Toolbar";
import ModelForm from "src/components/ModelForm";
import Notice, { type NoticeItem } from "src/components/Notice";
import { Button } from "src/components/Button";
import { Field, FieldDate, FieldSelect, FieldTextarea } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Group, GroupCol } from "src/components/UI";
import { HelpBox, HelpText } from "src/components/HelpBox";
import { getModelColumns } from "src/components/Table/services";
import { showToast } from "src/components/UIToast";
import { useAppContext } from "src/app/context";
import { usePaneToolbar } from "src/hooks/usePaneToolbar";
import { useQualityMe } from "src/hooks/useQualityMe";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { routeError } from "src/services/errors/route";
import {
	deleteAbsenceRequest, deleteWorkSchedule, fetchAbsenceRequest, fetchAbsenceRequests, fetchAttendanceJournal, fetchAttendanceMe, fetchWorkSchedules, markWorkDay,
	type AbsenceRequest, type AttendanceJournalRow, type WorkSchedule,
} from "src/services/quality/api";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { getAppUtcOffset, getFormatDate, getFormatDateOnly, getFormatTimeOnly } from "src/utils/datetime";
import { asText } from "src/utils/asText";
import { translate } from "src/i18";
import QualityChip from "src/models/_quality/QualityChip";
import { localYmd } from "src/models/_quality/month";
import { AbsenceRequestModal } from "./AbsenceRequestModal";
import { DecideModal } from "./DecideModal";
import { ScheduleModal } from "./ScheduleModal";
import {
	absenceKindLabel, requestPeriodText, requestStatusLabel, requestStatusTone, toJournalRows, toRequestRows, toScheduleRows,
	verdictKind, verdictLabel, verdictTone, workDaysText,
} from "./attendanceView";
import myRequestsColumnsJson from "./myRequestsColumns.json";
import requestsColumnsJson from "./requestsColumns.json";
import journalColumnsJson from "./journalColumns.json";
import schedulesColumnsJson from "./schedulesColumns.json";
import main from "src/styles/main.module.scss";
import styles from "./Attendance.module.scss";

const ME_KEY = ["quality", "attendance", "me"] as const;
const SOURCE_KEYS: Record<string, string> = { button: "attendanceSourceButton", login: "attendanceSourceLogin", both: "attendanceSourceBoth", manual: "attendanceSourceManual" };
const sourceLabel = (s: string | null | undefined): string => (s && SOURCE_KEYS[s] ? translate(SOURCE_KEYS[s]) : s ?? "");

/** Ячейка статуса заявки — меткой; общая для «моих» и «на решение». */
const renderRequestCell = (row: TDataItem, col: TColumn) => {
	if (col.identifier !== "attStatus") return undefined;
	const r = row.source as AbsenceRequest | undefined;
	return r ? <QualityChip tone={requestStatusTone(r.status)}>{requestStatusLabel(r.status)}</QualityChip> : undefined;
};

// ═══════════════════════════════════════════════════════════════════════════
// Мой день
// ═══════════════════════════════════════════════════════════════════════════

export const AttendanceMyDay: FC<Partial<TPane>> = ({ uniqId }) => {
	const qc = useQueryClient();
	const { confirm } = useAppContext().actions;
	const q = useQuery({ queryKey: ME_KEY, queryFn: fetchAttendanceMe, retry: false });
	const d = q.data;
	const [showRequest, setShowRequest] = useState(false);
	const [activeUuid, setActiveUuid] = useState<string | null>(null);
	const active = useMemo(() => (d?.requests ?? []).find((r) => r.uuid === activeUuid) ?? null, [d?.requests, activeUuid]);
	const [notices, setNotices] = useState<NoticeItem[]>([]);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(() => {
		void qc.invalidateQueries({ queryKey: ["quality", "attendance"] });
	}, [qc]);

	const markNow = useCallback(async () => {
		setBusy(true);
		setNotices([]);
		try {
			const r = await markWorkDay("button");
			showToast(translate(r.data?.already ? "attendanceAlreadyMarked" : "attendanceMarked"), r.data?.already ? "info" : "success");
			refresh();
		} catch (e) {
			setNotices(routeError(e, { source: translate("AttendanceMyDay") }));
		} finally {
			setBusy(false);
		}
	}, [refresh]);

	const withdraw = useCallback(async () => {
		if (!active || active.status !== "pending") return;
		if (!(await confirm(translate("attendanceWithdrawConfirm")))) return;
		try {
			await deleteAbsenceRequest(active.uuid);
			showToast(translate("attendanceWithdrawn"), "success");
			setActiveUuid(null);
			refresh();
		} catch (e) {
			setNotices(routeError(e, { source: translate("AttendanceMyDay") }));
		}
	}, [active, confirm, refresh]);

	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(myRequestsColumnsJson as TColumn[], "AttendanceMyRequests"));
	const view = useStaticTableView(useMemo(() => toRequestRows(d?.requests ?? []), [d?.requests]), { attSubmittedAt: "desc" });

	const paneToolbar = usePaneToolbar(uniqId, (
		<Toolbar className={main.PaneToolbarFill}>
			<Button icon="plus" onClick={() => setShowRequest(true)} disabled={!d}>{translate("attendanceNewRequest")}</Button>
			<Button onClick={() => void withdraw()} disabled={!active || active.status !== "pending"} title={translate("attendanceWithdrawHint")}>
				{translate("attendanceWithdraw")}
			</Button>
			<Toolbar.Divider />
			<Toolbar.ReloadButton onClick={() => void q.refetch()} disabled={q.isFetching} />
		</Toolbar>
	));

	// Фирма не назначена и пр. — сервер объяснил словами; показываем как сообщение экрана.
	const loadNotices = useLoadNotices([q.error], "AttendanceMyDay");
	const schedule = d?.schedule ?? null;
	const mark = d?.mark ?? null;

	return (
		<>
			{paneToolbar}
			<Notice items={[...loadNotices, ...notices]} />
			<div className={main.PaneFill}>
				<div className={styles.Body}>
					<div className={styles.Today}>
						<div className={styles.TodayInfo}>
							<h3 className={styles.TodayTitle}>{`${translate("attendanceToday")}: ${d ? getFormatDateOnly(d.today) : "…"}`}</h3>
							<span className={styles.TodayLine}>
								{schedule
									? `${translate("attendanceSchedule")}: ${schedule.startTime}–${schedule.endTime}, ${workDaysText(schedule.workDays)} · ${translate("workScheduleGrace")}: ${schedule.graceMinutes}`
									: translate("attendanceNoSchedule")}
							</span>
							<span className={styles.TodayLine}>
								{mark
									? <><span className={styles.TodayStrong}>{`${translate("attendanceMarkedAt")}: ${getFormatTimeOnly(mark.markedAt)}`}</span>{` · ${sourceLabel(mark.source)}`}</>
									: translate("attendanceNotMarked")}
							</span>
							{d?.source && <span className={styles.TodayLine}>{`${translate("attendanceSource")}: ${sourceLabel(d.source)}`}</span>}
						</div>
						<Button size="lg" variant="primary" onClick={() => void markNow()} disabled={!d || !!mark || busy}
							title={mark ? translate("attendanceMarkFinal") : undefined}>
							{translate("attendanceStartWork")}
						</Button>
					</div>
					<HelpBox>
						<HelpText text={translate("attendanceMyDayHelp")} />
					</HelpBox>
					<h4 className={styles.SectionTitle}>{translate("attendanceMyRequests")}</h4>
					<div className={styles.TableArea}>
						<Table {...buildStaticTableProps({
							componentName: "AttendanceMyRequests", rows: view.rows, columns: cols, setColumns: setCols,
							sorting: view.sorting, search: view.search, isLoading: q.isLoading,
							emptyText: translate("attendanceNoRequests"), renderCell: renderRequestCell,
							onActiveRowChange: (row) => setActiveUuid((row?.source as AbsenceRequest | undefined)?.uuid ?? null),
						})} />
					</div>
				</div>
			</div>
			{showRequest && d && (
				<AbsenceRequestModal schedule={schedule} today={d.today} onClose={() => setShowRequest(false)} onDone={refresh} />
			)}
		</>
	);
};
AttendanceMyDay.displayName = "AttendanceMyDay";

/**
 * Ошибки загрузки → сообщения экрана. routeError сам показывает тост системного сбоя (побочный
 * эффект), поэтому зовём его в эффекте по смене ошибки, а не при рендере.
 */
function useLoadNotices(errors: unknown[], sourceKey: string): NoticeItem[] {
	const [items, setItems] = useState<NoticeItem[]>([]);
	const first = errors.find(Boolean) ?? null;
	useEffect(() => {
		setItems(first ? routeError(first, { source: translate(sourceKey) }) : []);
	}, [first, sourceKey]);
	return items;
}

// ═══════════════════════════════════════════════════════════════════════════
// Посещаемость (главбух, руководитель, администратор)
// ═══════════════════════════════════════════════════════════════════════════

type JournalTab = "journal" | "requests" | "schedules";

export const AttendanceJournal: FC<Partial<TPane>> = ({ uniqId }) => {
	const qc = useQueryClient();
	const { confirm } = useAppContext().actions;
	const { addPane } = useAppContext().windows;
	const { isController } = useQualityMe();
	const [tab, setTab] = useState<JournalTab>("journal");
	const [date, setDate] = useState(() => localYmd(getAppUtcOffset() * 60));
	const [status, setStatus] = useState<AbsenceRequest["status"] | "">("pending");
	// Активные строки — по uuid, а сама запись — из свежих данных: после решения или правки
	// кнопки должны видеть новое состояние, а не снимок строки на момент щелчка.
	const [activeRequestUuid, setActiveRequestUuid] = useState<string | null>(null);
	const [activeScheduleUuid, setActiveScheduleUuid] = useState<string | null>(null);
	const [decide, setDecide] = useState<"approved" | "rejected" | null>(null);
	const [scheduleEdit, setScheduleEdit] = useState<WorkSchedule | "new" | null>(null);
	const [notices, setNotices] = useState<NoticeItem[]>([]);

	const journal = useQuery({ queryKey: ["quality", "attendance", "journal", date], queryFn: () => fetchAttendanceJournal(date), retry: false });
	const requests = useQuery({
		queryKey: ["quality", "attendance", "requests", status],
		queryFn: async () => (await fetchAbsenceRequests({ status })).items ?? [],
		retry: false,
	});
	const schedules = useQuery({ queryKey: ["quality", "attendance", "schedules"], queryFn: async () => (await fetchWorkSchedules()).items ?? [], retry: false });
	const startOf = useMemo(() => new Map((schedules.data ?? []).map((s) => [s.userUuid, s.startTime])), [schedules.data]);
	const activeRequest = useMemo(() => (requests.data ?? []).find((r) => r.uuid === activeRequestUuid) ?? null, [requests.data, activeRequestUuid]);
	const activeSchedule = useMemo(() => (schedules.data ?? []).find((x) => x.uuid === activeScheduleUuid) ?? null, [schedules.data, activeScheduleUuid]);

	const refresh = useCallback(() => {
		void qc.invalidateQueries({ queryKey: ["quality", "attendance"] });
	}, [qc]);

	// Двойной щелчок по заявке — её карточка (та же, куда ведёт уведомление о новой заявке).
	const openRequest = useCallback((r: AbsenceRequest) => {
		addPane({
			component: AbsenceRequestsForm,
			label: `${translate("AbsenceRequestsForm")}: ${r.userName ?? ""} · ${requestPeriodText(r)}`,
			data: { uuid: r.uuid } as Partial<TDataItem>,
			restore: { kind: "form", endpoint: "absence-requests", uuid: r.uuid },
		});
	}, [addPane]);

	const removeSchedule = useCallback(async () => {
		if (!activeSchedule) return;
		const q = translate("workScheduleDeleteConfirm").replace("{name}", activeSchedule.userName ?? "");
		if (!(await confirm(q))) return;
		try {
			await deleteWorkSchedule(activeSchedule.uuid);
			showToast(translate("workScheduleDeleted"), "success");
			setActiveScheduleUuid(null);
			refresh();
		} catch (e) {
			setNotices(routeError(e, { source: translate("AttendanceJournal") }));
		}
	}, [activeSchedule, confirm, refresh]);

	const [jCols, setJCols] = useState<TColumn[]>(() => getModelColumns(journalColumnsJson as TColumn[], "AttendanceJournalDay"));
	const [rCols, setRCols] = useState<TColumn[]>(() => getModelColumns(requestsColumnsJson as TColumn[], "AttendanceRequests"));
	const [sCols, setSCols] = useState<TColumn[]>(() => getModelColumns(schedulesColumnsJson as TColumn[], "AttendanceSchedules"));
	const jView = useStaticTableView(useMemo(() => toJournalRows(journal.data?.items ?? []), [journal.data]), { attEmployee: "asc" });
	const rView = useStaticTableView(useMemo(() => toRequestRows(requests.data ?? []), [requests.data]), { attSubmittedAt: "desc" });
	const sView = useStaticTableView(useMemo(() => toScheduleRows(schedules.data ?? []), [schedules.data]), { attEmployee: "asc" });

	const renderJournalCell = useCallback((row: TDataItem, col: TColumn) => {
		if (col.identifier !== "attVerdict") return undefined;
		const j = row.source as AttendanceJournalRow | undefined;
		if (!j) return undefined;
		return <QualityChip tone={verdictTone(verdictKind(j.verdict))} title={j.verdict?.description}>{verdictLabel(j.verdict)}</QualityChip>;
	}, []);

	const canDecideActive = !!activeRequest?.canDecide;
	const toolbarTabActions = tab === "requests" ? (
		<>
			<FieldSelect name="attendance_requests_status" size="sm" value={status} onChange={(e) => setStatus(e.target.value as AbsenceRequest["status"] | "")}
				options={[
					{ value: "pending", label: requestStatusLabel("pending") },
					{ value: "approved", label: requestStatusLabel("approved") },
					{ value: "rejected", label: requestStatusLabel("rejected") },
					{ value: "", label: translate("attendanceAllRequests") },
				]} />
			{isController && (
				<>
					<Button variant="primary" disabled={!canDecideActive} onClick={() => setDecide("approved")}>{translate("attendanceApprove")}</Button>
					<Button disabled={!canDecideActive} onClick={() => setDecide("rejected")}>{translate("attendanceReject")}</Button>
				</>
			)}
		</>
	) : tab === "schedules" && isController ? (
		<>
			<Button icon="plus" onClick={() => setScheduleEdit("new")}>{translate("workScheduleAdd")}</Button>
			<Button disabled={!activeSchedule} onClick={() => activeSchedule && setScheduleEdit(activeSchedule)}>{translate("workScheduleEdit")}</Button>
			<Button disabled={!activeSchedule} onClick={() => void removeSchedule()}>{translate("delete")}</Button>
		</>
	) : null;

	const paneToolbar = usePaneToolbar(uniqId, (
		<Toolbar className={main.PaneToolbarFill}>
			{tab === "journal" && (
				<FieldDate name="attendance_journal_date" value={date} onChange={(e) => setDate(e.target.value || localYmd(getAppUtcOffset() * 60))} width={FIELD_WIDTH.date} />
			)}
			{toolbarTabActions}
			<Toolbar.Divider />
			<Toolbar.ReloadButton onClick={refresh} disabled={journal.isFetching || requests.isFetching || schedules.isFetching} />
		</Toolbar>
	));

	const tabs = [
		{
			id: "journal", label: translate("attendanceJournalTab"), component: (
				<div className={styles.Tab}>
					<Table {...buildStaticTableProps({
						componentName: "AttendanceJournalDay", rows: jView.rows, columns: jCols, setColumns: setJCols,
						sorting: jView.sorting, search: jView.search, isLoading: journal.isLoading,
						emptyText: translate("attendanceJournalEmpty"), renderCell: renderJournalCell,
					})} />
				</div>
			),
		},
		{
			id: "requests", label: translate("attendanceRequestsTab"), component: (
				<div className={styles.Tab}>
					<Table {...buildStaticTableProps({
						componentName: "AttendanceRequests", rows: rView.rows, columns: rCols, setColumns: setRCols,
						sorting: rView.sorting, search: rView.search, isLoading: requests.isLoading,
						emptyText: translate("attendanceNoRequests"), renderCell: renderRequestCell,
						onActiveRowChange: (row) => setActiveRequestUuid((row?.source as AbsenceRequest | undefined)?.uuid ?? null),
						onRowClick: (row) => {
							const r = (row as TDataItem).source as AbsenceRequest | undefined;
							if (r) openRequest(r);
						},
					})} />
				</div>
			),
		},
		{
			id: "schedules", label: translate("attendanceSchedulesTab"), component: (
				<div className={styles.Tab}>
					<Table {...buildStaticTableProps({
						componentName: "AttendanceSchedules", rows: sView.rows, columns: sCols, setColumns: setSCols,
						sorting: sView.sorting, search: sView.search, isLoading: schedules.isLoading,
						emptyText: translate("workScheduleNone"),
						onActiveRowChange: (row) => setActiveScheduleUuid((row?.source as WorkSchedule | undefined)?.uuid ?? null),
						onRowClick: (row) => {
							const s = (row as TDataItem).source as WorkSchedule | undefined;
							if (s && isController) setScheduleEdit(s);
						},
					})} />
				</div>
			),
		},
	];

	const loadNotices = useLoadNotices([journal.error, requests.error, schedules.error], "AttendanceJournal");

	return (
		<>
			{paneToolbar}
			<Notice items={[
				{ type: "info", text: translate("attendanceJournalInfo") },
				{ type: "info", text: translate("attendanceCheckLater") },
				...loadNotices,
				...notices,
			]} />
			<div className={main.PaneFill}>
				<Tabs tabs={tabs} activeTab={tab} onTabChange={(id) => setTab(id as JournalTab)} />
			</div>
			{decide && activeRequest && (
				<DecideModal request={activeRequest} decision={decide} startTime={startOf.get(activeRequest.userUuid) ?? null}
					onClose={() => setDecide(null)} onDone={refresh} />
			)}
			{scheduleEdit && (
				<ScheduleModal schedule={scheduleEdit === "new" ? null : scheduleEdit} onClose={() => setScheduleEdit(null)} onDone={refresh} />
			)}
		</>
	);
};
AttendanceJournal.displayName = "AttendanceJournal";

// ═══════════════════════════════════════════════════════════════════════════
// Карточка заявки (из уведомления)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Заявка по uuid — GET /absence-requests/:id (своя — всегда, чужая — тем, кому виден сотрудник).
 * Не найдена или не видна — null: карточка скажет «заявка не найдена», а не упадёт.
 */
async function findRequest(uuid: string): Promise<AbsenceRequest | null> {
	try {
		return await fetchAbsenceRequest(uuid);
	} catch (e) {
		if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
		throw e;
	}
}

export const AbsenceRequestsForm: FC<Partial<TPane>> = ({ uniqId, data }) => {
	const uuid = asText(data?.uuid);
	const { requestClose, updatePaneLabel } = useAppContext().windows;
	const { confirm } = useAppContext().actions;
	const me = useAppContext().auth.user;
	const { isController } = useQualityMe();
	const qc = useQueryClient();
	const q = useQuery({ queryKey: ["quality", "attendance", "request", uuid], queryFn: () => findRequest(uuid), enabled: !!uuid, retry: false });
	const schedules = useQuery({ queryKey: ["quality", "attendance", "schedules"], queryFn: async () => (await fetchWorkSchedules()).items ?? [], enabled: isController, retry: false });
	const r = q.data ?? null;
	const [decide, setDecide] = useState<"approved" | "rejected" | null>(null);
	const [notices, setNotices] = useState<NoticeItem[]>([]);

	// Открыли по ссылке из уведомления — подпись вкладки «… → загрузка…» заменяем, когда заявка пришла.
	useEffect(() => {
		if (!r || !uniqId) return;
		updatePaneLabel(uniqId, `${translate("AbsenceRequestsForm")}: ${r.userName ?? ""} · ${requestPeriodText(r)}`);
	}, [r, uniqId, updatePaneLabel]);

	const refresh = useCallback(() => {
		void qc.invalidateQueries({ queryKey: ["quality", "attendance"] });
	}, [qc]);

	const withdraw = useCallback(async () => {
		if (!r || !(await confirm(translate("attendanceWithdrawConfirm")))) return;
		try {
			await deleteAbsenceRequest(r.uuid);
			showToast(translate("attendanceWithdrawn"), "success");
			refresh();
			if (uniqId) await requestClose(uniqId, { force: true });
		} catch (e) {
			setNotices(routeError(e, { source: translate("AbsenceRequestsForm") }));
		}
	}, [r, confirm, refresh, uniqId, requestClose]);

	const name = `absence_request_${uuid}`;
	const tabs = [{
		id: "tab-request", label: translate("general"), component: (
			<div className={main.FormWrapper}>
				<div className={main.Form}>
					{r ? (
						<GroupCol>
							<Group>
								<QualityChip tone={requestStatusTone(r.status)}>{requestStatusLabel(r.status)}</QualityChip>
								{r.unforeseen && <QualityChip tone="info">{translate("attendanceUnforeseen")}</QualityChip>}
							</Group>
							<Group>
								<Field label={translate("employee")} name={`${name}_user`} value={r.userName ?? ""} disabled minWidth={FIELD_WIDTH.lg} />
							</Group>
							<Group>
								<Field label={translate("attendanceKind")} name={`${name}_kind`} value={absenceKindLabel(r.kind)} disabled width={FIELD_WIDTH.wide} />
								<Field label={translate("attendancePeriod")} name={`${name}_period`} value={requestPeriodText(r)} disabled width={FIELD_WIDTH.wide} />
							</Group>
							<Group>
								<FieldTextarea label={translate("reason")} name={`${name}_reason`} value={r.reason ?? ""} disabled minWidth={FIELD_WIDTH.lg} rows={3} />
							</Group>
							<Group>
								<Field label={translate("attendanceSubmittedAt")} name={`${name}_created`} value={getFormatDate(r.createdAt)} disabled width={FIELD_WIDTH.date} />
								<Field label={translate("attDecidedBy")} name={`${name}_by`} value={r.decidedByName ?? ""} disabled width={FIELD_WIDTH.wide} />
							</Group>
							{r.decisionNote && (
								<Group>
									<FieldTextarea label={translate("attendanceDecisionNote")} name={`${name}_note`} value={r.decisionNote} disabled minWidth={FIELD_WIDTH.lg} rows={2} />
								</Group>
							)}
						</GroupCol>
					) : (
						<span className={styles.Empty}>{q.isLoading ? translate("loading") : translate("attendanceRequestNotFound")}</span>
					)}
				</div>
				<GroupCol className={main.FormNotice}>
					<Notice items={notices} />
				</GroupCol>
			</div>
		),
	}];

	const mine = !!r && r.userUuid === me?.uuid;
	const actions = r ? (
		<>
			{r.canDecide && isController && (
				<>
					<Button variant="primary" onClick={() => setDecide("approved")}>{translate("attendanceApprove")}</Button>
					<Button onClick={() => setDecide("rejected")}>{translate("attendanceReject")}</Button>
				</>
			)}
			{mine && r.status === "pending" && <Button onClick={() => void withdraw()}>{translate("attendanceWithdraw")}</Button>}
		</>
	) : undefined;

	return (
		<>
			<ModelForm paneId={uniqId} tabs={tabs} onSave={() => undefined} onSaveAndClose={() => undefined}
				onClose={() => { if (uniqId) void requestClose(uniqId); }} isLoading={q.isLoading} isInitialLoading={q.isLoading}
				readonly afterCloseButtons={actions} />
			{decide && r && (
				<DecideModal request={r} decision={decide} startTime={(schedules.data ?? []).find((s) => s.userUuid === r.userUuid)?.startTime ?? null}
					onClose={() => setDecide(null)} onDone={refresh} />
			)}
		</>
	);
};
AbsenceRequestsForm.displayName = "AbsenceRequestsForm";
