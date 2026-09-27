// ─────────────────────────────────────────────────────────────────────────────
// Границы суток, месяца и года В ПОЯСЕ ОРГАНИЗАЦИИ — единый помощник учёта.
//
// ЗАЧЕМ (аудит 26.09, У5). В учёте жили ТРИ разные границы суток:
//   • закрытие месяца — начало периода в полночь UTC (05:00 по Алматы), конец — по
//     местному времени сервера: документ от 01.06 00:30 не попадал ни в закрытие мая,
//     ни в закрытие июня;
//   • ОСВ и отчёты — сутки UTC (`dateTo + "T23:59:59.999Z"`), то есть местные сутки,
//     сдвинутые на 5 часов;
//   • амортизация — месяц по UTC: ОС, введённое 01.06 в 00:00 по Алматы, считалось
//     введённым в мае.
// Теперь все они берут границы ЗДЕСЬ, и все — в поясе организации.
//
// ПОЯС. Отдельного поля пояса у организации в схеме нет; все клиенты — в Казахстане,
// где с 01.03.2024 единый пояс UTC+5. Поэтому пояс — IANA-имя из переменной
// ACCOUNTING_TIME_ZONE (по умолчанию Asia/Almaty). IANA-имя, а не смещение: история
// поясов (до 01.03.2024 Алматы жила в UTC+6) учитывается сама, и старые периоды
// считаются так, как их видели тогда.
// Проверить потом: если появятся организации в других поясах — завести поле пояса у
// организации (схема — зона «backend-платформа») и возвращать его из orgTimeZone().
//
// КАЛЕНДАРНАЯ ДАТА ЗНАЧЕНИЯ. Даты периода хранятся по-разному: форма «Закрытие месяца»
// шлёт полночь UTC («2026-06-01T00:00:00Z»), старые записи могли прийти местной
// полуночью («2026-05-31T19:00:00Z»), фильтры отчётов — строкой «2026-06-01». Для
// пояса с положительным смещением день момента в местном времени во всех трёх случаях
// один и тот же — 01.06, — поэтому календарная дата берётся как местная дата момента,
// а строка «ГГГГ-ММ-ДД» — буквально.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_TIME_ZONE = "Asia/Almaty";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Пояс учёта организации (IANA). Сейчас общий для установки — см. шапку. */
export function orgTimeZone(_organizationUuid = null) {
	const tz = String(process.env.ACCOUNTING_TIME_ZONE || "").trim();
	return tz || DEFAULT_TIME_ZONE;
}

// Форматтеры дорогие в создании — по одному на пояс.
const formatters = new Map();
function formatterOf(tz) {
	let f = formatters.get(tz);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		formatters.set(tz, f);
	}
	return f;
}

/** Смещение пояса от UTC в момент `instant`, минут (Алматы 2026 → 300). */
export function tzOffsetMinutes(instant, tz = DEFAULT_TIME_ZONE) {
	const ms = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
	const whole = Math.floor(ms / 1000) * 1000; // форматтер отдаёт целые секунды
	const parts = formatterOf(tz).formatToParts(new Date(whole));
	const get = (type) => Number(parts.find((p) => p.type === type)?.value);
	const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
	return Math.round((asUtc - whole) / 60000);
}

/** Местная календарная дата момента: { y, m (1–12), d }. */
export function localDateOf(instant, tz = DEFAULT_TIME_ZONE) {
	const d = instant instanceof Date ? instant : new Date(instant);
	const shifted = new Date(d.getTime() + tzOffsetMinutes(d, tz) * 60000);
	return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/**
 * Момент местной полуночи дня y-m-d. Переполнение дня/месяца допустимо
 * (d = 32 → 1-е следующего месяца) — так удобно брать «начало следующих суток».
 */
export function zonedMidnight(y, m, d, tz = DEFAULT_TIME_ZONE) {
	const guess = Date.UTC(y, m - 1, d);
	const off = tzOffsetMinutes(new Date(guess), tz);
	let t = guess - off * 60000;
	// На стыке смены смещения первое приближение могло взять «чужое» смещение.
	const off2 = tzOffsetMinutes(new Date(t), tz);
	if (off2 !== off) t = guess - off2 * 60000;
	return new Date(t);
}

/**
 * Календарная дата значения: строка «ГГГГ-ММ-ДД» — буквально, иначе — местная дата
 * момента. Пусто/мусор → null.
 */
export function calendarDateOf(value, tz = DEFAULT_TIME_ZONE) {
	if (value == null || value === "") return null;
	if (typeof value === "string") {
		const m = DATE_ONLY.exec(value.trim());
		if (m) {
			const c = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
			return c.m >= 1 && c.m <= 12 && c.d >= 1 && c.d <= 31 ? c : null;
		}
	}
	const dt = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(dt.getTime())) return null;
	return localDateOf(dt, tz);
}

