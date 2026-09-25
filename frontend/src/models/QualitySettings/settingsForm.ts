/**
 * Настройки учёта качества (E17) — чистое отображение «настройки ↔ поля формы» и проверка ввода.
 *
 * Хранилище на сервере — вложенный JSON (services/quality/settingsRules.js DEFAULT_SETTINGS);
 * форма — плоские строки полей ввода. Сервер сливает присланное с текущим (частичное
 * сохранение): поля, которых экран не показывает (сроки находок по коду проверки), не
 * присылаются и не теряются.
 *
 * Рабочее время фирмы (часы, неделя, «сроки в рабочем времени») — отдельные поля: не числа, а время
 * «ЧЧ:ММ», дни недели и признак. Разбор — как у сервера (models/_quality/workWeek.ts).
 *
 * ПРОВЕРИТЬ ПОТОМ: все значения по умолчанию — предложение разработчика, владелец их не утверждал
 * (план, «Решения владельца», пп. 3–6). Экран показывает умолчание рядом с каждым полем.
 */
import { PRIORITIES, type Priority, type QualitySettings } from "src/services/quality/api";
import { formatWorkDays, normalizeHm, parseHm, parseWorkDays } from "src/models/_quality/workWeek";

/**
 * Настройки с датой начала действия стандарта. В типе клиента (api.ts) поля нет: его добавил
 * сервер — дату ставит первое назначение организации-фирмы, до неё правила кандидатов молчат.
 */
export type SettingsWithEffective = QualitySettings & { effectiveFrom?: string };

export interface SettingField {
	/** Ключ поля формы. */
	key: string;
	/** Путь к значению в настройках. */
	path: readonly string[];
	/** Ключ перевода подписи. */
	labelKey: string;
	min: number;
	max?: number;
	/** Хранится долей (0..1), вводится процентами. */
	percent?: boolean;
}

export interface SettingSection {
	key: string;
	titleKey: string;
	hintKey?: string;
	fields: SettingField[];
}

const PRIORITY_KEYS: Record<Priority, string> = {
	low: "qualitySettingsPriorityLow",
	normal: "qualitySettingsPriorityNormal",
	high: "qualitySettingsPriorityHigh",
	urgent: "qualitySettingsPriorityUrgent",
};

const byPriority = (prefix: string, group: string): SettingField[] =>
	PRIORITIES.map((p) => ({ key: `${prefix}_${p}`, path: ["sla", group, p], labelKey: PRIORITY_KEYS[p], min: 1 }));

/** Разделы экрана — в порядке, в каком их читает руководитель: сроки, контроль, дисциплина. */
export const SETTING_SECTIONS: SettingSection[] = [
	{
		key: "sla-reaction", titleKey: "qualitySettingsSlaReaction", hintKey: "qualitySettingsSlaReactionHint",
		fields: byPriority("reaction", "reactionMinutes"),
	},
	{
		key: "sla-resolve", titleKey: "qualitySettingsSlaResolve", hintKey: "qualitySettingsSlaResolveHint",
		fields: byPriority("resolve", "resolveHours"),
	},
	{
		key: "escalation", titleKey: "qualitySettingsEscalation",
		fields: [
			{ key: "overdueToManagerDays", path: ["escalation", "overdueToManagerDays"], labelKey: "qualitySettingsOverdueToManagerDays", min: 0 },
			{ key: "idleDays", path: ["escalation", "idleDays"], labelKey: "qualitySettingsIdleDays", min: 1 },
			{ key: "idleToChiefDays", path: ["escalation", "idleToChiefDays"], labelKey: "qualitySettingsIdleToChiefDays", min: 1 },
		],
	},
	{
		key: "error-control", titleKey: "qualitySettingsErrorControl",
		fields: [
			{ key: "controlDeadlineDays", path: ["errorControl", "controlDeadlineDays"], labelKey: "qualitySettingsControlDeadlineDays", min: 1 },
			{ key: "reopenWindowDays", path: ["errorControl", "reopenWindowDays"], labelKey: "qualitySettingsReopenWindowDays", min: 1 },
		],
	},
	{
		key: "findings", titleKey: "qualitySettingsFindings", hintKey: "qualitySettingsFindingsHint",
		fields: [
			{ key: "findingsDeadlineDays", path: ["findings", "deadlineDays"], labelKey: "qualitySettingsFindingsDeadlineDays", min: 1 },
		],
	},
	{
		key: "violations", titleKey: "qualitySettingsSystematic", hintKey: "qualitySettingsSystematicHint",
		fields: [
			{ key: "systematicThreshold", path: ["violations", "systematicThreshold"], labelKey: "qualitySettingsSystematicThreshold", min: 1 },
			{ key: "systematicMonths", path: ["violations", "systematicMonths"], labelKey: "qualitySettingsSystematicMonths", min: 1, max: 12 },
		],
	},
	{
		key: "attendance", titleKey: "qualitySettingsAttendance",
		fields: [
			{ key: "evaluateDaysBack", path: ["attendance", "evaluateDaysBack"], labelKey: "qualitySettingsEvaluateDaysBack", min: 0, max: 31 },
		],
	},
	{
		key: "consultation", titleKey: "qualitySettingsConsultation",
		fields: [
			{ key: "maxLength", path: ["consultation", "maxLength"], labelKey: "qualitySettingsMaxLength", min: 100 },
		],
	},
	{
		key: "primary-docs", titleKey: "qualitySettingsPrimaryDocs", hintKey: "qualitySettingsPrimaryDocsHint",
		fields: [
			{ key: "reportDay", path: ["primaryDocs", "reportDay"], labelKey: "qualitySettingsReportDay", min: 1, max: 28 },
			{ key: "lateWindowDays", path: ["primaryDocs", "lateWindowDays"], labelKey: "qualitySettingsLateWindowDays", min: 1 },
			{ key: "lateSharePercent", path: ["primaryDocs", "lateShareThreshold"], labelKey: "qualitySettingsLateSharePercent", min: 1, max: 100, percent: true },
		],
	},
	{
		key: "time", titleKey: "qualitySettingsTime", hintKey: "qualitySettingsTzHint",
		fields: [
			{ key: "tzOffsetMinutes", path: ["tzOffsetMinutes"], labelKey: "qualitySettingsTzOffset", min: -720, max: 840 },
		],
	},
];

