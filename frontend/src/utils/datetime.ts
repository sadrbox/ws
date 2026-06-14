// ── UTC offset singleton ─────────────────────────────────────────────────────
// Читается из localStorage при загрузке модуля — до рендера React.
// useGeneralSettings вызывает setAppUtcOffset() при изменении настройки.
const GENERAL_SETTINGS_KEY = "app_general_settings";
const MS_PER_HOUR = 3_600_000;
const DEFAULT_UTC_OFFSET = 5; // UTC+5 (Kazakhstan / Nur-Sultan)

let _utcOffsetHours: number = (() => {
	try {
		const raw = localStorage.getItem(GENERAL_SETTINGS_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as { utcOffset?: unknown };
			if (typeof parsed.utcOffset === "number") return parsed.utcOffset;
		}
	} catch { /* ignore */ }
	return DEFAULT_UTC_OFFSET;
})();

export function setAppUtcOffset(hours: number): void {
	_utcOffsetHours = hours;
}

export function getAppUtcOffset(): number {
	return _utcOffsetHours;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** Смещает UTC-момент на _utcOffsetHours и возвращает объект Date, чьи
 *  UTC-компоненты (getUTCDate, getUTCHours …) соответствуют «локальному»
 *  времени в сконфигурированном часовом поясе. */
function shiftToConfiguredTz(utcMs: number): Date {
	return new Date(utcMs + _utcOffsetHours * MS_PER_HOUR);
}

/** "дд.мм.гггг" из объекта Date по его UTC-компонентам. */
function formatShiftedDate(d: Date): string {
	return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

// ── Date formatting ───────────────────────────────────────────────────────────

/** Форматирует строку даты/ISO в "дд.мм.гггг" с учётом настроенного UTC-смещения. */
export const getFormatDateOnly = (dateString?: string | null): string => {
	if (!dateString) return "";
	const s = String(dateString).slice(0, 32).trim();
	if (!s) return "";
	// "YYYY-MM-DD" без TZ — чистая дата, отображаем как есть (не конвертируем).
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
	}
	// ISO с временем/TZ → сдвигаем на настроенный offset.
	const d = new Date(s);
	if (isNaN(d.getTime())) return s;
	return formatShiftedDate(shiftToConfiguredTz(d.getTime()));
};

/** Форматирует строку даты/ISO в "дд.мм.гггг чч:мм" с учётом настроенного UTC-смещения. */
export const getFormatDate = (dateString?: string): string => {
	if (!dateString) return "";
	const d = new Date(dateString);
	if (isNaN(d.getTime())) return "";
	const shifted = shiftToConfiguredTz(d.getTime());
	return `${formatShiftedDate(shifted)} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
};

// ── ISO ↔ <input type="datetime-local"> ──────────────────────────────────────
// Сервер хранит дату в UTC. Форма использует <input type="datetime-local">,
// который оперирует значениями без TZ-суффикса. Функции переводят между
// UTC ISO и «локальным» временем в настроенном часовом поясе.

/** ISO/Date → "YYYY-MM-DDTHH:mm" в настроенном часовом поясе (для datetime-local). */
export const isoToLocalInput = (value?: string | Date | null): string => {
	if (!value) return "";
	const d = value instanceof Date ? value : new Date(value);
	if (isNaN(d.getTime())) return "";
	const shifted = shiftToConfiguredTz(d.getTime());
	return (
		`${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
		`T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
	);
};

/** "YYYY-MM-DDTHH:mm" (в настроенном TZ) или "YYYY-MM-DD" → ISO UTC для сервера. */
export const localInputToIso = (value?: string | null): string | null => {
	if (!value) return null;
	const s = String(value).trim();
	if (!s) return null;
	// Только дата → 00:00 в настроенном TZ; datetime-local → секунды добиваем сами.
	let utcBaseIso: string | null = null;
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) utcBaseIso = `${s}T00:00:00Z`;
	else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) utcBaseIso = `${s}:00Z`;

	if (utcBaseIso) {
		// Трактуем компоненты как «настроенный TZ» → вычитаем смещение для UTC.
		const utcMs = new Date(utcBaseIso).getTime() - _utcOffsetHours * MS_PER_HOUR;
		return isNaN(utcMs) ? null : new Date(utcMs).toISOString();
	}
	const d = new Date(s);
	return isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * Период «YYYY-MM» → границы месяца в ISO (UTC-полночь первого и последнего дня).
 * Используется регламентными документами (закрытие месяца): periodStart — 1-е
 * число, periodEnd — последний день месяца. Пустой/некорректный ввод → null/null.
 */
export const monthPeriodToRange = (period?: string | null): { start: string | null; end: string | null } => {
	const m = /^(\d{4})-(\d{2})$/.exec((period ?? "").trim());
	if (!m) return { start: null, end: null };
	const y = parseInt(m[1], 10);
	const mo = parseInt(m[2], 10);
	if (mo < 1 || mo > 12) return { start: null, end: null };
	const start = new Date(Date.UTC(y, mo - 1, 1, 0, 0, 0));
	const end = new Date(Date.UTC(y, mo, 0, 0, 0, 0)); // день 0 след. месяца = последний день текущего
	return { start: start.toISOString(), end: end.toISOString() };
};

/** ISO-дата → период «YYYY-MM» (по UTC). Для обратной инициализации FieldPeriod. */
export const isoToMonthPeriod = (value?: string | null): string => {
	if (!value) return "";
	const d = new Date(value);
	if (isNaN(d.getTime())) return "";
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
