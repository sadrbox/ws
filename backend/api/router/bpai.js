// ─────────────────────────────────────────────────────────────────────────────
// Служебный канал BuhProf AI: задачи и заметки организации для чата внутри 1С.
//
//   GET   /bpai/tasks?bin=&state=open|all&limit=   задачи организации
//   POST  /bpai/tasks                              создать задачу
//   PATCH /bpai/tasks/:uuid                        изменить или закрыть
//   GET    /bpai/notes?bin=&limit=                 заметки организации
//   POST   /bpai/notes                             создать заметку
//   PATCH  /bpai/notes/:uuid                       изменить свою заметку
//   DELETE /bpai/notes/:uuid                       убрать свою заметку
//   GET   /bpai/task-statuses                      справочник статусов
//   POST  /bpai/tasks/:uuid/remind                 клиент напоминает о поручении (E17, п. 2)
//   POST  /bpai/tasks/:uuid/rate                   оценка клиента результата (E17, СК7.2)
//   POST  /bpai/checks/results                     итоги ночного прогона проверок учёта (E17 СК2)
//
// Сюда ходит AI-сервис ключом X-Api-Key (utils/bpaiAuth.js), а НЕ человек: JWT
// пользователя ERP у него нет, пользователь сидит в 1С. Организацию называет БИН,
// автора — имя пользователя 1С; обоих резолвит services/bpaiActor.js, создавая
// при отсутствии.
//
// ЗАПИСИ ЭТОГО КАНАЛА — ОБЫЧНЫЕ ЗАДАЧИ И ЗАМЕТКИ ERP, а не их копии: список в 1С
// и список в панели — один и тот же, поэтому здесь нет ни своей таблицы, ни
// своего понятия статуса. Заметка организации — та же `notes` с entityType
// "organizations", которой панель ведёт заметки к любой записи.
//
// Организация ОДНА на запрос и берётся из БИН: чужую не прочитать и не записать,
// даже зная её uuid, — поля organizationUuid в теле нет вовсе.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { resolveContext, organizationByBin, ActorError } from "../../services/bpaiActor.js";
import { resolveUser } from "../../services/pipeActor.js";
import { publish } from "../../services/chatBus.js";
import { prepareCreate, prepareUpdate, afterCreate, afterUpdate, remindTodo, rateTodo } from "../../services/quality/todos.js";
import { ingestCheckResults, CheckIngestBusyError } from "../../services/quality/checks.js";
import { isStaffUser } from "../../services/quality/access.js";
import { getFirmOrgSetting } from "../../services/quality/settings.js";
import { idempotent } from "../../services/idempotency.js";
import { orgTimeZone, zonedMidnight } from "../../services/periodBounds.js";

/** Автор из 1С — сотрудник фирмы? null — учёт качества не включён (фирма не назначена). */
async function isStaffAuthor(userUuid) {
	const firm = await getFirmOrgSetting();
	if (!firm) return null;
	return isStaffUser(userUuid, firm);
}

const router = express.Router();

/** Заметки организации — тот же полиморфный механизм, что у заметок к записи. */
const ORG_ENTITY = "organizations";

/**
 * ПРОИСХОЖДЕНИЕ записи: по нему в панели видно, что задача пришла из чата в 1С.
 *
 * Не `sourceType`. Тем полем задача ссылается на ОБЪЕКТ-источник (реализацию, заметку,
 * контрагента), и пока задача из 1С ни с чем не связана, метку можно было класть туда. Как
 * только понадобилось связать задачу с созданным документом, стало видно: поле одно, а
 * смыслов два. Теперь `origin` — откуда пришла, `sourceType`/`sourceUuid` — на что ссылается.
 */
const ORIGIN = "1c-chat";

const MAX_LIMIT = 200;

const text = (v) => (typeof v === "string" ? v.trim() : "");

function limitOf(raw, fallback = 50) {
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.min(Math.trunc(n), MAX_LIMIT);
}

