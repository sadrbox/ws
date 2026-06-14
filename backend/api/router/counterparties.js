// routes/counterparties.js
import express from "express";
// import { querySchema } from "../utils/module.js";
import { prisma } from "../../prisma/prisma-client.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { tenantFilter } from "../../utils/auth.js";
const router = express.Router();

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

	// Валидация name
	if (data.name !== undefined && data.name !== null) {
		if (typeof data.name !== "string") {
			errors.push("name должен быть строкой");
		} else if (data.name.trim().length > 255) {
			errors.push("name не должен превышать 255 символов");
		}
	}

	// Валидация legalName
	if (data.legalName !== undefined && data.legalName !== null) {
		if (typeof data.legalName !== "string") {
			errors.push("legalName должен быть строкой");
		} else if (data.legalName.trim().length > 500) {
			errors.push("legalName не должен превышать 500 символов");
		}
	}

	return errors;
};

// ============================================
// CREATE - Создание нового контрагента
// ============================================
router.post("/counterparties", async (req, res) => {
	try {
		const { bin, name, legalName } = req.body;

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
			name: name?.trim() ?? null,
			legalName: legalName?.trim() ?? null,
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
					name: name?.trim() ?? null,
					legalName: legalName?.trim() ?? null,
					organizationUuid: req.user?.organizationUuid ?? null,
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
// Розничный покупатель (продажи населению без выбора контрагента).
// Идемпотентно создаёт/возвращает ГЛОБАЛЬНОГО (organizationUuid=null) контрагента
// «Розничный покупатель» (резерв BIN 000000000000) + договор по умолчанию.
// Объявлен ДО `/counterparties/:uuid`. Используется терминалом продаж.
// ============================================
const RETAIL_BIN = "000000000000";
router.get("/counterparties/retail", async (_req, res) => {
	try {
		let counterparty = await prisma.counterparty.findFirst({ where: { bin: RETAIL_BIN }, select: { uuid: true, name: true } });
		if (!counterparty) {
			counterparty = await prisma.counterparty.create({
				data: { bin: RETAIL_BIN, name: "Розничный покупатель", legalName: "Розничный покупатель", organizationUuid: null },
				select: { uuid: true, name: true },
			});
		}
		let contract = await prisma.contract.findFirst({ where: { counterpartyUuid: counterparty.uuid, deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { id: "asc" }], select: { uuid: true, name: true } });
		if (!contract) {
			contract = await prisma.contract.create({
				data: { name: "Розничная продажа", counterpartyUuid: counterparty.uuid, organizationUuid: null, isPrimary: true },
				select: { uuid: true, name: true },
			});
		}
		return res.status(200).json({ success: true, counterparty, contract });
	} catch (error) {
		console.error("GET /counterparties/retail error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
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
		const TEXT_FIELDS = ["bin", "name", "legalName"];
		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhereClause = {};

		if (searchWords.length > 0) {
			searchWhereClause = {
				AND: searchWords.map((word) => {
					const orConditions = TEXT_FIELDS.map((field) => ({
						[field]: { contains: word, mode: "insensitive" },
					}));
					const num = Number(word);
					if (Number.isInteger(num) && num > 0) {
						orConditions.push({ id: { equals: num } });
					}
					return { OR: orConditions };
				}),
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

		// ── Итоговый where ────────────────────────────────────────────────────────
		const baseWhere = {
			...searchWhereClause,
			...dateRangeFilter,
			...filterWhereClause,
			...tenantFilter(req),
		};

		// ── Курсорная пагинация ───────────────────────────────────────────────
		const queryOptions = {
			take: limitNumber,
			where: baseWhere,
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
		const { bin, name, legalName } = req.body;

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

		if (name !== undefined && name !== null) {
			if (typeof name !== "string") {
				errors.push("name должен быть строкой");
			} else if (name.trim().length > 255) {
				errors.push("name не должен превышать 255 символов");
			}
		}

		if (legalName !== undefined && legalName !== null) {
			if (typeof legalName !== "string") {
				errors.push("legalName должен быть строкой");
			} else if (legalName.trim().length > 500) {
				errors.push("legalName не должен превышать 500 символов");
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
		if (name !== undefined) {
			updateData.name = name?.trim() || null;
		}
		if (legalName !== undefined) {
			updateData.legalName = legalName?.trim() || null;
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
		const allowedFields = ["name", "legalName"];
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

		// Перенаправляем в общий обработчик: он сам сделает findUnique →
		// guardReferences → delete и вернёт корректные коды (404/409/200).
		// Подменяем req.params.id для совместимости с handleDelete.
		req.params.id = uuid;
		return handleDelete({
			req,
			res,
			prisma,
			modelName: "counterparty",
			notFoundMessage: "Контрагент не найден",
		});
	} catch (error) {
		console.error("Error deleting counterparty:", error);
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
			orderBy: { legalName: "asc" },
			select: {
				id: true,
				bin: true,
				name: true,
				legalName: true,
			},
		});

		if (format === "csv") {
			// Генерация CSV
			const headers = ["ID", "БИН", "Краткое название", "Полное название"];
			const csvRows = [headers.join(",")];

			counterparties.forEach((cp) => {
				const row = [cp.id, cp.bin, cp.name || "", cp.legalName || ""];
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

router.post("/counterparties/batch-delete", (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: "counterparty" }),
);

export default router;
