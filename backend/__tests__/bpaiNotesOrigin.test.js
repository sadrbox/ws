// ─────────────────────────────────────────────────────────────────────────────
// Задачи и заметки из чата 1С: происхождение отдельно от ссылки, правка и уборка заметки
// (СВ3, СВ7, ПН2, ПН3 плана docs/PLAN_TASKS_NOTES_PANEL_SERVICE_2026-09-22.md).
//
// Что здесь держится, и почему именно это:
//   • ПРОИСХОЖДЕНИЕ И ССЫЛКА — РАЗНЫЕ ПОЛЯ. Раньше задача из 1С помечалась `sourceType`, тем же
//     полем, которым она ссылается на объект. Связать её с созданным документом было нельзя, не
//     стерев метку. Теперь origin — откуда пришла, sourceType/sourceUuid — на что ссылается;
//   • ЗАМЕТКУ ПРАВИТ АВТОР. Организация одна на запрос, и её мало: иначе любой пользователь базы
//     правил бы чужие записи;
//   • УБОРКА — ПОМЕТКА deletedAt. Заметка могла быть основанием задачи, стирать её нельзя;
//   • ОТБОР «НЕ ИЗ 1С» идёт по пустому origin. Через `not` он не выражается: Prisma 7 строки со
//     значением NULL в `not` не возвращает — это и проверяется ниже, чтобы никто не «упростил»;
//   • УЧЁТНАЯ ЗАПИСЬ ИНТЕГРАЦИИ помечена в списке, а пароль из списка по-прежнему не уходит.
// ─────────────────────────────────────────────────────────────────────────────
import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { prisma } from "../prisma/prisma-client.js";
import bpaiRouter from "../api/router/bpai.js";
import usersRouter from "../api/router/users.js";

const trash = { orgs: [], users: [], todos: [], notes: [] };

const app = express();
app.use(express.json());
app.use("/bpai", bpaiRouter);
// Список пользователей: свою проверку прав он не делает (её ставит server.js), нам нужна форма ответа.
app.use("/api/v1", (req, _res, next) => { req.user = { isSuperAdmin: true, uuid: null }; next(); }, usersRouter);
const server = app.listen(0);
const base = () => `http://127.0.0.1:${server.address().port}`;

after(async () => {
	await prisma.note.deleteMany({ where: { uuid: { in: trash.notes } } }).catch(() => {});
	await prisma.todo.deleteMany({ where: { uuid: { in: trash.todos } } }).catch(() => {});
	await prisma.organization.deleteMany({ where: { uuid: { in: trash.orgs } } }).catch(() => {});
	await prisma.user.deleteMany({ where: { uuid: { in: trash.users } } }).catch(() => {});
	server.close();
	await prisma.$disconnect();
});

const bin12 = () => String(Math.floor(1e11 + Math.random() * 8e11));
const who = (name) => ({ name });

