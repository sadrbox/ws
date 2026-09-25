/**
 * Производственный календарь (E17) — чистые помощники экрана: сетка месяца, рабочие дни, сверка
 * внесённого с законом.
 *
 * По календарю сервер считает все сроки стандарта в рабочем времени (SLA обращений, отработка находок,
 * проверка исправления) и выносит вердикт посещаемости: праздник и перенесённый выходной — не рабочие,
 * рабочий день-перенос (суббота по постановлению) — рабочий, прочие дни — по рабочей неделе фирмы
 * (backend/services/quality/workTime.js isWorkingDay). Экран считает так же — иначе «рабочих дней в
 * месяце» на экране и в сроках разошлись бы.
 */
import { translate } from "src/i18";
import type { QualityTone } from "src/models/_quality/QualityChip";
import type { CalendarDay, CalendarKind } from "src/services/quality/api";
import { dayLabel, parseWorkDays } from "src/models/_quality/workWeek";
import { withStableIds } from "src/utils/stableRowId";

export const CALENDAR_KINDS: readonly CalendarKind[] = ["holiday", "dayoff", "workday"];

const KIND_KEYS: Record<CalendarKind, string> = {
	holiday: "workCalendarHoliday",
	dayoff: "workCalendarDayoff",
	workday: "workCalendarWorkday",
};
export const kindLabel = (k: string): string => (KIND_KEYS[k as CalendarKind] ? translate(KIND_KEYS[k as CalendarKind]) : k);

const pad = (n: number) => String(n).padStart(2, "0");
export const ymdOf = (year: number, month: number, day: number): string => `${year}-${pad(month)}-${pad(day)}`;

/** День недели ISO (1 — пн … 7 — вс) по календарной дате, без часового пояса браузера. */
export function isoWeekday(ymd: string): number {
	const [y, m, d] = ymd.split("-").map(Number);
	const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return wd === 0 ? 7 : wd;
}

export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Рабочий ли день: перенос-«рабочий» — да; праздник и перенесённый выходной — нет; иначе — по неделе фирмы. */
export function isWorkingDay(weekday: number, kind: CalendarKind | null, weekFlags: readonly boolean[]): boolean {
	if (kind === "workday") return true;
	if (kind === "holiday" || kind === "dayoff") return false;
	return !!weekFlags[weekday - 1];
}

export interface CalendarCell {
	ymd: string;
	day: number;
	weekday: number;
	kind: CalendarKind | null;
	name: string | null;
	working: boolean;
	today: boolean;
}

export type CalendarIndex = ReadonlyMap<string, CalendarDay>;
export const indexCalendar = (items: readonly CalendarDay[]): CalendarIndex => new Map(items.map((d) => [d.date, d]));

/** Месяц по неделям с понедельника; null — клетки до первого и после последнего числа. */
export function monthGrid(year: number, month: number, index: CalendarIndex, workDays: string, todayYmd = ""): (CalendarCell | null)[][] {
	const flags = parseWorkDays(workDays);
	const cells: (CalendarCell | null)[] = [];
	for (let i = 1; i < isoWeekday(ymdOf(year, month, 1)); i++) cells.push(null);
	const n = daysInMonth(year, month);
	for (let day = 1; day <= n; day++) {
		const ymd = ymdOf(year, month, day);
		const e = index.get(ymd);
		const kind = e && (CALENDAR_KINDS as readonly string[]).includes(e.kind) ? e.kind : null;
		const weekday = isoWeekday(ymd);
		cells.push({ ymd, day, weekday, kind, name: e?.name ?? null, working: isWorkingDay(weekday, kind, flags), today: ymd === todayYmd });
	}
	while (cells.length % 7) cells.push(null);
	const weeks: (CalendarCell | null)[][] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
	return weeks;
}

/** Рабочих дней в месяце — по неделе фирмы и календарю. */
export function workingDaysInMonth(year: number, month: number, index: CalendarIndex, workDays: string): number {
	return monthGrid(year, month, index, workDays).flat().filter((c) => c?.working).length;
}

