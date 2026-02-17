import express from "express";
import cors from "cors";
import { querySchema } from "../utils/module.js";
import { prisma } from "../prisma/prisma-client.js";
import { success } from "zod";
const router = express.Router();
router.use(cors());

// Backend

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

// 		const { limit, cursor, filter } = parsed.data;

// 		// ── Поиск ────────────────────────────────────────────────────────
// 		const searchBy = filter?.searchBy ?? { columns: [], value: "" };
// 		const rawQuery = (searchBy.value || "").trim();
// 		const words = rawQuery.split(/\s+/).filter(Boolean);
// 		const searchColumns = Array.isArray(searchBy.columns)
// 			? searchBy.columns
// 			: [];

// 		const { startDate, endDate } = filter?.dateRange ?? {};
// 		const dateRangeFilter =
// 			startDate || endDate
// 				? {
// 						actionDate: {
// 							...(startDate ? { gte: startDate } : {}),
// 							...(endDate ? { lte: endDate } : {}),
// 						},
// 					}
// 				: {};

// 		let searchWhereClause = {};
// 		if (words.length > 0 && searchColumns.length > 0) {
// 			const andConditions = words
// 				.map((word) => {
// 					const orConditions = searchColumns
// 						.map(({ identifier, type }) => {
// 							if (type === "date") return null;
// 							if (typeof identifier !== "string" || !identifier.trim())
// 								return null;

// 							const [field, subField] = identifier.includes(".")
// 								? identifier.split(".")
// 								: [identifier, null];

// 							let condition = null;
// 							if (type === "string") {
// 								condition = { contains: word, mode: "insensitive" };
// 							} else if (
// 								type === "number" &&
// 								word !== "" &&
// 								!isNaN(Number(word))
// 							) {
// 								condition = { equals: Number(word) };
// 							}

// 							if (!condition) return null;
// 							return subField
// 								? { [field]: { [subField]: condition } }
// 								: { [field]: condition };
// 						})
// 						.filter(Boolean);

// 					return orConditions.length > 0 ? { OR: orConditions } : null;
// 				})
// 				.filter(Boolean);

// 			if (andConditions.length > 0) {
// 				searchWhereClause = { AND: andConditions };
// 			}
// 		}

// 		const baseWhere = {
// 			...searchWhereClause,
// 			...dateRangeFilter,
// 		};

// 		// ── Курсорная логика ─────────────────────────────────────────────
// 		// ИСПРАВЛЕНО: используем id ASC + WHERE id > cursor (было: id < cursor для DESC)
// 		// Правило: направление cursor ДОЛЖНО совпадать с направлением сортировки:
// 		//   ASC  → следующая страница имеет id БОЛЬШЕ последнего → { gt: cursorId }
// 		//   DESC → следующая страница имеет id МЕНЬШЕ последнего → { lt: cursorId }
// 		// let where = { ...baseWhere };
// 		const limitNumber = Number(limit) || 80;
// 		let queryOptions = {
// 			take: limitNumber,
// 			where: baseWhere, // Ваши фильтры поиска/дат
// 			include: { organization: true },
// 			orderBy: { id: "asc" },
// 		};

// 		if (cursor) {
// 			const cursorId = Number(cursor);
// 			if (!isNaN(cursorId)) {
// 				// Стандарт Prisma для пагинации:
// 				queryOptions.cursor = { id: cursorId };
// 				queryOptions.skip = 1; // Пропускаем сам элемент-курсор
// 			}
// 		}

// 		const items = await prisma.activityHistory.findMany(queryOptions);
// 		// Если вернулось столько же, сколько просили — потенциально есть еще данные
// 		const hasMore = items.length === limitNumber;
// 		// Берем ID ПОСЛЕДНЕГО элемента в массиве для следующего запроса
// 		const nextCursor = hasMore ? items[items.length - 1].id : null;

// 		return res.status(200).json({
// 			success: true,
// 			items,
// 			nextCursor,
// 			hasMore,
// 		});
// 	} catch (error) {
// 		console.error("GET /activityhistories error:", error);
// 		return res.status(500).json({
// 			success: false,
// 			message: "Ошибка сервера при получении истории активностей",
// 		});
// 	}
// });
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