async function call(method, path, body) {
	const r = await fetch(`${base()}${path}`, {
		method,
		headers: { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return { status: r.status, body: await r.json() };
}

/** Организация и автор заводятся первым же обращением канала — как в жизни. */
async function scene() {
	const bin = bin12();
	const author = `1С Бухгалтер ${crypto.randomUUID().slice(0, 6)}`;
	const created = await call("POST", "/bpai/notes", { bin, user: who(author), body: "первая заметка" });
	assert.equal(created.status, 201, JSON.stringify(created.body));
	trash.notes.push(created.body.item.uuid);
	const org = await prisma.organization.findFirst({ where: { bin }, select: { uuid: true } });
	const user = await prisma.user.findFirst({ where: { username: author }, select: { uuid: true } });
	trash.orgs.push(org.uuid);
	trash.users.push(user.uuid);
	return { bin, author, org: org.uuid, authorUuid: user.uuid, note: created.body.item };
}

test("СВ7: задача из 1С помечена происхождением, а ссылка на объект — отдельными полями", async () => {
	const s = await scene();
	const docUuid = crypto.randomUUID();

	const plain = await call("POST", "/bpai/tasks", { bin: s.bin, user: who(s.author), name: "Сдать 200.00" });
	assert.equal(plain.status, 201, JSON.stringify(plain.body));
	trash.todos.push(plain.body.item.uuid);
	assert.equal(plain.body.item.origin, "1c-chat");
	assert.match(plain.body.item.originLabel, /Чат в 1С/);
	assert.equal(plain.body.item.sourceType, null, "не связана с объектом — ссылки нет");

	const linked = await call("POST", "/bpai/tasks", {
		bin: s.bin, user: who(s.author), name: "Проверить реализацию",
		sourceType: "sales", sourceUuid: docUuid, sourceLabel: "№ 12 - 22.09.2026",
		originLabel: "Чат в 1С — Dev_01",
	});
	assert.equal(linked.status, 201, JSON.stringify(linked.body));
	trash.todos.push(linked.body.item.uuid);
	// Главное: обе вещи сказаны одновременно, а раньше приходилось выбирать одну.
	assert.equal(linked.body.item.origin, "1c-chat");
	assert.equal(linked.body.item.originLabel, "Чат в 1С — Dev_01");
	assert.equal(linked.body.item.sourceType, "sales");
	assert.equal(linked.body.item.sourceUuid, docUuid);

	const broken = await call("POST", "/bpai/tasks", {
		bin: s.bin, user: who(s.author), name: "Без адреса", sourceType: "sales",
	});
	assert.equal(broken.status, 400, "тип без идентификатора открыть нечего — это не ссылка");
});

test("СВ3: заметку правит и убирает её автор — и только он", async () => {
	const s = await scene();

	const edited = await call("PATCH", `/bpai/notes/${s.note.uuid}`, { bin: s.bin, user: who(s.author), body: "исправленная заметка" });
	assert.equal(edited.status, 200, JSON.stringify(edited.body));
	assert.equal(edited.body.item.body, "исправленная заметка");

	const stranger = `1С Другой ${crypto.randomUUID().slice(0, 6)}`;
	const foreign = await call("PATCH", `/bpai/notes/${s.note.uuid}`, { bin: s.bin, user: who(stranger), body: "чужими руками" });
	assert.equal(foreign.status, 403);
	const strangerUser = await prisma.user.findFirst({ where: { username: stranger }, select: { uuid: true } });
	trash.users.push(strangerUser.uuid);

	const gone = await call("DELETE", `/bpai/notes/${s.note.uuid}`, { bin: s.bin, user: who(s.author) });
	assert.equal(gone.status, 200);
	const row = await prisma.note.findUnique({ where: { uuid: s.note.uuid } });
	assert.ok(row.deletedAt, "уборка — пометка, а не стирание: заметка могла быть основанием задачи");

	const list = await call("GET", `/bpai/notes?bin=${s.bin}`);
	assert.equal(list.body.items.some((n) => n.uuid === s.note.uuid), false, "убранная не показывается");

	const again = await call("PATCH", `/bpai/notes/${s.note.uuid}`, { bin: s.bin, user: who(s.author), body: "ещё раз" });
	assert.equal(again.status, 404, "убранной заметки для канала больше нет");
});

test("СВ3: чужая заметка отвечает «не найдено», а не «нет доступа»", async () => {
	const mine = await scene();
	const other = await scene();
	// Перебирать чужие записи по коду ответа нельзя — отсюда 404, а не 403.
	const r = await call("PATCH", `/bpai/notes/${other.note.uuid}`, { bin: mine.bin, user: who(mine.author), body: "подсмотреть" });
	assert.equal(r.status, 404);
});

test("ПН2: «не из 1С» отбирается по пустому origin — через `not` такие строки не находятся", async () => {
	const s = await scene();
	const onec = await call("POST", "/bpai/tasks", { bin: s.bin, user: who(s.author), name: "из 1С" });
	trash.todos.push(onec.body.item.uuid);
	const byHand = await prisma.todo.create({ data: { name: "из панели", organizationUuid: s.org } });
	trash.todos.push(byHand.uuid);

	const empty = await prisma.todo.count({ where: { organizationUuid: s.org, origin: { equals: null } } });
	const filled = await prisma.todo.count({ where: { organizationUuid: s.org, origin: { not: null } } });
	assert.equal(empty, 1, "задача из панели");
	assert.equal(filled, 1, "задача из 1С");

	// Ловушка, из-за которой отбор и сделан через isNull: `not: "1c-chat"` пустые пропускает.
	const naive = await prisma.todo.count({ where: { organizationUuid: s.org, origin: { not: "1c-chat" } } });
	assert.equal(naive, 0, "Prisma 7: строки с NULL в `not` не возвращаются — «не из 1С» так не отобрать");
});

test("ПН3: учётная запись интеграции помечена в списке, а пароль из списка не уходит", async () => {
	// Автор заметки из 1С — настоящий пользователь ERP с пустым паролем: войти под ним нельзя.
	const s = await scene();
	const human = await prisma.user.create({
		data: { username: `человек-${crypto.randomUUID().slice(0, 6)}`, password: "не пусто" },
		select: { uuid: true },
	});
	trash.users.push(human.uuid);

	const r = await call("GET", "/api/v1/users?limit=999999");
	assert.equal(r.status, 200);
	const integration = r.body.items.find((u) => u.uuid === s.authorUuid);
	const byHand = r.body.items.find((u) => u.uuid === human.uuid);

	assert.equal(integration.isIntegration, true, "иначе её примут за брошенную и удалят вместе с авторством");
	assert.equal(byHand.isIntegration, false, "заведён руками — под ним входят");
	assert.equal("password" in integration, false, "хеш пароля в списке не показывают никому");
	assert.equal("password" in byHand, false);
});