export const ALL_FIELDS: SettingField[] = SETTING_SECTIONS.flatMap((s) => s.fields);

/** Чем отмечается приход на работу (СК6.2). */
export const ATTENDANCE_SOURCES = ["button", "login", "both"] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

export interface SettingsFormValues {
	/** Числовые поля — строками, как их держит поле ввода. */
	values: Record<string, string>;
	attendanceSource: string;
	/** Дата начала действия стандарта «ГГГГ-ММ-ДД»; пусто — правила кандидатов молчат. */
	effectiveFrom: string;
	/** Начало и конец рабочего дня фирмы «ЧЧ:ММ». */
	workStart: string;
	workEnd: string;
	/** Рабочая неделя «1,2,3,4,5» (по возрастанию, без повторов — как хранит сервер). */
	workDays: string;
	/** Сроки SLA и находок — в рабочем времени (true) или календарно. */
	slaWorkingTime: boolean;
}

function getPath(obj: unknown, path: readonly string[]): unknown {
	let cur: unknown = obj;
	for (const k of path) {
		if (!cur || typeof cur !== "object") return undefined;
		cur = (cur as Record<string, unknown>)[k];
	}
	return cur;
}

function setPath(obj: Record<string, unknown>, path: readonly string[], value: unknown): void {
	let cur = obj;
	path.forEach((k, i) => {
		if (i === path.length - 1) {
			cur[k] = value;
			return;
		}
		if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
		cur = cur[k] as Record<string, unknown>;
	});
}

/** Проценты без хвоста плавающей точки: 0.35 → «35», 0.125 → «12.5». */
const toPercent = (share: number): string => String(Math.round(share * 10000) / 100);

/** Значение настройки для показа (в т. ч. умолчание рядом с полем): доля — процентами. */
export function fieldValue(settings: unknown, field: SettingField): string {
	const v = getPath(settings, field.path);
	if (typeof v !== "number" || !Number.isFinite(v)) return "";
	return field.percent ? toPercent(v) : String(v);
}

export function settingsToForm(s: SettingsWithEffective | null | undefined): SettingsFormValues {
	const values: Record<string, string> = {};
	for (const f of ALL_FIELDS) values[f.key] = fieldValue(s, f);
	return {
		values,
		attendanceSource: s?.attendance?.source ?? "button",
		effectiveFrom: typeof s?.effectiveFrom === "string" ? s.effectiveFrom : "",
		workStart: s?.workHours?.start ?? "",
		workEnd: s?.workHours?.end ?? "",
		workDays: typeof s?.workDays === "string" ? formatWorkDays(parseWorkDays(s.workDays)) : "",
		slaWorkingTime: s?.slaWorkingTime ?? true,
	};
}

/** Рабочие поля формы, которые сравниваются «как есть» (слияние правок, признак изменений). */
const PLAIN_KEYS = ["attendanceSource", "effectiveFrom", "workStart", "workEnd", "workDays", "slaWorkingTime"] as const;

