// E17 «Стандарт качества БухПроф» — вызовы backend (docs/PLAN_QUALITY_STANDARD_2026-09-25.md).
//
// Права — на сервере (группы сотрудников, services/quality/access.js): панель лишь прячет то,
// что заведомо запрещено, по контексту GET /quality/me. Ответы — формат backend:
// списки {items, total, hasMore, nextCursor}, одиночные {item}, прочее {data}.
import { api } from "src/services/api/client";
import { aiFetch } from "src/services/ai/endpoint";

// ── Контекст ──────────────────────────────────────────────────────────────────
export interface QualityGroupRef { uuid: string; name: string; headUuid: string | null; managerUuid: string | null }
export interface TelegramStatus { enabled: boolean; botName: string | null; linked: boolean; linkedAt: string | null }
export interface QualityMe {
	firmOrganizationUuid: string | null;
	firmOrganizationName: string | null;
	firmExplicit: boolean;
	isAdmin: boolean;
	isHead: boolean;
	isManager: boolean;
	canManage: boolean;
	canDecide: boolean;
	groups: QualityGroupRef[];
	unreadNotifications: number;
	telegram: TelegramStatus;
}
export const fetchQualityMe = () => api.get<{ success: boolean; data: QualityMe }>("/quality/me").then((r) => r.data);

// ── Настройки ─────────────────────────────────────────────────────────────────
export interface QualitySettings {
	/** С какой даты (YYYY-MM-DD) действуют правила кандидатов; пусто — молчат. Ставится при первом назначении фирмы. */
	effectiveFrom: string;
	tzOffsetMinutes: number;
	/** Рабочее время фирмы «ЧЧ:ММ»: по нему — SLA, сроки находок и проверки исправления (рабочие минуты и дни). */
	workHours: { start: string; end: string };
	/** Рабочая неделя, ISO-дни через запятую («1,2,3,4,5»). Праздники и переносы — в производственном календаре. */
	workDays: string;
	/** false — сроки календарные (круглосуточная поддержка). */
	slaWorkingTime: boolean;
	sla: { reactionMinutes: Record<Priority, number>; resolveHours: Record<Priority, number> };
	escalation: { overdueToManagerDays: number; idleDays: number; idleToChiefDays: number };
	errorControl: { controlDeadlineDays: number; reopenWindowDays: number };
	findings: { deadlineDays: number; perCheckDeadlineDays: Record<string, number> };
	violations: { systematicThreshold: number; systematicMonths: number };
	attendance: { source: "button" | "login" | "both"; evaluateDaysBack: number };
	consultation: { maxLength: number };
	primaryDocs: { reportDay: number; lateWindowDays: number; lateShareThreshold: number };
}
export const fetchQualitySettings = () =>
	api.get<{ success: boolean; data: { settings: QualitySettings; defaults: QualitySettings; firmOrganizationUuid: string | null; firmExplicit: boolean } }>("/quality/settings").then((r) => r.data);
export const saveQualitySettings = (body: { settings?: Partial<QualitySettings>; firmOrganizationUuid?: string | null }) =>
	api.put<{ success: boolean; data: { settings: QualitySettings; firmOrganizationUuid: string | null } }>("/quality/settings", body).then((r) => r.data);

// ── Уведомления и Telegram ───────────────────────────────────────────────────
export interface NotificationLink { endpoint?: string; uuid?: string; pane?: string }
export interface UserNotification {
	uuid: string;
	kind: string;
	title: string;
	body: string | null;
	link: NotificationLink | null;
	readAt: string | null;
	createdAt: string;
}
export const fetchNotifications = (params: { unread?: boolean; since?: string; limit?: number } = {}) =>
	api.get<{ success: boolean; items: UserNotification[]; unreadCount: number }>("/quality/notifications", {
		params: { ...(params.unread ? { unread: 1 } : {}), ...(params.since ? { since: params.since } : {}), limit: params.limit ?? 100 },
	});
export const markNotificationsRead = (body: { uuids?: string[]; all?: boolean }) => api.post<{ success: boolean }>("/quality/notifications/read", body);
export const fetchTelegramStatus = () => api.get<{ success: boolean; data: TelegramStatus }>("/quality/telegram").then((r) => r.data);
export const createTelegramLink = () =>
	api.post<{ success: boolean; data: { code: string; url: string | null; botName: string | null; enabled: boolean } }>("/quality/telegram/link").then((r) => r.data);
