// Роутеры после аудита 26.09 (Б1, Б3, Б4, Б5, Б6, Б8, Б9, У8, Б14) — сквозь HTTP, без БД.
//
// Каждый роутер поднимается в своём express-приложении, `req.user` подставляется так, как его
// собирает tenantMiddleware, а обращения к базе подменяются на уровне делегатов Prisma. Проверяем
// ровно то, что до исправления пропускало чужое: чужой документ по id, чужую организацию в теле,
// самоназначение ролей, выгрузку секретов, удаление «Событий 1С».
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { prisma } from "../prisma/prisma-client.js";

const member = { uuid: "u1", username: "m", organizationUuid: "org-A", allowedOrgUuids: ["org-A"], adminOrgUuids: [], isOrgAdmin: false, isSuperAdmin: false, operatorDataAccess: true };
const adminA = { ...member, uuid: "u2", username: "a", adminOrgUuids: ["org-A"], isOrgAdmin: true, isAnyOrgAdmin: true };

/** Подменить методы делегатов Prisma на время теста; вернуть функцию отката. */
function mock(map) {
	const saved = [];
	for (const [path, fn] of Object.entries(map)) {
		const [model, method] = path.split(".");
		const target = method ? prisma[model] : prisma;
		const key = method ?? model;
		saved.push([target, key, target[key]]);
		target[key] = fn;
	}
	return () => { for (const [t, k, v] of saved.reverse()) t[k] = v; };
}

async function withApp(router, user, fn, { mount = "/api/v1", raw = false } = {}) {
	const app = express();
	if (!raw) app.use(express.json());
	app.use((req, _res, next) => { req.user = user ? { ...user } : undefined; next(); });
	app.use(mount, router);
	const server = app.listen(0);
	try {
		const base = `http://127.0.0.1:${server.address().port}${mount}`;
		const call = async (method, path, body) => {
			const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
			return { status: r.status, body: await r.json().catch(() => ({})) };
		};
		return await fn(call);
	} finally {
		server.close();
	}
}

// ── Б1: /sync ─────────────────────────────────────────────────────────────
import syncRouter from "../api/router/sync.js";

test("Б1: /sync/push — стать суперадмином через users больше нельзя", async () => {
	const restore = mock({ "user.update": async () => { throw new Error("не должно вызываться"); } });
	try {
		await withApp(syncRouter, member, async (call) => {
			const r = await call("POST", "/sync/push", { changes: [{ table: "users", action: "update", uuid: "u1", data: { isSuperAdmin: true } }] });
			assert.equal(r.status, 200);
			assert.equal(r.body.applied, 0);
			assert.equal(r.body.errors[0].code, "SYNC_PUSH_REFUSED");
		});
	} finally { restore(); }
});

test("Б1: /sync/push — документ офлайн не пишется; справочник в чужую организацию — отказ", async () => {
	let created = false;
	const restore = mock({
		"accessPermission.findFirst": async () => ({ accessLevel: "full" }),
		"counterparty.findUnique": async () => null,
		"counterparty.create": async () => { created = true; return {}; },
	});
	try {
		await withApp(syncRouter, member, async (call) => {
			const r = await call("POST", "/sync/push", { changes: [
				{ table: "sales", action: "create", uuid: "s1", data: { organizationUuid: "org-A" } },
				{ table: "counterparties", action: "create", uuid: "c1", data: { name: "X", organizationUuid: "org-VICTIM" } },
			] });
			assert.equal(r.body.applied, 0);
			assert.match(r.body.errors[0].error, /Документ нельзя записать офлайн/);
			assert.match(r.body.errors[1].error, /Организация недоступна/);
			assert.equal(created, false);
		});
	} finally { restore(); }
});

