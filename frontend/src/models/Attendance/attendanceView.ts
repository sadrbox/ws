/**
 * Трудовая дисциплина (E17 СК6, пп. 32–34) — чистые помощники экранов «Мой день» и
 * «Посещаемость»: рабочие дни графика, вердикты дня, заявки.
 *
 * Вердикт дня выносит сервер (attendanceRules.evaluateDay): ok, pending (заявка ждёт решения),
 * not_workday, too_early (день ещё не кончился) или violation с пунктом стандарта — 32
 * (опоздание без согласования), 33 (отсутствие без заявки), 34 (заявка подана после начала дня).
 *
 * Праздники и переносы сервер берёт из производственного календаря (решено 25.09): в праздник и
 * перенесённый выходной вердикт — not_workday, в рабочую субботу по переносу отметку ждут.
 */
import { translate } from "src/i18";
import type { QualityTone } from "src/models/_quality/QualityChip";
import type { AbsenceRequest, AttendanceJournalRow, WorkSchedule } from "src/services/quality/api";
import { getFormatDateOnly, getFormatTimeOnly } from "src/utils/datetime";
import { withStableIds } from "src/utils/stableRowId";
import { normalizeHm, parseHm, workDaysText } from "src/models/_quality/workWeek";

// Рабочая неделя и «ЧЧ:ММ» — общие с настройками качества и календарём (models/_quality/workWeek.ts).
export { ISO_DAYS, dayLabel, parseWorkDays, formatWorkDays, workDaysText, parseHm, normalizeHm } from "src/models/_quality/workWeek";

/**
 * Подана ли заявка ПОСЛЕ начала рабочего дня `ymd` (п. 34): момент подачи против начала дня
 * по графику в местном времени (смещение фирмы от UTC в минутах).
 */
export function submittedAfterStart(submittedAtIso: string, ymd: string, startTime: string, offsetMinutes: number): boolean {
	const start = parseHm(startTime);
	const [y, m, d] = ymd.split("-").map(Number);
	if (start === null || !y || !m || !d) return false;
	const startUtc = Date.UTC(y, m - 1, d) + (start - offsetMinutes) * 60_000;
	const at = new Date(submittedAtIso).getTime();
	return Number.isFinite(at) && at > startUtc;
}

// ── Вердикт дня ──────────────────────────────────────────────────────────────

export type VerdictKind = "ok" | "late" | "absent" | "notice" | "pending" | "not_workday" | "too_early" | "unknown";

const VERDICT_KEYS: Record<VerdictKind, string> = {
	ok: "attendanceVerdictOk",
	late: "attendanceVerdictLate",
	absent: "attendanceVerdictAbsent",
	notice: "attendanceVerdictNotice",
	pending: "attendanceVerdictPending",
	not_workday: "attendanceVerdictNotWorkday",
	too_early: "attendanceVerdictTooEarly",
	unknown: "attendanceVerdictUnknown",
};

/** Вердикт сервера → вид: нарушение различаем по пункту стандарта (32, 33, 34). */
export function verdictKind(v: { verdict?: string; item?: number } | null | undefined): VerdictKind {
	if (!v?.verdict) return "unknown";
	if (v.verdict === "violation") return v.item === 32 ? "late" : v.item === 33 ? "absent" : v.item === 34 ? "notice" : "unknown";
	return (["ok", "pending", "not_workday", "too_early"] as const).find((k) => k === v.verdict) ?? "unknown";
}

/** Подпись вердикта; у нарушения — с пунктом стандарта. */
export function verdictLabel(v: { verdict?: string; item?: number } | null | undefined): string {
	const kind = verdictKind(v);
	const base = translate(VERDICT_KEYS[kind]);
	return v?.verdict === "violation" && v.item ? `${base} (${translate("attendanceItem")} ${v.item})` : base;
}

export function verdictTone(kind: VerdictKind): QualityTone {
	if (kind === "ok") return "ok";
	if (kind === "late" || kind === "absent" || kind === "notice") return "bad";
	if (kind === "pending") return "warn";
	return "muted";
}

// ── Заявки ───────────────────────────────────────────────────────────────────

export const ABSENCE_KINDS: readonly AbsenceRequest["kind"][] = ["late", "absence", "schedule_change"];

const KIND_KEYS: Record<AbsenceRequest["kind"], string> = {
	late: "attendanceKindLate",
	absence: "attendanceKindAbsence",
	schedule_change: "attendanceKindScheduleChange",
};
const STATUS_KEYS: Record<AbsenceRequest["status"], string> = {
	pending: "attendanceRequestPending",
	approved: "attendanceRequestApproved",
	rejected: "attendanceRequestRejected",
};

export const absenceKindLabel = (k: string): string => (KIND_KEYS[k as AbsenceRequest["kind"]] ? translate(KIND_KEYS[k as AbsenceRequest["kind"]]) : k);
export const requestStatusLabel = (s: string): string => (STATUS_KEYS[s as AbsenceRequest["status"]] ? translate(STATUS_KEYS[s as AbsenceRequest["status"]]) : s);

export function requestStatusTone(s: string): QualityTone {
	if (s === "approved") return "ok";
	if (s === "rejected") return "bad";
	if (s === "pending") return "warn";
	return "muted";
}

