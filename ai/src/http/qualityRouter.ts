// Качество консультаций (E17, СК7.1; стандарт, пп. 24–25) — проверка ответа клиенту моделью, по требованию.
//
//   POST /v1/quality/review-answer   { text, question?, date? } → 200 { verdict, score, checks, suggestions, rewrite, model, date }
//
// КОМУ. Любому пользователю ERP (JWT бэкенда): проверка ничего не читает из баз 1С и ничего не пишет — это подсказка
// автору ответа до отправки, как эвристики ERP, только по смыслу. Организация не нужна: текст приносит сам человек.
//
// ОТДЕЛЬНЫЙ РОУТЕР. userRouter собирает всё «про организацию и её 1С»; здесь — стандарт качества, и маршрутам не
// нужно ничего из его механики. Монтируется в server.ts ПЕРЕД userRouter на `/v1/quality`: иначе пользователь
// проверялся бы дважды (четыре запроса к ERP на каждый вызов).
//
// ЦЕНА. Каждый вызов — обращение к модели, поэтому лимит на пользователя (RATE_LIMIT_QUALITY_REVIEW_PER_MIN), и
// считаются только запросы, дошедшие до модели: неверный запрос и выключенная модель лимит не тратят.
//
// ТЕКСТ НЕ ХРАНИТСЯ. Ни ответ, ни вопрос клиента не пишутся ни в журнал действий, ни в лог сервиса: это переписка с
// клиентом, и сервису она не нужна. В журнал — кто, когда, длины, дата, итог, модель и расход токенов.
//
// ОТКАЗЫ — конвертом сервиса `{ success: false, error: { code, message, details? } }`:
//   400 VALIDATION_ERROR — нет текста; текст длиннее 20 000 знаков; вопрос длиннее 4000; дата не YYYY-MM-DD
//                          (`details.field` — какое поле; у длины ещё `maxLength` и `length`);
//   429 RATE_LIMITED     — лимит на пользователя (заголовок Retry-After);
//   503 LLM_DISABLED     — модель не настроена (LLM_PROVIDER=none, нет ключа) или отвергла ключ / кончился баланс;
//   502 LLM_ERROR        — модель недоступна или ответила ошибкой — повторить позже;
//   502 LLM_BAD_OUTPUT   — ответ модели не прошёл проверку формы и после одного повтора;
//   422 LLM_REFUSED      — модель отказалась оценивать текст;
//   504 LLM_TIMEOUT      — модель не уложилась в QUALITY_REVIEW_TIMEOUT_SECS.

import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { Db } from "../db/pool.ts";
import type { Config } from "../config.ts";
import type { Logger } from "../logger.ts";
import type { Audit } from "../audit/index.ts";
import { requireErpUser } from "../auth/index.ts";
import { LLMError, type LLMProvider } from "../llm/provider.ts";
import { llmHint } from "../llm/health.ts";
import { rateLimit } from "./rateLimit.ts";
import {
	REVIEW_QUESTION_MAX, REVIEW_TEXT_MAX, ReviewError, isCalendarDate, reviewConsultation, todayLocal, type ReviewInput,
} from "../quality/review.ts";

/** Пустое поле формы панели приходит пустой строкой — это «не задано», а не ошибка. */
const blankToNull = (v: unknown): unknown => (typeof v === "string" && !v.trim() ? null : v);

const BodySchema = z.object({
	text: z.string().trim().min(1).max(REVIEW_TEXT_MAX),
	question: z.preprocess(blankToNull, z.string().trim().max(REVIEW_QUESTION_MAX).nullish()),
	date: z.preprocess(blankToNull, z.string().trim().refine(isCalendarDate).nullish()),
});

type Failure = { status: number; code: string; message: string; details?: Record<string, unknown> };

/** Первая претензия к телу — человеческими словами и с полем, чтобы панель могла подсветить его. */
function invalid(issue: z.core.$ZodIssue | undefined, body: unknown): Failure {
	const field = String(issue?.path[0] ?? "text");
	if (field === "text" && issue?.code === "too_big") {
		const text = (body as { text?: unknown } | null)?.text;
		return {
			status: 400, code: "VALIDATION_ERROR",
			// Разряды — вручную: toLocaleString зависит от сборки ICU, и на части серверов вышло бы «20,000».
			message: `Ответ длиннее ${String(REVIEW_TEXT_MAX).replace(/\B(?=(\d{3})+$)/g, " ")} знаков — это уже не консультация (п. 24 стандарта): сократите его до вывода, рекомендации и ссылки на статью`,
			details: { field, maxLength: REVIEW_TEXT_MAX, length: typeof text === "string" ? text.trim().length : null },
		};
	}
	const message = field === "question" ? `question: вопрос клиента — строка до ${REVIEW_QUESTION_MAX} знаков`
		: field === "date" ? "date: дата консультации в виде YYYY-MM-DD"
			: "text: нужен текст ответа клиенту";
	return { status: 400, code: "VALIDATION_ERROR", message, details: { field } };
}

/**
 * Сбой модели → ответ маршрута. Ключ отвергнут и баланс исчерпан — это настройка, а не «повторите позже»: для
 * пользователя то же, что модель не подключена (503 LLM_DISABLED), а текст подсказки говорит администратору, что
 * именно чинить. Сеть, лимит провайдера и 5xx — 502 LLM_ERROR: пройдёт само.
 */
