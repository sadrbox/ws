import express from "express";
import { applyPipeReference } from "../../services/pipeReference.js";
import { querySchema } from "../../utils/module.js";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { pruneAuditLog, retentionDays } from "../../services/auditLog.js";
import { parse1cDate } from "../../utils/parse1cDate.js";
import { resolveActors } from "../../services/pipeActor.js";
// import { success } from "zod";
const router = express.Router();

// Ручная чистка журнала по сроку хранения (AUDIT_RETENTION_DAYS, по умолчанию 365).
// Обычно чистка идёт сама, не чаще раза в сутки, попутно с записью в журнал —
// планировщика (cron) в проекте нет. Эндпоинт нужен, когда ждать окна нельзя.
// Только суперадмин: массовое удаление журнала — привилегированная операция.
// POST /prune  — ручная чистка журнала
router.post("/prune", async (req, res) => {
	try {
		if (!req.user?.isSuperAdmin) {
			return res.status(403).json({
				success: false,
				message: "Требуются права суперадминистратора",
			});
		}
		const days =
			req.body?.days !== undefined ? Number(req.body.days) : retentionDays();
		if (!Number.isFinite(days) || days <= 0) {
			return res.status(400).json({
				success: false,
				message: "days должен быть положительным числом",
			});
		}
		const result = await pruneAuditLog(days);
		return res.status(200).json({ success: true, ...result });
	} catch (error) {
		console.error("POST /pipe/prune error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// POST /  — прием события от 1С (ДанныеОбъекта)
// Ожидаем JSON с полями: actionDate, actionType, organization, user, object, props
// Логируем тело для отладки и сохраняем запись в activity_history.
// ============================================
router.post("/", async (req, res) => {
	try {
		const body = req.body || {};
		console.log("POST /pipe body:", JSON.stringify(body));

		const actionType = body.actionType ? String(body.actionType) : "create";
		// 1С шлёт «13.07.2026 23:22:04» — new Date() такое не парсит (Invalid Date →
		// Prisma отвергала запрос → 500 → 1С ретраила и теряла событие).
		// Нераспознанная дата не повод терять событие: подставляем время приёма.
		const actionDate = parse1cDate(body.actionDate) ?? new Date();

		const organizationShortName = body.organization?.shortName ?? null;
		const bin = body.organization?.bin ?? null;

		const userName =
			body.user?.userName ??
			body.user?.userName ??
			body.userName ??
			req.user?.username ??
			"1C";
		const host = body.user?.host ?? null;
		const ip = body.user?.ip ?? req.ip ?? null;

		const objectId = body.object?.id ?? body.objectId ?? null;
		const objectType = body.object?.type ?? body.objectType ?? null;
		const objectName = body.object?.name ?? null;

		const props = body.props ?? null;

		if (!objectId || !objectType) {
			return res
				.status(400)
				.json({ success: false, message: "Missing object.id or object.type" });
		}

		// Организация и пользователь — ССЫЛКАМИ на объекты системы, а не только именами.
		// Нет объекта — создаём (организацию только при наличии БИН). Сбой резолва не
		// роняет приём: событие важнее ссылок, они просто останутся пустыми.
		const actors = await resolveActors(body);

		const item = await prisma.pipeActivity.create({
			data: {
				...actors,
				actionDate,
				actionType,
				organizationShortName,
				bin,
				userName: String(userName).slice(0, 255),
				host,
				ip,
				objectId: String(objectId),
				objectType: String(objectType),
				objectName: objectName
					? String(objectName).slice(0, 255)
					: String(objectType).slice(0, 255),
				props: props ?? undefined,
				payload: body,
			},
		});

		// Применяем событие к справочнику (создать / обновить / привязать).
		// Сопоставление по (externalSource="1C", externalId=object.id) — см. pipeReference.js.
		// Сбой сопоставления НЕ роняет приём: событие уже сохранено, результат пишем в него же,
		// и он виден во «Входящих 1С» (applyStatus). Иначе 1С получала бы 500 и слала повторы.
		const applied = await applyPipeReference(body);
		const saved = await prisma.pipeActivity.update({
			where: { uuid: item.uuid },
			data: {
				applyStatus: applied.status,
				applyModel: applied.model ?? null,
				applyUuid: applied.uuid ?? null,
				applyMessage: applied.message ?? null,
			},
		});

		return res.status(201).json({ success: true, item: saved, applied });
	} catch (error) {
		console.error("POST /pipe error:", error);
		return res
			.status(500)
			.json({ success: false, message: "Ошибка сервера при приёме события" });
	}
});

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

// ============================================
// READ - Получение записи истории по UUID
// ============================================
// GET /:uuid — получить запись по UUID
router.get("/:uuid", async (req, res) => {
	try {
		const { uuid } = req.params;

		if (
			typeof uuid !== "string" ||
			uuid.length !== 36 ||
			(uuid.match(/-/g) || []).length !== 4
		) {
			return res.status(400).json({
				success: false,
				message: "Некорректный формат UUID",
			});
		}

		const item = await prisma.activityHistory.findUnique({
			where: { uuid },
			include: { organization: true },
		});

		if (!item) {
			return res.status(404).json({
				success: false,
				message: "Запись не найдена",
			});
		}

		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error("GET /pipe/:uuid error:", error);
		return res.status(500).json({
			success: false,
			message: "Ошибка сервера при получении записи",
		});
	}
});

// ============================================
// READ - Список записей истории (курсорная пагинация)
// ============================================
// GET /  — список записей (cursor pagination)
router.get("/", async (req, res) => {
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
		// console.log(
		// 	`[GET /activityhistories] limit=${limitNumber}, cursor=${cursorNumber}, search=${search}`,
		// );

		// ── Сортировка ────────────────────────────────────────────────────────
		// Клиент шлёт sort как JSON-строку: { "field": "asc"|"desc" }
		// Поддерживается точечная нотация для связей: "organization.name"
		// → преобразуется в { organization: { name: "asc" } } для Prisma
		const orderBy = [];
		const sortParam =
			typeof req.query.sort === "string" ? req.query.sort : null;

		if (sortParam) {
			try {
				const sortObj = JSON.parse(sortParam);
				if (sortObj && typeof sortObj === "object") {
					for (const [field, dir] of Object.entries(sortObj)) {
						if (dir !== "asc" && dir !== "desc") continue;

						// Точечная нотация: "organization.name" → { organization: { name: dir } }
						if (field.includes(".")) {
							const parts = field.split(".");
							// Строим вложенный объект справа налево
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

		// Сортировка по умолчанию — id asc (обязательна для курсорной пагинации)
		if (orderBy.length === 0) {
			orderBy.push({ id: "asc" });
		} else {
			// Всегда добавляем id как вторичный ключ сортировки для стабильности курсора
			const hasId = orderBy.some((o) => "id" in o);
			if (!hasId) {
				orderBy.push({ id: "asc" });
			}
		}

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
				AND: searchWords.map((word) => {
					const orConditions = TEXT_FIELDS.map((field) => ({
						[field]: { contains: word, mode: "insensitive" },
					}));
					const num = Number(word);
					if (idNum) orConditions.push(idNum);
					return { OR: orConditions };
				}),
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
			...tenantFilter(req),
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
		console.error("GET /pipe error:", error);
		return res.status(500).json({
			success: false,
			message: "Ошибка сервера при получении истории активностей",
		});
	}
});

// ============================================
// DELETE /activityhistories/:id
// ============================================
// DELETE /:id
router.delete("/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;

		await prisma.activityHistory.delete({
			where: isNumeric ? { id: numId } : { uuid: param },
		});

		return res.status(200).json({ success: true, message: "Удалено" });
	} catch (error) {
		if (error.code === "P2025") {
			return res
				.status(404)
				.json({ success: false, message: "Запись не найдена" });
		}
		console.error("DELETE /pipe/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