/** Начало местных суток дня значения (null — пусто/мусор). */
export function startOfLocalDay(value, tz = DEFAULT_TIME_ZONE) {
	const c = calendarDateOf(value, tz);
	return c ? zonedMidnight(c.y, c.m, c.d, tz) : null;
}

/** Последняя миллисекунда местных суток дня значения (для условий `lte`). */
export function endOfLocalDay(value, tz = DEFAULT_TIME_ZONE) {
	const c = calendarDateOf(value, tz);
	return c ? new Date(zonedMidnight(c.y, c.m, c.d + 1, tz).getTime() - 1) : null;
}

/**
 * Границы периода документа (закрытие месяца и т. п.): от местной полуночи первого
 * дня до последней миллисекунды последнего дня включительно.
 */
export function periodBounds(periodStart, periodEnd, tz = DEFAULT_TIME_ZONE) {
	return { start: startOfLocalDay(periodStart, tz), end: endOfLocalDay(periodEnd, tz) };
}

/** Индекс местного месяца: год × 12 + (месяц − 1). */
export function localMonthIndex(value, tz = DEFAULT_TIME_ZONE) {
	const c = calendarDateOf(value, tz);
	return c ? c.y * 12 + (c.m - 1) : null;
}

/** Местный календарный год значения. */
export function localYear(value, tz = DEFAULT_TIME_ZONE) {
	return calendarDateOf(value, tz)?.y ?? null;
}

/** Границы местного года: [start, end) — end = начало следующего года. */
export function yearBounds(year, tz = DEFAULT_TIME_ZONE) {
	return { start: zonedMidnight(year, 1, 1, tz), end: zonedMidnight(year + 1, 1, 1, tz) };
}

/** Некорректная дата в параметрах запроса (→ HTTP 400). */
export class BadDateError extends Error {
	constructor(name, value) {
		super(`Некорректная дата в параметре ${name}: «${value}»`);
		this.name = "BadDateError";
	}
}

/**
 * Условие Prisma по полю даты для фильтра отчёта «с … по …» (обе даты включительно,
 * сутки — местные). Пустые параметры пропускаются; оба пусты → null.
 * Бросает BadDateError, если дата не разбирается.
 */
export function dateRangeWhere(dateFrom, dateTo, tz = DEFAULT_TIME_ZONE) {
	const range = {};
	if (dateFrom) {
		const from = startOfLocalDay(dateFrom, tz);
		if (!from) throw new BadDateError("dateFrom", dateFrom);
		range.gte = from;
	}
	if (dateTo) {
		const to = endOfLocalDay(dateTo, tz);
		if (!to) throw new BadDateError("dateTo", dateTo);
		range.lte = to;
	}
	return Object.keys(range).length ? range : null;
}

/** Маппинг BadDateError → HTTP 400. Возвращает true, если ответ отправлен. */
export function respondBadDateError(err, res) {
	if (err instanceof BadDateError) {
		res.status(400).json({ success: false, message: err.message });
		return true;
	}
	return false;
}

export default {
	DEFAULT_TIME_ZONE,
	orgTimeZone,
	tzOffsetMinutes,
	localDateOf,
	zonedMidnight,
	calendarDateOf,
	startOfLocalDay,
	endOfLocalDay,
	periodBounds,
	localMonthIndex,
	localYear,
	yearBounds,
	dateRangeWhere,
	BadDateError,
	respondBadDateError,
};