function modelFailure(e: unknown): Failure | null {
	if (e instanceof ReviewError) {
		if (e.code === "LLM_TIMEOUT") return { status: 504, code: e.code, message: e.message };
		if (e.code === "LLM_REFUSED") return { status: 422, code: e.code, message: e.message };
		return { status: 502, code: "LLM_BAD_OUTPUT", message: e.message };
	}
	if (e instanceof LLMError) {
		const hint = llmHint(e.code, e.message);
		const config = e.code === "LLM_AUTH" || e.code === "LLM_QUOTA" || /credit balance/i.test(e.message);
		return config
			? { status: 503, code: "LLM_DISABLED", message: `Проверка ответа моделью недоступна: ${hint}` }
			: { status: 502, code: "LLM_ERROR", message: `Не удалось обратиться к модели: ${hint}`, details: { retryable: e.retryable } };
	}
	return null;
}

export function qualityRouter(deps: {
	erp: Db;
	cfg: Pick<Config, "JWT_SECRET" | "RATE_LIMIT_QUALITY_REVIEW_PER_MIN" | "QUALITY_REVIEW_TIMEOUT_SECS">;
	/** Провайдер модели — тот же, что у чата; `null` — модель не настроена, маршрут отвечает 503. */
	llm: LLMProvider | null;
	audit?: Pick<Audit, "write"> | null;
	log: Pick<Logger, "info" | "warn" | "error">;
	/** Часы — дата консультации по умолчанию; подставляются тестом. */
	now?: () => Date;
}) {
	const { erp, cfg, llm, log } = deps;
	const audit = deps.audit ?? null;
	const now = deps.now ?? (() => new Date());
	const r = Router();

	/** Отказ промиса — ответ 500, а не повисший запрос: express 4 асинхронных отказов не ловит. */
	const wrap = (h: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler => (req, res, next) => {
		Promise.resolve(h(req, res, next)).catch((e: unknown) => {
			log.error({ err: e instanceof Error ? e.message : String(e), path: req.path }, "качество: сбой маршрута");
			if (!res.headersSent) res.status(500).json({ success: false, error: { code: "INTERNAL", message: "Внутренняя ошибка сервиса — повторите позже" } });
		});
	};
	const fail = (res: Response, f: Failure) => {
		res.status(f.status).json({ success: false, error: { code: f.code, message: f.message, ...(f.details ? { details: f.details } : {}) } });
	};

	r.use(wrap(requireErpUser(erp, cfg.JWT_SECRET)));

	const limiter = rateLimit({
		max: cfg.RATE_LIMIT_QUALITY_REVIEW_PER_MIN, windowMs: 60_000,
		message: `Проверка ответа моделью — не чаще ${cfg.RATE_LIMIT_QUALITY_REVIEW_PER_MIN} раз в минуту: подождите немного`,
	});

	/** До лимита: выключенная модель и неверное тело — отказ сразу и без расхода лимита. */
	const precheck: RequestHandler = (req, res, next) => {
		if (!llm) {
			fail(res, {
				status: 503, code: "LLM_DISABLED",
				message: "Проверка ответа моделью недоступна: модель в сервисе BuhProf AI не настроена (LLM_PROVIDER и ключ API). Подсказка по форме ответа в ERP работает и без неё",
			});
			return;
		}
		const p = BodySchema.safeParse(req.body ?? {});
		if (!p.success) {
			fail(res, invalid(p.error.issues[0], req.body));
			return;
		}
		const input: ReviewInput = { text: p.data.text, question: p.data.question || null, date: p.data.date || todayLocal(now()) };
		res.locals.reviewInput = input;
		next();
	};

	r.post("/review-answer", precheck, limiter, wrap(async (req, res) => {
		const u = req.erpUser!;
		const input = res.locals.reviewInput as ReviewInput;
		const t0 = Date.now();
		// Только длины и дата — ни слова из самого текста (см. шапку).
		const facts = { length: input.text.length, questionLength: input.question?.length ?? 0, date: input.date };
		try {
			const out = await reviewConsultation(llm!, input, { deadlineMs: cfg.QUALITY_REVIEW_TIMEOUT_SECS * 1000 });
			const { review } = out;
			const summary = {
				...facts, outcome: "ok", verdict: review.verdict, score: review.score, model: review.model,
				failed: Object.entries(review.checks).filter(([, c]) => !c.ok).map(([k]) => k),
				attempts: out.attempts, usage: out.usage, durationMs: Date.now() - t0,
			};
			await audit?.write({ event: "quality.review_answer", organizationUuid: u.organizationUuid, userUuid: u.uuid, details: summary });
			log.info({ userUuid: u.uuid, ...summary }, "качество: ответ клиенту проверен моделью");
			res.json({ success: true, data: { ...review, date: input.date } });
		} catch (e) {
			const f = modelFailure(e);
			if (!f) throw e;
			const summary = {
				...facts, outcome: f.code, provider: llm!.name,
				...(e instanceof ReviewError ? { attempts: e.attempts, usage: e.usage, problem: e.problem } : { providerCode: (e as LLMError).code }),
				durationMs: Date.now() - t0,
			};
			await audit?.write({ event: "quality.review_answer", organizationUuid: u.organizationUuid, userUuid: u.uuid, details: summary });
			log.warn({ userUuid: u.uuid, ...summary, err: e instanceof Error ? e.message : String(e) }, "качество: проверка ответа моделью не удалась");
			fail(res, f);
		}
	}));

	return r;
}