/** Дата-время без пояса: «ГГГГ-ММ-ДД[Tчч:мм[:сс[.доли]]]» (так 1С отдаёт дату через XMLString). */
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/;

/**
 * Срок: 1С шлёт ISO-дату. Пустое — «без срока», мусор — отказ, а не молчаливый null.
 *
 * ДАТА БЕЗ ВРЕМЕНИ — «ВЕСЬ ДЕНЬ» (КР-22 аудита 27.09). «2026-09-30T00:00:00» без пояса (1С отдаёт
 * дату через XMLString) разбиралось в поясе процесса — местной полуночью, то есть точным моментом, и
 * просрочка с кандидатом по п. 20 появлялась на сутки раньше. Теперь полночь без пояса — та же дата
 * без времени, что «2026-09-30»: полночь UTC, которую taskRules.deadlineDueAt читает как конец
 * местного дня. Время ≠ 00:00 без пояса — местное время организации (orgTimeZone), строка с поясом —
 * точный момент как есть. Пустая дата 1С («0001-01-01…») — «без срока», а не срок в первом веке.
 */
export function deadlineOf(raw) {
	if (raw === undefined || raw === null || raw === "") return null;
	const s = String(raw).trim();
	const m = LOCAL_DATE_TIME.exec(s);
	if (m) {
		const [y, mo, d, h = 0, mi = 0, sec = 0] = m.slice(1, 7).map((v) => Number(v ?? 0));
		const fracMs = m[7] ? Math.floor(Number(`0.${m[7]}`) * 1000) : 0;
		if (y <= 1) return null; // пустая дата 1С
		const day = new Date(Date.UTC(y, mo - 1, d));
		// «30.02» Date молча превратил бы в 02.03 — это мусор, а не срок.
		if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d || h > 23 || mi > 59 || sec > 59) {
			throw new ActorError(400, "Некорректный срок задачи");
		}
		if (h === 0 && mi === 0 && sec === 0 && fracMs === 0) return day;
		const tz = orgTimeZone();
		return new Date(zonedMidnight(y, mo, d, tz).getTime() + ((h * 60 + mi) * 60 + sec) * 1000 + fracMs);
	}
	const d = new Date(s);
	if (!s || Number.isNaN(d.getTime())) throw new ActorError(400, "Некорректный срок задачи");
	return d;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ссылка задачи на объект-источник. Пара «тип + uuid» либо есть целиком, либо её нет вовсе:
 * тип без идентификатора открыть нечего, идентификатор без типа — некуда идти.
 */
function sourceOf(body) {
	const sourceType = text(body?.sourceType);
	const sourceUuid = text(body?.sourceUuid);
	if (!sourceType && !sourceUuid) return {};
	if (!sourceType || !UUID_RE.test(sourceUuid)) throw new ActorError(400, "Ссылка на объект: нужны и sourceType, и sourceUuid (uuid)");
	return { sourceType, sourceUuid, sourceLabel: text(body?.sourceLabel) || null };
}

/** Коды завершающих статусов: по ним отбираются открытые задачи и закрывается задача. */
async function finalStatuses() {
	const rows = await prisma.todoStatus.findMany({
		where: { deletedAt: null, isFinal: true },
		orderBy: { sortOrder: "asc" },
		select: { code: true, name: true },
	});
	return rows;
}

/** Задача для 1С: только то, что показывает форма и читает модель. */
const taskView = (t) => ({
	uuid: t.uuid,
	id: t.id,
	name: t.name,
	description: t.description,
	status: t.status,
	deadline: t.deadline,
	createdAt: t.createdAt,
	updatedAt: t.updatedAt,
	curatorName: t.curator?.username ?? null,
	executorName: t.executor?.username ?? null,
	counterpartyUuid: t.counterpartyUuid,
	// Ссылка на объект (если задачу связали с документом) и происхождение — разными полями.
	sourceType: t.sourceType,
	sourceUuid: t.sourceUuid,
	sourceLabel: t.sourceLabel,
	origin: t.origin,
	originLabel: t.originLabel,
	// E17: вид, результат, напоминания и оценка — их видит форма 1С и читает модель.
	kind: t.kind,
	priority: t.priority,
	result: t.result,
	reminderCount: t.reminderCount,
	clientRating: t.clientRating,
	acceptedAt: t.acceptedAt,
	reactionDueAt: t.reactionDueAt,
});

