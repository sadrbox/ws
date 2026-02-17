import express from "express";
import cors from "cors";
import { querySchema } from "../../utils/module.js";
import { prisma } from "../../prisma/prisma-client.js";
// import { success } from "zod";
const router = express.Router();
router.use(cors());

// Zod-схема валидации входящих query-параметров
// ──────────────────────────────────────────────────────────────────────────────
// Предполагается, что querySchema уже объявлена выше в файле примерно так:
//
// const querySchema = z.object({
//   cursor: z.coerce.number().int().positive().optional(),
//   limit:  z.coerce.number().int().min(1).max(500).default(80),
//   sort:   z.string().optional(),           // "-createdAt,name"
//   search: z.string().optional(),
//   filter: z.record(z.record(z.unknown())).optional(),
// });
//
// ──────────────────────────────────────────────────────────────────────────────

// router.get("/activityhistories", async (req, res) => {
// 	try {
// 		const parsed = querySchema.safeParse(req.query);
// 		if (!parsed.success) {
// 			return res.status(400).json({
// 				success: false,
// 				message: "Некорректные параметры запроса",
// 				errors: parsed.error.flatten().fieldErrors,
// 			});
// 		}

// 		const {
// 			cursor,
// 			limit: rawLimit,
// 			sort: sortParam,
// 			search,
// 			filter,
// 		} = parsed.data;
// 		const limitNumber = Number(rawLimit) || 80;

// 		// ── Сортировка ────────────────────────────────────────────────────────
// 		// Формат: "-createdAt,name"  →  [{ createdAt: "desc" }, { name: "asc" }]
// 		const orderBy = [];

// 		if (sortParam) {
// 			for (const part of sortParam.split(",")) {
// 				const trimmed = part.trim();
// 				if (!trimmed) continue;
// 				if (trimmed.startsWith("-")) {
// 					orderBy.push({ [trimmed.slice(1)]: "desc" });
// 				} else {
// 					orderBy.push({ [trimmed]: "asc" });
// 				}
// 			}
// 		}

// 		// Сортировка по умолчанию — id asc (обязательна для корректной курсорной пагинации)
// 		if (orderBy.length === 0) {
// 			orderBy.push({ id: "asc" });
// 		}

// 		// ── Поиск ─────────────────────────────────────────────────────────────
// 		// search=слово или несколько слов через пробел
// 		const words = search ? search.trim().split(/\s+/).filter(Boolean) : [];

// 		let searchWhereClause = {};
// 		if (words.length > 0) {
// 			// Ищем по текстовым полям таблицы
// 			const textFields = [
// 				"actionType",
// 				"bin",
// 				"userName",
// 				"host",
// 				"ip",
// 				"city",
// 				"objectId",
// 				"objectType",
// 				"objectName",
// 			];

// 			const andConditions = words.map((word) => ({
// 				OR: textFields.map((field) => ({
// 					[field]: { contains: word, mode: "insensitive" },
// 				})),
// 			}));

// 			searchWhereClause = { AND: andConditions };
// 		}

// 		// ── Фильтры ───────────────────────────────────────────────────────────
// 		// Клиент шлёт: filter[field][operator]=value
// 		// После парсинга Express/Zod это выглядит как объект:
// 		// filter = { field: { operator: value } }
// 		let filterWhereClause = {};

// 		if (filter && typeof filter === "object") {
// 			for (const [field, conditions] of Object.entries(filter)) {
// 				if (!conditions || typeof conditions !== "object") continue;

// 				for (const [operator, value] of Object.entries(conditions)) {
// 					switch (operator) {
// 						case "contains":
// 							filterWhereClause[field] = {
// 								contains: String(value),
// 								mode: "insensitive",
// 							};
// 							break;
// 						case "equals":
// 							filterWhereClause[field] = { equals: value };
// 							break;
// 						case "gte":
// 							filterWhereClause[field] = {
// 								...filterWhereClause[field],
// 								gte: value,
// 							};
// 							break;
// 						case "lte":
// 							filterWhereClause[field] = {
// 								...filterWhereClause[field],
// 								lte: value,
// 							};
// 							break;
// 						case "gt":
// 							filterWhereClause[field] = {
// 								...filterWhereClause[field],
// 								gt: value,
// 							};
// 							break;
// 						case "lt":
// 							filterWhereClause[field] = {
// 								...filterWhereClause[field],
// 								lt: value,
// 							};
// 							break;
// 						default:
// 							// Неизвестный оператор игнорируем
// 							break;
// 					}
// 				}
// 			}
// 		}

// 		// ── Итоговый where ────────────────────────────────────────────────────
// 		const baseWhere = {
// 			...searchWhereClause,
// 			...filterWhereClause,
// 		};

// 		// ── Курсорная пагинация ───────────────────────────────────────────────
// 		// Правило: направление cursor ДОЛЖНО совпадать с направлением сортировки.
// 		//   ASC  → следующая страница id > cursor → { gt: cursorId }
// 		//   DESC → следующая страница id < cursor → { lt: cursorId }
// 		// Здесь используем механизм Prisma cursor + skip:1

// 		const queryOptions = {
// 			take: limitNumber,
// 			where: baseWhere,
// 			include: { organization: true },
// 			orderBy,
// 		};

// 		if (cursor) {
// 			const cursorId = Number(cursor);
// 			if (!isNaN(cursorId) && cursorId > 0) {
// 				queryOptions.cursor = { id: cursorId };
// 				queryOptions.skip = 1; // пропускаем сам элемент-курсор
// 			}
// 		}

