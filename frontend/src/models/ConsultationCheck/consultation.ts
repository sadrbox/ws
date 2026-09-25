/**
 * «Проверка ответа клиенту» (E17 СК7.1) — порядок и подписи пунктов проверки.
 *
 * Стандарт (п. 24): ответ краткий, понятный и предметный — вывод, рекомендация, конкретная статья
 * НПА и актуальность нормы на дату консультации; многостраничные тексты закона вместо
 * консультации недопустимы. Сервер (services/quality/consultationRules.js) проверяет это
 * эвристиками — по форме, а не по сути.
 *
 * Проверка моделью (сервис ai, POST /v1/quality/review-answer, по кнопке) добавляет суть: есть ли прямой
 * вывод, что именно рекомендовано, какие статьи названы, нет ли неуверенных формулировок. Верна ли норма и
 * действует ли редакция, модель не утверждает — только просит сверить (так задано её заданием).
 */
import type { ConsultationReview, ModelReview } from "src/services/quality/api";
import type { NoticeType } from "src/components/Notice";
import type { QualityTone } from "src/models/_quality/QualityChip";

type CheckKey = keyof ConsultationReview["checks"];

/** Порядок — как в стандарте: вывод, рекомендация, статья НПА, актуальность, затем форма ответа. */
export const CHECK_ORDER: readonly CheckKey[] = ["conclusion", "recommendation", "npa", "actuality", "length", "notLawDump"];

const CHECK_KEYS: Record<CheckKey, string> = {
	conclusion: "consultationCheckConclusion",
	recommendation: "consultationCheckRecommendation",
	npa: "consultationCheckNpa",
	actuality: "consultationCheckActuality",
	length: "consultationCheckLengthOk",
	notLawDump: "consultationCheckNotLawDump",
};

export interface ChecklistRow {
	key: CheckKey;
	labelKey: string;
	passed: boolean;
}

export function reviewChecklist(r: Pick<ConsultationReview, "checks"> | null | undefined): ChecklistRow[] {
	if (!r?.checks) return [];
	return CHECK_ORDER.map((key) => ({ key, labelKey: CHECK_KEYS[key], passed: !!r.checks[key] }));
}

/** Тон оценки: всё выполнено — хорошо, большая часть — «доработать», меньше двух третей — плохо. */
export function scoreTone(score: number): QualityTone {
	if (score >= 100) return "ok";
	if (score >= 67) return "warn";
	return "bad";
}

// ── Проверка моделью ─────────────────────────────────────────────────────────

type ModelCheckKey = keyof ModelReview["checks"];

/** Порядок — как у эвристик, затем то, что умеет только модель: краткость по сути и уверенность тона. */
export const MODEL_CHECK_ORDER: readonly ModelCheckKey[] = ["conclusion", "recommendation", "npa", "actuality", "brevity", "certainty"];

const MODEL_CHECK_KEYS: Record<ModelCheckKey, string> = {
	conclusion: "consultationCheckConclusion",
	recommendation: "consultationCheckRecommendation",
	npa: "consultationCheckNpa",
	actuality: "consultationCheckActuality",
	brevity: "consultationModelBrevity",
	certainty: "consultationModelCertainty",
};

export interface ModelChecklistRow {
	key: ModelCheckKey;
	labelKey: string;
	ok: boolean;
	note: string;
}

export function modelChecklist(r: Pick<ModelReview, "checks"> | null | undefined): ModelChecklistRow[] {
	if (!r?.checks) return [];
	return MODEL_CHECK_ORDER.map((key) => ({
		key,
		labelKey: MODEL_CHECK_KEYS[key],
		ok: !!r.checks[key]?.ok,
		note: String(r.checks[key]?.note ?? "").trim(),
	}));
}

/** Тон вердикта модели: «годится» — хорошо; «доработать» — по оценке (ниже половины — плохо). */
export function modelVerdictTone(r: Pick<ModelReview, "verdict" | "score"> | null | undefined): QualityTone {
	if (!r) return "muted";
	if (r.verdict === "ok") return "ok";
	return r.score < 50 ? "bad" : "warn";
}

/**
 * Отказ сервиса ИИ, о котором надо сказать по-своему, а не общим «ошибка сервиса»: проверка моделью не
 * настроена — это не сбой (эвристики работают); частые нажатия и неразборчивый ответ модели — повод
 * повторить. null — обычная ошибка (её покажет общий разбор routeError).
 */
export function modelErrorNotice(e: unknown): { type: NoticeType; key: string } | null {
	const o = (e && typeof e === "object" ? e : {}) as { status?: unknown; code?: unknown };
	const code = typeof o.code === "string" ? o.code : "";
	if (code === "LLM_DISABLED") return { type: "info", key: "consultationModelDisabled" };
	if (code === "LLM_BAD_OUTPUT") return { type: "warning", key: "consultationModelBadOutput" };
	if (code === "LLM_TIMEOUT") return { type: "warning", key: "consultationModelTimeout" };
	if (code === "LLM_REFUSED") return { type: "warning", key: "consultationModelRefused" };
	if (code === "LLM_ERROR") return { type: "warning", key: "consultationModelUnavailable" };
	if (o.status === 429 || code === "RATE_LIMITED") return { type: "warning", key: "consultationModelRateLimited" };
	return null;
}