// 		const { limit, cursor, filter } = parsed.data;

// 		// ── Поиск ────────────────────────────────────────────────────────
// 		const searchBy = filter?.searchBy ?? { columns: [], value: "" };
// 		const rawQuery = (searchBy.value || "").trim();
// 		const words = rawQuery.split(/\s+/).filter(Boolean);
// 		const searchColumns = Array.isArray(searchBy.columns)
// 			? searchBy.columns
// 			: [];

// 		const { startDate, endDate } = filter?.dateRange ?? {};
// 		const dateRangeFilter =
// 			startDate || endDate
// 				? {
// 						actionDate: {
// 							...(startDate ? { gte: startDate } : {}),
// 							...(endDate ? { lte: endDate } : {}),
// 						},
// 					}
// 				: {};

// 		let searchWhereClause = {};
// 		if (words.length > 0 && searchColumns.length > 0) {
// 			const andConditions = words
// 				.map((word) => {
// 					const orConditions = searchColumns
// 						.map(({ identifier, type }) => {
// 							if (type === "date") return null;
// 							if (typeof identifier !== "string" || !identifier.trim())
// 								return null;

// 							const [field, subField] = identifier.includes(".")
// 								? identifier.split(".")
// 								: [identifier, null];

// 							let condition = null;
// 							if (type === "string") {
// 								condition = { contains: word, mode: "insensitive" };
// 							} else if (
// 								type === "number" &&
// 								word !== "" &&
// 								!isNaN(Number(word))
// 							) {
// 								condition = { equals: Number(word) };
// 							}

// 							if (!condition) return null;
// 							return subField
// 								? { [field]: { [subField]: condition } }
// 								: { [field]: condition };
// 						})
// 						.filter(Boolean);

// 					return orConditions.length > 0 ? { OR: orConditions } : null;
// 				})
// 				.filter(Boolean);

// 			if (andConditions.length > 0) {
// 				searchWhereClause = { AND: andConditions };
// 			}
// 		}

// 		const baseWhere = {
// 			...searchWhereClause,
// 			...dateRangeFilter,
// 		};

// 		// ── Курсорная логика ─────────────────────────────────────────────
// 		// ИСПРАВЛЕНО: используем id ASC + WHERE id > cursor (было: id < cursor для DESC)
// 		// Правило: направление cursor ДОЛЖНО совпадать с направлением сортировки:
// 		//   ASC  → следующая страница имеет id БОЛЬШЕ последнего → { gt: cursorId }
// 		//   DESC → следующая страница имеет id МЕНЬШЕ последнего → { lt: cursorId }
// 		let where = { ...baseWhere };
// 		let cursorObj = undefined;

// 		if (cursor) {
// 			const cursorId = Number(cursor);
// 			if (!isNaN(cursorId)) {
// 				where = {
// 					...baseWhere,
// 					id: { gt: cursorId }, // ← gt (БОЛЬШЕ) для ASC-сортировки
// 				};
// 				cursorObj = { id: cursorId };
// 			}
// 		}

// 		// ── Запрос ───────────────────────────────────────────────────────
// 		const items = await prisma.activityHistory.findMany({
// 			take: limit,
// 			// cursor + skip:1 используется Prisma для исключения самого курсора.
// 			// При наличии WHERE id > cursorId курсор уже исключён условием,
// 			// поэтому передаём cursor только для оптимизации индекса Prisma,
// 			// skip:1 при этом НЕ нужен (иначе пропустим первую валидную запись).
// 			...(cursorObj ? { cursor: cursorObj } : {}),
// 			where,
// 			include: {
// 				organization: true,
// 			},
// 			orderBy: {
// 				id: "asc", // ИСПРАВЛЕНО: сортируем по id для стабильной курсорной пагинации.
// 				// actionDate может иметь дубли (несколько записей в одну секунду),
// 				// что делает курсор по actionDate ненадёжным.
// 				// id всегда уникален и монотонно возрастает → идеален для курсора.
// 			},
// 		});

