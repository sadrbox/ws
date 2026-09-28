// КР-18 аудита 27.09: права сотрудника обслуживающей фирмы в организации клиента — HEADLESS, без БД
// (делегаты Prisma подменяются). Сценарий «админ фирмы → клиент по связи обслуживания»:
//   • в клиенте права — из профиля связи (service_accountant) с модулями клиента, а не из строк прав
//     самой фирмы (раньше — запасным путём «право в любой доступной организации»);
//   • switch-org пускает в клиента по живой связи, ответ несёт клиента в списке организаций и права
//     для меню по профилю связи;
//   • офлайн-справочник организаций не пропадает без права Organization;
//   • назначение профиля сотруднику фирмы в клиенте — понятный отказ (права меняются связью);
//   • удалённый пользователь не получает токена (вход, /auth/me, switch-org) — P3 аудита 27.09.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma/prisma-client.js";
import { tenantMiddleware, accessPermissionMiddleware, canAccessModel, generateToken } from "../utils/auth.js";
import { serviceAccessLevel, maxLevel, moduleOfModel } from "../services/serviceLinks.js";
import authRouter from "../api/router/auth.js";
import syncRouter, { ORG_DIRECTORY_SELECT } from "../api/router/sync.js";
import profilesRouter from "../api/router/permissionProfiles.js";

const FIRM = "org-FIRM";
const CLIENT = "org-CLIENT";
const OTHER = "org-OTHER";
const LINK = { clientOrgUuid: CLIENT, state: "active", validUntil: null, profile: "service_accountant", modules: null, uuid: "link-1" };

/** Админ фирмы: член FIRM с ролью admin, на клиента назначен связью; активная организация — по аргументу. */
function firmAdmin(active = CLIENT, extra = {}) {
	return {
		uuid: "u-firm", username: "firmadmin", isSuperAdmin: false, organizationUuid: active, deletedAt: null,
		employeeUuid: null, employee: null, twoFactorEnabled: false, twoFactorSecret: null, avatarPath: null,
		accessRights: [{ organizationUuid: FIRM, role: "admin", organization: { uuid: FIRM, name: "Фирма", legalName: null, bin: "100000000001" } }],
		...extra,
	};
}

/** Подменить методы делегатов Prisma на время теста; вернуть откат. */
function mock(map) {
	const saved = [];
	for (const [path, fn] of Object.entries(map)) {
		const [model, method] = path.split(".");
		saved.push([prisma[model], method, prisma[model][method]]);
		prisma[model][method] = fn;
	}
	return () => { for (const [t, k, v] of saved.reverse()) t[k] = v; };
}

/** База сценария: у админа фирмы в ФИРМЕ — полные права на всё (профиль owner), в клиенте строк нет. */
function scenario({ user = firmAdmin(), link = LINK, extra = {} } = {}) {
	return mock({
		"user.findUnique": async () => (typeof user === "function" ? user() : user),
		"serviceAssignment.findMany": async ({ where }) => (where.userUuid === "u-firm" && link ? [{ link }] : []),
		"accessPermission.findFirst": async ({ where }) => {
			const org = where.organizationUuid;
			const hitsFirm = org === FIRM || (Array.isArray(org?.in) && org.in.includes(FIRM));
			return hitsFirm ? { accessLevel: "full", organizationUuid: FIRM } : null;
		},
		"accessPermission.findMany": async ({ where }) => {
			const orgs = where.OR ? where.OR.map((c) => c.organizationUuid) : [where.organizationUuid];
			return orgs.includes(FIRM) ? [{ modelName: "User", accessLevel: "full", organizationUuid: FIRM }, { modelName: "Sale", accessLevel: "full", organizationUuid: FIRM }] : [];
		},
		"organization.findMany": async ({ where }) => [OTHER, CLIENT, FIRM].filter((u) => where?.uuid?.in?.includes(u)).map((u) => ({ uuid: u, name: `Орг ${u}`, legalName: null, bin: "200000000002" })),
		"user.update": async () => ({}),
		"activityHistory.create": async () => ({}),
		...extra,
	});
}

