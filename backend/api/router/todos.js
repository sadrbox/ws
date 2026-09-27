import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { clampLimit, sendError, parseDateParam, BadRequestError } from "../../utils/listQuery.js";
import { tenantFilter, checkOwnership, resolveWritableOrg, respondOrgAccessError, orgIsAccessible } from "../../utils/auth.js";
import { idSearchCondition } from "../../utils/searchId.js";
import { publish } from "../../services/chatBus.js";
import { personalChannel } from "../../services/quality/notify.js";
import {
	prepareCreate, prepareUpdate, afterCreate, afterUpdate, acceptTodo, remindTodo, returnTodo,
	helpTodo, rateTodo, todoHistory,
} from "../../services/quality/todos.js";

const router = express.Router();

/**
 * Уведомить исполнителя о назначенной задаче через ту же SSE-шину, что и чат.
 * Событие уходит в ЛИЧНЫЙ канал исполнителя (Б13 аудита 26.09): раньше — в канал организации, и
 * название чужой задачи получал каждый сотрудник, а отбор делал только браузер.
 * Себе задачу назначил (executor == актор) — не беспокоим.
 */
function notifyTaskAssigned(item, actorUuid) {
	if (!item?.executorUuid) return;
	if (item.executorUuid === actorUuid) return;
	publish(personalChannel(item.executorUuid), {
		type: "task",
		todo: {
			uuid: item.uuid,
			title: item.description || item.name || `#${item.id}`,
			executorUuid: item.executorUuid,
			deadline: item.deadline,
		},
	});
}

// Статус ищется фильтром, а не полнотекстом: `contains` по коду статуса находил лишнее
// («new» внутри «renewal») и мешал индексу (О, передача «backend-платформа»).
const TEXT_FIELDS = ["name", "description", "result"];

/**
 * Видна ли задача пользователю. Задача БЕЗ организации (старые записи, созданные до Б8 аудита
 * 26.09) раньше считалась «глобальной» и читалась и правилась любым по id — теперь она видна
 * суперадмину и своим участникам (куратору, исполнителю).
 */
function canSeeTodo(item, req) {
	if (!item || item.deletedAt) return false;
	if (item.organizationUuid == null) {
		const me = req.user?.uuid;
		return !!req.user?.isSuperAdmin || (!!me && (item.curatorUuid === me || item.executorUuid === me));
	}
	return checkOwnership(item, req);
}

/** Задача по id/uuid ЭТОЙ организации пользователя; чужая и удалённая — «не найдена». */
async function findOwnTodo(req, param) {
	const numId = Number(param);
	const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
	const item = await prisma.todo.findUnique({ where: isNumeric ? { id: numId } : { uuid: String(param) } });
	if (!canSeeTodo(item, req)) return null;
	return item;
}

/** Актор для журнала событий задачи. */
const actorOf = (req) => ({ uuid: req.user?.uuid ?? null, name: req.user?.username ?? null, channel: "erp" });

/** Поля E17, которые форма может прислать при создании/правке. */
const QUALITY_FIELDS = ["kind", "priority", "result", "nextControlAt", "reportedBy", "errorTypeUuid", "parentTodoUuid"];

/*
 * Куратор и исполнитель — только безопасные поля (Б3 аудита 26.09): `include` отдавал строку
 * User целиком — хэш пароля и секрет 2FA в каждом списке задач.
 */
const TODO_USER_SELECT = {
	select: {
		id: true,
		uuid: true,
		username: true,
		avatarPath: true,
		employeeUuid: true,
		employee: { select: { uuid: true, fullName: true, firstName: true, lastName: true, middleName: true, avatarPath: true } },
	},
};
const INCLUDE = {
	organization: true,
	counterparty: true,
	curator: TODO_USER_SELECT,
	executor: TODO_USER_SELECT,
};

