// Общие куски HTTP для роутеров E17: список в формате ModelList (курсор по id, поиск, фильтры,
// сортировка), единый ответ об ошибке. Чистые функции без Prisma.
import { idSearchCondition } from "../../utils/searchId.js";

const OPS = ["equals", "contains", "gte", "lte", "gt", "lt", "in"];

/**
 * Разобрать параметры списка.
 * @param {object} req
 * @param {{textFields?:string[], filterFields?:string[], numericFields?:string[], sortFields?:string[], defaultOrder?:object[]}} o
 * @returns {{where:object, orderBy:object[], take:number, cursor:number|null}}
 */
export function listQuery(req, { textFields = [], filterFields = [], numericFields = [], sortFields = [], defaultOrder = [{ id: "desc" }] } = {}) {
	const take = Math.min(Math.max(Number(req.query.limit) || 200, 1), 2000);
	const cursor = req.query.cursor !== undefined && Number(req.query.cursor) > 0 ? Number(req.query.cursor) : null;
	const where = {};
	const and = [];

	const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
	if (search && textFields.length) {
		for (const word of search.split(/\s+/).filter(Boolean)) {
			const or = textFields.map((f) => ({ [f]: { contains: word, mode: "insensitive" } }));
			const idCond = idSearchCondition(word);
			if (idCond) or.push(idCond);
			and.push({ OR: or });
		}
	}

	const filter = req.query.filter && typeof req.query.filter === "object" ? req.query.filter : {};
	for (const [field, conds] of Object.entries(filter)) {
		if (!filterFields.includes(field) || !conds || typeof conds !== "object") continue;
		for (const [op, raw] of Object.entries(conds)) {
			if (!OPS.includes(op)) continue;
			const value = raw === "true" ? true : raw === "false" ? false : raw;
			if (op === "contains") and.push({ [field]: { contains: String(value), mode: "insensitive" } });
			else if (op === "in") and.push({ [field]: { in: String(value).split(",").filter(Boolean) } });
			else and.push({ [field]: { [op]: numericFields.includes(field) && Number.isFinite(Number(value)) ? Number(value) : value } });
		}
	}
	if (and.length) where.AND = and;

	const orderBy = [];
	if (typeof req.query.sort === "string") {
		try {
			const s = JSON.parse(req.query.sort);
			for (const [f, dir] of Object.entries(s || {})) {
				if ((dir === "asc" || dir === "desc") && sortFields.includes(f)) orderBy.push({ [f]: dir });
			}
		} catch {
			// некорректный JSON сортировки — как без сортировки
		}
	}
	if (!orderBy.length) orderBy.push(...defaultOrder);
	if (!orderBy.some((o) => "id" in o)) orderBy.push({ id: "desc" });
	return { where, orderBy, take, cursor };
}

/** Опции findMany с курсором. */
export function pageArgs({ where, orderBy, take, cursor }) {
	return { where, orderBy, take, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) };
}

/** Ответ списка в формате ModelList. */
export function listResponse(items, take, total) {
	const hasMore = items.length === take;
	return { success: true, items, nextCursor: hasMore ? items[items.length - 1].id : null, hasMore, ...(total !== undefined ? { total } : {}) };
}

export function fail(res, status, message, extra = {}) {
	return res.status(status).json({ success: false, message, ...extra });
}

export function serverError(res, where, error) {
	console.error(`[quality] ${where}:`, error);
	return res.status(500).json({ success: false, message: "Ошибка сервера" });
}

const dateRe = /^\d{4}-\d{2}-\d{2}/;
/** Дата из тела: undefined — не передана, null — очищена, Date — значение; мусор → Error. */
export function bodyDate(v, name = "дата") {
	if (v === undefined) return undefined;
	if (v === null || v === "") return null;
	if (!dateRe.test(String(v))) throw new BodyError(`Некорректная ${name}`);
	const d = new Date(v);
	if (Number.isNaN(d.getTime())) throw new BodyError(`Некорректная ${name}`);
	return d;
}

export class BodyError extends Error {
	constructor(message) {
		super(message);
		this.status = 400;
	}
}

/** Обёртка обработчика: BodyError → 400, прочее → 500 с журналом. */
export function handler(where, fn) {
	return async (req, res) => {
		try {
			await fn(req, res);
		} catch (e) {
			if (e instanceof BodyError) return fail(res, 400, e.message);
			return serverError(res, where, e);
		}
	};
}

export const text = (v) => (typeof v === "string" ? v.trim() : "");

export default { listQuery, pageArgs, listResponse, fail, serverError, bodyDate, BodyError, handler, text };
