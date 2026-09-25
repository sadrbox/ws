// Правила трудовой дисциплины (E17 СК6, пп. 32–34) — чистые функции без Prisma.
//
//  п. 32 — опоздание без ПРЕДВАРИТЕЛЬНОГО согласования;
//  п. 33 — отсутствие (или изменение времени) без согласования;
//  п. 34 — несвоевременное уведомление: заявка подана после начала дня. Исключение —
//          объективная непредвиденная причина; её отмечает согласующий (`unforeseen`).
//
// Праздники и переносы берутся из производственного календаря (workTime.js, calendar.js): в праздник
// и перенесённый выходной правило молчит, в рабочую субботу по переносу — ждёт отметку.

import { isoWeekdayOf, localToUtc, parseHm } from "./time.js";

export const ABSENCE_KINDS = ["late", "absence", "schedule_change"];

/**
 * Рабочий ли день у сотрудника: производственный календарь главнее графика — праздник и перенесённый
 * выходной не рабочие, рабочий день-перенос (суббота по постановлению) — рабочий; иначе — по графику.
 */
export function isWorkday(schedule, ymd, dayKind = null) {
	const kind = dayKind?.(ymd) ?? null;
	if (kind === "holiday" || kind === "dayoff") return false;
	if (kind === "workday") return true;
	const days = String(schedule?.workDays ?? "1,2,3,4,5").split(",").map((s) => Number(s.trim())).filter(Boolean);
	return days.includes(isoWeekdayOf(ymd));
}

/** Заявка покрывает дату. Для «опоздания» это тот же день. */
function covers(r, ymd) {
	return r.dateFrom <= ymd && ymd <= r.dateTo;
}

/**
 * Вердикт по одному дню одного сотрудника.
 * @param {{schedule:object, ymd:string, mark:{markedAt:Date|string}|null, requests:object[], now:Date, offsetMinutes:number}} p
 * @returns {{verdict:"not_workday"|"too_early"|"ok"|"pending"|"violation", item?:number, rule?:string, description?:string}}
 */
export function evaluateDay({ schedule, ymd, mark, requests, now, offsetMinutes, dayKind = null }) {
	if (!schedule || schedule.isActive === false) return { verdict: "not_workday" };
	if (!isWorkday(schedule, ymd, dayKind)) return { verdict: "not_workday" };
	const startMin = parseHm(schedule.startTime) ?? 540;
	const endMin = parseHm(schedule.endTime) ?? 1080;
	const grace = Number.isFinite(schedule.graceMinutes) ? schedule.graceMinutes : 10;
	const startAt = localToUtc(ymd, startMin, offsetMinutes);
	const lateAfter = new Date(startAt.getTime() + grace * 60_000);
	const endAt = localToUtc(ymd, endMin, offsetMinutes);

	const markedAt = mark ? new Date(mark.markedAt) : null;
	const onTime = markedAt && markedAt.getTime() <= lateAfter.getTime();
	if (onTime) return { verdict: "ok" };

	const late = !!markedAt; // пришёл, но позже допуска
	// Ещё не конец дня и отметки нет — рано судить: человек может прийти.
	if (!late && now.getTime() < endAt.getTime()) return { verdict: "too_early" };
	if (late && now.getTime() < lateAfter.getTime()) return { verdict: "too_early" };

	const relevant = (requests || []).filter((r) => !r.deletedAt && covers(r, ymd) && (late ? ["late", "absence", "schedule_change"] : ["absence", "schedule_change"]).includes(r.kind));
	// На заявку ещё не ответили — ждём решения, не заводим кандидата раньше времени.
	if (relevant.some((r) => r.status === "pending")) return { verdict: "pending" };
	const approved = relevant.filter((r) => r.status === "approved");
	if (approved.length) {
		const inAdvance = approved.some((r) => new Date(r.createdAt).getTime() <= startAt.getTime());
		if (inAdvance || approved.some((r) => r.unforeseen)) return { verdict: "ok" };
		return {
			verdict: "violation", item: 34, rule: late ? "late_notice" : "absence_notice",
			description: late
				? `Опоздание ${ymd}: заявка подана уже после начала рабочего дня`
				: `Отсутствие ${ymd}: заявка подана уже после начала рабочего дня`,
		};
	}
	if (late) {
		const minutes = Math.round((markedAt.getTime() - startAt.getTime()) / 60_000);
		return { verdict: "violation", item: 32, rule: "late", description: `Опоздание ${ymd} на ${minutes} мин без предварительного согласования` };
	}
	return { verdict: "violation", item: 33, rule: "absent", description: `Отсутствие ${ymd} без согласования: отметки начала дня нет` };
}

export default { ABSENCE_KINDS, isWorkday, evaluateDay };
