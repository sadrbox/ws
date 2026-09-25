// Рабочее время и производственный календарь РК (E17) — чистые функции без Prisma.
//
// ЗАЧЕМ. Сроки стандарта — «принять обращение в работу», «отработать находку», «прийти к началу дня» —
// имеют смысл только в рабочем времени. В календарном обращение, пришедшее в пятницу в 17:55, стало бы
// нарушением к 18:55 пятницы, находка, найденная в субботу, «просрочилась» бы за выходные, а праздник
// выглядел бы прогулом. Поэтому все сроки E17 считаются здесь: по графику рабочей недели фирмы и
// производственному календарю (праздники, перенесённые выходные, рабочие дни-переносы).
//
// КАЛЕНДАРЬ РК ПО ЗАКОНУ (Закон «О праздниках в Республике Казахстан»): государственные и национальные
// праздники — нерабочие дни; при совпадении такого праздника с выходным выходной переносится на
// следующий после праздничного рабочий день. Для религиозных праздников (Православное Рождество,
// Курбан айт) перенос не делается. Дату Курбан айта и дополнительные переносы дней отдыха каждый год
// устанавливает Правительство — их вносят в календарь руками (экран «Производственный календарь»).
// ПРОВЕРИТЬ ПОТОМ: сверить заполненный календарь с постановлением Правительства о переносе дней отдыха
// на 2026 и 2027 годы и внести дату Курбан айта 2027.

import { localParts, localToUtc, addDaysYmd, isoWeekdayOf, parseHm } from "./time.js";

/** Государственные и национальные праздники РК: переносятся с выходного. */
export const RK_NATIONAL_HOLIDAYS = [
	{ md: "01-01", name: "Новый год" },
	{ md: "01-02", name: "Новый год" },
	{ md: "03-08", name: "Международный женский день" },
	{ md: "03-21", name: "Наурыз мейрамы" },
	{ md: "03-22", name: "Наурыз мейрамы" },
	{ md: "03-23", name: "Наурыз мейрамы" },
	{ md: "05-01", name: "Праздник единства народа Казахстана" },
	{ md: "05-07", name: "День защитника Отечества" },
	{ md: "05-09", name: "День Победы" },
	{ md: "07-06", name: "День Столицы" },
	{ md: "08-30", name: "День Конституции" },
	{ md: "10-25", name: "День Республики" },
	{ md: "12-16", name: "День Независимости" },
];

/** Религиозные праздники — нерабочие, но без переноса с выходного. */
export const RK_RELIGIOUS_FIXED = [{ md: "01-07", name: "Православное Рождество" }];

/**
 * Первый день Курбан айта — по постановлению Правительства на каждый год. Внесены только известные
 * заранее по расчёту даты; ПРОВЕРИТЬ ПОТОМ: сверить с постановлением (2026) и добавить следующие годы.
 */
export const RK_KURBAN_AIT = { 2026: "2026-05-27" };

export const CALENDAR_KINDS = ["holiday", "dayoff", "workday"];

const isWeekend = (ymd) => isoWeekdayOf(ymd) >= 6;

/**
 * Календарь РК на год по закону: праздники + переносы выходных, совпавших с государственными
 * праздниками. Возвращает [{date, kind, name}] по возрастанию даты.
 */
