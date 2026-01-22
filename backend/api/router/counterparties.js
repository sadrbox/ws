// routes/counterparties.js
import express from "express";
import cors from "cors";
// import { querySchema } from "../utils/module.js";
import { prisma } from "../../prisma/prisma-client.js";
// import { success } from "zod";
const router = express.Router();
router.use(cors());

// Валидация БИН
const validateBIN = (bin) => {
	if (!bin || typeof bin !== "string") {
		return { valid: false, error: "БИН обязателен и должен быть строкой" };
	}
	if (!/^\d{12}$/.test(bin.trim())) {
		return { valid: false, error: "БИН должен состоять ровно из 12 цифр" };
	}
	return { valid: true };
};

// Валидация данных контрагента
const validateCounterpartyData = (data) => {
	const errors = [];

	// Валидация БИН
	const binValidation = validateBIN(data.bin);
	if (!binValidation.valid) {
		errors.push(binValidation.error);
	}

	// Валидация shortName
	if (data.shortName !== undefined && data.shortName !== null) {
		if (typeof data.shortName !== "string") {
			errors.push("shortName должен быть строкой");
		} else if (data.shortName.trim().length > 255) {
			errors.push("shortName не должен превышать 255 символов");
		}
	}

	// Валидация displayName
	if (data.displayName !== undefined && data.displayName !== null) {
		if (typeof data.displayName !== "string") {
			errors.push("displayName должен быть строкой");
		} else if (data.displayName.trim().length > 500) {
			errors.push("displayName не должен превышать 500 символов");
		}
	}

	return errors;
};

// ============================================
// CREATE - Создание нового контрагента
// ============================================
router.post("/counterparties", async (req, res) => {
	try {
		const { bin, shortName, displayName } = req.body;

		// 1. Ранняя проверка наличия
		if (!bin || typeof bin !== "string") {
			return res.status(400).json({
				message: "Поле BIN обязательно и должно быть строкой",
			});
		}

		// 2. Нормализация один раз
		const normalizedBin = bin.trim();

		// 3. Валидация (предполагаем, что validate... теперь принимает уже trimmed значения)
		const errors = validateCounterpartyData({
			bin: normalizedBin,
			shortName: shortName?.trim() ?? null,
			displayName: displayName?.trim() ?? null,
		});

		if (errors.length > 0) {
			return res.status(400).json({ message: "Ошибка валидации", errors });
		}

		// 4. Проверка + создание в одной транзакции (самый надёжный способ)
		const counterparty = await prisma.$transaction(async (tx) => {
			const existing = await tx.counterparty.findUnique({
				where: { bin: normalizedBin },
			});

			if (existing) {
				throw Object.assign(new Error("Duplicate BIN"), { status: 409 });
			}

			return tx.counterparty.create({
				data: {
					bin: normalizedBin,
					shortName: shortName?.trim() ?? null, // или "" — решите сами
					displayName: displayName?.trim() ?? null,
				},
			});
		});

		return res.status(201).json(counterparty);
	} catch (error) {
		console.error("Error creating counterparty:", error);

		if (error.status === 409 || error.code === "P2002") {
			return res.status(409).json({
				message: "Контрагент с таким БИН уже существует",
			});
		}

		// В продакшене лучше не отдавать error.message
		return res.status(500).json({
			message: "Не удалось создать контрагента",
			// error: error.message,   ← закомментировать в проде
		});
	}
});

