/**
 * Регламентные задачи (E17 СК1.7) — чистые правила формы и списка расписаний, без JSX
 * (Fast Refresh: index.tsx отдаёт только компоненты).
 *
 * Расписание больше не справочник «на память»: активное расписание с cron-выражением исполняет
 * backend (services/quality/jobs.js → runScheduledTasks) и создаёт задачи вида «regulation».
 * Выражение проверяет сервер (400 «Расписание: …» — сообщение формы); срок задачи в днях —
 * здесь и на сервере одинаково: целое от 0 до 365.
 */
import { translate } from "src/i18";
import { asText } from "src/utils/asText";

/** Статусы расписания. Исполняется только active. */
export const SCHEDULE_STATUS_KEYS: Record<string, string> = {
	active: "scheduleStatusActive",
	paused: "scheduleStatusPaused",
	completed: "scheduleStatusCompleted",
};

export function scheduleStatusLabel(code: unknown): string {
	const c = asText(code);
	const key = SCHEDULE_STATUS_KEYS[c];
	return key ? translate(key) : c;
}

export const scheduleStatusOptions = (): { value: string; label: string }[] =>
	Object.keys(SCHEDULE_STATUS_KEYS).map((code) => ({ value: code, label: scheduleStatusLabel(code) }));

export const MAX_DEADLINE_DAYS = 365;

/** Срок задачи в днях: пусто — без срока; иначе целое 0–365. Текст ошибки или null. */
export function deadlineDaysError(value: string): string | null {
	const v = value.trim();
	if (!v) return null;
	if (!/^\d+$/.test(v) || Number(v) > MAX_DEADLINE_DAYS) return translate("scheduleDeadlineDaysInvalid");
	return null;
}

/** Срок в днях для запроса: пусто — null (без срока). Вызывать после deadlineDaysError. */
export const deadlineDaysValue = (value: string): number | null => (value.trim() ? Number(value.trim()) : null);

/**
 * Смещение местного времени расписаний («UTC+5», «UTC+5:30», «UTC−3»). Время в cron — местное:
 * «1-го числа в 9:00» бухгалтер понимает по часам на стене (services/quality/cron.js).
 */
export function tzLabel(offsetMinutes: number): string {
	const m = Math.round(Number(offsetMinutes) || 0);
	const sign = m < 0 ? "−" : "+";
	const abs = Math.abs(m);
	const h = Math.floor(abs / 60);
	const rest = abs % 60;
	return `UTC${sign}${h}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

/** Смещение по умолчанию, пока настройки не пришли: Казахстан с 01.03.2024 — UTC+5 (как на сервере). */
export const DEFAULT_TZ_OFFSET_MINUTES = 300;