export type SettingsFormResult =
	| { settings: Partial<SettingsWithEffective> }
	| { error: { field: SettingField } | { effectiveFrom: true } | { workHours: true } | { workDays: true } };

/**
 * Поля формы → частичные настройки для PUT: только ИЗМЕНЁННОЕ относительно сохранённого.
 *
 * Почему не всё сразу. Сервер сливает присланное с текущим, и полный набор из открытой давно
 * формы затёр бы то, что поменялось на сервере за это время. Живой случай — дата начала
 * действия стандарта: её ставит первое назначение организации-фирмы, и форма, открытая до
 * назначения, прислала бы пустую дату и тем выключила бы правила.
 *
 * Числа — целые в своих пределах (сроки в минутах, часах и днях дробными не бывают); проценты —
 * от 1 до 100, хранятся долей.
 */
export function formToSettings(f: SettingsFormValues, saved: SettingsWithEffective | null | undefined): SettingsFormResult {
	const base = settingsToForm(saved);
	const out: Record<string, unknown> = {};
	for (const field of ALL_FIELDS) {
		const value = (f.values[field.key] ?? "").trim();
		if (value === base.values[field.key]) continue;
		const n = Number(value.replace(",", "."));
		const bad = value === "" || !Number.isFinite(n) || (!field.percent && !Number.isInteger(n))
			|| n < field.min || (field.max !== undefined && n > field.max);
		if (bad) return { error: { field } };
		setPath(out, field.path, field.percent ? Math.round(n * 100) / 10000 : n);
	}
	if (f.attendanceSource !== base.attendanceSource) {
		const source = (ATTENDANCE_SOURCES as readonly string[]).includes(f.attendanceSource) ? f.attendanceSource : "button";
		setPath(out, ["attendance", "source"], source);
	}
	const eff = f.effectiveFrom.trim();
	if (eff !== base.effectiveFrom) {
		if (eff && !/^\d{4}-\d{2}-\d{2}$/.test(eff)) return { error: { effectiveFrom: true } };
		out.effectiveFrom = eff;
	}
	// Часы — парой: сервер сверяет конец с началом, а половина пары сверилась бы со старой половиной.
	if (f.workStart.trim() !== base.workStart || f.workEnd.trim() !== base.workEnd) {
		const start = parseHm(f.workStart);
		const end = parseHm(f.workEnd);
		if (start === null || end === null || end <= start) return { error: { workHours: true } };
		out.workHours = { start: normalizeHm(f.workStart), end: normalizeHm(f.workEnd) };
	}
	if (f.workDays !== base.workDays) {
		const days = formatWorkDays(parseWorkDays(f.workDays));
		if (!days) return { error: { workDays: true } };
		out.workDays = days;
	}
	if (f.slaWorkingTime !== base.slaWorkingTime) out.slaWorkingTime = f.slaWorkingTime;
	return { settings: out as Partial<SettingsWithEffective> };
}

/** Изменена ли форма относительно сохранённых настроек. */
export function isSettingsDirty(f: SettingsFormValues, saved: SettingsWithEffective | null | undefined): boolean {
	const base = settingsToForm(saved);
	if (PLAIN_KEYS.some((k) => f[k] !== base[k])) return true;
	return ALL_FIELDS.some((field) => (f.values[field.key] ?? "").trim() !== base.values[field.key]);
}

/**
 * Пришли новые сохранённые настройки, а в форме есть несохранённые правки: правки человека
 * оставляем, остальное берём новое (трёхстороннее слияние «было → стало → правка»).
 *
 * Иначе нельзя ни так, ни эдак: сбросить форму — потерять правки; оставить как есть — держать
 * в нетронутых полях устаревшие значения, которые запись потом отправит как изменения (так
 * пустая дата начала действия стандарта затёрла бы дату, поставленную назначением фирмы).
 */
export function rebaseForm(
	f: SettingsFormValues,
	prev: SettingsWithEffective | null | undefined,
	next: SettingsWithEffective | null | undefined,
): SettingsFormValues {
	const was = settingsToForm(prev);
	const now = settingsToForm(next);
	const values: Record<string, string> = { ...now.values };
	for (const [k, v] of Object.entries(f.values)) {
		if (v !== was.values[k]) values[k] = v;
	}
	const pick = <K extends (typeof PLAIN_KEYS)[number]>(k: K): SettingsFormValues[K] => (f[k] !== was[k] ? f[k] : now[k]);
	return {
		values,
		attendanceSource: pick("attendanceSource"),
		effectiveFrom: pick("effectiveFrom"),
		workStart: pick("workStart"),
		workEnd: pick("workEnd"),
		workDays: pick("workDays"),
		slaWorkingTime: pick("slaWorkingTime"),
	};
}
