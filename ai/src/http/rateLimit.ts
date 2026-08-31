// Ограничение частоты запросов — в памяти процесса, по ключу (пользователь ERP, иначе IP).
//
// Зачем свой, а не пакет: один процесс, один ключ на пользователя, окно в минуту — здесь нечего
// конфигурировать, а лишняя зависимость в цепочке поставки — лишний риск. Скользящее окно из
// меток времени: точнее фиксированных «вёдер» на границе минуты и достаточно дёшево при
// лимитах в десятки запросов.
//
// Превышение — 429 с кодом RATE_LIMITED и Retry-After: панель показывает сообщение, а не
// «сервис недоступен». Метки старше окна выбрасываются при каждом обращении; ключи без
// обращений чистятся раз в несколько минут, чтобы память не росла от разовых посетителей.

import type { Request, RequestHandler } from "express";

export type RateLimitOptions = {
	/** Максимум запросов на окно. 0 — без ограничения. */
	max: number;
	/** Окно в миллисекундах. */
	windowMs: number;
	/** Ключ клиента; по умолчанию — uuid пользователя ERP, иначе IP. */
	key?: (req: Request) => string;
	/** Считать ли запрос — например, только запросы с вложениями. По умолчанию считаются все. */
	applies?: (req: Request) => boolean;
	/** Что сказать пользователю. */
	message?: string;
};

export function rateLimit(opts: RateLimitOptions): RequestHandler {
	const hits = new Map<string, number[]>();
	const key = opts.key ?? ((req: Request) => req.erpUser?.uuid ?? req.ip ?? "anonymous");
	const applies = opts.applies ?? (() => true);
	const sweep = setInterval(() => {
		const border = Date.now() - opts.windowMs;
		for (const [k, times] of hits) {
			const live = times.filter((t) => t > border);
			if (live.length) hits.set(k, live);
			else hits.delete(k);
		}
	}, Math.max(opts.windowMs, 60_000));
	sweep.unref();

	return (req, res, next) => {
		if (opts.max <= 0 || !applies(req)) {
			next();
			return;
		}
		const now = Date.now();
		const border = now - opts.windowMs;
		const k = key(req);
		const times = (hits.get(k) ?? []).filter((t) => t > border);
		if (times.length >= opts.max) {
			const retryAfterSec = Math.max(1, Math.ceil((times[0] + opts.windowMs - now) / 1000));
			res.setHeader("Retry-After", String(retryAfterSec));
			res.status(429).json({
				success: false,
				error: { code: "RATE_LIMITED", message: opts.message ?? `Слишком много запросов — повторите через ${retryAfterSec} с`, retryAfterSec },
			});
			return;
		}
		times.push(now);
		hits.set(k, times);
		next();
	};
}