export function workingDaysInYear(year: number, index: CalendarIndex, workDays: string): number {
	let total = 0;
	for (let m = 1; m <= 12; m++) total += workingDaysInMonth(year, m, index, workDays);
	return total;
}

/**
 * Сверка с законом. same — как по закону; changed — день есть в законе, но вид другой; extra — внесён
 * руками (перенос по постановлению, Курбан айт); missing — по закону есть, в календаре нет (убрали —
 * тогда сроки считают этот день рабочим).
 */
export type LawState = "same" | "changed" | "extra" | "missing";

const LAW_KEYS: Record<LawState, string> = {
	same: "workCalendarLawSame",
	changed: "workCalendarLawChanged",
	extra: "workCalendarLawExtra",
	missing: "workCalendarLawMissing",
};
export const lawLabel = (s: LawState): string => translate(LAW_KEYS[s]);
export const lawTone = (s: LawState): QualityTone => (s === "same" ? "ok" : s === "missing" ? "warn" : "info");

export interface CalendarEntry extends CalendarDay {
	/** Есть в календаре (а не только в законе). */
	stored: boolean;
	lawState: LawState;
}

/** Внесённое + предложенное законом, по дате. Строки «нет в календаре» — чтобы администратор мог вернуть день. */
export function calendarEntries(items: readonly CalendarDay[], byLaw: readonly CalendarDay[]): CalendarEntry[] {
	const law = indexCalendar(byLaw);
	const stored = indexCalendar(items);
	const out: CalendarEntry[] = items.map((d) => {
		const l = law.get(d.date);
		return { ...d, stored: true, lawState: !l ? "extra" : l.kind === d.kind ? "same" : "changed" };
	});
	for (const l of byLaw) if (!stored.has(l.date)) out.push({ ...l, stored: false, lawState: "missing" });
	return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Строки таблицы: дата — сырой «ГГГГ-ММ-ДД» (колонка вида date сама форматирует и верно сортирует). */
export function toCalendarRows(entries: readonly CalendarEntry[]) {
	return withStableIds(entries.map((e) => ({
		uuid: e.date,
		wcDate: e.date,
		wcWeekday: dayLabel(isoWeekday(e.date)),
		wcKind: kindLabel(e.kind),
		wcName: e.name ?? "",
		wcSource: e.stored ? translate(e.source === "manual" ? "workCalendarSourceManual" : "workCalendarSourceLaw") : "—",
		wcLaw: lawLabel(e.lawState),
		source: e,
	})), (r) => r.uuid);
}

/** Проверка дня до записи — как у сервера (POST /work-calendar). Ключи перевода ошибок. */
export function validateDay(d: { date: string; kind: string }): string[] {
	const errors: string[] = [];
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.date);
	if (!m || Number(m[3]) < 1 || Number(m[3]) > daysInMonth(Number(m[1]), Number(m[2])) || Number(m[2]) < 1 || Number(m[2]) > 12) {
		errors.push("workCalendarErrDate");
	}
	if (!(CALENDAR_KINDS as readonly string[]).includes(d.kind)) errors.push("workCalendarErrKind");
	return errors;
}

/**
 * Название месяца на языке интерфейса — от Intl, как подпись месяца бонуса (models/_quality/month.ts):
 * двенадцать ключей на двух языках ради заголовков сетки лишние. Intl не справился — номер месяца.
 */
export function monthName(month: number, lang: "ru" | "kk" = "ru"): string {
	try {
		const name = new Intl.DateTimeFormat(lang === "kk" ? "kk-KZ" : "ru-RU", { month: "long", timeZone: "UTC" })
			.format(new Date(Date.UTC(2000, month - 1, 1)));
		if (!name || /^\d+$/.test(name)) return pad(month);
		return `${name.charAt(0).toLocaleUpperCase()}${name.slice(1)}`;
	} catch {
		return pad(month);
	}
}