const noteView = (n) => ({
	uuid: n.uuid,
	id: n.id,
	body: n.body,
	authorName: n.authorName,
	createdAt: n.createdAt,
	updatedAt: n.updatedAt,
});

const TASK_INCLUDE = { curator: true, executor: true };

/** Ошибку входных данных отдаём с её текстом, остальное — 500 и запись в журнал. */
function fail(res, error, where) {
	if (error instanceof ActorError) return res.status(error.status).json({ success: false, message: error.message });
	console.error(`[bpai] ${where}:`, error);
	return res.status(500).json({ success: false, message: "Ошибка сервера" });
}

// ── Статусы задач ────────────────────────────────────────────────────────────
router.get("/task-statuses", async (_req, res) => {
	try {
		const items = await prisma.todoStatus.findMany({
			where: { deletedAt: null },
			orderBy: { sortOrder: "asc" },
			select: { code: true, name: true, isFinal: true, isCancel: true, sortOrder: true },
		});
		return res.status(200).json({ success: true, items });
	} catch (error) {
		return fail(res, error, "GET /task-statuses");
	}
});

// ── Задачи организации ───────────────────────────────────────────────────────
router.get("/tasks", async (req, res) => {
	try {
		// Чтению автор не нужен: резолвим только организацию, иначе имя-заглушка
		// завела бы в ERP пользователя на каждый просмотр списка.
		const organizationUuid = await organizationByBin(req.query.bin);

		const where = { organizationUuid, deletedAt: null };
		if (text(req.query.state) !== "all") {
			const finals = (await finalStatuses()).map((s) => s.code);
			if (finals.length) where.status = { notIn: finals };
		}
		const items = await prisma.todo.findMany({
			where,
			include: TASK_INCLUDE,
			orderBy: [{ deadline: "asc" }, { id: "desc" }],
			take: limitOf(req.query.limit),
		});
		return res.status(200).json({ success: true, items: items.map(taskView) });
	} catch (error) {
		return fail(res, error, "GET /tasks");
	}
});

/*
 * ПОВТОР ЗАПРОСА — НЕ ВТОРАЯ ЗАДАЧА (добор аудита 26.09, п. 4). Ход из 1С после таймаута сервис ИИ
 * повторяет с тем же `Idempotency-Key: 1c:<baseId>:<ключ>`; ERP запоминает ключ и отвечает прежним
 * результатом — services/idempotency.js. Без заголовка запрос обычный.
 */