export const unlinkTelegram = () => api.delete<{ success: boolean }>("/quality/telegram");

// ── Задачи (действия E17) ────────────────────────────────────────────────────
export type TodoKind = "task" | "client_request" | "error" | "control" | "check_finding" | "regulation" | "manager_order";
export type Priority = "low" | "normal" | "high" | "urgent";
export const TODO_KINDS: TodoKind[] = ["task", "client_request", "error", "control", "check_finding", "regulation", "manager_order"];
export const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];
export const REPORTED_BY = ["client", "staff", "chief", "check"] as const;

export interface TodoEventRow {
	uuid: string;
	type: string;
	actorName: string | null;
	fromUserName: string | null;
	toUserName: string | null;
	channel: string | null;
	note: string | null;
	payload: Record<string, unknown> | null;
	createdAt: string;
}
export interface TodoWatcherRow { uuid: string; userUuid: string; userName: string; reason: string; createdAt: string }
export const fetchTodoHistory = (uuid: string) =>
	api.get<{ success: boolean; events: TodoEventRow[]; watchers: TodoWatcherRow[] }>(`/todos/${uuid}/history`);
export const acceptTodo = (uuid: string) => api.post<{ success: boolean }>(`/todos/${uuid}/accept`);
export const remindTodo = (uuid: string, body: { note?: string; channel?: string }) => api.post<{ success: boolean }>(`/todos/${uuid}/remind`, body);
export const returnTodo = (uuid: string, reason: string) => api.post<{ success: boolean }>(`/todos/${uuid}/return`, { reason });
export const helpTodo = (uuid: string, note?: string) => api.post<{ success: boolean; notified: number }>(`/todos/${uuid}/help`, { note });
export const rateTodo = (uuid: string, rating: number, comment?: string) => api.post<{ success: boolean }>(`/todos/${uuid}/rate`, { rating, comment });

// ── Нарушения и бонус ────────────────────────────────────────────────────────
export type ViolationStatus = "candidate" | "confirmed" | "disputed" | "rejected";
export interface EvidenceRow { kind: string; uuid?: string; label?: string; [k: string]: unknown }
export interface Violation {
	id: number;
	uuid: string;
	userUuid: string;
	userName: string | null;
	clientOrganizationUuid: string | null;
	clientName: string | null;
	itemNumber: number;
	itemTitle: string | null;
	occurredAt: string;
	detectedAt: string;
	bonusMonth: string;
	description: string;
	evidence: EvidenceRow[] | null;
	source: string;
	status: ViolationStatus;
	selfDetected: boolean;
	decidedByName: string | null;
	decidedAt: string | null;
	decisionNote: string | null;
	disputeText: string | null;
	disputedAt: string | null;
	disputeDecision: string | null;
	disputeDecidedByName: string | null;
	createdByName: string | null;
	canDecide?: boolean;
	isMine?: boolean;
}
export const confirmViolation = (uuid: string, body: { note?: string; selfDetected?: boolean; selfDetectedInfo?: { foundBySelfCheck: boolean; fixedInTime: boolean; reported: boolean; noConsequences: boolean } }) =>
	api.post<{ success: boolean; item: Violation }>(`/standard-violations/${uuid}/confirm`, body);
export const rejectViolation = (uuid: string, note: string) => api.post<{ success: boolean; item: Violation }>(`/standard-violations/${uuid}/reject`, { note });
export const disputeViolation = (uuid: string, text: string) => api.post<{ success: boolean; item: Violation }>(`/standard-violations/${uuid}/dispute`, { text });
export const resolveDispute = (uuid: string, decision: "confirmed" | "rejected", note: string) =>
	api.post<{ success: boolean; item: Violation }>(`/standard-violations/${uuid}/resolve-dispute`, { decision, note });

export interface BonusRow {
	userUuid: string;
	userName: string;
	groupName: string | null;
	role: string | null;
	bonus: boolean;
	confirmedCount: number;
	violations: { uuid: string; itemNumber: number; description: string; detectedAt: string }[];
	pendingCandidates: number;
	disputed: number;
	windowCount: number;
	systematic: boolean;
	noMeasure: boolean;
}
export interface BonusMonthData {
	month: string;
	closed: { closedAt: string; closedByName: string | null } | null;
	items: BonusRow[];
	systematicMonths: number;
	systematicThreshold: number;
}
export const fetchBonus = (month?: string) => api.get<{ success: boolean; data: BonusMonthData }>("/quality/bonus", { params: month ? { month } : {} }).then((r) => r.data);
export const closeBonusMonth = (month: string, force = false) => api.post<{ success: boolean }>("/quality/bonus/close", { month, force });
export const reopenBonusMonth = (month: string) => api.post<{ success: boolean }>("/quality/bonus/reopen", { month });