/** «25.09.2026» или «25.09.2026 — 27.09.2026», и время, если указано: «10:00–12:00». */
export function requestPeriodText(r: Pick<AbsenceRequest, "dateFrom" | "dateTo" | "timeFrom" | "timeTo">): string {
	const from = getFormatDateOnly(r.dateFrom);
	const dates = r.dateTo && r.dateTo !== r.dateFrom ? `${from} — ${getFormatDateOnly(r.dateTo)}` : from;
	const times = [r.timeFrom, r.timeTo].filter(Boolean).join("–");
	return times ? `${dates}, ${times}` : dates;
}

export interface AbsenceDraft {
	kind: string;
	dateFrom: string;
	dateTo: string;
	timeFrom: string;
	timeTo: string;
	reason: string;
}

/** Короче этого сервер причину не примет (attendance.js). */
export const MIN_REASON = 5;

/** Проверка заявки до отправки — ключи ошибок в порядке полей формы. */
export function validateAbsence(d: AbsenceDraft): string[] {
	const errors: string[] = [];
	if (!ABSENCE_KINDS.includes(d.kind as AbsenceRequest["kind"])) errors.push("attendanceErrKind");
	if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dateFrom)) errors.push("attendanceErrDate");
	else if (d.dateTo && d.dateTo < d.dateFrom) errors.push("attendanceErrDateOrder");
	if ((d.timeFrom && parseHm(d.timeFrom) === null) || (d.timeTo && parseHm(d.timeTo) === null)) errors.push("attendanceErrTime");
	if (d.reason.trim().length < MIN_REASON) errors.push("attendanceErrReason");
	return errors;
}

/** Тело заявки для сервера: у «опоздания» конец периода — тот же день. */
export function absencePayload(d: AbsenceDraft): { kind: string; dateFrom: string; dateTo?: string; timeFrom?: string; timeTo?: string; reason: string } {
	const oneDay = d.kind === "late" || !d.dateTo;
	return {
		kind: d.kind,
		dateFrom: d.dateFrom,
		...(oneDay ? {} : { dateTo: d.dateTo }),
		...(d.timeFrom.trim() ? { timeFrom: normalizeHm(d.timeFrom) } : {}),
		...(d.timeTo.trim() ? { timeTo: normalizeHm(d.timeTo) } : {}),
		reason: d.reason.trim(),
	};
}

// ── График ───────────────────────────────────────────────────────────────────

export interface ScheduleDraft {
	userUuid: string;
	startTime: string;
	endTime: string;
	workDays: boolean[];
	graceMinutes: string;
	isActive: boolean;
}

/** Проверка графика до записи — как у сервера (scheduleData): время, дни, допуск 0…240. */
export function validateSchedule(d: ScheduleDraft): string[] {
	const errors: string[] = [];
	if (!d.userUuid) errors.push("workScheduleErrUser");
	const start = parseHm(d.startTime);
	const end = parseHm(d.endTime);
	if (start === null || end === null) errors.push("workScheduleErrTime");
	else if (end <= start) errors.push("workScheduleErrTimeOrder");
	if (!d.workDays.some(Boolean)) errors.push("workScheduleErrDays");
	const g = Number(d.graceMinutes);
	if (d.graceMinutes.trim() === "" || !Number.isInteger(g) || g < 0 || g > 240) errors.push("workScheduleErrGrace");
	return errors;
}

// ── Строки таблиц ────────────────────────────────────────────────────────────

/** Строки таблицы заявок: плоские поля под колонки + исходная заявка для действий. */
export function toRequestRows(items: readonly AbsenceRequest[]) {
	return withStableIds(items.map((r) => ({
		uuid: r.uuid,
		attEmployee: r.userName ?? "",
		attKind: absenceKindLabel(r.kind),
		attPeriod: requestPeriodText(r),
		reason: r.reason ?? "",
		attStatus: requestStatusLabel(r.status),
		attUnforeseen: !!r.unforeseen,
		attSubmittedAt: r.createdAt,
		attDecidedBy: r.decidedByName ?? "",
		attDecisionNote: r.decisionNote ?? "",
		source: r,
	})), (r) => r.uuid);
}

/** Строки журнала дня. Отметка — время по часам приложения; вердикт — словом с пунктом. */
export function toJournalRows(items: readonly AttendanceJournalRow[]) {
	return withStableIds(items.map((j) => ({
		uuid: j.userUuid,
		attEmployee: j.userName,
		attSchedule: j.schedule ? `${j.schedule.startTime}–${j.schedule.endTime}, ${workDaysText(j.schedule.workDays)}` : "",
		attMark: j.mark ? getFormatTimeOnly(j.mark.markedAt) : "",
		attRequests: (j.requests ?? []).map((r) => `${absenceKindLabel(r.kind)}: ${requestStatusLabel(r.status)}`).join("; "),
		attVerdict: verdictLabel(j.verdict),
		source: j,
	})), (r) => r.uuid);
}

/** Строки графиков. */
export function toScheduleRows(items: readonly WorkSchedule[]) {
	return withStableIds(items.map((s) => ({
		uuid: s.uuid,
		attEmployee: s.userName ?? "",
		workScheduleStart: s.startTime,
		workScheduleEnd: s.endTime,
		workScheduleDays: workDaysText(s.workDays),
		workScheduleGrace: s.graceMinutes,
		isActive: s.isActive,
		source: s,
	})), (r) => r.uuid);
}