/** Приложение как в server.js: tenantMiddleware → accessPermissionMiddleware → обработчик. */
async function withApi(fn, { routers = [] } = {}) {
	const app = express();
	app.use(express.json());
	app.use("/api/v1", authRouter);
	app.use("/api/v1", (req, _res, next) => { req.user = { uuid: "u-firm", username: "firmadmin" }; next(); });
	app.use("/api/v1", tenantMiddleware, accessPermissionMiddleware);
	for (const r of routers) app.use("/api/v1", r);
	app.use("/api/v1", (req, res) => res.json({ success: true, passed: true, org: req.user.organizationUuid }));
	const srv = app.listen(0);
	await new Promise((r) => srv.once("listening", r));
	const base = `http://127.0.0.1:${srv.address().port}/api/v1`;
	const call = async (method, path, body, headers = {}) => {
		const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
		return { status: r.status, body: await r.json().catch(() => ({})) };
	};
	try {
		return await fn(call);
	} finally {
		srv.close();
	}
}

test("КР-18: уровень по профилю связи — service_accountant ведёт учёт, доступом клиента не распоряжается; модули клиента", () => {
	const ctx = { profile: "service_accountant", modules: null };
	assert.equal(serviceAccessLevel(ctx, "Sale"), "full");
	assert.equal(serviceAccessLevel(ctx, "MonthClose"), "full");
	assert.equal(serviceAccessLevel(ctx, "User"), "none");
	assert.equal(serviceAccessLevel(ctx, "AccessPermission"), "none");
	const cashOnly = { profile: "service_accountant", modules: ["cash"] };
	assert.equal(serviceAccessLevel(cashOnly, "Sale"), "none", "модуль «Продажи» клиентом не открыт");
	assert.equal(serviceAccessLevel(cashOnly, "SaleItem", { segment: "saleitems" }), "none", "строки — модуль документа");
	assert.equal(serviceAccessLevel(cashOnly, "Cashbox"), "full");
	assert.equal(serviceAccessLevel(cashOnly, "Product"), "full", "ядро учёта модулю не принадлежит");
	assert.equal(serviceAccessLevel({ profile: "owner", modules: null }, "Sale"), "none", "owner фирме не выдаётся");
	assert.equal(serviceAccessLevel(null, "Sale"), "none");
	assert.equal(moduleOfModel("ImportDeclaration"), "purchase");
	assert.equal(maxLevel(undefined, "readonly", "none"), "readonly");
	assert.equal(maxLevel("full", "мусор"), "full");
});

test("КР-18: в клиенте права — профиль связи, а не строки прав фирмы (админ фирмы не распоряжается пользователями клиента)", async () => {
	const restore = scenario();
	try {
		await withApi(async (call) => {
			const sales = await call("GET", "/sales");
			assert.equal(sales.status, 200, "учёт клиента по профилю связи");
			assert.equal(sales.body.org, CLIENT, "активная — клиент (по обслуживанию)");
			assert.equal((await call("POST", "/month-closes", {})).status, 200, "закрытие месяца — по профилю");
			// Раньше: право User=full из строк ФИРМЫ проходило запасным путём — 200.
			assert.equal((await call("GET", "/users")).status, 403);
			assert.equal((await call("POST", "/access-permissions", {})).status, 403);
			// Сводный вид — прежним путём (уровень одной организации за все не решает).
			assert.equal((await call("GET", "/users", null, { "x-org-scope": "group" })).status, 200);
		});
	} finally {
		restore();
	}
});

