// Отказ промиса в маршруте — это ответ 500, а не повисший запрос (Н1 аудита 26.09).
//
// Express 4 не ловит отказы асинхронных обработчиков: сбой БД в `await` оставлял запрос без ответа до обрыва
// прокси (~100 с, в браузере — «CORS error»), а Node получал необработанный отказ промиса. Часть роутеров
// оборачивала свои get/post сама, но `r.use(...)` (проверка JWT, агента, токена базы) оставался голым, а в
// userRouter, adminRouter и чате обёртки не было вовсе. Теперь одна обёртка на весь роутер — и для маршрутов,
// и для промежуточных обработчиков: по одному их забывают.

import type { Logger } from "../logger.ts";
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response, Router } from "express";

const METHODS = ["get", "post", "put", "patch", "delete", "all", "use"] as const;

/**
 * Обернуть обработчик: отказ промиса пишется в журнал и превращается в 500 (если ответ ещё не начат).
 * Обработчики ошибок (четыре аргумента) и вложенные роутеры не трогаем: у первых своя сигнатура, по которой
 * express их и узнаёт, вторые синхронны и сами оборачивают свои маршруты.
 */
export function safeHandler(h: RequestHandler, log: Pick<Logger, "error">, label: string): RequestHandler {
	if (typeof h !== "function" || h.length >= 4 || (h as unknown as { stack?: unknown }).stack !== undefined) return h;
	const wrapped: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
		let out: unknown;
		try {
			out = h(req, res, next);
		} catch (e) {
			fail(e, req, res, log, label);
			return;
		}
		if (out && typeof (out as Promise<unknown>).catch === "function") {
			(out as Promise<unknown>).catch((e: unknown) => fail(e, req, res, log, label));
		}
	};
	return wrapped;
}

/**
 * «Неверный синтаксис» Postgres (22P02) — это не поломка сервиса, а негодный идентификатор в запросе: `/batches/abc`
 * в колонку `uuid`. Раньше такой запрос получал 500 (аудит 26.09); теперь — 400 с понятной причиной.
 */
export const isBadInput = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === "22P02";

function fail(e: unknown, req: Request, res: Response, log: Pick<Logger, "error">, label: string): void {
	if (isBadInput(e)) {
		if (!res.headersSent) res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Некорректный идентификатор в запросе" } });
		return;
	}
	log.error({ err: e instanceof Error ? e.message : String(e), path: req.path, method: req.method }, `${label}: сбой`);
	if (!res.headersSent) res.status(500).json({ success: false, error: { code: "INTERNAL", message: "Внутренняя ошибка сервиса — повторите позже" } });
}

/**
 * Обернуть ВСЕ будущие обработчики роутера: get/post/put/patch/delete/all и use. Путь (строка, RegExp или
 * массив) и обработчики ошибок проходят как есть. Вызывать сразу после `Router()`.
 */
export function safeRouter<T extends Router>(r: T, log: Pick<Logger, "error">, label: string): T {
	for (const method of METHODS) {
		const original = (r as unknown as Record<string, (...args: unknown[]) => unknown>)[method].bind(r);
		(r as unknown as Record<string, (...args: unknown[]) => unknown>)[method] = (...args: unknown[]) =>
			original(...args.map((a) => wrapArg(a, log, label)));
	}
	return r;
}

function wrapArg(a: unknown, log: Pick<Logger, "error">, label: string): unknown {
	if (Array.isArray(a)) return a.map((x) => wrapArg(x, log, label));
	return typeof a === "function" ? safeHandler(a as RequestHandler | ErrorRequestHandler as RequestHandler, log, label) : a;
}