// 		const items = await prisma.activityHistory.findMany(queryOptions);

// 		// Если вернулось ровно столько, сколько просили — потенциально есть ещё данные
// 		const hasMore = items.length === limitNumber;
// 		// ID последнего элемента становится курсором следующей страницы
// 		const nextCursor = hasMore ? items[items.length - 1].id : null;

// 		// Общее количество записей (только для первой страницы, cursor === undefined)
// 		let total;
// 		if (!cursor) {
// 			total = await prisma.activityHistory.count({ where: baseWhere });
// 		}

// 		return res.status(200).json({
// 			success: true,
// 			items,
// 			nextCursor,
// 			hasMore,
// 			...(total !== undefined ? { total } : {}),
// 		});
// 	} catch (error) {
// 		console.error("GET /activityhistories error:", error);
// 		return res.status(500).json({
// 			success: false,
// 			message: "Ошибка сервера при получении истории активностей",
// 		});
// 	}
// });

router.get("/activityhistories", async (req, res) => {
	try {
		// ── Разбор и валидация query-параметров вручную ───────────────────────
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const search =
			typeof req.query.search === "string" ? req.query.search.trim() : "";

		// Парсим limit: если не приходит — используем 500, максимум 10000
		const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : 500;
		const limitNumber = Math.min(Math.max(parsedLimit, 1), 999999);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;

		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0)) {
			return res.status(400).json({
				success: false,
				message: "Некорректный параметр cursor",
			});
		}

		// filter приходит как вложенный объект: filter[field][operator]=value
		// Express автоматически разбирает его в req.query.filter = { field: { operator: value } }
		const filter =
			req.query.filter && typeof req.query.filter === "object"
				? req.query.filter
				: {};

		// Логируем для отладки
		console.log(
			`[GET /activityhistories] limit=${limitNumber}, cursor=${cursorNumber}, search=${search}`,
		);

		// ⚠️ СОРТИРОВКА ОТКЛЮЧЕНА НА СЕРВЕРЕ - ДЕЛАЕТСЯ НА КЛИЕНТЕ
		// Сервер возвращает данные в порядке возрастания ID (для курсорной пагинации)
		const orderBy = [{ id: "asc" }];

		// ── Поиск (search=строка) ─────────────────────────────────────────────
		const TEXT_FIELDS = [
			"actionType",
			"bin",
			"userName",
			"host",
			"ip",
			"city",
			"objectId",
			"objectType",
			"objectName",
		];

		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhereClause = {};

		if (searchWords.length > 0) {
			searchWhereClause = {
				AND: searchWords.map((word) => ({
					OR: TEXT_FIELDS.map((field) => ({
						[field]: { contains: word, mode: "insensitive" },
					})),
				})),
			};
		}

		// ── Фильтр по дате (filter[dateRange][startDate] / filter[dateRange][endDate]) ──
		const dateRange =
			filter.dateRange && typeof filter.dateRange === "object"
				? filter.dateRange
				: {};
		const startDate =
			typeof dateRange.startDate === "string" ? dateRange.startDate : null;
		const endDate =
			typeof dateRange.endDate === "string" ? dateRange.endDate : null;

		const dateRangeFilter =
			startDate || endDate
				? {
						actionDate: {
							...(startDate ? { gte: new Date(startDate) } : {}),
							...(endDate ? { lte: new Date(endDate) } : {}),
						},
					}
				: {};

		// ── Произвольные фильтры filter[field][operator]=value ────────────────
		const ALLOWED_OPERATORS = ["contains", "equals", "gte", "lte", "gt", "lt"];
		const SKIP_KEYS = ["searchBy", "dateRange"];
		const filterWhereClause = {};

		for (const [field, conditions] of Object.entries(filter)) {
			if (SKIP_KEYS.includes(field)) continue;
			if (!conditions || typeof conditions !== "object") continue;

			for (const [operator, value] of Object.entries(conditions)) {
				if (!ALLOWED_OPERATORS.includes(operator)) continue;

				if (!filterWhereClause[field]) {
					filterWhereClause[field] = {};
				}

				if (operator === "contains") {
					// contains требует mode, поэтому заменяем объект целиком
					filterWhereClause[field] = {
						contains: String(value),
						mode: "insensitive",
					};
				} else {
					filterWhereClause[field][operator] = value;
				}
			}
		}

		// ── Итоговый where ────────────────────────────────────────────────────
		const baseWhere = {
			...searchWhereClause,
			...dateRangeFilter,
			...filterWhereClause,
		};

		// ── Курсорная пагинация ───────────────────────────────────────────────
		// Prisma cursor + skip:1 — стандарт для cursor-based pagination
		const queryOptions = {
			take: limitNumber,
			where: baseWhere,
			include: { organization: true },
			orderBy,
		};

		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1; // пропускаем сам элемент-курсор
		}

		const items = await prisma.activityHistory.findMany(queryOptions);

		// Если вернулось ровно столько, сколько просили — потенциально есть ещё данные
		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		// Общее количество — считаем только на первой странице (без cursor),
		// чтобы не делать лишний COUNT при каждом scroll
		let total;
		if (cursorNumber === null) {
			total = await prisma.activityHistory.count({ where: baseWhere });
		}

		return res.status(200).json({
			success: true,
			items,
			nextCursor,
			hasMore,
			...(total !== undefined ? { total } : {}),
		});
	} catch (error) {
		console.error("GET /activityhistories error:", error);
		return res.status(500).json({
			success: false,
			message: "Ошибка сервера при получении истории активностей",
		});
	}
});

export default router;