// ============================================
// GET /todos — курсорная пагинация
// ============================================
router.get("/todos", async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const search =
			typeof req.query.search === "string" ? req.query.search.trim() : "";

		const limitNumber = clampLimit(rawLimit);
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
			orderBy.push({ id: "desc" });
		} else {
			const hasId = orderBy.some((o) => "id" in o);
			if (!hasId) orderBy.push({ id: "desc" });
		}

		// ── Поиск ─────────────────────────────────────────────────────────────
		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhereClause = {};

		if (searchWords.length > 0) {
			searchWhereClause = {
				AND: searchWords.map((word) => {
					const orConditions = TEXT_FIELDS.map((field) => ({
						[field]: { contains: word, mode: "insensitive" },
					}));
					const idNum = idSearchCondition(word);
					if (idNum) orConditions.push(idNum);
					return { OR: orConditions };
				}),
			};
		}

		// ── Произвольные фильтры ──────────────────────────────────────────────
		// isNull — отбор по ПУСТОМУ полю («задачи не из 1С»: origin пуст). Через `not` его не
		// выразить: Prisma 7 в `not` строки со значением NULL не возвращает — проверено на живой
		// базе, 9 пустых из 15 не попали в выборку. Значение приходит строкой из query.
		const ALLOWED_OPERATORS = ["contains", "equals", "gte", "lte", "gt", "lt", "isNull"];
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
				} else if (operator === "isNull") {
					const empty = value === true || value === "true" || value === "1";
					filterWhereClause[field] = empty ? { equals: null } : { not: null };
				} else {
					filterWhereClause[field][operator] = value;
				}
			}
		}

		// ── Итоговый where ────────────────────────────────────────────────────
		const baseWhere = {
			...searchWhereClause,
			...filterWhereClause,
			...tenantFilter(req),
			// Удаление мягкое (E17 СК0.1): удалённые задачи в списке и на доске не видны.
			deletedAt: null,
		};

		// ── Курсорная пагинация ───────────────────────────────────────────────
		const queryOptions = {
			take: limitNumber,
			where: baseWhere,
			include: INCLUDE,
			orderBy,
		};

		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const items = await prisma.todo.findMany(queryOptions);

		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		let total;
		if (cursorNumber === null) {
			total = await prisma.todo.count({ where: baseWhere });
		}

		return res.status(200).json({
			success: true,
			items,
			nextCursor,
			hasMore,
			...(total !== undefined ? { total } : {}),
		});
	} catch (error) {
		// Ошибка ввода (кривая дата, поле фильтра) — 400, остальное — 500 с записью в журнал.
		return sendError(res, error, { message: "Ошибка сервера при получении задач", label: "GET /todos" });
	}
});

