// Местное время для правил E17 — чистые функции без зависимостей.
//
// Сервер может жить в UTC, а «опоздал к 9:00» и «месяц выявления» — понятия местные. Поэтому
// всё, что зависит от календаря, считается со смещением `tzOffsetMinutes` из настроек
// (Казахстан — UTC+5). ПРОВЕРИТЬ ПОТОМ: переход на часовые пояса с летним временем не нужен
// для РК, но если установка окажется в другой стране — нужен IANA-пояс вместо смещения.

const pad = (n) => String(n).padStart(2, "0");

/** Местные части момента: дата YYYY-MM-DD, месяц YYYY-MM, минуты от полуночи, день недели ISO. */
export function localParts(date, offsetMinutes = 0) {
	const t = new Date(new Date(date).getTime() + offsetMinutes * 60_000);
	const ymd = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
	const dow = t.getUTCDay();
	return {
		ymd,
		ym: ymd.slice(0, 7),
		minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
		isoWeekday: dow === 0 ? 7 : dow,
		year: t.getUTCFullYear(),
		month: t.getUTCMonth() + 1,
		day: t.getUTCDate(),
	};
}

/** "HH:MM" → минуты от полуночи; мусор → null. */
export function parseHm(hm) {
	const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm ?? "").trim());
	if (!m) return null;
	const h = Number(m[1]);
	const mi = Number(m[2]);
	if (h > 23 || mi > 59) return null;
	return h * 60 + mi;
}

/** Местные дата и время → момент UTC. */
export function localToUtc(ymd, minutesOfDay, offsetMinutes = 0) {
	const [y, mo, d] = String(ymd).split("-").map(Number);
	return new Date(Date.UTC(y, mo - 1, d, 0, 0) + (minutesOfDay - offsetMinutes) * 60_000);
}

/** Сдвиг местной даты на n дней. */
export function addDaysYmd(ymd, n) {
	const [y, mo, d] = String(ymd).split("-").map(Number);
	const t = new Date(Date.UTC(y, mo - 1, d + n));
	return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** День недели ISO (1 — понедельник … 7 — воскресенье) для местной даты. */
export function isoWeekdayOf(ymd) {
	const [y, mo, d] = String(ymd).split("-").map(Number);
	const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
	return dow === 0 ? 7 : dow;
}

/** Месяц YYYY-MM момента по местному времени. */
export function monthOf(date, offsetMinutes = 0) {
	return localParts(date, offsetMinutes).ym;
}

/** Корректный ли месяц YYYY-MM. */
export function isMonth(v) {
	return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v ?? ""));
}

/** Сдвиг месяца YYYY-MM на n (может быть отрицательным). */
export function addMonths(ym, n) {
	const [y, m] = String(ym).split("-").map(Number);
	const idx = y * 12 + (m - 1) + n;
	return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/** Границы местного месяца в UTC: [from, to) — to = начало следующего месяца. */
export function monthBounds(ym, offsetMinutes = 0) {
	const from = localToUtc(`${ym}-01`, 0, offsetMinutes);
	const to = localToUtc(`${addMonths(ym, 1)}-01`, 0, offsetMinutes);
	return { from, to };
}

export default { localParts, parseHm, localToUtc, addDaysYmd, isoWeekdayOf, monthOf, isMonth, addMonths, monthBounds };