test("Б1: /sync/pull — пользователи без секретов и только по членству; права — только свои", async () => {
	const seen = {};
	const restore = mock({
		"user.findMany": async (args) => { seen.user = args; return [{ uuid: "u1", username: "m", updatedAt: new Date() }]; },
		"accessPermission.findMany": async (args) => { seen.perm = args; return []; },
		"accessPermission.findFirst": async () => ({ accessLevel: "readonly" }),
	});
	try {
		await withApp(syncRouter, member, async (call) => {
			const r = await call("POST", "/sync/pull", { tables: ["users", "access-permissions", "importdeclarations"] });
			assert.equal(r.status, 200);
			assert.ok(seen.user.select, "пользователи — только явный select");
			assert.equal(seen.user.select.password, undefined);
			assert.equal(seen.user.select.twoFactorSecret, undefined);
			assert.equal(seen.user.include, undefined);
			assert.match(JSON.stringify(seen.user.where), /accessRights/);
			assert.match(JSON.stringify(seen.perm.where), /"userUuid":"u1"/);
			assert.deepEqual(r.body.skipped, ["importdeclarations"]);
		});
	} finally { restore(); }
});

// ── Б3: /users ────────────────────────────────────────────────────────────
import usersRouter from "../api/router/users.js";

test("Б3: filter/sort по паролю и секрету 2FA отклоняются", async () => {
	const restore = mock({ "user.findMany": async () => { throw new Error("не должно вызываться"); } });
	try {
		await withApp(usersRouter, adminA, async (call) => {
			const r = await call("GET", "/users?filter[password][gte]=%242a");
			assert.equal(r.status, 400);
			const r2 = await call("GET", "/users?filter[twoFactorSecret][contains]=A");
			assert.equal(r2.status, 400);
		});
	} finally { restore(); }
});

test("Б3: карточка пользователя — без хэша и секрета, только видимые", async () => {
	let args;
	const restore = mock({ "user.findFirst": async (a) => { args = a; return { uuid: "u9", username: "x" }; } });
	try {
		await withApp(usersRouter, member, async (call) => {
			const r = await call("GET", "/users/7");
			assert.equal(r.status, 200);
			assert.equal(args.select.password, undefined);
			assert.equal(args.select.twoFactorSecret, undefined);
			assert.match(JSON.stringify(args.where), /accessRights/, "видимость по членству");
		});
	} finally { restore(); }
});

test("Б3: чужой пароль задаёт только суперадмин; суперадмина админ фирмы не правит", async () => {
	let updated = null;
	let target = { uuid: "u9", isSuperAdmin: false, accessRights: [{ organizationUuid: "org-A" }] };
	const restore = mock({
		"user.findFirst": async () => target,
		"user.update": async (a) => { updated = a; return { uuid: "u9" }; },
	});
	try {
		await withApp(usersRouter, adminA, async (call) => {
			let r = await call("PUT", "/users/u9", { password: "new-pass-123" });
			assert.equal(r.status, 403);
			assert.equal(r.body.code, "PASSWORD_CHANGE_FORBIDDEN");
			assert.equal(updated, null);
			target = { uuid: "root", isSuperAdmin: true, accessRights: [{ organizationUuid: "org-A" }] };
			r = await call("PUT", "/users/root", { username: "pwned" });
			assert.equal(r.status, 403);
		});
		await withApp(usersRouter, { ...member, isSuperAdmin: true }, async (call) => {
			target = { uuid: "u9", isSuperAdmin: false, accessRights: [] };
			const r = await call("PUT", "/users/u9", { password: "new-pass-123" });
			assert.equal(r.status, 200);
			assert.match(updated.data.password, /^\$2[ab]\$/, "пароль — хэшем bcrypt");
		});
	} finally { restore(); }
});

test("Б3: удалить пользователя другой организации админ не может", async () => {
	let deleted = false;
	const restore = mock({
		"user.findFirst": async () => ({ uuid: "u9", isSuperAdmin: false, accessRights: [{ organizationUuid: "org-A" }, { organizationUuid: "org-B" }] }),
		"user.delete": async () => { deleted = true; },
	});
	try {
		await withApp(usersRouter, adminA, async (call) => {
			const r = await call("DELETE", "/users/u9");
			assert.equal(r.status, 403);
			assert.equal(deleted, false);
		});
	} finally { restore(); }
});

// ── Б4: /access-rights/batch ──────────────────────────────────────────────
import accessRightsRouter from "../api/router/accessrights.js";

