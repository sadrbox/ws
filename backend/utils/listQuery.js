// ─────────────────────────────────────────────────────────────────────────────
// Разбор параметров списков: предел выдачи, фильтры по схеме, ошибки ввода → 400
// (Н3 и Н10 аудита 26.09).
//
// ПРЕДЕЛ (Н3). Роутеры списков разбирали `limit` каждый сам, с потолком 999999: запрос
// `?limit=999999` отдавал таблицу целиком со всеми связями — для событий 1С с payload это
// гигабайты в памяти воркера на один запрос. Теперь потолок один — MAX_LIST_LIMIT (500): ровно
// столько таблица интерфейса просит за порцию (TableBody, BATCH_SIZE). Дальше — курсор: «прыжок»
// полосой прокрутки на тысячную строку догружается порциями, а не одним запросом на всё.
// Роутер, которому законно нужно больше (канбан сделок просит 1000), передаёт свой `max` явно.
//
// ОШИБКИ ВВОДА (Н10). `?filter[date][gte]=вчера`, фильтр по несуществующей колонке или кривое
// число уходили в Prisma как есть, та бросала PrismaClientValidationError, и пользователь
// получал 500 «Внутренняя ошибка сервера» — а в журнале ошибок оседал мусор, в котором тонут
// настоящие сбои. Это ошибка запроса, а не сервера: 400 с понятным текстом.
//   • buildFilterWhere проверяет поля и значения фильтра по СХЕМЕ (Prisma.dmmf) заранее;
//   • isClientInputError узнаёт ошибку ввода, которую всё-таки поймала Prisma;
//   • sendError — общий ответ из catch роутера: 400 для ошибок ввода, 500 для остального.
// Тот же разбор ошибок стоит в глобальном обработчике server.js — для всего, что дошло до next(err).
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";

/** Потолок выдачи списка за один запрос. */
export const MAX_LIST_LIMIT = 500;

/**
 * Предел выдачи из `req.query.limit`: число от 1 до `max`; пусто или мусор — `def`.
 * @param {unknown} raw
 * @param {{ def?: number, max?: number }} [opts]
 */
export function clampLimit(raw, { def = MAX_LIST_LIMIT, max = MAX_LIST_LIMIT } = {}) {
	const fallback = Math.min(Math.max(Math.trunc(def), 1), max);
	if (raw === undefined || raw === null || raw === "") return fallback;
	const n = Number(Array.isArray(raw) ? raw[0] : raw);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(Math.max(Math.trunc(n), 1), max);
}

/** Ошибка запроса клиента: глобальный обработчик и sendError отвечают на неё 400. */
export class BadRequestError extends Error {
	constructor(message, details = undefined) {
		super(message);
		this.name = "BadRequestError";
		this.status = 400;
		this.expose = true;
		if (details !== undefined) this.details = details;
	}
}

/**
 * Дата из параметра запроса: пусто → null, кривая → BadRequestError (а не Invalid Date в Prisma).
 * @param {unknown} value
 * @param {string} [name] — имя параметра для текста ошибки
 */
export function parseDateParam(value, name = "date") {
	if (value === undefined || value === null || value === "") return null;
	const d = value instanceof Date ? value : new Date(String(value));
	if (Number.isNaN(d.getTime())) throw new BadRequestError(`Некорректная дата в параметре «${name}»`);
	return d;
}

// ── Поля моделей из схемы ──────────────────────────────────────────────────
const MODELS = new Map(); // имя модели в нижнем регистре → Map<поле, { type, kind, isList }>
for (const m of Prisma.dmmf?.datamodel?.models ?? []) {
	MODELS.set(m.name.toLowerCase(), new Map(m.fields.map((f) => [f.name, { type: f.type, kind: f.kind, isList: f.isList }])));
}

const FILTER_OPERATORS = ["contains", "equals", "gte", "lte", "gt", "lt"];
const NUMERIC = new Set(["Int", "BigInt", "Float", "Decimal"]);