export interface Measure { uuid: string; userUuid: string; userName: string | null; kind: string; date: string; note: string | null; createdByUuid: string | null; createdByName: string | null }
export const MEASURE_KINDS = ["talk", "training", "warning", "other"] as const;
export const fetchMeasures = (userUuid?: string) =>
	api.get<{ success: boolean; items: Measure[] }>("/violation-measures", { params: userUuid ? { "filter[userUuid][equals]": userUuid } : {} });
export const createMeasure = (body: { userUuid: string; kind: string; note: string; date?: string; violationUuid?: string }) => api.post<{ success: boolean; item: Measure }>("/violation-measures", body);
export const deleteMeasure = (uuid: string) => api.delete<{ success: boolean }>(`/violation-measures/${uuid}`);

// ── Справочники ──────────────────────────────────────────────────────────────
export interface StandardItem { uuid: string; id: number; number: number; title: string; text: string; appliesTo: string; kind: string; isActive: boolean; version: string | null }
export const fetchStandardItems = () => api.get<{ success: boolean; items: StandardItem[] }>("/standard-items");
export const seedStandardItems = () => api.post<{ success: boolean; data: { created: number } }>("/standard-items/seed");

// ── Проверки учёта ───────────────────────────────────────────────────────────
export interface CheckFinding {
	id: number;
	uuid: string;
	organizationUuid: string;
	organizationName: string | null;
	checkCode: string;
	checkTitle: string;
	area: string;
	fingerprint: string;
	severity: "error" | "warning" | "info";
	title: string;
	factDate: string | null;
	amount: string | number | null;
	data: { account?: string | null; quantity?: number | null; objects?: { kind: string; id: string; name?: string }[]; documents?: { kind: string; documentType?: string; id: string; number?: string; date?: string }[]; details?: Record<string, unknown> } | null;
	firstSeenAt: string;
	lastSeenAt: string;
	resolvedAt: string | null;
	exceptionReason: string | null;
	exceptionByName: string | null;
	exceptionAt: string | null;
	exceptionUntil: string | null;
	exceptionActive: boolean;
	state: "open" | "resolved" | "exception";
	todoUuid: string | null;
	canDecide?: boolean;
}
export const setFindingException = (uuid: string, reason: string, until?: string | null) =>
	api.post<{ success: boolean }>(`/check-findings/${uuid}/exception`, { reason, until: until || null });
export const clearFindingException = (uuid: string) => api.delete<{ success: boolean }>(`/check-findings/${uuid}/exception`);

export interface KnRowInput { kbk?: string | null; name?: string | null; balance: number | string }
export interface KnComparisonRow { kbk: string | null; name: string | null; knBalance: number; onecBalance: number | null; diff: number | null; matched: boolean; ok: boolean }
export interface KnStatement {
	uuid: string;
	id: number;
	organizationUuid: string;
	organizationName?: string | null;
	onDate: string;
	rows?: KnRowInput[];
	comparison: { rows: KnComparisonRow[]; mismatches: number; total: number; snapshotAt: string | null; note?: string } | null;
	userName?: string | null;
	mismatches?: number | null;
	createdAt: string;
}
export const createKnStatement = (body: { organizationUuid: string; onDate: string; rows: KnRowInput[] }) => api.post<{ success: boolean; item: KnStatement }>("/kn-statements", body);
export const fetchKnStatement = (uuid: string) => api.get<{ success: boolean; item: KnStatement }>(`/kn-statements/${uuid}`);

export interface PrimaryDocsData {
	month: string;
	deadline: string;
	windowStart: string;
	series: { at: string; count: number }[];
	lateShare: number | null;
	signal: boolean;
	receipts: { uuid: string; month: string; receivedAt: string; complete: boolean; note: string | null; userName: string | null }[];
}
export const fetchPrimaryDocs = (organizationUuid: string, month?: string) =>
	api.get<{ success: boolean; data: PrimaryDocsData }>("/quality/primary-docs", { params: { organizationUuid, ...(month ? { month } : {}) } }).then((r) => r.data);