test("Б4: пакет членств — без прав ничего, admin раздаёт только суперадмин, чужая организация — нет", async () => {
	let wrote = false;
	const restore = mock({
		"accessRight.findUnique": async () => null,
		"$transaction": async () => { wrote = true; },
	});
	try {
		const op = (organizationUuid, role) => ({ operations: [{ action: "create", data: { userUuid: "u1", organizationUuid, role } }] });
		await withApp(accessRightsRouter, member, async (call) => {
			assert.equal((await call("POST", "/access-rights/batch", op("org-A", "admin"))).status, 403, "рядовой участник");
		});
		await withApp(accessRightsRouter, adminA, async (call) => {
			assert.equal((await call("POST", "/access-rights/batch", op("org-A", "admin"))).status, 403, "admin — только суперадмин");
			assert.equal((await call("POST", "/access-rights/batch", op("org-VICTIM", "member"))).status, 403, "чужая организация");
			assert.equal(wrote, false);
			assert.equal((await call("POST", "/access-rights/batch", op("org-A", "member"))).status, 200, "своя организация, участник — можно");
			assert.equal(wrote, true);
		});
	} finally { restore(); }
});

// ── Б5, Б8: фабрика шапок документов ─────────────────────────────────────
import { createDocumentHeaderRouter } from "../api/router/_documentHeaderFactory.js";

test("Б5/Б8: чужое закрытие месяца не читается, не правится и не создаётся", async () => {
	const router = createDocumentHeaderRouter({ MODEL: "monthClose", ROUTE: "month-closes", stringFields: ["organizationUuid"], periodExempt: true });
	let updated = false;
	const restore = mock({
		"monthClose.findUnique": async () => ({ id: 5, uuid: "mc5", organizationUuid: "org-B", posted: true, date: new Date() }),
		"monthClose.update": async () => { updated = true; return {}; },
		"monthClose.create": async () => { throw new Error("не должно вызываться"); },
	});
	try {
		await withApp(router, member, async (call) => {
			assert.equal((await call("GET", "/month-closes/5")).status, 404);
			assert.equal((await call("PUT", "/month-closes/5", { posted: false })).status, 404, "раньше открывало чужой закрытый период");
			assert.equal(updated, false);
			const r = await call("POST", "/month-closes", { organizationUuid: "org-B", date: "2026-08-31" });
			assert.equal(r.status, 403);
			assert.equal(r.body.code, "ORG_NOT_ACCESSIBLE");
		});
	} finally { restore(); }
});

// ── У8: кассовые ордера — удаление только своего направления ──────────────
import { createCashOrderRouter } from "../api/router/_cashOrderFactory.js";

test("У8: через маршрут ПКО РКО не удаляется", async () => {
	const router = createCashOrderRouter({ direction: "receipt", route: "cash-receipt-orders", docType: "cash_receipt_order" });
	const restore = mock({
		"cashOrder.findUnique": async () => ({ direction: "expense", organizationUuid: "org-A" }),
		"cashOrder.delete": async () => { throw new Error("не должно вызываться"); },
	});
	try {
		await withApp(router, member, async (call) => {
			assert.equal((await call("DELETE", "/cash-receipt-orders/5")).status, 404);
		});
	} finally { restore(); }
});

// ── Б6: организации, файлы, события 1С ───────────────────────────────────
import organizationsRouter from "../api/router/organizations.js";
import filesRouter from "../api/router/files.js";
import pipeRouter from "../api/router/pipeactivities.js";

test("Б6: чужая организация по id — 404; код приглашения видит только админ", async () => {
	let row = { uuid: "org-VICTIM", name: "Жертва", inviteCode: "SECRET" };
	const restore = mock({ "organization.findUnique": async () => row });
	try {
		await withApp(organizationsRouter, adminA, async (call) => {
			assert.equal((await call("GET", "/organizations/12")).status, 404, "раньше отдавала и inviteCode");
			row = { uuid: "org-A", name: "Своя", inviteCode: "OWN" };
			assert.equal((await call("GET", "/organizations/1")).body.item.inviteCode, "OWN");
		});
		await withApp(organizationsRouter, member, async (call) => {
			const r = await call("GET", "/organizations/1");
			assert.equal(r.status, 200);
			assert.equal(r.body.item.inviteCode, undefined, "участнику — без кода приглашения");
			assert.equal((await call("DELETE", "/organizations/1")).status, 403, "удаляет только администратор");
		});
	} finally { restore(); }
});