router.post("/tasks", idempotent("POST /bpai/tasks"), async (req, res) => {
	try {
		const { organizationUuid, author } = await resolveContext(req.body);
		const name = text(req.body?.name);
		const description = text(req.body?.description);
		if (!name && !description) throw new ActorError(400, "Нужен текст задачи");

		// Исполнитель — по имени, как автор: «поставь задачу Айгуль» должно попадать
		// человеку, а не в общий список. Не названо — задача без исполнителя.
		const executorName = text(req.body?.executorName);
		const executor = executorName ? await resolveUser({ user: { name: executorName } }) : null;

		/*
		 * СВЯЗЬ С ОБЪЕКТОМ (СВ7). Модель создала в 1С реализацию и ставит по ней задачу — чип
		 * «Источник» в панели должен открывать саму реализацию. Идентификатор сюда приходит уже
		 * проверенным: сервис отдаёт только то, что встречалось в результатах вызовов этого
		 * диалога, — выдуманный id до нас не доходит. Здесь остаётся форма: uuid должен быть uuid.
		 */
		const source = sourceOf(req.body);

		// E17: обращение клиента из 1С получает срок реакции и срок решения по SLA. Вид — ПО РОЛИ
		// АВТОРА, а не по догадке модели (решено 25.09): автор не сотрудник фирмы — это клиент, и его
		// задача — обращение всегда; сотрудник фирмы ставит себе обычную задачу, а обращение — если
		// записывает просьбу клиента (признак модели). Учёт качества не включён — решает признак модели.
		// Сотрудник узнаётся по имени пользователя 1С = имени в ERP (так канал уже определяет автора).
		const modelSaysRequest = text(req.body?.kind) === "client_request";
		const staff = await isStaffAuthor(author.uuid);
		const kind = staff === false ? "client_request" : modelSaysRequest ? "client_request" : "task";
		const deadline = deadlineOf(req.body?.deadline);
		const quality = await prepareCreate({ kind, priority: req.body?.priority, deadline, executorUuid: executor?.uuid ?? null, curatorUuid: author.uuid });
		if (quality.error) throw new ActorError(400, quality.error);

		const item = await prisma.todo.create({
			data: {
				name: name || description.slice(0, 200),
				description: description || null,
				organizationUuid,
				curatorUuid: author.uuid,
				executorUuid: executor?.uuid ?? null,
				deadline,
				...source,
				origin: ORIGIN,
				originLabel: text(req.body?.originLabel) || text(req.body?.sourceLabel) || "Чат в 1С",
				...quality.data,
			},
			include: TASK_INCLUDE,
		});
		// Задача создана — побочный эффект зафиксирован: сбой дальше (история, уведомления) не должен
		// освобождать ключ идемпотентности, иначе повтор хода создаст вторую задачу (КР-5 аудита 27.09).
		res.locals.idempotencyCommitted = true;
		await afterCreate(item, { actorUuid: author.uuid, actorName: author.name ?? null, channel: "1c-chat" });

		// Исполнителю — тем же уведомлением, что и при назначении из панели.
		if (item.executorUuid && item.executorUuid !== author.uuid) {
			publish(organizationUuid, {
				type: "task",
				todo: { uuid: item.uuid, title: item.description || item.name || `#${item.id}`, executorUuid: item.executorUuid, deadline: item.deadline },
			});
		}
		return res.status(201).json({ success: true, item: taskView(item) });
	} catch (error) {
		return fail(res, error, "POST /tasks");
	}
});

router.patch("/tasks/:uuid", async (req, res) => {
	try {
		const { organizationUuid, author } = await resolveContext(req.body);
		const existing = await prisma.todo.findUnique({ where: { uuid: String(req.params.uuid) } });
		// Чужая организация отвечает «не найдено», а не «нет доступа»: иначе по коду
		// ответа можно перебирать чужие задачи.
		if (!existing || existing.deletedAt || existing.organizationUuid !== organizationUuid) {
			throw new ActorError(404, "Задача не найдена");
		}

		const data = {};
		if (req.body?.name !== undefined) data.name = text(req.body.name) || null;
		if (req.body?.description !== undefined) data.description = text(req.body.description) || null;
		if (req.body?.deadline !== undefined) data.deadline = deadlineOf(req.body.deadline);
		// E17: результат — что сделано. Без него задачу не закрыть (п. 1).
		const result = req.body?.result !== undefined ? text(req.body.result) : undefined;

		if (req.body?.close === true) {
			const finals = await finalStatuses();
			if (!finals.length) throw new ActorError(409, "В ERP не настроен ни один завершающий статус задачи");
			data.status = finals[0].code;
		} else if (req.body?.status !== undefined) {
			const code = text(req.body.status);
			const known = await prisma.todoStatus.findFirst({ where: { code, deletedAt: null }, select: { code: true } });
			if (!known) throw new ActorError(400, `Неизвестный статус задачи: ${code}`);
			data.status = known.code;
		}

		if (!Object.keys(data).length && result === undefined) throw new ActorError(400, "Нечего менять");
		const quality = await prepareUpdate(existing, { ...(data.status !== undefined ? { status: data.status } : {}), ...(result !== undefined ? { result } : {}) });
		if (quality.error) throw new ActorError(400, quality.error);
		Object.assign(data, quality.data);
		const item = await prisma.todo.update({ where: { uuid: existing.uuid }, data, include: TASK_INCLUDE });
		await afterUpdate(existing, item, { actorUuid: author.uuid, actorName: author.name ?? null, channel: "1c-chat", statuses: quality.statuses });
		return res.status(200).json({ success: true, item: taskView(item) });
	} catch (error) {
		return fail(res, error, "PATCH /tasks/:uuid");
	}
});