// ============================================
// READ - Получение списка контрагентов с поиском и фильтрацией
// ============================================
router.get("/counterparties", async (req, res) => {
	try {
		// Пагинация
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 100;
		const skip = (page - 1) * limit;

		// Параметры поиска и фильтрации
		const search = req.query.search || "";
		const sortBy = req.query.sortBy || "createdAt";
		const sortOrder = req.query.sortOrder || "desc";

		// Фильтры
		const filterBin = req.query.bin || "";
		const filterShortName = req.query.shortName || "";
		const filterDisplayName = req.query.displayName || "";

		// Даты (для фильтрации по диапазону)
		const dateFrom = req.query.dateFrom;
		const dateTo = req.query.dateTo;

		// Построение условий WHERE
		const where = {};

		// Общий поиск по всем текстовым полям
		if (search) {
			where.OR = [
				{ bin: { contains: search } },
				{ shortName: { contains: search, mode: "insensitive" } },
				{ displayName: { contains: search, mode: "insensitive" } },
			];
		}

		// Специфичные фильтры (работают вместе с общим поиском через AND)
		const andConditions = [];

		if (filterBin) {
			andConditions.push({ bin: { contains: filterBin } });
		}

		if (filterShortName) {
			andConditions.push({
				shortName: { contains: filterShortName, mode: "insensitive" },
			});
		}

		if (filterDisplayName) {
			andConditions.push({
				displayName: { contains: filterDisplayName, mode: "insensitive" },
			});
		}

		// Фильтр по диапазону дат
		if (dateFrom || dateTo) {
			const dateFilter = {};
			if (dateFrom) {
				dateFilter.gte = new Date(dateFrom);
			}
			if (dateTo) {
				dateFilter.lte = new Date(dateTo);
			}
			andConditions.push({ createdAt: dateFilter });
		}

		// Объединяем условия
		if (andConditions.length > 0) {
			where.AND = andConditions;
		}

		// Валидация поля сортировки
		const allowedSortFields = [
			"id",
			"bin",
			"shortName",
			"displayName",
			"createdAt",
			"updatedAt",
		];
		const orderByField = allowedSortFields.includes(sortBy)
			? sortBy
			: "createdAt";
		const orderByDirection = sortOrder === "asc" ? "asc" : "desc";

		// Выполнение запроса в транзакции
		const [counterparties, total] = await prisma.$transaction([
			prisma.counterparty.findMany({
				where,
				skip,
				take: limit,
				orderBy: { [orderByField]: orderByDirection },
				include: {
					_count: {
						select: {
							contracts: true,
							contacts: true,
							bankAccounts: true,
						},
					},
				},
			}),
			prisma.counterparty.count({ where }),
		]);

		res.status(200).json({
			items: counterparties,
			total,
			page,
			limit,
			totalPages: Math.ceil(total / limit),
			filters: {
				search,
				bin: filterBin,
				shortName: filterShortName,
				displayName: filterDisplayName,
				dateFrom,
				dateTo,
			},
			sort: {
				field: orderByField,
				order: orderByDirection,
			},
		});
	} catch (error) {
		console.error("Error fetching counterparties:", error);
		res.status(500).json({
			message: "Error fetching data.",
			error: error.message,
		});
	}
});

// ============================================
// READ - Получение контрагента по ID
// ============================================
router.get("/counterparties/:uuid", async (req, res) => {
	try {
		const { uuid } = req.params;

		// Простая проверка: строка длиной 36 символов и содержит хотя бы 3 дефиса
		if (
			typeof uuid !== "string" ||
			uuid.length !== 36 ||
			(uuid.match(/-/g) || []).length !== 4
		) {
			return res.status(400).json({
				message: "Некорректный формат UUID контрагента",
			});
		}

		const counterparty = await prisma.counterparty.findUnique({
			where: { uuid },
			include: {
				contracts: {
					select: {
						id: true,
						contractNumber: true,
						contractText: true,
						startDate: true,
						endDate: true,
					},
					// orderBy: { contractDate: "desc" },
				},
				contacts: {
					select: {
						id: true,
						value: true,
					},
					// orderBy: { name: "asc" },
				},
				bankAccounts: {
					select: {
						id: true,
						iban: true,
						bankName: true,
						bik: true,
					},
					// orderBy: { bankName: "asc" },
				},
			},
		});

		if (!counterparty) {
			return res.status(404).json({
				message: "Контрагент не найден",
			});
		}

		res.status(200).json(counterparty);
	} catch (error) {
		console.error("Error fetching counterparty:", error);
		res.status(500).json({
			message: "Не удалось получить данные контрагента",
			error: error.message,
		});
	}
});

// ============================================
// READ - Получение контрагента по UUID
// ============================================
router.get("/counterparties/uuid/:uuid", async (req, res) => {
	try {
		const { uuid } = req.params;

		const counterparty = await prisma.counterparty.findUnique({
			where: { uuid },
			include: {
				contracts: {
					orderBy: { contractDate: "desc" },
				},
				contacts: {
					orderBy: { name: "asc" },
				},
				bankAccounts: {
					orderBy: { bankName: "asc" },
				},
			},
		});

		if (!counterparty) {
			return res.status(404).json({
				message: "Контрагент не найден",
			});
		}

		res.status(200).json(counterparty);
	} catch (error) {
		console.error("Error fetching counterparty by UUID:", error);
		res.status(500).json({
			message: "Не удалось получить данные контрагента",
			error: error.message,
		});
	}
});

