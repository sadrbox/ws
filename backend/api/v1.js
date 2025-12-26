import express from "express";
import cors from "cors";
// import { PrismaClient } from "@prisma/client";
import { prisma } from "../prisma/prisma-client.js";
// import { parse, formatISO } from "date-fns";
// import { formatIpAddress } from "./utils/format.js";
// import { getLocalIP } from "./utils/module.js";
// import apiv1 from "./api/v1.js";

// const prisma = new PrismaClient();
const router = express.Router();
router.use(cors());

// Backend
router.get("/activityhistories", async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 100;
		const skip = (page - 1) * limit;

		// --- Парсинг фильтра с безопасностью ---
		let filter = {};
		if (req.query.filter && typeof req.query.filter === "string") {
			try {
				filter = JSON.parse(req.query.filter);
			} catch (jsonError) {
				console.error("Error parsing filter JSON:", jsonError);
				// Можно вернуть ошибку клиенту или просто использовать пустой фильтр
				return res.status(400).json({ message: "Invalid filter JSON format." });
			}
		}
		// --- Конец парсинга фильтра ---

		// --- Поиск ---
		const searchBy = filter.searchBy ?? { columns: [], value: "" };
		const rawQuery = (searchBy.value || "").trim();
		// Разбиваем на слова по пробелам и удаляем пустые строки
		const words = rawQuery.split(/\s+/).filter(Boolean);

		// Преобразование колонок в нужный формат { identifier, type }
		const searchColumns = Array.isArray(searchBy.columns)
			? searchBy.columns
			: [];

		// console.log("Search words:", words); // Лог для отладки

		// --- Дата ---
		const dateRange = filter.dateRange ?? { startDate: null, endDate: null };
		// Проверяем, что даты являются строками перед созданием Date
		const startDate =
			dateRange.startDate && typeof dateRange.startDate === "string"
				? new Date(dateRange.startDate)
				: null;
		const endDate =
			dateRange.endDate && typeof dateRange.endDate === "string"
				? new Date(dateRange.endDate)
				: null;

		// Валидация дат после создания объектов Date
		if (startDate && isNaN(startDate.getTime())) {
			// Указываем, какое поле вызвало ошибку
			console.error(
				`Invalid startDate string received: ${dateRange.startDate}`
			);
			return res.status(400).json({ message: `Invalid startDate value.` });
		}
		if (endDate && isNaN(endDate.getTime())) {
			// Указываем, какое поле вызвало ошибку
			console.error(`Invalid endDate string received: ${dateRange.endDate}`);
			return res.status(400).json({ message: `Invalid endDate value.` });
		}

		const dateRangeFilter =
			startDate || endDate
				? {
						actionDate: {
							...(startDate ? { gte: startDate } : {}),
							...(endDate ? { lte: endDate } : {}),
						},
				  }
				: {};

		// --- Where clause (Поиск) ---
		// Эта логика УЖЕ делает фильтрацию для каждого слова (AND) по всем колонкам (OR)
		const searchWhereClause =
			words.length > 0 && searchColumns.length > 0 // Убедимся, что массивы не пустые
				? {
						AND: words
							.map((word) => {
								const orConditions = searchColumns
									.map(({ identifier, type }) => {
										// не фильтруем по дате - это уже учтено в dateRangeFilter
										// Если тип - дата, пропускаем создание условия для поиска по тексту
										if (type === "date") return null;

										// Проверка, что identifier существует и является строкой
										if (
											typeof identifier !== "string" ||
											identifier.length === 0
										) {
											console.warn(
												`Invalid identifier in searchColumns: ${identifier}`
											);
											return null;
										}

										const [field, subField] = identifier.includes(".")
											? identifier.split(".")
											: [identifier, null];

										let condition = null;

										if (type === "string") {
											// Можно добавить опцию case-insensitive в зависимости от ORM/БД
											condition = { contains: word };
										} else if (
											type === "number" &&
											word !== "" &&
											!isNaN(Number(word))
										) {
											// Дополнительная проверка word !== '', т.к. Number('') = 0
											condition = { equals: Number(word) };
										} else {
											// Пропускаем другие типы или нечисловые значения для числовых полей
											return null;
										}

										// Проверка, что условие было успешно создано
										if (!condition) {
											return null;
										}

										return subField
											? { [field]: { [subField]: condition } }
											: { [field]: condition };
									})
									.filter(Boolean); // Удаляем null условия

								// Если для слова не создано ни одного OR условия (например, все колонки были date), пропускаем его
								if (orConditions.length === 0) {
									return null;
								}

								return { OR: orConditions }; // Одно OR условие для каждого слова
							})
							.filter(Boolean), // Удаляем null OR условия (если для слова не нашлось подходящих колонок)
				  }
				: {}; // Пустой объект поиска, если нет слов или колонок

		// Проверяем, что массив AND не пустой, если whereClause был создан
		// Это нужно, если, например, слова были, но ни одна из searchColumns не подходит
		const finalSearchWhereClause =
			(searchWhereClause.AND?.length ?? 0) > 0 ? searchWhereClause : {};

		// Объединяем все условия
		const finalWhereClause = {
			...finalSearchWhereClause, // Условия поиска по тексту/числам
			...dateRangeFilter, // Условия фильтрации по дате
		};

		console.log(
			"Final WHERE clause:",
			JSON.stringify(finalWhereClause, null, 2)
		); // Лог финального фильтра

		// --- Запрос к базе ---
		const [activityHistories, total] = await prisma.$transaction([
			prisma.activityHistory.findMany({
				skip,
				take: limit,
				where: finalWhereClause, // Используем объединенный фильтр
				include: {
					organization: true, // Убедитесь, что организация связана
				},
				// TODO: Добавить order/orderBy из req.query.sort если необходимо
			}),
			prisma.activityHistory.count({
				where: finalWhereClause, // Используем объединенный фильтр для подсчета
			}),
		]);

		res.status(200).json({
			items: activityHistories,
			total,
			page,
			totalPages: Math.ceil(total / limit),
		});
	} catch (error) {
		console.error("Error fetching ActivityHistories:", error); // Уточняем лог
		// Проверяем тип ошибки, чтобы не отправлять чувствительную информацию в прод
		const message =
			error instanceof Error ? error.message : "An unknown error occurred.";
		res.status(500).json({
			message: "Error fetching data.",
			error: message,
		});
	}
});

router.get("/counterparties", async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 100;
		const skip = (page - 1) * limit;

		const [counterparties, total] = await prisma.$transaction([
			prisma.counterparty.findMany({
				skip,
				take: limit,
				// include: {
				// 	organization: true,
				// 	counterparty: true,
				// },
			}),
			prisma.counterparty.count(),
		]);

		res.status(200).json({
			items: counterparties,
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
