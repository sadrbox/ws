// Задачи E17 (СК1): SLA, результат, передача, напоминания клиента, возврат, «Нужна помощь»,
// ошибки с задачей-проверкой. Общий слой для роутера панели (api/router/todos.js) и канала
// 1С (api/router/bpai.js): правило одно, откуда бы ни пришла задача.
import { prisma } from "../../prisma/prisma-client.js";
import { getQualitySettings } from "./settings.js";
import {
	normKind, normPriority, normReportedBy, reactionDueAt, resolveDueAt, transitionError,
	transitionStamps, isFinalStatus, isCancelStatus,
} from "./taskRules.js";
import { chiefsOf, managersOf, firmOrgForUser, userNames } from "./access.js";
import { getWorkOptions } from "./calendar.js";
import { addWorkingDays } from "./workTime.js";
import { createCandidate } from "./violations.js";
import { notifyUser, notifyMany } from "./notify.js";

// ── Справочник статусов (кэш 30 с) ──────────────────────────────────────────────
let statusCache = { at: 0, rows: [] };
export async function loadStatuses() {
	if (Date.now() - statusCache.at < 30_000 && statusCache.rows.length) return statusCache.rows;
	const rows = await prisma.todoStatus.findMany({
		where: { deletedAt: null },
		orderBy: { sortOrder: "asc" },
		select: { code: true, name: true, isFinal: true, isWaiting: true, isCancel: true, sortOrder: true },
	});
	statusCache = { at: Date.now(), rows };
	return rows;
}
export function _resetStatusCache() { statusCache = { at: 0, rows: [] }; }

/** Первый финальный НЕ-отменяющий статус («Выполнена») — им закрывают задачу правила. */
export function doneStatus(statuses) {
	return statuses.find((s) => s.isFinal && !isCancelStatus(statuses, s.code))?.code ?? "done";
}
/** Статус «в работе» для возврата задачи: первый не финальный, не ожидающий и не «новая». */
export function workStatus(statuses) {
	return statuses.find((s) => !s.isFinal && !s.isWaiting && s.code !== "new")?.code ?? "in_progress";
}

// ── Журнал событий ──────────────────────────────────────────────────────────────
export async function logEvent(todoUuid, { type, actorUuid = null, actorName = null, fromUserUuid = null, toUserUuid = null, channel = "erp", note = null, payload = null }) {
	try {
		await prisma.todoEvent.create({ data: { todoUuid, type, actorUuid, actorName, fromUserUuid, toUserUuid, channel, note: note ? String(note).slice(0, 2000) : null, payload: payload ?? undefined } });
	} catch (e) {
		console.warn("[quality] logEvent:", e.message); // журнал не должен ронять саму операцию
	}
}

/** Фирма, настройки и рабочее время для задачи: по исполнителю, иначе по куратору. */
async function settingsForTask(t) {
	const firm = await firmOrgForUser(t.executorUuid || t.curatorUuid || null);
	const settings = await getQualitySettings(firm);
	return { firm, settings, work: await getWorkOptions(settings) };
}