export const createPrimaryDocsReceipt = (body: { organizationUuid: string; month: string; complete?: boolean; note?: string; receivedAt?: string }) =>
	api.post<{ success: boolean }>("/primary-docs-receipts", body);
export const deletePrimaryDocsReceipt = (uuid: string) => api.delete<{ success: boolean }>(`/primary-docs-receipts/${uuid}`);

// ── Панели ────────────────────────────────────────────────────────────────────
export type AreaState = "red" | "yellow" | "green" | "none";
/**
 * Проверки базы клиента: ok — свежий прогон; stale — успешного не было больше двух суток; error — последний
 * прогон упал (агент не ответил, нет каталога); unavailable — агент или расширение не умеют проверки;
 * never — прогонов не было.
 */
export interface RunStatus { state: "ok" | "stale" | "error" | "unavailable" | "access" | "never"; code?: string | null; message?: string | null; at?: string | null; check?: string | null }
export interface AreaCell { errors: number; warnings: number; overdue: number; openTasks: number; state: AreaState }
export interface ChiefClientRow {
	organizationUuid: string;
	name: string;
	groupUuid: string;
	groupName: string;
	responsibleUuid: string | null;
	responsibleName: string | null;
	lastRunAt: string | null;
	/** Состояние проверок базы клиента (dashboards.runStatusOf); нет у старого сервера. */
	runStatus?: RunStatus;
	areas: Record<string, AreaCell>;
	requests: { open: number; unaccepted: number; overdueReaction: number; state: AreaState };
	deadlines: { overdue: number; open: number; state: AreaState };
	primaryDocs: { received: boolean; complete?: boolean; receivedAt?: string };
	kn: { onDate: string; mismatches: number | null } | null;
}
export interface ConsultationRow { uuid: string; id: number; name: string | null; result: string | null; clientRating: number | null; executorName: string | null; organizationUuid: string; completedAt: string; reasons: string[] }
export interface ChiefDashboardData { areas: string[]; clients: ChiefClientRow[]; consultations: ConsultationRow[] }
export const fetchChiefDashboard = (groupUuid?: string) =>
	api.get<{ success: boolean; data: ChiefDashboardData }>("/quality/dashboard/chief", { params: groupUuid ? { groupUuid } : {} }).then((r) => r.data);

export interface ManagerDashboardData {
	month: string;
	groups: { uuid: string; name: string; headName: string | null; staff: (BonusRow & { role: string })[]; totals: { withoutBonus: number; candidates: number; systematic: number; noMeasure: number } }[];
}
export const fetchManagerDashboard = (month?: string) =>
	api.get<{ success: boolean; data: ManagerDashboardData }>("/quality/dashboard/manager", { params: month ? { month } : {} }).then((r) => r.data);

// ── Консультация ─────────────────────────────────────────────────────────────
export interface ConsultationReview {
	ok: boolean;
	score: number;
	length: number;
	checks: { conclusion: boolean; recommendation: boolean; npa: boolean; actuality: boolean; length: boolean; notLawDump: boolean };
	suggestions: string[];
}
export const reviewConsultation = (text: string) => api.post<{ success: boolean; data: ConsultationReview }>("/quality/consultation-review", { text }).then((r) => r.data);

// ── Чек-листы ────────────────────────────────────────────────────────────────
export type ChecklistItemStatus = "pending" | "ok" | "na" | "problem";
export interface ChecklistRunItem { uuid: string; id: number; position: number; text: string; checkCode: string | null; checkTitle: string | null; status: ChecklistItemStatus; comment: string | null; confirmedByName: string | null; confirmedAt: string | null }
export interface ChecklistRun {
	uuid: string;
	id: number;
	name: string;
	clientOrganizationUuid: string;
	clientName: string | null;
	periodFrom: string;
	periodTo: string;
	executorUuid: string | null;
	executorName: string | null;
	reviewerUuid: string | null;
	reviewerName: string | null;
	status: "open" | "submitted" | "reviewed";
	submittedAt: string | null;
	reviewedAt: string | null;
	items?: ChecklistRunItem[];
	progress?: { total: number; done: number; problems: number };
	canMark?: boolean;
	canReview?: boolean;
}
export const fetchChecklistRun = (uuid: string) => api.get<{ success: boolean; item: ChecklistRun }>(`/checklist-runs/${uuid}`);
export const createChecklistRun = (body: { templateUuid: string; clientOrganizationUuid: string; periodFrom: string; periodTo: string; executorUuid?: string; reviewerUuid?: string }) =>
	api.post<{ success: boolean; item: ChecklistRun }>("/checklist-runs", body);