test("КР-18: модули связи — закрытый клиентом модуль недоступен и в самом клиенте", async () => {
	const restore = scenario({ link: { ...LINK, modules: "cash" } });
	try {
		await withApi(async (call) => {
			assert.equal((await call("GET", "/sales")).status, 403);
			assert.equal((await call("GET", "/saleitems")).status, 403);
			assert.equal((await call("GET", "/cashboxes")).status, 200);
			assert.equal((await call("GET", "/products")).status, 200);
		});
	} finally {
		restore();
	}
});

test("КР-18: связь погасла — клиент недоступен, активная сбрасывается; в своей фирме — свои права", async () => {
	const restore = scenario({ link: { ...LINK, state: "revoked" } });
	try {
		await withApi(async (call) => {
			const r = await call("GET", "/sales");
			assert.notEqual(r.body.org, CLIENT, "клиент выпал из доступных");
		});
	} finally {
		restore();
	}
	const restore2 = scenario({ user: firmAdmin(FIRM) });
	try {
		await withApi(async (call) => {
			assert.equal((await call("GET", "/users")).status, 200, "в своей фирме админ — как прежде");
		});
	} finally {
		restore2();
	}
});

test("КР-18: canAccessModel в клиенте — тем же правилом, что middleware", async () => {
	const restore = scenario();
	try {
		const req = { method: "GET", user: { uuid: "u-firm" }, headers: {}, query: {} };
		await tenantMiddleware(req, { status() { return this; }, json() { return this; } }, () => {});
		assert.equal(req.user.organizationUuid, CLIENT);
		assert.equal(await canAccessModel(req, "AccountingEntry"), true);
		assert.equal(await canAccessModel(req, "MonthClose", { write: true }), true);
		assert.equal(await canAccessModel(req, "User"), false, "раньше — true по правам фирмы");
		assert.equal(await canAccessModel(req, "Organization"), false);
	} finally {
		restore();
	}
});

test("КР-18: switch-org в клиента по живой связи — токен, клиент в списке организаций, меню по профилю связи", async () => {
	const restore = scenario({ user: firmAdmin(FIRM) });
	try {
		await withApi(async (call) => {
			const token = generateToken({ uuid: "u-firm", username: "firmadmin" });
			const auth = { authorization: `Bearer ${token}` };
			const r = await call("PATCH", "/auth/switch-org", { organizationUuid: CLIENT }, auth);
			assert.equal(r.status, 200, r.body?.message);
			assert.ok(r.body.token);
			assert.equal(r.body.user.organizationUuid, CLIENT);
			const entry = r.body.user.accessRights.find((a) => a.organizationUuid === CLIENT);
			assert.equal(entry?.role, "service", "клиент в переключателе — с ролью service, не admin");
			assert.equal(entry?.service?.profile, "service_accountant");
			assert.ok(r.body.user.allowedOrgUuids.includes(CLIENT));
			const level = (m) => r.body.user.accessPermissions.find((p) => p.modelName === m)?.accessLevel;
			assert.equal(level("Sale"), "full");
			assert.equal(level("User"), "none", "права фирмы в меню клиента не переносятся");
			// Чужая организация без связи — по-прежнему отказ.
			assert.equal((await call("PATCH", "/auth/switch-org", { organizationUuid: OTHER }, auth)).status, 403);
			// /auth/me после переключения — те же права и список.
			prisma.user.findUnique = async () => firmAdmin(CLIENT);
			const me = await call("GET", "/auth/me", null, auth);
			assert.equal(me.status, 200);
			assert.ok(me.body.user.accessRights.some((a) => a.organizationUuid === CLIENT && a.role === "service"));
			assert.equal(me.body.user.accessPermissions.find((p) => p.modelName === "User")?.accessLevel, "none");
			assert.equal(me.body.user.deletedAt, undefined, "служебное поле наружу не уходит");
		});
	} finally {
		restore();
	}
});

