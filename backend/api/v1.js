import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
// import { parse, formatISO } from "date-fns";
// import { formatIpAddress } from "./utils/format.js";
// import { getLocalIP } from "./utils/module.js";
// import apiv1 from "./api/v1.js";

const prisma = new PrismaClient();
const router = express.Router();
router.use(cors());

router.get("/activityhistories", async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 100;
		const skip = (page - 1) * limit;

		const rawQuery = (req.query.searchQuery || "").trim();
		const words = rawQuery.split(/\s+/).filter(Boolean);

		let searchColumnsRaw = req.query.searchColumns || "[]";
		let searchColumns;
		try {
			searchColumns = JSON.parse(searchColumnsRaw);
		} catch (e) {
			searchColumns = [];
		}
		// console.log(searchColumnsRaw);

		// Парсинг startDate и endDate
		const startDate = req.query.startDate
			? new Date(req.query.startDate)
			: null;
		const endDate = req.query.endDate ? new Date(req.query.endDate) : null;

		// Проверка на валидность даты
		if (startDate && isNaN(startDate.getTime())) {
			throw new Error(`Invalid startDate: ${req.query.startDate}`);
		}
		if (endDate && isNaN(endDate.getTime())) {
			throw new Error(`Invalid endDate: ${req.query.endDate}`);
		}

		// Добавим в фильтр по полю createdAt (или другому полю даты)
		const dateRangeFilter =
			startDate || endDate
				? {
						actionDate: {
							...(startDate ? { gte: startDate } : {}),
							...(endDate ? { lte: endDate } : {}),
						},
				  }
				: {};

		const whereClause =
			words.length && searchColumns.length
				? {
						AND: words.map((word) => {
							const orConditions = searchColumns
								.map((column) => {
									const type = column.type;
									const [field, subField] = column.identifier.split(".");

									// Если тип неизвестен — игнорируем
									if (!type) return null;

									const value =
										type === "number" && !isNaN(Number(word))
											? Number(word)
											: type === "date" && !isNaN(Date.parse(word))
											? new Date(word)
											: word;

									if (type === "string") {
										const condition = {
											contains: word,
											// mode: "insensitive",
										};

										return subField
											? { [field]: { [subField]: condition } }
											: { [field]: condition };
									}

									const isNumeric = !isNaN(value) && Number.isInteger(+value);

									if (
										typeof value === "number" &&
										type === "number" &&
										isNumeric
									) {
										const condition = { equals: value };

										return subField
											? { [field]: { [subField]: condition } }
											: { [field]: condition };
									}

									return null;
								})
								.filter(Boolean); // убираем null

							return { OR: orConditions };
						}),
				  }
				: undefined;

		const finalWhereClause = {
			...whereClause,
			...dateRangeFilter,
		};
		// console.log(JSON.stringify(whereClause, null, 2));

		const [activityHistories, total] = await prisma.$transaction([
			prisma.activityHistory.findMany({
				skip,
				take: limit,
				where: finalWhereClause,
				include: {
					organization: true,
				},
			}),
			prisma.activityHistory.count({
				where: finalWhereClause,
			}),
		]);
		// console.log(activityHistories);

		res.status(200).json({
			items: activityHistories,
			total,
			page,
			totalPages: Math.ceil(total / limit),
		});
	} catch (error) {
		console.error("Error fetching:", error);
		res.status(500).json({
			message: "Error fetching data.",
			error: error.message,
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
				// include: {
				// 	organization: true,
				// 	counterparty: true,
				// },
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