export const markChecklistItem = (runUuid: string, itemUuid: string, status: ChecklistItemStatus, comment?: string) =>
	api.post<{ success: boolean }>(`/checklist-runs/${runUuid}/items/${itemUuid}`, { status, comment });
export const submitChecklistRun = (uuid: string) => api.post<{ success: boolean }>(`/checklist-runs/${uuid}/submit`);
export const reviewChecklistRun = (uuid: string) => api.post<{ success: boolean }>(`/checklist-runs/${uuid}/review`);

// ── Посещаемость ─────────────────────────────────────────────────────────────
export interface WorkSchedule { uuid: string; userUuid: string; userName?: string; startTime: string; endTime: string; workDays: string; graceMinutes: number; isActive: boolean }
export interface AbsenceRequest { uuid: string; userUuid: string; userName?: string | null; kind: "late" | "absence" | "schedule_change"; dateFrom: string; dateTo: string; timeFrom: string | null; timeTo: string | null; reason: string | null; status: "pending" | "approved" | "rejected"; unforeseen: boolean; decidedByName?: string | null; decisionNote: string | null; createdAt: string; canDecide?: boolean }
export interface WorkDayMark { uuid: string; date: string; markedAt: string; source: string }
export interface AttendanceMe { today: string; schedule: WorkSchedule | null; mark: WorkDayMark | null; requests: AbsenceRequest[]; source: string }
export const fetchAttendanceMe = () => api.get<{ success: boolean; data: AttendanceMe }>("/attendance/me").then((r) => r.data);
export const markWorkDay = (source: "button" | "login" = "button") => api.post<{ success: boolean; data: { mark?: WorkDayMark; already?: boolean; skipped?: boolean } }>("/attendance/mark", { source });
export interface AttendanceJournalRow { userUuid: string; userName: string; schedule: WorkSchedule; mark: WorkDayMark | null; requests: AbsenceRequest[]; verdict: { verdict: string; item?: number; description?: string } }
export const fetchAttendanceJournal = (date?: string) =>
	api.get<{ success: boolean; data: { date: string; items: AttendanceJournalRow[] } }>("/attendance/journal", { params: date ? { date } : {} }).then((r) => r.data);
export const createAbsenceRequest = (body: { kind: string; dateFrom: string; dateTo?: string; timeFrom?: string; timeTo?: string; reason: string }) =>
	api.post<{ success: boolean; item: AbsenceRequest }>("/absence-requests", body);
export const decideAbsenceRequest = (uuid: string, body: { status: "approved" | "rejected"; unforeseen?: boolean; note?: string }) =>
	api.post<{ success: boolean }>(`/absence-requests/${uuid}/decide`, body);
export const deleteAbsenceRequest = (uuid: string) => api.delete<{ success: boolean }>(`/absence-requests/${uuid}`);
export const saveWorkSchedule = (body: Partial<WorkSchedule> & { userUuid: string }, uuid?: string) =>
	uuid ? api.put<{ success: boolean; item: WorkSchedule }>(`/work-schedules/${uuid}`, body) : api.post<{ success: boolean; item: WorkSchedule }>("/work-schedules", body);

// ── Дополнения панелей СК2/СК3/СК6 ───────────────────────────────────────────
// Списки без ModelList (выбор шаблона при создании прогона, заявки и графики в панели
// «Посещаемость») и удаление из форм. Формат ответа — как у остальных списков E17.

/** Прогон одной проверки учёта у клиента (журнал GET /check-runs). */
export interface CheckRun {
	id: number;
	uuid: string;
	organizationUuid: string;
	organizationName: string | null;
	checkCode: string;
	checkTitle: string;
	checkVersion: number | null;
	status: "ok" | "findings" | "skipped" | "error";
	truncated: boolean;
	total: number;
	summary: { error?: number; warning?: number; info?: number } | null;
	errorCode: string | null;
	errorMessage: string | null;
	skipReason: string | null;
	durationMs: number | null;
	createdAt: string;
}