const dateOrNull = (v) => {
	if (v === undefined) return undefined;
	if (v === null || v === "") return null;
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Поля E17 для создания задачи + проверка. Возвращает { data } или { error }.
 * @param {object} body — тело запроса (панель или канал 1С)
 */
export async function prepareCreate(body, { now = new Date() } = {}) {
	const statuses = await loadStatuses();
	const kind = normKind(body.kind);
	const priority = normPriority(body.priority);
	const status = body.status || "new";
	const result = typeof body.result === "string" ? body.result.trim() || null : null;
	const nextControlAt = dateOrNull(body.nextControlAt) ?? null;
	const err = transitionError({ nextStatus: status, statuses, result, nextControlAt });
	if (err) return { error: err };
	const data = {
		kind,
		priority,
		result,
		nextControlAt,
		reportedBy: kind === "error" ? normReportedBy(body.reportedBy) : null,
		errorTypeUuid: kind === "error" ? body.errorTypeUuid || null : null,
		parentTodoUuid: body.parentTodoUuid || null,
		lastActivityAt: now,
		...transitionStamps({ prevStatus: "new", nextStatus: status, statuses, startedAt: null, now }),
	};
	if (kind === "client_request") {
		// Сроки SLA — в рабочем времени фирмы (производственный календарь): обращение в пятницу
		// вечером принимают в понедельник утром, а не «через час, в субботу».
		const { settings, work } = await settingsForTask(body);
		data.reactionDueAt = reactionDueAt(now, priority, settings, work);
		// Срок решения по SLA — только если человек не поставил свой.
		if (!body.deadline) data.deadline = resolveDueAt(now, priority, settings, work);
	}
	return { data };
}

/**
 * Поля E17 для изменения задачи + проверка перехода. Возвращает { data, events } или { error }.
 * `data` дополняет то, что роутер уже собрал из тела.
 */
export async function prepareUpdate(existing, body, { now = new Date() } = {}) {
	const statuses = await loadStatuses();
	const data = { lastActivityAt: now };
	if (body.kind !== undefined) data.kind = normKind(body.kind);
	if (body.priority !== undefined) data.priority = normPriority(body.priority);
	if (body.result !== undefined) data.result = typeof body.result === "string" ? body.result.trim() || null : null;
	if (body.nextControlAt !== undefined) data.nextControlAt = dateOrNull(body.nextControlAt);
	if (body.reportedBy !== undefined) data.reportedBy = normReportedBy(body.reportedBy);
	if (body.errorTypeUuid !== undefined) data.errorTypeUuid = body.errorTypeUuid || null;
	if (body.parentTodoUuid !== undefined) data.parentTodoUuid = body.parentTodoUuid || null;

	const nextStatus = body.status !== undefined ? body.status : existing.status;
	if (nextStatus !== existing.status || data.result !== undefined || data.nextControlAt !== undefined) {
		const err = transitionError({
			nextStatus,
			statuses,
			result: data.result !== undefined ? data.result : existing.result,
			nextControlAt: data.nextControlAt !== undefined ? data.nextControlAt : existing.nextControlAt,
		});
		// Правку уже закрытой задачи без смены статуса не блокируем результатом задним числом.
		if (err && (nextStatus !== existing.status || !isFinalStatus(statuses, existing.status))) return { error: err };
	}
	Object.assign(data, transitionStamps({ prevStatus: existing.status, nextStatus, statuses, startedAt: existing.startedAt, now }));
	// Принять в работу = первое движение исполнителя по обращению.
	if (nextStatus !== existing.status && !existing.acceptedAt && nextStatus !== "new") data.acceptedAt = now;
	// Задачу переквалифицировали в обращение клиента: SLA начинает счёт с этого момента — срок реакции
	// (если обращение ещё не принято) и срок решения (если своего нет). Иначе обращение, заведённое как
	// обычная задача, так и осталось бы без срока реакции (найдено 25.09 при сборке формы).
	if (data.kind === "client_request" && existing.kind !== "client_request") {
		const { settings, work } = await settingsForTask({ executorUuid: body.executorUuid ?? existing.executorUuid, curatorUuid: existing.curatorUuid });
		const priority = data.priority ?? existing.priority;
		if (!existing.acceptedAt && !data.acceptedAt && !existing.reactionDueAt) data.reactionDueAt = reactionDueAt(now, priority, settings, work);
		if (!existing.deadline && body.deadline === undefined) data.deadline = resolveDueAt(now, priority, settings, work);
	}
	return { data, statuses };
}

/** После создания: журнал, правила ошибок (пп. 4, 6). */
export async function afterCreate(item, { actorUuid = null, actorName = null, channel = "erp" } = {}) {
	await logEvent(item.uuid, { type: "created", actorUuid, actorName, toUserUuid: item.executorUuid, channel, payload: { kind: item.kind, priority: item.priority } });
	if (item.kind !== "error" || !item.executorUuid) return;

	// п. 4 — ошибку первым выявил клиент.
	if (item.reportedBy === "client") {
		await createCandidate({
			userUuid: item.executorUuid, itemNumber: 4, rule: "client_error", ruleKey: `client_error:${item.uuid}`,
			clientOrganizationUuid: item.organizationUuid,
			description: `Ошибку выявил клиент раньше сотрудника: «${item.name || item.description || ""}»`.slice(0, 500),
			evidence: [{ kind: "todo", uuid: item.uuid, label: item.name || `#${item.id}` }],
		});
	}
	// п. 6 — повтор разобранной ошибки: тот же тип у того же сотрудника, прежняя уже закрыта.
	if (item.errorTypeUuid) {
		const prev = await prisma.todo.findFirst({
			where: { kind: "error", errorTypeUuid: item.errorTypeUuid, executorUuid: item.executorUuid, completedAt: { not: null }, uuid: { not: item.uuid }, deletedAt: null },
			orderBy: { completedAt: "desc" },
			select: { uuid: true, id: true, name: true, completedAt: true },
		});
		if (prev) {
			const et = await prisma.errorType.findUnique({ where: { uuid: item.errorTypeUuid }, select: { name: true } });
			await createCandidate({
				userUuid: item.executorUuid, itemNumber: 6, rule: "repeat_error", ruleKey: `repeat_error:${item.uuid}`,
				clientOrganizationUuid: item.organizationUuid,
				description: `Повтор разобранной ошибки «${et?.name ?? "тип ошибки"}»: прежняя закрыта ${prev.completedAt.toISOString().slice(0, 10)}`,
				evidence: [{ kind: "todo", uuid: item.uuid, label: item.name || `#${item.id}` }, { kind: "todo", uuid: prev.uuid, label: prev.name || `#${prev.id}` }],
			});
		}
	}
}

/**
 * После изменения: журнал статуса/передачи/результата, наблюдатель при передаче, проверка
 * исправления ошибки (п. 5), уведомление наблюдателям о закрытии.
 */
export async function afterUpdate(existing, item, { actorUuid = null, actorName = null, channel = "erp", statuses = null, reason = null } = {}) {
	const sts = statuses || (await loadStatuses());
	if (item.status !== existing.status) {
		await logEvent(item.uuid, { type: "status", actorUuid, actorName, channel, payload: { from: existing.status, to: item.status } });
	}
	if (item.result && item.result !== existing.result) {
		await logEvent(item.uuid, { type: "result", actorUuid, actorName, channel, note: item.result });
	}
	if (item.executorUuid !== existing.executorUuid) {
		await logEvent(item.uuid, { type: "transfer", actorUuid, actorName, channel, fromUserUuid: existing.executorUuid, toUserUuid: item.executorUuid, note: reason });
		// п. 22: передавший остаётся наблюдателем до закрытия.
		if (existing.executorUuid) {
			await prisma.todoWatcher.upsert({
				where: { todoUuid_userUuid: { todoUuid: item.uuid, userUuid: existing.executorUuid } },
				create: { todoUuid: item.uuid, userUuid: existing.executorUuid, reason: "transfer" },
				update: {},
			});
		}
	}
	const becameDone = isFinalStatus(sts, item.status) && !isFinalStatus(sts, existing.status);
	if (!becameDone) return;
	// Наблюдателям — что задача закрыта (и чем).
	const watchers = await prisma.todoWatcher.findMany({ where: { todoUuid: item.uuid }, select: { userUuid: true } });
	await notifyMany(watchers.map((w) => w.userUuid).filter((u) => u !== actorUuid), {
		kind: "task_closed",
		title: `Закрыта задача: ${item.name || item.description || `#${item.id}`}`,
		body: item.result || null,
		link: { endpoint: "todos", uuid: item.uuid },
		organizationUuid: item.organizationUuid,
		dedupKey: `closed:${item.uuid}:${item.completedAt?.toISOString?.() ?? ""}`,
	});
	// п. 5: ошибку исправили — проверка исправления уходит тому, кто её передал (куратору),
	// а если исполнитель сам себе куратор — главбуху. Отмена ошибки проверки не требует.
	if (item.kind === "error" && !isCancelStatus(sts, item.status)) await createControlTask(item);
}

/** Задача-проверка исправления ошибки (п. 5). Одна на ошибку. */
export async function createControlTask(errorTodo) {
	const exists = await prisma.todo.findFirst({ where: { parentTodoUuid: errorTodo.uuid, kind: "control", deletedAt: null }, select: { uuid: true } });
	if (exists) return null;
	// Кто проверяет: тот, кто передал ошибку (куратор), иначе главбух исполнителя, иначе руководитель,
	// иначе администратор фирмы. Проверка исправления не должна теряться из-за незаполненной группы (п. 5).
	let controller = errorTodo.curatorUuid && errorTodo.curatorUuid !== errorTodo.executorUuid ? errorTodo.curatorUuid : null;
	if (!controller && errorTodo.executorUuid) controller = (await chiefsOf(errorTodo.executorUuid))[0] ?? null;
	if (!controller && errorTodo.executorUuid) controller = (await managersOf(errorTodo.executorUuid))[0] ?? null;
	const { firm, settings, work } = await settingsForTask(errorTodo);
	if (!controller && firm) {
		const admin = await prisma.accessRight.findFirst({ where: { organizationUuid: firm, role: "admin", userUuid: { not: errorTodo.executorUuid ?? undefined } }, select: { userUuid: true }, orderBy: { id: "asc" } });
		controller = admin?.userUuid ?? null;
	}
	// Совсем некому (фирма не назначена, групп нет) — задачу-проверку всё равно ставим, без исполнителя:
	// она видна в списке задач клиента и на панели, а не пропадает молча.
	const days = settings.errorControl.controlDeadlineDays;
	const now = new Date();
	const control = await prisma.todo.create({
		data: {
			name: `Проверить исправление: ${errorTodo.name || errorTodo.description || `#${errorTodo.id}`}`.slice(0, 250),
			description: `Исправление отмечено исполнителем. Результат: ${errorTodo.result ?? "—"}\nУбедитесь, что ошибка фактически устранена (п. 5 стандарта).`,
			organizationUuid: errorTodo.organizationUuid,
			counterpartyUuid: errorTodo.counterpartyUuid,
			curatorUuid: errorTodo.executorUuid,
			executorUuid: controller,
			deadline: work ? addWorkingDays(now, days, work) : new Date(now.getTime() + days * 86_400_000),
			kind: "control",
			parentTodoUuid: errorTodo.uuid,
			lastActivityAt: now,
			origin: "quality",
			originLabel: "Контроль исправления ошибки",
		},
	});
	await logEvent(control.uuid, { type: "created", channel: "system", toUserUuid: controller, note: "Проверка исправления ошибки" });
	await logEvent(errorTodo.uuid, { type: "control", channel: "system", toUserUuid: controller, payload: { controlTodoUuid: control.uuid } });
	if (controller) await notifyUser(controller, {
		kind: "control_task",
		title: `Проверьте исправление ошибки: ${errorTodo.name || `#${errorTodo.id}`}`,
		link: { endpoint: "todos", uuid: control.uuid },
		organizationUuid: errorTodo.organizationUuid,
		dedupKey: `control:${control.uuid}`,
	});
	return control;
}

// ── Действия над задачей ────────────────────────────────────────────────────────

/** Принять в работу (обращение клиента — п. 3). */
export async function acceptTodo(todo, actor) {
	const statuses = await loadStatuses();
	const now = new Date();
	const data = { acceptedAt: todo.acceptedAt ?? now, firstResponseAt: todo.firstResponseAt ?? now, lastActivityAt: now };
	if (todo.status === "new") {
		data.status = workStatus(statuses);
		Object.assign(data, transitionStamps({ prevStatus: todo.status, nextStatus: data.status, statuses, startedAt: todo.startedAt, now }));
	}
	if (!todo.executorUuid && actor?.uuid) data.executorUuid = actor.uuid;
	const item = await prisma.todo.update({ where: { uuid: todo.uuid }, data });
	await logEvent(todo.uuid, { type: "accepted", actorUuid: actor?.uuid, actorName: actor?.name, channel: actor?.channel || "erp" });
	return item;
}

/**
 * Напоминание клиента о поручении (п. 2). Первое — повод ускориться, второе и следующие —
 * кандидат в нарушения: «клиент не должен выполнять функцию контроля».
 */
export async function remindTodo(todo, actor, { note = null, channel = "erp" } = {}) {
	const now = new Date();
	const item = await prisma.todo.update({
		where: { uuid: todo.uuid },
		data: { reminderCount: { increment: 1 }, lastReminderAt: now },
	});
	await logEvent(todo.uuid, { type: "reminder", actorUuid: actor?.uuid, actorName: actor?.name, channel, note });
	const title = `Клиент напоминает: ${todo.name || todo.description || `#${todo.id}`}`;
	if (item.executorUuid) {
		await notifyUser(item.executorUuid, { kind: "reminder", title, body: note, link: { endpoint: "todos", uuid: todo.uuid }, organizationUuid: todo.organizationUuid, dedupKey: `reminder:${todo.uuid}:${item.reminderCount}` });
	}
	if (item.reminderCount >= 2 && item.executorUuid) {
		await notifyMany(await chiefsOf(item.executorUuid), { kind: "reminder", title: `Повторное напоминание клиента (${item.reminderCount}): ${todo.name || `#${todo.id}`}`, link: { endpoint: "todos", uuid: todo.uuid }, organizationUuid: todo.organizationUuid, dedupKey: `reminder-chief:${todo.uuid}:${item.reminderCount}` });
		await createCandidate({
			userUuid: item.executorUuid, itemNumber: 2, rule: "client_reminder", ruleKey: `client_reminder:${todo.uuid}`,
			clientOrganizationUuid: todo.organizationUuid,
			description: `Клиенту пришлось напомнить о поручении повторно (${item.reminderCount} раз): «${todo.name || todo.description || ""}»`.slice(0, 500),
			evidence: [{ kind: "todo", uuid: todo.uuid, label: todo.name || `#${todo.id}` }],
		});
	}
	return item;
}

/**
 * Вернуть закрытую задачу: «не выполнено» (п. 1). Возвращает клиент/куратор/главбух.
 * Первый возврат задачи — кандидат исполнителю; повторные возвраты — в журнале той же задачи.
 */
export async function returnTodo(todo, actor, { reason, channel = "erp" } = {}) {
	const statuses = await loadStatuses();
	if (!isFinalStatus(statuses, todo.status)) return { error: "Вернуть можно только закрытую задачу" };
	if (!String(reason || "").trim()) return { error: "Укажите, что не выполнено" };
	const now = new Date();
	const next = workStatus(statuses);
	const item = await prisma.todo.update({
		where: { uuid: todo.uuid },
		data: { status: next, returnedCount: { increment: 1 }, lastActivityAt: now, ...transitionStamps({ prevStatus: todo.status, nextStatus: next, statuses, startedAt: todo.startedAt, now }) },
	});
	await logEvent(todo.uuid, { type: "returned", actorUuid: actor?.uuid, actorName: actor?.name, channel, note: reason });
	if (todo.executorUuid) {
		await notifyUser(todo.executorUuid, { kind: "returned", title: `Задача возвращена: ${todo.name || `#${todo.id}`}`, body: reason, link: { endpoint: "todos", uuid: todo.uuid }, organizationUuid: todo.organizationUuid, dedupKey: `returned:${todo.uuid}:${item.returnedCount}` });
		// Возврат от самого исполнителя — не нарушение: он сам увидел недоделку.
		if (actor?.uuid !== todo.executorUuid) {
			await createCandidate({
				userUuid: todo.executorUuid, itemNumber: 1, rule: "returned", ruleKey: `returned:${todo.uuid}`,
				clientOrganizationUuid: todo.organizationUuid,
				description: `Задача закрыта без конечного результата и возвращена: ${reason}`.slice(0, 500),
				evidence: [{ kind: "todo", uuid: todo.uuid, label: todo.name || `#${todo.id}`, result: todo.result }],
			});
		}
	}
	return { item };
}

/**
 * «Нужна помощь» (п. 40): эскалация главбуху без последствий для сотрудника — стандарт требует
 * обращаться за помощью сразу, а не наказывает за это.
 */
export async function helpTodo(todo, actor, { note = null } = {}) {
	const now = new Date();
	const item = await prisma.todo.update({
		where: { uuid: todo.uuid },
		data: { helpRequestedAt: now, escalationLevel: Math.max(todo.escalationLevel || 0, 1), escalatedAt: now, lastActivityAt: now },
	});
	await logEvent(todo.uuid, { type: "help", actorUuid: actor?.uuid, actorName: actor?.name, channel: "erp", note });
	const chiefs = await chiefsOf(todo.executorUuid || actor?.uuid);
	await notifyMany(chiefs, {
		kind: "help",
		title: `Нужна помощь: ${todo.name || todo.description || `#${todo.id}`}`,
		body: note ? `${actor?.name ?? ""}: ${note}` : actor?.name ?? null,
		link: { endpoint: "todos", uuid: todo.uuid },
		organizationUuid: todo.organizationUuid,
		dedupKey: `help:${todo.uuid}:${now.toISOString()}`,
	});
	return { item, notified: chiefs.length };
}

/** Оценка клиента ответа/результата (СК7.2): 1–5. */
export async function rateTodo(todo, actor, { rating, comment = null, channel = "erp" } = {}) {
	const r = Number(rating);
	if (!Number.isInteger(r) || r < 1 || r > 5) return { error: "Оценка — целое число от 1 до 5" };
	const item = await prisma.todo.update({ where: { uuid: todo.uuid }, data: { clientRating: r, clientRatingNote: comment ? String(comment).slice(0, 1000) : null } });
	await logEvent(todo.uuid, { type: "rating", actorUuid: actor?.uuid, actorName: actor?.name, channel, note: comment, payload: { rating: r } });
	if (r <= 2 && todo.executorUuid) {
		await notifyMany(await chiefsOf(todo.executorUuid), { kind: "low_rating", title: `Низкая оценка клиента (${r}): ${todo.name || `#${todo.id}`}`, body: comment, link: { endpoint: "todos", uuid: todo.uuid }, organizationUuid: todo.organizationUuid, dedupKey: `rating:${todo.uuid}:${r}` });
	}
	return { item };
}

/** События задачи с именами участников — вкладка «История» формы. */
export async function todoHistory(todoUuid) {
	const [events, watchers] = await Promise.all([
		prisma.todoEvent.findMany({ where: { todoUuid }, orderBy: { createdAt: "asc" } }),
		prisma.todoWatcher.findMany({ where: { todoUuid } }),
	]);
	const names = await userNames([...events.flatMap((e) => [e.actorUuid, e.fromUserUuid, e.toUserUuid]), ...watchers.map((w) => w.userUuid)]);
	return {
		events: events.map((e) => ({
			...e,
			actorName: e.actorName || names.get(e.actorUuid) || null,
			fromUserName: names.get(e.fromUserUuid) ?? null,
			toUserName: names.get(e.toUserUuid) ?? null,
		})),
		watchers: watchers.map((w) => ({ ...w, userName: names.get(w.userUuid) ?? w.userUuid })),
	};
}

export default {
	loadStatuses, doneStatus, workStatus, logEvent, prepareCreate, prepareUpdate, afterCreate, afterUpdate,
	createControlTask, acceptTodo, remindTodo, returnTodo, helpTodo, rateTodo, todoHistory,
};
