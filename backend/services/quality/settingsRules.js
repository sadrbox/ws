// Настройки E17 «Стандарт качества» — ЧИСТЫЕ правила без Prisma (проверяются headless-тестом).
// Хранилище — AppSetting `quality.settings.<организация-фирма>` (services/quality/settings.js).
//
// ПРОВЕРИТЬ ПОТОМ: все значения по умолчанию ниже — предложение разработчика, владелец их не
// утверждал (docs/PLAN_QUALITY_STANDARD_2026-09-25.md, раздел «Решения владельца», пп. 4–6).
// Меняются на экране «Качество → Настройки» без выпуска.

import { parseHm } from "./time.js";

export const DEFAULT_SETTINGS = Object.freeze({
	/**
	 * С какой даты (YYYY-MM-DD) действуют правила кандидатов. Ставится сама, когда администратор
	 * впервые назначает организацию-фирму: стандарт не применяется задним числом к задачам и
	 * срокам, которые были до его введения. Пусто — правила молчат.
	 */
	effectiveFrom: "",
	/** Смещение местного времени от UTC, минут. Казахстан с 01.03.2024 — UTC+5. */
	tzOffsetMinutes: 300,
	/**
	 * Рабочее время фирмы: по нему считаются SLA обращений, сроки отработки находок и проверки
	 * исправления — в рабочих минутах и днях с учётом производственного календаря (workTime.js).
	 */
	workHours: { start: "09:00", end: "18:00" },
	/** Рабочая неделя (ISO: 1 — понедельник). Праздники и переносы — в производственном календаре. */
	workDays: "1,2,3,4,5",
	/** false — считать сроки календарно (как до 25.09); оставлено на случай круглосуточной поддержки. */
	slaWorkingTime: true,
	sla: {
		/** Срок ПРИНЯТИЯ обращения клиента в работу, минут — по приоритету (п. 3). */
		reactionMinutes: { low: 240, normal: 60, high: 30, urgent: 15 },
		/** Срок РЕШЕНИЯ обращения, часов — ставится сроком задачи, если его не задали. */
		resolveHours: { low: 72, normal: 24, high: 8, urgent: 4 },
	},
	escalation: {
		/** Просрочено дольше N дней — сигнал руководителю (главбуху — сразу). */
		overdueToManagerDays: 2,
		/** Нет движения по задаче N дней — напоминание исполнителю. */
		idleDays: 3,
		/** Нет движения N дней — сигнал главбуху (пп. 21, 40). */
		idleToChiefDays: 5,
	},
	errorControl: {
		/** Срок задачи-проверки исправления ошибки, дней (п. 5). */
		controlDeadlineDays: 2,
		/** Находка вернулась в течение N дней после устранения — кандидат по п. 5. */
		reopenWindowDays: 30,
	},
	findings: {
		/** Сколько дней на отработку находки с важностью error до кандидата в нарушения. */
		deadlineDays: 5,
		/** Отдельные сроки по коду проверки: { "stock.negative": 3 }. */
		perCheckDeadlineDays: {},
	},
	violations: {
		/** Систематичность: N подтверждённых нарушений за скользящие M месяцев. */
		systematicThreshold: 3,
		systematicMonths: 3,
	},
	attendance: {
		/**
		 * Чем отмечается приход: button | login | both. По умолчанию both (25.09, «лучшее решение»):
		 * забытая кнопка у работающего человека — ложный «прогул» и лишний кандидат для главбуха, а
		 * первый вход в ERP — честный признак начала работы. Отметку ставит самое раннее из двух.
		 */
		source: "both",
		/** За сколько прошедших дней правило пересматривает посещаемость (заявки согласуют позже). */
		evaluateDaysBack: 3,
	},
	consultation: {
		/** Ответ длиннее — «простыня»: предложить сжать (п. 24). */
		maxLength: 1500,
	},
	primaryDocs: {
		/** Число следующего месяца — срок, к которому первичка месяца должна быть в базе. */
		reportDay: 15,
		/** Сколько последних дней перед сроком считаются «накоплением перед отчётностью». */
		lateWindowDays: 5,
		/** Доля документов, внесённых в последние дни, выше которой — сигнал (п. 19). */
		lateShareThreshold: 0.5,
	},
});

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Слить сохранённые настройки с умолчаниями. Берётся только то, что совпадает по типу с
 * умолчанием: кривое значение из базы не должно ронять правила (строка вместо числа молча
 * превратилась бы в NaN-срок и вечную просрочку).
 */
export function mergeSettings(stored, defaults = DEFAULT_SETTINGS) {
	const out = {};
	for (const [key, def] of Object.entries(defaults)) {
		const v = isPlainObject(stored) ? stored[key] : undefined;
		if (isPlainObject(def)) {
			// Словари «по коду» (perCheckDeadlineDays) — пустые по умолчанию: берём как есть.
			if (Object.keys(def).length === 0) out[key] = isPlainObject(v) ? { ...v } : {};
			else out[key] = mergeSettings(v, def);
		} else if (typeof def === "number") {
			out[key] = typeof v === "number" && Number.isFinite(v) ? v : def;
		} else if (typeof def === typeof v) {
			out[key] = v;
		} else {
			out[key] = def;
		}
	}
	return out;
}

// Тот же разбор «ЧЧ:ММ», что у правил рабочего времени (workTime.workOptions): иначе проверка
// приняла бы то, что правила молча заменят умолчанием, или наоборот.
const hmMinutes = (v) => parseHm(v);

/**
 * Проверка присланной правки настроек (PUT /quality/settings) по полям рабочего времени: их типом
 * не поймать — «25:00» и «8,9» такие же строки, как «09:00» и «1,2,3,4,5», а кривое значение молча
 * сдвинуло бы все сроки SLA. null — годится, иначе текст для человека.
 */
export function settingsPatchError(patch) {
	if (!isPlainObject(patch)) return null;
	if (patch.workHours !== undefined) {
		if (!isPlainObject(patch.workHours)) return "Рабочее время: ожидается начало и конец дня";
		const start = patch.workHours.start !== undefined ? hmMinutes(patch.workHours.start) : 0;
		const end = patch.workHours.end !== undefined ? hmMinutes(patch.workHours.end) : 24 * 60;
		if (start === null || end === null) return "Рабочее время: укажите время как ЧЧ:ММ, например 09:00";
		if (patch.workHours.start !== undefined && patch.workHours.end !== undefined && end <= start) {
			return "Рабочее время: конец дня должен быть позже начала";
		}
	}
	if (patch.workDays !== undefined) {
		const parts = String(patch.workDays).split(",").map((x) => x.trim()).filter(Boolean);
		if (!parts.length || parts.some((x) => !/^[1-7]$/.test(x))) return "Рабочая неделя: выберите хотя бы один день";
	}
	if (patch.slaWorkingTime !== undefined && typeof patch.slaWorkingTime !== "boolean") return "Признак «Сроки в рабочем времени» — да или нет";
	if (patch.effectiveFrom !== undefined && patch.effectiveFrom !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(patch.effectiveFrom))) {
		return "Дата начала действия стандарта — в формате ГГГГ-ММ-ДД";
	}
	return null;
}

/** Правка + сохранённое: конец дня позже начала и после частичной правки (прислали только начало). */
export function mergedWorkHoursError(merged) {
	const start = hmMinutes(merged?.workHours?.start);
	const end = hmMinutes(merged?.workHours?.end);
	if (start !== null && end !== null && end <= start) return "Рабочее время: конец дня должен быть позже начала";
	return null;
}

export default { DEFAULT_SETTINGS, mergeSettings, settingsPatchError, mergedWorkHoursError };
