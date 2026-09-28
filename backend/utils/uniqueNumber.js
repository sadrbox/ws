// ─────────────────────────────────────────────────────────────────────────────
// Уникальность номера документа В ПРЕДЕЛАХ КАЛЕНДАРНОГО ГОДА.
//
// Номера ведутся отдельной последовательностью на каждый год (см. documentNumbering.js),
// поэтому уникальность проверяется среди документов той же prisma-модели с той же
// организацией и тем же годом (по полю date). Защищает от ручного ввода дубля.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";
import { normalizeDocNumber } from "../services/documentNumbering.js";
import { localYear, yearBounds, orgTimeZone } from "../services/periodBounds.js";

export class DuplicateNumberError extends Error {
	constructor(message) {
		super(message);
		this.name = "DuplicateNumberError";
		this.errors = [message];
	}
}

/**
 * Бросает DuplicateNumberError, если номер уже занят в этом году (та же модель,
 * та же организация). Пустой номер — пропускается (автогенерация уникальна).
 * @param {string} modelName  prisma-модель ("sale", "cashOrder", ...)
 * @param {{number?:string, date?:Date|string, organizationUuid?:string|null, excludeUuid?:string, extraWhere?:object}} args
 *        extraWhere — доп. фильтр серии (напр. {direction} для cashOrder: ПКО и РКО
 *        ведут НЕЗАВИСИМЫЕ ряды номеров в одной таблице).
 */
export async function assertUniqueNumber(modelName, { number, date, organizationUuid = null, excludeUuid, extraWhere = {} } = {}, client = prisma) {
	// Сравнение по нормализованному значению (без ведущих нулей): «00074» == «74».
	const num = normalizeDocNumber(number);
	if (!num) return;
	const d = date ? new Date(date) : new Date();
	if (isNaN(d.getTime())) return;
	// Год — местный, в поясе учёта (ACCOUNTING_TIME_ZONE), как у выделения номера
	// (documentNumbering.allocateNumber) — P3 аудита 27.09. Раньше год и его границы брались по
	// поясу сервера: при сервере не в поясе учёта документ первых часов 1 января проверялся
	// против прошлого года — ложный 409 «номер занят» (или пропуск настоящего дубля).
	const tz = orgTimeZone(organizationUuid);
	const year = localYear(d, tz) ?? d.getFullYear();
	const { start: yearStart, end: yearEnd } = yearBounds(year, tz); // [начало года, начало следующего)
	const where = {
		number: num,
		deletedAt: null,
		date: { gte: yearStart, lt: yearEnd },
		organizationUuid: organizationUuid ?? null,
		...extraWhere,
		...(excludeUuid ? { uuid: { not: excludeUuid } } : {}),
	};
	let existing = null;
	try {
		// Новые записи хранятся нормализованными → точный матч по нормализованному
		// номеру корректен. (Легаси-строки с нулями сходятся к норме при пересохранении.)
		existing = await client[modelName].findFirst({ where, select: { id: true } });
	} catch (err) {
		// Нет таблицы/поля — не блокируем по инфраструктурной ошибке.
		console.error(`assertUniqueNumber(${modelName}) error:`, err);
		return;
	}
	if (existing) {
		throw new DuplicateNumberError(`Номер «${num}» уже используется в этом году — номер документа должен быть уникальным в пределах года.`);
	}
}

/** DuplicateNumberError → HTTP 409. Возвращает true, если ответ отправлен. */
export function respondDuplicateNumberError(err, res) {
	if (err instanceof DuplicateNumberError) {
		res.status(409).json({ success: false, message: err.message, errors: err.errors });
		return true;
	}
	return false;
}

export default { assertUniqueNumber, DuplicateNumberError, respondDuplicateNumberError };