test("Б6: файл чужого владельца не скачивается и не удаляется; список «все файлы» фильтруется", async () => {
	const restore = mock({
		"attachedFile.findUnique": async () => ({ uuid: "f1", ownerType: "counterparty", ownerUuid: "cp-B", filePath: "x.pdf", deletedAt: null }),
		"attachedFile.findMany": async () => [
			{ uuid: "f1", ownerType: "counterparty", ownerUuid: "cp-B" },
			{ uuid: "f2", ownerType: "counterparty", ownerUuid: "cp-A" },
			{ uuid: "f3", ownerType: "unknown_kind", ownerUuid: "z" },
		],
		"attachedFile.delete": async () => { throw new Error("не должно вызываться"); },
		"counterparty.findUnique": async ({ where }) => ({ organizationUuid: where.uuid === "cp-A" ? "org-A" : "org-B" }),
		// Колонка организации файла «ещё не применена» — роутер работает по владельцам (как до миграции).
		"$queryRaw": async () => [],
	});
	try {
		await withApp(filesRouter, member, async (call) => {
			assert.equal((await call("GET", "/files/download/f1")).status, 404);
			assert.equal((await call("DELETE", "/files/f1")).status, 404);
			const r = await call("GET", "/files/all");
			assert.deepEqual(r.body.items.map((f) => f.uuid), ["f2"]);
		});
	} finally { restore(); }
});

test("Б6: «События 1С» не удаляются; список — только своей организации", async () => {
	let where;
	const restore = mock({
		"pipeActivity.findMany": async (a) => { where = a.where; return []; },
		"pipeActivity.count": async () => 0,
		"pipeActivity.delete": async () => { throw new Error("не должно вызываться"); },
		"pipeActivity.deleteMany": async () => { throw new Error("не должно вызываться"); },
	});
	try {
		await withApp(pipeRouter, { ...member, isSuperAdmin: true }, async (call) => {
			assert.equal((await call("DELETE", "/pipeactivities/abc")).status, 405, "даже суперадмину");
			assert.equal((await call("POST", "/pipeactivities/batch-delete", { uuids: ["abc"] })).status, 405);
		});
		await withApp(pipeRouter, member, async (call) => {
			await call("GET", "/pipeactivities");
			assert.equal(where.organizationUuid, "org-A");
		});
	} finally { restore(); }
});

// ── Б2: связи обслуживания и профили прав ────────────────────────────────
import serviceLinksRouter from "../api/router/serviceLinks.js";
import permissionProfilesRouter from "../api/router/permissionProfiles.js";

test("Б2: фирма не подтверждает связь за клиента; профиль в чужой организации не назначается", async () => {
	const restore = mock({
		"serviceLink.findUnique": async () => ({ uuid: "l1", serviceOrgUuid: "org-A", clientOrgUuid: "org-VICTIM", state: "requested" }),
		"serviceLink.update": async () => { throw new Error("не должно вызываться"); },
	});
	try {
		await withApp(serviceLinksRouter, adminA, async (call) => {
			assert.equal((await call("POST", "/service-links/l1/confirm")).status, 403);
		});
		await withApp(permissionProfilesRouter, adminA, async (call) => {
			const r = await call("POST", "/permission-profiles/apply", { userUuid: "u2", organizationUuid: "org-VICTIM", profile: "owner", role: "admin" });
			assert.equal(r.status, 403);
			const r2 = await call("POST", "/permission-profiles/apply", { userUuid: "u9", organizationUuid: "org-A", profile: "owner", role: "admin" });
			assert.equal(r2.status, 403, "роль admin — только суперадмин");
		});
	} finally { restore(); }
});

// ── Б9: оценку своей задачи исполнитель не ставит ────────────────────────
import todosRouter from "../api/router/todos.js";

test("Б9: исполнитель не оценивает свою задачу", async () => {
	const restore = mock({
		"todo.findUnique": async () => ({ uuid: "t1", id: 1, organizationUuid: "org-A", executorUuid: "u1", deletedAt: null }),
		"todo.update": async () => { throw new Error("не должно вызываться"); },
	});
	try {
		await withApp(todosRouter, member, async (call) => {
			const r = await call("POST", "/todos/t1/rate", { rating: 5 });
			assert.equal(r.status, 403);
			assert.equal(r.body.code, "SELF_RATING");
		});
	} finally { restore(); }
});

