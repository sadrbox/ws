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
// READ - Получение списка контрагентов (курсорная пагинация)
// ============================================
router.get("/counterparties", async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const search =
			typeof req.query.search === "string" ? req.query.search.trim() : "";

		const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : 500;
		const limitNumber = Math.min(Math.max(parsedLimit, 1), 999999);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;

		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0)) {
			return res.status(400).json({
				success: false,
				message: "Некорректный параметр cursor",
			});
		}

		const filter =
			req.query.filter && typeof req.query.filter === "object"
				? req.query.filter
				: {};

		// ── Сортировка ────────────────────────────────────────────────────────
		const orderBy = [];
		const sortParam =
			typeof req.query.sort === "string" ? req.query.sort : null;

		if (sortParam) {
			try {
				const sortObj = JSON.parse(sortParam);
				if (sortObj && typeof sortObj === "object") {
					for (const [field, dir] of Object.entries(sortObj)) {
						if (dir !== "asc" && dir !== "desc") continue;
						if (field.includes(".")) {
							const parts = field.split(".");
							let nested = { [parts[parts.length - 1]]: dir };
							for (let i = parts.length - 2; i >= 0; i--) {
								nested = { [parts[i]]: nested };
							}
							orderBy.push(nested);
						} else {
							orderBy.push({ [field]: dir });
						}
					}
				}
			} catch {
				// Некорректный JSON — игнорируем
			}
		}

		if (orderBy.length === 0) {
			orderBy.push({ id: "asc" });
		} else {
			const hasId = orderBy.some((o) => "id" in o);
			if (!hasId) orderBy.push({ id: "asc" });
		}

		// ── Поиск ─────────────────────────────────────────────────────────────
		const TEXT_FIELDS = ["bin", "shortName", "displayName"];
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

		// ── Фильтр по дате ────────────────────────────────────────────────────
		const dateRange =
			filter.dateRange && typeof filter.dateRange === "object"
				? filter.dateRange
				: {};
		const startDate =
			typeof dateRange.startDate === "string" ? dateRange.startDate : null;
		const endDate =
			typeof dateRange.endDate === "string" ? dateRange.endDate : null;

		const dateRangeFilter = {};

		// ── Произвольные фильтры ──────────────────────────────────────────────
		const ALLOWED_OPERATORS = ["contains", "equals", "gte", "lte", "gt", "lt"];
		const SKIP_KEYS = ["searchBy", "dateRange"];
		const filterWhereClause = {};

		for (const [field, conditions] of Object.entries(filter)) {
			if (SKIP_KEYS.includes(field)) continue;
			if (!conditions || typeof conditions !== "object") continue;

			for (const [operator, value] of Object.entries(conditions)) {
				if (!ALLOWED_OPERATORS.includes(operator)) continue;

				if (!filterWhereClause[field]) filterWhereClause[field] = {};

				if (operator === "contains") {
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
		const queryOptions = {
			take: limitNumber,
			where: baseWhere,
			include: {
				_count: {
					select: {
						contracts: true,
						contacts: true,
						bankAccounts: true,
					},
				},
			},
			orderBy,
		};

		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const items = await prisma.counterparty.findMany(queryOptions);

		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		let total;
		if (cursorNumber === null) {
			total = await prisma.counterparty.count({ where: baseWhere });
		}

		return res.status(200).json({
			success: true,
			items,
			nextCursor,
			hasMore,
			...(total !== undefined ? { total } : {}),
		});
	} catch (error) {
		console.error("GET /counterparties error:", error);
		return res.status(500).json({
			success: false,
			message: "Ошибка сервера при получении контрагентов",
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
router.put("/counterparties/:uuid", async (req, res) => {
	try {
		const { uuid } = req.params;
		const { bin, shortName, displayName } = req.body;

		if (
			typeof uuid !== "string" ||
			uuid.length !== 36 ||
			(uuid.match(/-/g) || []).length !== 4
		) {
			return res.status(400).json({
				message: "Некорректный формат UUID контрагента",
			});
		}
		// if (isNaN(uuid)) {
		// 	return res.status(400).json({
		// 		message: "Некорректный UUID контрагента",
		// 	});
		// }

		// Проверка существования контрагента
		const existingCounterparty = await prisma.counterparty.findUnique({
			where: { uuid },
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
		if (bin !== undefined) {
			updateData.bin = bin?.trim() || null;
		}

		// Обновление контрагента
		const updatedCounterparty = await prisma.counterparty.update({
			where: { uuid },
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
router.patch("/counterparties/:uuid", async (req, res) => {
	try {
		const { uuid } = req.params;

		if (
			typeof uuid !== "string" ||
			uuid.length !== 36 ||
			(uuid.match(/-/g) || []).length !== 4
		) {
			return res.status(400).json({
				message: "Некорректный формат UUID контрагента",
			});
		}

		if (isNaN(uuid)) {
			return res.status(400).json({
				message: "Некорректный ID контрагента",
			});
		}

		// Проверка существования
		const existingCounterparty = await prisma.counterparty.findUnique({
			where: { uuid },
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
			where: { uuid },
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
router.delete("/counterparties/:uuid", async (req, res) => {
	try {
		const { uuid } = req.params;

		if (
			typeof uuid !== "string" ||
			uuid.length !== 36 ||
			(uuid.match(/-/g) || []).length !== 4
		) {
			return res.status(400).json({
				message: "Некорректный формат UUID контрагента",
			});
		}

		if (isNaN(uuid)) {
			return res.status(400).json({
				message: "Некорректный ID контрагента",
			});
		}

		// Проверка существования и связанных данных
		const existingCounterparty = await prisma.counterparty.findUnique({
			where: { uuid },
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
			where: { uuid },
		});

		res.status(200).json({
			message: "Контрагент успешно удален",
			uuid: uuid,
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
			},
		});

		if (format === "csv") {
			// Генерация CSV
			const headers = ["ID", "БИН", "Краткое название", "Полное название"];
			const csvRows = [headers.join(",")];

			counterparties.forEach((cp) => {
				const row = [cp.id, cp.bin, cp.shortName || "", cp.displayName || ""];
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