// ── E17: напоминание и оценка клиента ────────────────────────────────────────

/** Задача организации из БИН запроса (чужая и удалённая — «не найдена»). */
async function orgTask(req) {
	const ctx = await resolveContext(req.body);
	const todo = await prisma.todo.findUnique({ where: { uuid: String(req.params.uuid) } });
	if (!todo || todo.deletedAt || todo.organizationUuid !== ctx.organizationUuid) throw new ActorError(404, "Задача не найдена");
	return { ...ctx, todo };
}

// Клиент напоминает о поручении из чата 1С. Второе напоминание — кандидат в нарушения по п. 2.
router.post("/tasks/:uuid/remind", async (req, res) => {
	try {
		const { author, todo } = await orgTask(req);
		await remindTodo(todo, { uuid: author.uuid, name: author.name ?? null }, { note: text(req.body?.note) || null, channel: "1c-chat" });
		const item = await prisma.todo.findUnique({ where: { uuid: todo.uuid }, include: TASK_INCLUDE });
		return res.status(200).json({ success: true, item: taskView(item) });
	} catch (error) {
		return fail(res, error, "POST /tasks/:uuid/remind");
	}
});

router.post("/tasks/:uuid/rate", async (req, res) => {
	try {
		const { author, todo } = await orgTask(req);
		const r = await rateTodo(todo, { uuid: author.uuid, name: author.name ?? null }, { rating: req.body?.rating, comment: text(req.body?.comment) || null, channel: "1c-chat" });
		if (r.error) throw new ActorError(400, r.error);
		const item = await prisma.todo.findUnique({ where: { uuid: todo.uuid }, include: TASK_INCLUDE });
		return res.status(200).json({ success: true, item: taskView(item) });
	} catch (error) {
		return fail(res, error, "POST /tasks/:uuid/rate");
	}
});

// ── E17: итоги ночного прогона проверок учёта (контракт — docs/TASK_EXTENSION_ACCOUNTING_CHECKS_2026-09-25.md) ──
// Тело: { bin, baseKey, agentId, startedAt, finishedAt, catalog, runs:[…], snapshots:[…] }.
// Организацию называет БИН, как во всём канале; незнакомый БИН — 404 (сервис ai шлёт только
// тех, кого нашёл в ERP).
// Ключ посылки (`Idempotency-Key` и поле `idempotencyKey`, `checks:<sha>`): повтор после обрыва
// соединения получает прежние счётчики, а не второй приём (добор аудита 26.09, п. 4).
router.post("/checks/results", idempotent("POST /bpai/checks/results"), async (req, res) => {
	try {
		// НЕ organizationByBin: тот заводит организацию по незнакомому БИН (так работает чат),
		// а итоги проверок по чужому или опечатанному БИН должны отвергаться, не создавая клиентов.
		const bin = text(req.body?.bin);
		const org = /^\d{12}$/.test(bin) ? await prisma.organization.findFirst({ where: { bin, deletedAt: null }, select: { uuid: true } }) : null;
		if (!org) throw new ActorError(404, "Организация с таким БИН в ERP не найдена");
		const data = await ingestCheckResults(org.uuid, req.body || {});
		// Итоги приняты (КР-5 аудита 27.09): дальше 5xx запоминается, а не освобождает ключ. Сбой ДО
		// этого места ключ освобождает — повтор безопасен: уже принятые проверки приём отсечёт по readAt.
		res.locals.idempotencyCommitted = true;
		return res.status(200).json({ success: true, data });
	} catch (error) {
		// Эту проверку клиента уже принимает другой запрос (КР-15 аудита 27.09): отказ временный —
		// 503, ключ посылки свободен, повтор примет итоги (принятое до отказа отсечётся по readAt).
		if (error instanceof CheckIngestBusyError) {
			res.set("Retry-After", "60");
			return res.status(503).json({ success: false, code: error.code, message: error.message });
		}
		return fail(res, error, "POST /checks/results");
	}
});