// 		// ── hasMore и nextCursor ──────────────────────────────────────────
// 		const hasMore = items.length === limit;

// 		// nextCursor = id последней записи текущей страницы.
// 		// Следующий запрос: WHERE id > nextCursor → получит записи после текущей страницы.
// 		const nextCursor = hasMore ? items[items.length - 1].id : null;

// 		return res.status(200).json({
// 			success: true,
// 			items,
// 			nextCursor,
// 			hasMore,
// 		});
// 	} catch (error) {
// 		console.error("GET /activityhistories error:", error);
// 		return res.status(500).json({
// 			success: false,
// 			message: "Ошибка сервера при получении истории активностей",
// 		});
// 	}
// });

// router.get("/counterparties", async (req, res) => {
// 	try {
// 		const page = parseInt(req.query.page) || 1;
// 		const limit = parseInt(req.query.limit) || 100;
// 		const skip = (page - 1) * limit;

// 		const [counterparties, total] = await prisma.$transaction([
// 			prisma.counterparty.findMany({
// 				skip,
// 				take: limit,
// 				// include: {
// 				// 	organization: true,
// 				// 	counterparty: true,
// 				// },
// 			}),
// 			prisma.counterparty.count(),
// 		]);

// 		res.status(200).json({
// 			items: counterparties,
// 			total,
// 			page,
// 			totalPages: Math.ceil(total / limit),
// 		});
// 	} catch (error) {
// 		console.error("Error fetching:", error);
// 		res
// 			.status(500)
// 			.json({ message: "Error fetching data.", error: error.message });
// 	}
// });

router.post("/counterparties", async (req, res) => {
	try {
		const { bin, shortName, displayName } = req.body;

		// Валидация
		const errors = [];

		if (!bin || typeof bin !== "string") {
			errors.push("BIN обязателен и должен быть строкой");
		} else if (!/^\d{12}$/.test(bin)) {
			errors.push("BIN должен состоять ровно из 12 цифр");
		}

		if (shortName && typeof shortName !== "string") {
			errors.push("shortName должен быть строкой");
		}

		if (displayName && typeof displayName !== "string") {
			errors.push("displayName должен быть строкой");
		}

		if (errors.length > 0) {
			return res.status(400).json({
				message: "Ошибка валидации",
				errors,
			});
		}

		const counterparty = await prisma.counterparty.create({
			data: {
				bin: bin.trim(),
				shortName: shortName?.trim() || null,
				displayName: displayName?.trim() || null,
			},
		});

		res.status(201).json(counterparty);
	} catch (error) {
		if (error.code === "P2002") {
			return res.status(409).json({
				message: "Контрагент с таким БИН уже существует",
			});
		}

		console.error(error);
		res.status(500).json({
			message: "Не удалось создать контрагента",
			error: error.message,
		});
	}
});

router.get("/organizations", async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 100;
		const skip = (page - 1) * limit;

		const [organizations, total] = await prisma.$transaction([
			prisma.organization.findMany({
				skip,
				take: limit,
				// include: {
				// 	organization: true,
				// 	counterparty: true,
				// },
			}),
			prisma.organization.count(),
		]);

		res.status(200).json({
			items: organizations,
			total,
			page,
			totalPages: Math.ceil(total / limit),
		});
	} catch (error) {
		console.error("Error fetching:", error);
		res
			.status(500)
			.json({ message: "Error fetching data.", error: error.message });
	}
});

router.get("/contracts", async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 100;
		const skip = (page - 1) * limit;

		const [contracts, total] = await prisma.$transaction([
			prisma.contract.findMany({
				skip,
				take: limit,
				include: {
					organization: true,
					counterparty: true,
				},
			}),
			prisma.contract.count(),
		]);

		res.status(200).json({
			items: contracts,
			total,
			page,
			totalPages: Math.ceil(total / limit),
		});
	} catch (error) {
		console.error("Error fetching:", error);
		res
			.status(500)
			.json({ message: "Error fetching data.", error: error.message });
	}
});

router.get("/data", (req, res) => {
	res.json({ message: "Data response" });
});

export default router;
