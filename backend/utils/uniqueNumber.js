// ─────────────────────────────────────────────────────────────────────────────
// Уникальность номера документа В ПРЕДЕЛАХ КАЛЕНДАРНОГО ГОДА.
//
// Номера ведутся отдельной последовательностью на каждый год (см. documentNumbering.js),
// поэтому уникальность проверяется среди документов той же prisma-модели с той же
// организацией и тем же годом (по полю date). Защищает от ручного ввода дубля.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

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
 * @param {{number?:string, date?:Date|string, organizationUuid?:string|null, excludeUuid?:string}} args
 */
export async function assertUniqueNumber(modelName, { number, date, organizationUuid = null, excludeUuid } = {}, client = prisma) {
	const num = (number ?? "").trim();
	if (!num) return;
	const d = date ? new Date(date) : new Date();
	if (isNaN(d.getTime())) return;
	const year = d.getFullYear();
	const yearStart = new Date(year, 0, 1, 0, 0, 0, 0);
	const yearEnd = new Date(year + 1, 0, 1, 0, 0, 0, 0); // верхняя граница исключительно
	const where = {
		number: num,
		deletedAt: null,
		date: { gte: yearStart, lt: yearEnd },
		organizationUuid: organizationUuid ?? null,
		...(excludeUuid ? { uuid: { not: excludeUuid } } : {}),
	};
	let existing = null;
	try {
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