/** Значение фильтра в тип поля. Не приводится — BadRequestError. */
function coerce(field, meta, op, raw) {
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (meta.type === "DateTime") {
		const d = new Date(String(value));
		if (Number.isNaN(d.getTime())) throw new BadRequestError(`Некорректная дата в фильтре «${field}»`);
		return d;
	}
	if (NUMERIC.has(meta.type)) {
		const s = String(value).trim().replace(",", ".");
		const n = Number(s);
		if (s === "" || !Number.isFinite(n)) throw new BadRequestError(`Некорректное число в фильтре «${field}»`);
		if (meta.type === "Int" && !Number.isInteger(n)) throw new BadRequestError(`Некорректное целое в фильтре «${field}»`);
		if (meta.type === "Int" && Math.abs(n) > 2147483647) throw new BadRequestError(`Слишком большое число в фильтре «${field}»`);
		return n;
	}
	if (meta.type === "Boolean") {
		const s = String(value).trim().toLowerCase();
		if (s === "true" || s === "1") return true;
		if (s === "false" || s === "0") return false;
		throw new BadRequestError(`Некорректное логическое значение в фильтре «${field}»`);
	}
	if (op === "gte" || op === "lte" || op === "gt" || op === "lt" || op === "equals" || op === "contains") return String(value);
	return value;
}

/**
 * Условия Prisma из `req.query.filter` вида `{ поле: { оператор: значение } }` — с проверкой по
 * схеме. Неизвестное поле, связь вместо скаляра, кривая дата или число → BadRequestError (400):
 * молча выбросить условие нельзя — пользователь получил бы нефильтрованный список, думая, что он
 * отфильтрован. `contains` у нестрокового поля превращается в `equals` приведённого значения.
 *
 * @param {string} modelName — имя Prisma-модели (регистр не важен)
 * @param {unknown} filter — сырой req.query.filter
 * @param {{ skip?: string[] }} [opts] — ключи, которые разбирает сам роутер (searchBy, dateRange…)
 * @returns {Record<string, object>}
 */
export function buildFilterWhere(modelName, filter, { skip = ["searchBy", "dateRange"] } = {}) {
	const where = {};
	if (!filter || typeof filter !== "object" || Array.isArray(filter)) return where;
	const fields = MODELS.get(String(modelName).toLowerCase());
	for (const [field, conditions] of Object.entries(filter)) {
		if (skip.includes(field)) continue;
		if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) continue;
		const meta = fields?.get(field);
		if (!fields || !meta || meta.kind === "object" || meta.isList) {
			throw new BadRequestError(`Неизвестное поле фильтра «${field}»`);
		}
		for (const [op, raw] of Object.entries(conditions)) {
			if (!FILTER_OPERATORS.includes(op)) continue;
			const value = coerce(field, meta, op, raw);
			if (op === "contains") {
				where[field] = meta.type === "String" ? { contains: value, mode: "insensitive" } : { equals: value };
			} else {
				if (!where[field] || "contains" in where[field]) where[field] = {};
				where[field][op] = value;
			}
		}
	}
	return where;
}

// Коды Prisma, которые означают «значение из запроса не подходит к колонке», а не сбой базы:
// слишком длинное, не того типа, вне диапазона, неверный формат.
const CLIENT_INPUT_CODES = new Set(["P2000", "P2005", "P2006", "P2007", "P2009", "P2012", "P2019", "P2020", "P2023", "P2033"]);

/** Ошибка вызвана вводом клиента (400), а не сбоем сервера (500)? */
export function isClientInputError(err) {
	if (!err) return false;
	if (err instanceof BadRequestError || err.status === 400) return true;
	if (err instanceof Prisma.PrismaClientValidationError || err.name === "PrismaClientValidationError") return true;
	return typeof err.code === "string" && CLIENT_INPUT_CODES.has(err.code);
}

/**
 * Ответ из catch роутера: ошибка ввода — 400 с её текстом (для BadRequestError) или общим
 * «Некорректные параметры запроса» (для ошибки Prisma — её текст раскрывает схему); прочее — 500
 * с `message` и записью в журнал.
 * @param {import("express").Response} res
 * @param {unknown} err
 * @param {{ message?: string, label?: string }} [opts]
 */
export function sendError(res, err, { message = "Ошибка сервера", label = "request" } = {}) {
	if (isClientInputError(err)) {
		const text = err instanceof BadRequestError || err?.expose ? err.message : "Некорректные параметры запроса";
		return res.status(400).json({ success: false, message: text });
	}
	console.error(`${label} error:`, err);
	return res.status(500).json({ success: false, message });
}

export default { MAX_LIST_LIMIT, clampLimit, BadRequestError, parseDateParam, buildFilterWhere, isClientInputError, sendError };
