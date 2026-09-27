// ─────────────────────────────────────────────────────────────────────────────
// Отклонённый промис async-обработчика → обработчик ошибок Express, а не падение воркера
// (Н1 аудита 26.09).
//
// ЗАЧЕМ. Express 4 вызывает обработчик и ловит только СИНХРОННОЕ исключение: промис, который
// возвращает `async (req, res) => …`, он не смотрит. `await` вне try (сбой БД в SSE-потоке,
// в режиме поддержки, в eGov) давал «необработанное отклонение», а Node 24 на нём завершает
// процесс. EventSource переподключается раз в 3 с — и один сбой БД превращался в цикл падений
// всех воркеров. Библиотека express-async-errors делает то же самое; своя версия — это
// двадцать строк без новой зависимости (и без её предположений о внутренностях Express).
//
// КАК. Один раз подменяем `Layer.prototype.handle_request/handle_error` — через них Express
// зовёт КАЖДЫЙ обработчик и middleware любого роутера, созданного когда угодно. Вернул
// обработчик промис — вешаем на него `catch` → `next(err)`. Всё прочее — как в Express.
//
// ДВАЖДЫ `next` НЕ ЗОВЁМ. Если обработчик уже передал управление дальше (`next()`) или сам
// сообщил об ошибке, а его промис потом всё равно отклонился — второй вызов `next` запустил
// бы цепочку повторно. Такое отклонение только пишем в журнал.
// ─────────────────────────────────────────────────────────────────────────────
import Layer from "express/lib/router/layer.js";

const PATCHED = Symbol.for("aleppo.asyncErrorsPatched");

const isThenable = (v) => v !== null && (typeof v === "object" || typeof v === "function") && typeof v.then === "function";

/** Ошибка из «пустого» отклонения (`Promise.reject()`): Express считает falsy-ошибку успехом. */
function asError(reason) {
	if (reason instanceof Error) return reason;
	const e = new Error(reason === undefined ? "Промис обработчика отклонён без причины" : String(reason));
	e.cause = reason;
	return e;
}

/**
 * Вызвать обработчик, связав его промис с `next`. `args` — аргументы до `next`.
 * @param {Function} fn
 * @param {unknown[]} args
 * @param {Function} next
 * @param {(msg: string, err: unknown) => void} onLate — отклонение после того, как `next` уже звали
 */
function invoke(fn, args, next, onLate) {
	let passed = false;
	const guarded = (...a) => {
		passed = true;
		return next(...a);
	};
	let ret;
	try {
		ret = fn(...args, guarded);
	} catch (err) {
		if (passed) return onLate("исключение после next()", err);
		return guarded(err);
	}
	if (isThenable(ret)) {
		ret.then(undefined, (reason) => {
			if (passed) return onLate("отклонённый промис после next()", reason);
			guarded(asError(reason));
		});
	}
}

/**
 * Подключить защиту (идемпотентно — повторный вызов ничего не делает).
 * @param {{ log?: (msg: string, err: unknown) => void }} [opts]
 */
export function installAsyncErrorHandling({ log = (m, e) => console.error(`[async-errors] ${m}:`, e) } = {}) {
	if (Layer.prototype[PATCHED]) return false;

	Layer.prototype.handle_request = function handle(req, res, next) {
		const fn = this.handle;
		if (fn.length > 3) return next(); // обработчик ошибок — не для обычного запроса
		invoke(fn, [req, res], next, log);
	};

	Layer.prototype.handle_error = function handleError(error, req, res, next) {
		const fn = this.handle;
		if (fn.length !== 4) return next(error); // не обработчик ошибок
		invoke(fn, [error, req, res], next, log);
	};

	Layer.prototype[PATCHED] = true;
	return true;
}

/**
 * Страховка процесса: отклонение, которое не поймал никто (фоновые задачи, забытый `void`),
 * пишем в журнал и живём дальше. Node 24 по умолчанию на нём завершает процесс — а воркер,
 * держащий сотню SSE-соединений, из-за одной упавшей записи уведомления падать не должен.
 * Исключения (`uncaughtException`) не трогаем: после них состояние процесса не определено,
 * и перезапуск pm2 — правильный ответ.
 * @returns {Function} снятие обработчика (для тестов)
 */
export function installUnhandledRejectionGuard({ log = (m, e) => console.error(m, e) } = {}) {
	const handler = (reason) => log("[process] необработанное отклонение промиса (процесс продолжает работу):", reason);
	process.on("unhandledRejection", handler);
	return () => process.off("unhandledRejection", handler);
}

export default { installAsyncErrorHandling, installUnhandledRejectionGuard };