export type ChecklistPeriodicity = "month" | "quarter" | "year" | "once";
export interface ChecklistTemplateItem { uuid?: string; position: number; text: string; checkCode: string | null; checkTitle?: string | null; standardItemNumber: number | null }
export interface ChecklistTemplate {
	uuid: string;
	id: number;
	name: string;
	description: string | null;
	periodicity: ChecklistPeriodicity;
	isActive: boolean;
	items?: ChecklistTemplateItem[];
	itemsCount?: number;
	canEdit?: boolean;
}
export const fetchChecklistTemplates = (params: { activeOnly?: boolean } = {}) =>
	api.get<{ success: boolean; items: ChecklistTemplate[] }>("/checklist-templates", {
		params: { limit: 500, ...(params.activeOnly ? { "filter[isActive][equals]": "true" } : {}) },
	});
export const deleteChecklistTemplate = (uuid: string) => api.delete<{ success: boolean }>(`/checklist-templates/${uuid}`);
export const deleteChecklistRun = (uuid: string) => api.delete<{ success: boolean }>(`/checklist-runs/${uuid}`);

/** Заявки видимых сотрудников (у строк, по которым можно решать, — canDecide). */
/** Карточка заявки: своя — всегда, чужая — главбуху, руководителю, администратору. 404 — не найдена или не видна. */
export const fetchAbsenceRequest = (uuid: string) => api.get<{ success: boolean; item: AbsenceRequest }>(`/absence-requests/${uuid}`).then((r) => r.item);
export const fetchAbsenceRequests = (params: { status?: AbsenceRequest["status"] | ""; mine?: boolean; limit?: number } = {}) =>
	api.get<{ success: boolean; items: AbsenceRequest[]; total?: number }>("/absence-requests", {
		params: {
			limit: params.limit ?? 500,
			...(params.status ? { "filter[status][equals]": params.status } : {}),
			...(params.mine ? { mine: 1 } : {}),
		},
	});
export const fetchWorkSchedules = () => api.get<{ success: boolean; items: WorkSchedule[] }>("/work-schedules", { params: { limit: 500 } });
export const deleteWorkSchedule = (uuid: string) => api.delete<{ success: boolean }>(`/work-schedules/${uuid}`);

// ── Решения 25.09: фирма, производственный календарь, проверка ответа моделью ──────────────
export interface FirmCandidate { uuid: string; name: string; bin: string | null; kind: string; members: number; isAdmin: boolean; reasons: string[] }
export const fetchFirmCandidates = () => api.get<{ success: boolean; items: FirmCandidate[]; current: string | null }>("/quality/firm-candidates");

/** День производственного календаря: holiday — праздник, dayoff — перенесённый выходной, workday — рабочий день-перенос. */
export type CalendarKind = "holiday" | "dayoff" | "workday";
export interface CalendarDay { date: string; kind: CalendarKind; name: string | null; source?: string }
export const fetchWorkCalendar = (year: number) =>
	api.get<{ success: boolean; data: { year: number; items: CalendarDay[]; byLaw: CalendarDay[] } }>("/work-calendar", { params: { year } }).then((r) => r.data);
export const saveWorkCalendarDay = (day: { date: string; kind: CalendarKind; name?: string }) => api.post<{ success: boolean }>("/work-calendar", day);
export const deleteWorkCalendarDay = (date: string) => api.delete<{ success: boolean }>(`/work-calendar/${date}`);
export const seedWorkCalendar = (year: number) => api.post<{ success: boolean; data: { year: number; created: number } }>("/work-calendar/seed", { year }).then((r) => r.data);

/** Разбор ответа клиенту моделью ИИ (сервис ai, по кнопке) — дополняет эвристики сервера. */
export interface ModelCheck { ok: boolean; note: string }
export interface ModelReview {
	verdict: "ok" | "needs_work";
	score: number;
	checks: { conclusion: ModelCheck; recommendation: ModelCheck; npa: ModelCheck & { articles?: string[] }; actuality: ModelCheck; brevity: ModelCheck; certainty: ModelCheck };
	suggestions: string[];
	rewrite: string | null;
	model: string;
	/** Дата, на которую оценивалась актуальность нормы (присланная или «сегодня» сервиса). */
	date?: string;
}
export const reviewConsultationByModel = (body: { text: string; question?: string; date?: string }) =>
	aiFetch<ModelReview>("/v1/quality/review-answer", { method: "POST", body: JSON.stringify(body) });