test("Б8: задача не создаётся в чужой организации", async () => {
	const restore = mock({ "todo.create": async () => { throw new Error("не должно вызываться"); } });
	try {
		await withApp(todosRouter, member, async (call) => {
			const r = await call("POST", "/todos", { name: "x", organizationUuid: "org-VICTIM" });
			assert.equal(r.status, 403);
		});
	} finally { restore(); }
});

// ── Б14: вебхук WhatsApp без секрета ─────────────────────────────────────
import waWebhookRouter from "../api/router/waWebhook.js";

test("Б14: без WA_APP_SECRET вебхук отвечает 403 и ничего не принимает", async () => {
	const prev = process.env.WA_APP_SECRET;
	delete process.env.WA_APP_SECRET;
	const restore = mock({ "waChannel.findFirst": async () => { throw new Error("не должно вызываться"); } });
	try {
		await withApp(waWebhookRouter, null, async (call) => {
			const r = await call("POST", "/wa/webhook", { entry: [] });
			assert.equal(r.status, 403);
		}, { mount: "/api1", raw: true });
	} finally {
		restore();
		if (prev !== undefined) process.env.WA_APP_SECRET = prev;
	}
});

// ── И24: возражение по нарушению — решает уровень выше подтвердившего ────
import violationsRouter from "../api/router/standardViolations.js";

test("И24: главбух не решает то, что подтвердил главбух; руководитель — решает", async () => {
	const firm = { ...member, organizationUuid: "org-F", allowedOrgUuids: ["org-F"] };
	const groups = [
		{ uuid: "g1", organizationUuid: "org-F", headUuid: "head", managerUuid: "mgr", deletedAt: null, members: [{ userUuid: "acc" }], clients: [] },
		{ uuid: "g2", organizationUuid: "org-F", headUuid: "head2", managerUuid: "mgr", deletedAt: null, members: [{ userUuid: "acc" }], clients: [] },
	];
	let updated = null;
	const restore = mock({
		"appSetting.findUnique": async () => ({ value: "org-F" }),
		"staffGroup.findMany": async () => groups,
		"accessRight.findUnique": async () => ({ role: "member" }),
		"standardViolation.findUnique": async () => ({ id: 7, uuid: "v7", organizationUuid: "org-F", userUuid: "acc", status: "disputed", decidedByUuid: "head", itemNumber: 5, bonusMonth: "2026-09", deletedAt: null }),
		"standardViolation.update": async (a) => { updated = a.data; return { uuid: "v7", ...a.data }; },
		"bonusMonth.findMany": async () => [],
		"userNotification.createManyAndReturn": async () => [],
		"user.findMany": async () => [],
		"organization.findMany": async () => [],
		"organization.findUnique": async () => null,
		"standardItem.findMany": async () => [],
		// Журнал действий пишется мимо ответа — в тесте в базу не ходим.
		"activityHistory.create": async () => ({}),
		"activityHistory.deleteMany": async () => ({ count: 0 }),
	});
	try {
		const body = { decision: "rejected", note: "Возражение обосновано" };
		await withApp(violationsRouter, { ...firm, uuid: "head" }, async (call) => {
			const r = await call("POST", "/standard-violations/v7/resolve-dispute", body);
			assert.equal(r.status, 403);
			assert.match(r.body.message, /не тот, кто подтверждал/);
			const g = await call("GET", "/standard-violations/v7");
			assert.equal(g.body.item.canResolveDispute, false, "флаг для кнопки «Решить»");
		});
		await withApp(violationsRouter, { ...firm, uuid: "head2" }, async (call) => {
			const r = await call("POST", "/standard-violations/v7/resolve-dispute", body);
			assert.equal(r.status, 403, "второй главбух — тот же уровень, не выше");
			assert.match(r.body.message, /уровень выше/);
		});
		assert.equal(updated, null);
		await withApp(violationsRouter, { ...firm, uuid: "mgr" }, async (call) => {
			const g = await call("GET", "/standard-violations/v7");
			assert.equal(g.body.item.canResolveDispute, true);
			const r = await call("POST", "/standard-violations/v7/resolve-dispute", body);
			assert.equal(r.status, 200, r.body.message);
			assert.equal(updated.disputeDecidedByUuid, "mgr");
		});
	} finally { restore(); }
});