// ============================================
// UPDATE - Обновление контрагента
// ============================================
router.put("/counterparties/:id", async (req, res) => {
	try {
		const { id } = req.params;
		const { shortName, displayName } = req.body;
		const counterpartyId = parseInt(id);

		if (isNaN(counterpartyId)) {
			return res.status(400).json({
				message: "Некорректный ID контрагента",
			});
		}

		// Проверка существования контрагента
		const existingCounterparty = await prisma.counterparty.findUnique({
			where: { id: counterpartyId },
		});

		if (!existingCounterparty) {
			return res.status(404).json({
				message: "Контрагент не найден",
			});
		}

		// Валидация только изменяемых полей
		const errors = [];

		if (shortName !== undefined && shortName !== null) {
			if (typeof shortName !== "string") {
				errors.push("shortName должен быть строкой");
			} else if (shortName.trim().length > 255) {
				errors.push("shortName не должен превышать 255 символов");
			}
		}

		if (displayName !== undefined && displayName !== null) {
			if (typeof displayName !== "string") {
				errors.push("displayName должен быть строкой");
			} else if (displayName.trim().length > 500) {
				errors.push("displayName не должен превышать 500 символов");
			}
		}

		if (errors.length > 0) {
			return res.status(400).json({
				message: "Ошибка валидации",
				errors,
			});
		}

		// Подготовка данных для обновления
		const updateData = {};
		if (shortName !== undefined) {
			updateData.shortName = shortName?.trim() || null;
		}
		if (displayName !== undefined) {
			updateData.displayName = displayName?.trim() || null;
		}

		// Обновление контрагента
		const updatedCounterparty = await prisma.counterparty.update({
			where: { id: counterpartyId },
			data: updateData,
		});

		res.status(200).json(updatedCounterparty);
	} catch (error) {
		console.error("Error updating counterparty:", error);
		res.status(500).json({
			message: "Не удалось обновить контрагента",
			error: error.message,
		});
	}
});

// ============================================
// PATCH - Частичное обновление контрагента
// ============================================
router.patch("/counterparties/:id", async (req, res) => {
	try {
		const { id } = req.params;
		const counterpartyId = parseInt(id);

		if (isNaN(counterpartyId)) {
			return res.status(400).json({
				message: "Некорректный ID контрагента",
			});
		}

		// Проверка существования
		const existingCounterparty = await prisma.counterparty.findUnique({
			where: { id: counterpartyId },
		});

		if (!existingCounterparty) {
			return res.status(404).json({
				message: "Контрагент не найден",
			});
		}

		// Фильтруем только допустимые поля для обновления
		const allowedFields = ["shortName", "displayName"];
		const updateData = {};

		for (const field of allowedFields) {
			if (req.body[field] !== undefined) {
				updateData[field] = req.body[field]?.trim() || null;
			}
		}

		if (Object.keys(updateData).length === 0) {
			return res.status(400).json({
				message: "Нет данных для обновления",
			});
		}

		const updatedCounterparty = await prisma.counterparty.update({
			where: { id: counterpartyId },
			data: updateData,
		});

		res.status(200).json(updatedCounterparty);
	} catch (error) {
		console.error("Error patching counterparty:", error);
		res.status(500).json({
			message: "Не удалось обновить контрагента",
			error: error.message,
		});
	}
});

// ============================================
// DELETE - Удаление контрагента
// ============================================
router.delete("/counterparties/:id", async (req, res) => {
	try {
		const { id } = req.params;
		const counterpartyId = parseInt(id);

		if (isNaN(counterpartyId)) {
			return res.status(400).json({
				message: "Некорректный ID контрагента",
			});
		}

		// Проверка существования и связанных данных
		const existingCounterparty = await prisma.counterparty.findUnique({
			where: { id: counterpartyId },
			include: {
				_count: {
					select: {
						contracts: true,
						contacts: true,
						bankAccounts: true,
					},
				},
			},
		});

		if (!existingCounterparty) {
			return res.status(404).json({
				message: "Контрагент не найден",
			});
		}

		// Проверка на наличие связанных записей
		const hasRelatedData =
			existingCounterparty._count.contracts > 0 ||
			existingCounterparty._count.contacts > 0 ||
			existingCounterparty._count.bankAccounts > 0;

		if (hasRelatedData) {
			return res.status(409).json({
				message:
					"Невозможно удалить контрагента, так как существуют связанные записи",
				details: {
					contracts: existingCounterparty._count.contracts,
					contacts: existingCounterparty._count.contacts,
					bankAccounts: existingCounterparty._count.bankAccounts,
				},
			});
		}

		// Удаление контрагента
		await prisma.counterparty.delete({
			where: { id: counterpartyId },
		});

		res.status(200).json({
			message: "Контрагент успешно удален",
			id: counterpartyId,
		});
	} catch (error) {
		console.error("Error deleting counterparty:", error);

		if (error.code === "P2003") {
			return res.status(409).json({
				message: "Невозможно удалить контрагента из-за связанных записей",
			});
		}

		res.status(500).json({
			message: "Не удалось удалить контрагента",
			error: error.message,
		});
	}
});

