// ── UTC offset singleton ─────────────────────────────────────────────────────
// Читается из localStorage при загрузке модуля — до рендера React.
// useGeneralSettings вызывает setAppUtcOffset() при изменении настройки.
const GENERAL_SETTINGS_KEY = "app_general_settings";

let _utcOffsetHours: number = (() => {
	try {
		const raw = localStorage.getItem(GENERAL_SETTINGS_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as { utcOffset?: unknown };
			if (typeof parsed.utcOffset === "number") return parsed.utcOffset;
		}
	} catch { /* ignore */ }
	return 5; // Default: UTC+5 (Kazakhstan / Nur-Sultan)
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
	return new Date(utcMs + _utcOffsetHours * 3_600_000);
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
	const shifted = shiftToConfiguredTz(d.getTime());
	return `${pad(shifted.getUTCDate())}.${pad(shifted.getUTCMonth() + 1)}.${shifted.getUTCFullYear()}`;
};

/** Форматирует строку даты/ISO в "дд.мм.гггг чч:мм" с учётом настроенного UTC-смещения. */
export const getFormatDate = (dateString?: string): string => {
	if (!dateString) return "";
	const d = new Date(dateString);
	if (isNaN(d.getTime())) return "";
	const shifted = shiftToConfiguredTz(d.getTime());
	return (
		`${pad(shifted.getUTCDate())}.${pad(shifted.getUTCMonth() + 1)}.${shifted.getUTCFullYear()}` +
		` ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
	);
};

// ── ISO ↔ <input type="datetime-local"> ──────────────────────────────────────
// Сервер хранит дату в UTC. Форма использует <input type="datetime-local">,
// который оперирует значениями без TZ-суффикса. Функции переводят между
// UTC ISO и «локальным» временем в настроенном часовом поясе.

/** ISO/Date → "YYYY-MM-DDTHH:mm" в настроенном часовом поясе (для datetime-local). */
export const isoToLocalInput = (value?: string | Date | null): string => {
	if (!value) return "";
	const d = value instanceof Date ? value : new Date(value as string);
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
	// Только дата → 00:00 в настроенном TZ
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		// Трактуем как UTC-полночь минус смещение
		const utcMs = new Date(`${s}T00:00:00Z`).getTime() - _utcOffsetHours * 3_600_000;
		return isNaN(utcMs) ? null : new Date(utcMs).toISOString();
	}
	// datetime-local → трактуем как «настроенный TZ», конвертируем в UTC
	if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
		const utcMs = new Date(`${s}:00Z`).getTime() - _utcOffsetHours * 3_600_000;
		return isNaN(utcMs) ? null : new Date(utcMs).toISOString();
	}
	const d = new Date(s);
	return isNaN(d.getTime()) ? null : d.toISOString();
};

// ── UUID polyfill ─────────────────────────────────────────────────────────────
export const crypto = {
	randomUUID: (): string =>
		"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
			const r = (Math.random() * 16) | 0;
			return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
		}),
};