// ============================================
// GET /todos/:id
// ============================================
router.get("/todos/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		const whereClause = isNumeric ? { id: numId } : { uuid: param };

		const item = await prisma.todo.findUnique({
			where: whereClause,
			include: INCLUDE,
		});

		// Чужая организация и удалённая задача — «не найдена», а не «нет доступа»: иначе по
		// коду ответа можно перебирать чужие задачи (до E17 проверки не было вовсе).
		if (!canSeeTodo(item, req)) {
			return res
				.status(404)
				.json({ success: false, message: "Задача не найдена" });
		}

		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error("GET /todos/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// POST /todos
// ============================================
router.post("/todos", async (req, res) => {
	try {
		const {
			name,
			description,
			status,
			organizationUuid,
			counterpartyUuid,
			curatorUuid,
			executorUuid,
			deadline,
			deadlineDays,
			sourceType,
			sourceUuid,
			sourceLabel,
		} = req.body;

		// Организация задачи — доступная пользователю; не указана — активная (Б8 аудита 26.09:
		// задача без организации читалась и правилась любым по id).
		const orgUuid = resolveWritableOrg(req, organizationUuid);

		// E17: вид, SLA, результат; проверка статуса (финал — только с результатом).
		const quality = await prepareCreate(req.body);
		if (quality.error) return res.status(400).json({ success: false, message: quality.error });

		const item = await prisma.todo.create({
			data: {
				name: name?.trim() ?? null,
				description: description?.trim() ?? null,
				status: status || "new",
				organizationUuid: orgUuid,
				counterpartyUuid: counterpartyUuid || null,
				curatorUuid: curatorUuid || null,
				executorUuid: executorUuid || null,
				deadline: parseDateParam(deadline, "deadline"),
				deadlineDays: deadlineDays ? parseInt(deadlineDays) : null,
				// Ссылка на объект-источник (создание «из заметки» и т.п.)
				sourceType: sourceType || null,
				sourceUuid: sourceUuid || null,
				sourceLabel: sourceLabel || null,
				...quality.data,
				// SLA ставит срок решения обращения, если человек не поставил свой.
				...(deadline ? {} : quality.data.deadline ? { deadline: quality.data.deadline } : {}),
			},
			include: INCLUDE,
		});

		// Назначенному исполнителю — уведомление в реальном времени (E9/E4-шина).
		notifyTaskAssigned(item, req.user?.uuid);
		await afterCreate(item, { actorUuid: req.user?.uuid, actorName: req.user?.username });

		return res.status(201).json({ success: true, item });
	} catch (error) {
		if (respondOrgAccessError(error, res)) return;
		if (error instanceof BadRequestError) return res.status(400).json({ success: false, message: error.message });
		console.error("POST /todos error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// PUT /todos/:id
// ============================================
router.put("/todos/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		const whereClause = isNumeric ? { id: numId } : { uuid: param };

		const existing = await prisma.todo.findUnique({ where: whereClause });
		if (!canSeeTodo(existing, req)) {
			return res
				.status(404)
				.json({ success: false, message: "Задача не найдена" });
		}

		const {
			name,
			description,
			status,
			organizationUuid,
			counterpartyUuid,
			curatorUuid,
			executorUuid,
			deadline,
			deadlineDays,
			sourceType,
			sourceUuid,
			sourceLabel,
		} = req.body;

		const data = {};
		if (name !== undefined) data.name = name?.trim() ?? null;
		if (description !== undefined)
			data.description = description?.trim() ?? null;
		if (status !== undefined) data.status = status;
		// Перенос в другую организацию — только в доступную: раньше свою задачу можно было
		// «переложить» в чужую фирму.
		if (organizationUuid !== undefined) {
			if (!organizationUuid && !req.user?.isSuperAdmin) {
				return res.status(400).json({ success: false, message: "Не выбрана организация задачи" });
			}
			if (organizationUuid && !orgIsAccessible(req, organizationUuid)) {
				return res.status(403).json({ success: false, code: "ORG_NOT_ACCESSIBLE", message: "Организация недоступна" });
			}
			data.organizationUuid = organizationUuid || null;
		}
		if (counterpartyUuid !== undefined)
			data.counterpartyUuid = counterpartyUuid || null;
		if (curatorUuid !== undefined) data.curatorUuid = curatorUuid || null;
		if (executorUuid !== undefined) data.executorUuid = executorUuid || null;
		if (deadline !== undefined)
			data.deadline = parseDateParam(deadline, "deadline");
		if (deadlineDays !== undefined)
			data.deadlineDays = deadlineDays ? parseInt(deadlineDays) : null;
		// Ссылка на объект-источник
		if (sourceType !== undefined) data.sourceType = sourceType || null;
		if (sourceUuid !== undefined) data.sourceUuid = sourceUuid || null;
		if (sourceLabel !== undefined) data.sourceLabel = sourceLabel || null;

		// E17: поля качества и проверка перехода (финал — с результатом, ожидание — с датой).
		const qualityBody = {};
		for (const k of QUALITY_FIELDS) if (req.body[k] !== undefined) qualityBody[k] = req.body[k];
		if (status !== undefined) qualityBody.status = status;
		// Срок и исполнитель — чтобы правило SLA не перебило срок, поставленный человеком, и
		// брало настройки фирмы нового исполнителя.
		if (deadline !== undefined) qualityBody.deadline = deadline;
		if (executorUuid !== undefined) qualityBody.executorUuid = executorUuid || null;
		const quality = await prepareUpdate(existing, qualityBody);
		if (quality.error) return res.status(400).json({ success: false, message: quality.error });
		Object.assign(data, quality.data);

		const item = await prisma.todo.update({
			where: whereClause,
			data,
			include: INCLUDE,
		});
		await afterUpdate(existing, item, { actorUuid: req.user?.uuid, actorName: req.user?.username, statuses: quality.statuses, reason: req.body.transferReason || null });

		// Уведомляем только при СМЕНЕ исполнителя на нового — иначе правка статуса
		// (drag на доске) слала бы уведомление на каждый чих.
		if (item.executorUuid && item.executorUuid !== existing.executorUuid) {
			notifyTaskAssigned(item, req.user?.uuid);
		}

		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error instanceof BadRequestError) return res.status(400).json({ success: false, message: error.message });
		if (error.code === "P2025") {
			return res
				.status(404)
				.json({ success: false, message: "Задача не найдена" });
		}
		console.error("PUT /todos/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// DELETE /todos/:id
// ============================================
router.delete("/todos/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		const whereClause = isNumeric ? { id: numId } : { uuid: param };

		// Мягкое удаление (E17 СК0.1): у задачи журнал событий, наблюдатели и, возможно,
		// нарушения со ссылкой на неё — физическое удаление оставило бы их без предмета.
		const existing = await prisma.todo.findUnique({ where: whereClause });
		if (!canSeeTodo(existing, req)) {
			return res.status(404).json({ success: false, message: "Задача не найдена" });
		}
		await prisma.todo.update({ where: { uuid: existing.uuid }, data: { deletedAt: new Date() } });

		return res.status(200).json({ success: true, message: "Удалено" });
	} catch (error) {
		if (error.code === "P2025") {
			return res
				.status(404)
				.json({ success: false, message: "Задача не найдена" });
		}
		console.error("DELETE /todos/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// E17: действия над задачей (docs/PLAN_QUALITY_STANDARD_2026-09-25.md, СК1)
// ============================================

/** Обёртка: найти свою задачу и выполнить действие; ошибки правил — 400. */
function todoAction(fn) {
	return async (req, res) => {
		try {
			const todo = await findOwnTodo(req, req.params.id);
			if (!todo) return res.status(404).json({ success: false, message: "Задача не найдена" });
			const out = await fn(todo, req);
			if (out?.error) return res.status(400).json({ success: false, message: out.error });
			const item = await prisma.todo.findUnique({ where: { uuid: todo.uuid }, include: INCLUDE });
			return res.status(200).json({ success: true, item, ...(out?.extra ?? {}) });
		} catch (error) {
			console.error(`POST ${req.path} error:`, error);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	};
}

// Принять обращение в работу (п. 3 — реакция «в моменте»).
router.post("/todos/:id/accept", todoAction((todo, req) => acceptTodo(todo, actorOf(req))));

// Клиент напомнил (звонок, письмо) — отмечает сотрудник; из чата 1С — через /bpai (п. 2).
router.post("/todos/:id/remind", todoAction((todo, req) =>
	remindTodo(todo, actorOf(req), { note: req.body?.note ?? null, channel: req.body?.channel || "phone" })));

// Вернуть закрытую задачу: «не выполнено» (п. 1).
router.post("/todos/:id/return", todoAction((todo, req) => returnTodo(todo, actorOf(req), { reason: req.body?.reason })));

// «Нужна помощь» — эскалация главбуху без последствий (п. 40).
router.post("/todos/:id/help", todoAction(async (todo, req) => {
	const r = await helpTodo(todo, actorOf(req), { note: req.body?.note ?? null });
	return { extra: { notified: r.notified } };
}));

/*
 * Оценка клиента результата (СК7.2). Оценку со слов клиента вносит сотрудник — но НЕ исполнитель
 * задачи (Б9 аудита 26.09): иначе исполнитель сам ставил себе «5» и перезаписывал низкую оценку,
 * а по ней считается бонус. Клиент из 1С оценивает через канал /bpai.
 */
router.post("/todos/:id/rate", async (req, res, next) => {
	try {
		const todo = await findOwnTodo(req, req.params.id);
		if (todo && todo.executorUuid && todo.executorUuid === req.user?.uuid) {
			return res.status(403).json({ success: false, code: "SELF_RATING", message: "Исполнитель не может оценивать свою задачу — оценку вносит клиент или другой сотрудник" });
		}
		return next();
	} catch (error) {
		console.error("POST /todos/:id/rate error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
}, todoAction((todo, req) =>
	rateTodo(todo, actorOf(req), { rating: req.body?.rating, comment: req.body?.comment ?? null })));

// История задачи: события и наблюдатели.
router.get("/todos/:id/history", async (req, res) => {
	try {
		const todo = await findOwnTodo(req, req.params.id);
		if (!todo) return res.status(404).json({ success: false, message: "Задача не найдена" });
		return res.status(200).json({ success: true, ...(await todoHistory(todo.uuid)) });
	} catch (error) {
		console.error("GET /todos/:id/history error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