// ============================================
// SEARCH - Быстрый поиск контрагента по БИН
// ============================================
router.get("/counterparties/search/bin/:bin", async (req, res) => {
	try {
		const { bin } = req.params;

		const binValidation = validateBIN(bin);
		if (!binValidation.valid) {
			return res.status(400).json({
				message: binValidation.error,
			});
		}

		const counterparty = await prisma.counterparty.findUnique({
			where: { bin: bin.trim() },
			include: {
				_count: {
					select: {
						contracts: true,
						contacts: true,
						bankAccounts: true,
					},
				},
			},
		});

		if (!counterparty) {
			return res.status(404).json({
				message: "Контрагент с указанным БИН не найден",
			});
		}

		res.status(200).json(counterparty);
	} catch (error) {
		console.error("Error searching counterparty by BIN:", error);
		res.status(500).json({
			message: "Ошибка поиска контрагента",
			error: error.message,
		});
	}
});

// ============================================
// BULK DELETE - Массовое удаление контрагентов
// ============================================
router.post("/counterparties/bulk-delete", async (req, res) => {
	try {
		const { ids } = req.body;

		if (!Array.isArray(ids) || ids.length === 0) {
			return res.status(400).json({
				message: "Необходимо передать массив ID для удаления",
			});
		}

		const counterpartyIds = ids
			.map((id) => parseInt(id))
			.filter((id) => !isNaN(id));

		if (counterpartyIds.length === 0) {
			return res.status(400).json({
				message: "Не найдено корректных ID для удаления",
			});
		}

		// Проверка на связанные данные
		const counterpartiesWithRelations = await prisma.counterparty.findMany({
			where: { id: { in: counterpartyIds } },
			include: {
				_count: {
					select: {
						contracts: true,
						contacts: true,
						bankAccounts: true,
					},
				},
			},
		});

		const cannotDelete = counterpartiesWithRelations.filter(
			(cp) =>
				cp._count.contracts > 0 ||
				cp._count.contacts > 0 ||
				cp._count.bankAccounts > 0,
		);

		if (cannotDelete.length > 0) {
			return res.status(409).json({
				message:
					"Некоторые контрагенты имеют связанные записи и не могут быть удалены",
				cannotDelete: cannotDelete.map((cp) => ({
					id: cp.id,
					bin: cp.bin,
					displayName: cp.displayName,
					relations: {
						contracts: cp._count.contracts,
						contacts: cp._count.contacts,
						bankAccounts: cp._count.bankAccounts,
					},
				})),
			});
		}

		// Удаление
		const deleteResult = await prisma.counterparty.deleteMany({
			where: { id: { in: counterpartyIds } },
		});

		res.status(200).json({
			message: `Успешно удалено контрагентов: ${deleteResult.count}`,
			count: deleteResult.count,
		});
	} catch (error) {
		console.error("Error bulk deleting counterparties:", error);
		res.status(500).json({
			message: "Ошибка при массовом удалении",
			error: error.message,
		});
	}
});

// ============================================
// EXPORT - Экспорт списка контрагентов
// ============================================
router.get("/counterparties/export/list", async (req, res) => {
	try {
		const format = req.query.format || "json"; // json, csv

		const counterparties = await prisma.counterparty.findMany({
			orderBy: { displayName: "asc" },
			select: {
				id: true,
				bin: true,
				shortName: true,
				displayName: true,
				createdAt: true,
				updatedAt: true,
			},
		});

		if (format === "csv") {
			// Генерация CSV
			const headers = [
				"ID",
				"БИН",
				"Краткое название",
				"Полное название",
				"Дата создания",
				"Дата обновления",
			];
			const csvRows = [headers.join(",")];

			counterparties.forEach((cp) => {
				const row = [
					cp.id,
					cp.bin,
					cp.shortName || "",
					cp.displayName || "",
					cp.createdAt.toISOString(),
					cp.updatedAt.toISOString(),
				];
				csvRows.push(row.map((val) => `"${val}"`).join(","));
			});

			const csvContent = csvRows.join("\n");

			res.setHeader("Content-Type", "text/csv; charset=utf-8");
			res.setHeader(
				"Content-Disposition",
				"attachment; filename=counterparties.csv",
			);
			res.status(200).send("\uFEFF" + csvContent); // BOM for Excel UTF-8
		} else {
			// JSON формат
			res.status(200).json({
				items: counterparties,
				total: counterparties.length,
				exportedAt: new Date().toISOString(),
			});
		}
	} catch (error) {
		console.error("Error exporting counterparties:", error);
		res.status(500).json({
			message: "Ошибка при экспорте данных",
			error: error.message,
		});
	}
});

export default router;
