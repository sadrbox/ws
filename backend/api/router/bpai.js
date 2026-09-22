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

/** Срок: 1С шлёт ISO-дату. Пустое — «без срока», мусор — отказ, а не молчаливый null. */
function deadlineOf(raw) {
	if (raw === undefined || raw === null || raw === "") return null;
	const d = new Date(String(raw));
	if (Number.isNaN(d.getTime())) throw new ActorError(400, "Некорректный срок задачи");
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
			select: { code: true, name: true, isFinal: true, sortOrder: true },
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

router.post("/tasks", async (req, res) => {
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

		const item = await prisma.todo.create({
			data: {
				name: name || description.slice(0, 200),
				description: description || null,
				organizationUuid,
				curatorUuid: author.uuid,
				executorUuid: executor?.uuid ?? null,
				deadline: deadlineOf(req.body?.deadline),
				...source,
				origin: ORIGIN,
				originLabel: text(req.body?.originLabel) || text(req.body?.sourceLabel) || "Чат в 1С",
			},
			include: TASK_INCLUDE,
		});

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
		const { organizationUuid } = await resolveContext(req.body);
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

		if (!Object.keys(data).length) throw new ActorError(400, "Нечего менять");
		const item = await prisma.todo.update({ where: { uuid: existing.uuid }, data, include: TASK_INCLUDE });
		return res.status(200).json({ success: true, item: taskView(item) });
	} catch (error) {
		return fail(res, error, "PATCH /tasks/:uuid");
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