test("P3: удалённый пользователь не получает токена — вход, /auth/me, switch-org", async () => {
	const hash = await bcrypt.hash("pw", 4);
	const gone = firmAdmin(FIRM, { deletedAt: new Date(), password: hash });
	const restore = scenario({
		user: gone,
		extra: {
			// Вход ищет только неудалённых: без условия deletedAt: null найдётся и удалённый.
			"user.findFirst": async ({ where }) => (where.deletedAt === null ? null : gone),
		},
	});
	try {
		await withApi(async (call) => {
			const login = await call("POST", "/auth/login", { username: "firmadmin", password: "pw" });
			assert.equal(login.status, 401);
			assert.equal(login.body.token, undefined);
			const auth = { authorization: `Bearer ${generateToken({ uuid: "u-firm", username: "firmadmin" })}` };
			assert.equal((await call("GET", "/auth/me", null, auth)).status, 401);
			const sw = await call("PATCH", "/auth/switch-org", { organizationUuid: FIRM }, auth);
			assert.equal(sw.status, 401);
			assert.equal(sw.body.token, undefined, "переключение не продлевает сеанс удалённого");
		});
	} finally {
		restore();
	}
});

test("КР-18: sync pull — организации не пропадают без права Organization (только имя и БИН); учёт клиента — по профилю", async () => {
	const seen = {};
	const restore = scenario({
		extra: {
			"organization.findMany": async (args) => { seen.org = args; return [{ id: 1, uuid: CLIENT, name: "Клиент", bin: "300000000003", updatedAt: new Date() }]; },
			"sale.findMany": async () => [{ id: 1, uuid: "s1", organizationUuid: CLIENT, updatedAt: new Date() }],
		},
	});
	try {
		await withApi(async (call) => {
			const r = await call("POST", "/sync/pull", { tables: ["organizations", "sales", "users"] });
			assert.equal(r.status, 200);
			assert.equal(r.body.data.organizations?.[0]?.uuid, CLIENT, "раньше — skipped, офлайн без организаций");
			assert.deepEqual(r.body.limited, ["organizations"]);
			assert.deepEqual(seen.org.select, { ...ORG_DIRECTORY_SELECT }, "без реквизитов и кода приглашения");
			assert.ok(JSON.stringify(seen.org.where).includes(CLIENT), "изоляция прежняя — активная организация");
			assert.equal(r.body.data.sales?.length, 1);
			assert.ok(r.body.skipped?.includes("users"), "пользователи клиента — не по профилю связи");
		}, { routers: [syncRouter] });
	} finally {
		restore();
	}
});

test("КР-18: назначить профиль сотруднику фирмы в клиенте — понятный отказ (права меняются связью), членом он не становится", async () => {
	// Назначает администратор клиента (по членству) — подставляем его контекст напрямую.
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => { req.user = { uuid: "u-client-admin", organizationUuid: CLIENT, adminOrgUuids: [CLIENT], isOrgAdmin: true, allowedOrgUuids: [CLIENT] }; next(); });
	app.use("/api/v1", profilesRouter);
	let created = false;
	const restore = mock({
		"accessRight.findUnique": async () => null,
		"serviceAssignment.findMany": async ({ where }) => (where.userUuid === "u-firm" ? [{ link: LINK }] : []),
		"accessPermission.deleteMany": async () => { created = true; return { count: 0 }; },
		"accessPermission.createMany": async () => { created = true; return { count: 0 }; },
	});
	const srv = app.listen(0);
	try {
		await new Promise((r) => srv.once("listening", r));
		const post = async (userUuid) => {
			const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/v1/permission-profiles/apply`, {
				method: "POST", headers: { "content-type": "application/json" },
				body: JSON.stringify({ userUuid, organizationUuid: CLIENT, profile: "accountant" }),
			});
			return { status: r.status, body: await r.json() };
		};
		const r = await post("u-firm");
		assert.equal(r.status, 409);
		assert.equal(r.body.code, "SERVICE_LINK_PROFILE");
		assert.equal((await post("u-stranger")).status, 404, "посторонний — как прежде");
		assert.equal(created, false, "права не записаны");
	} finally {
		srv.close();
		restore();
	}
});
