// ─────────────────────────────────────────────────────────────────────────────
// Разбор даты из события 1С.
//
// 1С шлёт дату в РУССКОМ формате: «13.07.2026 23:22:04». `new Date(...)` такое не
// понимает — в Node это Invalid Date, Prisma отвергает запрос, /pipe отвечает 500,
// и 1С уходит в ретраи (по 3 попытки на каждое событие). Событие терялось целиком
// из-за одного лишь формата даты.
//
// Поддерживаем то, что реально приходит и может прийти:
//   • «13.07.2026 23:22:04» / «13.07.2026»      — русский формат 1С;
//   • «2026-07-13T23:22:04» / «2026-07-13»      — ISO;
//   • «20260713232204»                          — компактный формат 1С.
//
// Дата — не тот реквизит, из-за которого стоит терять событие: если формат вовсе
// не распознан, отдаём null, а вызывающий подставляет время приёма.
// ─────────────────────────────────────────────────────────────────────────────

/** «13.07.2026 23:22:04» или «13.07.2026» */
const RU = /^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
/** «20260713232204» / «20260713» */
const COMPACT = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?$/;

/**
 * Собирает дату и ПРОВЕРЯЕТ, что она не «уехала».
 *
 * new Date(2026, 12, 32) не падает — он молча перекатывается в февраль 2027. Значит
 * «32.13.2026» стало бы валидной датой, и мусор из 1С тихо попал бы в журнал. Поэтому
 * сверяем, что собранная дата состоит из тех же компонентов, что пришли.
 */
function build(y, m, d, hh, mm, ss) {
	const dt = new Date(y, m - 1, d, hh, mm, ss);
	if (Number.isNaN(dt.getTime())) return null;
	const ok =
		dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d &&
		dt.getHours() === hh && dt.getMinutes() === mm && dt.getSeconds() === ss;
	return ok ? dt : null;
}

/**
 * @param {unknown} raw — значение actionDate из тела события.
 * @returns {Date|null} null — формат не распознан (вызывающий подставит now()).
 */
export function parse1cDate(raw) {
	if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
	const s = String(raw ?? "").trim();
	if (!s) return null;

	const ru = RU.exec(s);
	if (ru) {
		const [, d, m, y, hh = "0", mm = "0", ss = "0"] = ru;
		return build(Number(y), Number(m), Number(d), Number(hh), Number(mm), Number(ss));
	}

	const c = COMPACT.exec(s);
	if (c) {
		const [, y, m, d, hh = "0", mm = "0", ss = "0"] = c;
		return build(Number(y), Number(m), Number(d), Number(hh), Number(mm), Number(ss));
	}

	const iso = new Date(s);
	return Number.isNaN(iso.getTime()) ? null : iso;
}

export default { parse1cDate };