// ── Заметки организации ──────────────────────────────────────────────────────
router.get("/notes", async (req, res) => {
	try {
		const organizationUuid = await organizationByBin(req.query.bin);

		const items = await prisma.note.findMany({
			where: { entityType: ORG_ENTITY, entityUuid: organizationUuid, deletedAt: null },
			orderBy: { createdAt: "desc" },
			take: limitOf(req.query.limit),
		});
		return res.status(200).json({ success: true, items: items.map(noteView) });
	} catch (error) {
		return fail(res, error, "GET /notes");
	}
});

router.post("/notes", async (req, res) => {
	try {
		const { organizationUuid, author } = await resolveContext(req.body);
		const body = text(req.body?.body);
		if (!body) throw new ActorError(400, "Текст заметки обязателен");
		const item = await prisma.note.create({
			data: {
				entityType: ORG_ENTITY,
				entityUuid: organizationUuid,
				organizationUuid,
				body,
				authorUuid: author.uuid,
				authorName: author.name,
			},
		});
		return res.status(201).json({ success: true, item: noteView(item) });
	} catch (error) {
		return fail(res, error, "POST /notes");
	}
});

/*
 * ПРАВКА И УБОРКА ЗАМЕТКИ (СВ3). В панели заметку правит и убирает её автор — в 1С этого не
 * было вовсе: написал с опечаткой, и она осталась навсегда.
 *
 * ПРАВО — АВТОРСТВО, а не организация. Организация здесь одна на запрос (по БИН), и её мало:
 * иначе любой пользователь любой базы этой организации правил бы чужие записи. Автор —
 * пользователь 1С, найденный по имени, тот же, что и при создании.
 *
 * УБОРКА — ПОМЕТКА, а не удаление строки: `deletedAt`, как у всего остального в ERP. Заметка
 * могла быть основанием задачи, и стирать её из истории нельзя.
 */
async function ownNote(req) {
	const { organizationUuid, author } = await resolveContext(req.body);
	const note = await prisma.note.findUnique({ where: { uuid: String(req.params.uuid) } });
	// Чужая организация отвечает «не найдено», а не «нет доступа»: иначе по коду ответа
	// можно перебирать чужие заметки.
	if (!note || note.deletedAt || note.entityType !== ORG_ENTITY || note.entityUuid !== organizationUuid) {
		throw new ActorError(404, "Заметка не найдена");
	}
	if (note.authorUuid && note.authorUuid !== author.uuid) {
		throw new ActorError(403, "Заметку правит и убирает тот, кто её написал");
	}
	return note;
}

router.patch("/notes/:uuid", async (req, res) => {
	try {
		const note = await ownNote(req);
		const body = text(req.body?.body);
		if (!body) throw new ActorError(400, "Текст заметки обязателен");
		const item = await prisma.note.update({ where: { uuid: note.uuid }, data: { body } });
		return res.status(200).json({ success: true, item: noteView(item) });
	} catch (error) {
		return fail(res, error, "PATCH /notes/:uuid");
	}
});

router.delete("/notes/:uuid", async (req, res) => {
	try {
		// Тело у DELETE непривычно, но здесь оно обязательно: в нём БИН и имя автора —
		// субъекта у этого канала нет иначе (ключ принадлежит сервису, а не человеку).
		const note = await ownNote(req);
		await prisma.note.update({ where: { uuid: note.uuid }, data: { deletedAt: new Date() } });
		return res.status(200).json({ success: true, item: { uuid: note.uuid } });
	} catch (error) {
		return fail(res, error, "DELETE /notes/:uuid");
	}
});

export default router;