export function computeRkCalendar(year) {
	const out = [];
	const holidays = new Map();
	for (const h of RK_NATIONAL_HOLIDAYS) holidays.set(`${year}-${h.md}`, { name: h.name, national: true });
	for (const h of RK_RELIGIOUS_FIXED) holidays.set(`${year}-${h.md}`, { name: h.name, national: false });
	if (RK_KURBAN_AIT[year]) holidays.set(RK_KURBAN_AIT[year], { name: "Курбан айт", national: false });
	for (const [date, h] of [...holidays.entries()].sort(([a], [b]) => a.localeCompare(b))) out.push({ date, kind: "holiday", name: h.name });
	const dayoffs = new Set();
	for (const [date, h] of [...holidays.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		if (!h.national || !isWeekend(date)) continue;
		// Следующий после праздничного рабочий день: будний, не праздник и ещё не занят переносом.
		let t = addDaysYmd(date, 1);
		for (let i = 0; i < 30 && (isWeekend(t) || holidays.has(t) || dayoffs.has(t)); i++) t = addDaysYmd(t, 1);
		dayoffs.add(t);
		out.push({ date: t, kind: "dayoff", name: `Перенос выходного: ${h.name} (${date})` });
	}
	return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Функция «вид дня по календарю» из записей: holiday | dayoff | workday | null (обычный день). */
export function makeDayKind(entries) {
	const map = new Map((entries || []).map((e) => [e.date, e.kind]));
	return (ymd) => map.get(ymd) ?? null;
}

/** Дни рабочей недели из строки «1,2,3,4,5» (ISO: 1 — понедельник). */
export function parseWorkDays(v) {
	const days = String(v ?? "1,2,3,4,5").split(",").map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 7);
	return days.length ? days : [1, 2, 3, 4, 5];
}

/**
 * Параметры рабочего времени из настроек качества.
 * @returns {{offsetMinutes:number, workStart:number, workEnd:number, workDays:number[], dayKind:(ymd:string)=>string|null}}
 */
export function workOptions(settings, dayKind = () => null) {
	const start = parseHm(settings?.workHours?.start) ?? 540;
	const end = parseHm(settings?.workHours?.end) ?? 1080;
	return {
		offsetMinutes: settings?.tzOffsetMinutes ?? 300,
		workStart: start,
		workEnd: end > start ? end : 1080,
		workDays: parseWorkDays(settings?.workDays),
		dayKind,
	};
}

/** Рабочий ли день: перенос-«рабочий» — да; праздник и перенесённый выходной — нет; иначе — по неделе. */
export function isWorkingDay(ymd, opts) {
	const kind = opts?.dayKind?.(ymd) ?? null;
	if (kind === "workday") return true;
	if (kind === "holiday" || kind === "dayoff") return false;
	return (opts?.workDays ?? [1, 2, 3, 4, 5]).includes(isoWeekdayOf(ymd));
}

/**
 * Момент через `minutes` рабочих минут от `start`. Вне рабочего времени отсчёт начинается с ближайшего
 * начала рабочего дня: обращение в пятницу в 20:00 со сроком 60 минут — срок в понедельник в 10:00.
 */
export function addWorkingMinutes(start, minutes, opts) {
	let remaining = Math.max(0, Math.round(Number(minutes) || 0));
	const p = localParts(start, opts.offsetMinutes);
	let ymd = p.ymd;
	let cur = p.minutes;
	for (let i = 0; i < 800; i++) {
		if (isWorkingDay(ymd, opts)) {
			const from = Math.max(cur, opts.workStart);
			if (from < opts.workEnd) {
				const avail = opts.workEnd - from;
				if (remaining <= avail) return localToUtc(ymd, from + remaining, opts.offsetMinutes);
				remaining -= avail;
			}
		}
		ymd = addDaysYmd(ymd, 1);
		cur = 0;
	}
	// Календарь без рабочих дней на два года вперёд — ошибка настройки; не зависаем, считаем календарно.
	return new Date(new Date(start).getTime() + Number(minutes) * 60_000);
}

/**
 * Момент через `days` рабочих дней от `start` — в то же местное время. Выходные и праздники не
 * считаются: находка, найденная в субботу, со сроком 5 рабочих дней — срок в пятницу.
 */
export function addWorkingDays(start, days, opts) {
	const p = localParts(start, opts.offsetMinutes);
	let ymd = p.ymd;
	let left = Math.max(0, Math.round(Number(days) || 0));
	for (let i = 0; i < 2000 && left > 0; i++) {
		ymd = addDaysYmd(ymd, 1);
		if (isWorkingDay(ymd, opts)) left--;
	}
	return localToUtc(ymd, p.minutes, opts.offsetMinutes);
}

/** Сколько рабочих дней прошло между `from` и `to` (дни после `from` по `to` включительно). */
export function workingDaysBetween(from, to, opts) {
	const a = localParts(from, opts.offsetMinutes).ymd;
	const b = localParts(to, opts.offsetMinutes).ymd;
	if (b <= a) return 0;
	let n = 0;
	let ymd = a;
	for (let i = 0; i < 4000 && ymd < b; i++) {
		ymd = addDaysYmd(ymd, 1);
		if (isWorkingDay(ymd, opts)) n++;
	}
	return n;
}

export default {
	RK_NATIONAL_HOLIDAYS, RK_RELIGIOUS_FIXED, RK_KURBAN_AIT, CALENDAR_KINDS, computeRkCalendar, makeDayKind,
	parseWorkDays, workOptions, isWorkingDay, addWorkingMinutes, addWorkingDays, workingDaysBetween,
};
