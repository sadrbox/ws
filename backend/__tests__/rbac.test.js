// ─────────────────────────────────────────────────────────────────────────────
// T1.4 — Ревизия RBAC: тест-матрица прав.
//
// Проверяет userAccessRightMiddleware: пропуск привилегированных ролей, гейт по
// уровню (GET → readonly|full, мутации → full, none/нет записи → 403) и покрытие
// маршрутов документов в ROUTE_TO_MODEL (страж от «забыли зарегистрировать»).
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import { userAccessRightMiddleware, ROUTE_TO_MODEL } from "../utils/auth.js";

// Прогон middleware с фейковыми req/res. Возвращает { passed, status, body }.
async function run({ user, method = "GET", path = "/writeoffs" }) {
	let passed = false;
	const res = {
		statusCode: 200,
		body: null,
		status(c) { this.statusCode = c; return this; },
		json(b) { this.body = b; return this; },
	};
	await userAccessRightMiddleware({ user, method, path, ip: "127.0.0.1" }, res, () => { passed = true; });
	return { passed, status: res.statusCode, body: res.body };
}

// ─── Привилегированные роли и служебные ветки (без БД) ───────────────────────
test("суперадмин проходит любой метод", async () => {
	for (const method of ["GET", "POST", "PUT", "DELETE"]) {
		const r = await run({ user: { uuid: "x", isSuperAdmin: true }, method, path: "/writeoffs" });
		assert.ok(r.passed, `superadmin ${method}`);
	}
});

test("администратор организации проходит", async () => {
	assert.ok((await run({ user: { uuid: "x", isOrgAdmin: true }, method: "POST" })).passed);
	assert.ok((await run({ user: { uuid: "x", isAnyOrgAdmin: true }, method: "DELETE" })).passed);
});

test("OPTIONS пропускается всегда (CORS preflight)", async () => {
	assert.ok((await run({ user: { uuid: "x" }, method: "OPTIONS" })).passed);
});

test("неизвестный маршрут не гейтится (нет модели в карте)", async () => {
	const r = await run({ user: { uuid: "x", username: "nobody" }, method: "POST", path: "/health-check" });
	assert.ok(r.passed, "маршрут вне ROUTE_TO_MODEL проходит");
});

// ─── Матрица уровней (реальные права в БД) ───────────────────────────────────
let userUuid;
before(async () => {
	const u = await prisma.user.create({ data: { username: `rbac-test-${crypto.randomUUID().slice(0, 8)}` } });
	userUuid = u.uuid;
});
after(async () => {
	if (userUuid) {
		await prisma.userAccessRight.deleteMany({ where: { userUuid } });
		await prisma.user.delete({ where: { uuid: userUuid } }).catch(() => {});
	}
	await prisma.$disconnect();
});

async function grant(level) {
	await prisma.userAccessRight.deleteMany({ where: { userUuid, modelName: "WriteOff" } });
	if (level) await prisma.userAccessRight.create({ data: { userUuid, modelName: "WriteOff", accessLevel: level, organizationUuid: null } });
}

test("уровень full: GET и мутации проходят", async () => {
	await grant("full");
	const u = { uuid: userUuid, username: "rbac-user" };
	assert.ok((await run({ user: u, method: "GET" })).passed, "GET");
	assert.ok((await run({ user: u, method: "POST" })).passed, "POST");
	assert.ok((await run({ user: u, method: "DELETE" })).passed, "DELETE");
});

test("уровень readonly: GET проходит, мутации → 403", async () => {
	await grant("readonly");
	const u = { uuid: userUuid, username: "rbac-user" };
	assert.ok((await run({ user: u, method: "GET" })).passed, "GET разрешён");
	const post = await run({ user: u, method: "POST" });
	assert.equal(post.passed, false);
	assert.equal(post.status, 403, "POST запрещён");
	assert.equal((await run({ user: u, method: "PUT" })).status, 403);
});

test("уровень none: всё → 403", async () => {
	await grant("none");
	const u = { uuid: userUuid, username: "rbac-user" };
	assert.equal((await run({ user: u, method: "GET" })).status, 403);
	assert.equal((await run({ user: u, method: "POST" })).status, 403);
});

test("нет записи о праве: всё → 403 (deny by default)", async () => {
	await grant(null); // прав нет вовсе
	const u = { uuid: userUuid, username: "rbac-user" };
	assert.equal((await run({ user: u, method: "GET" })).status, 403, "без права GET запрещён");
	assert.equal((await run({ user: u, method: "POST" })).status, 403);
});

// ─── Страж покрытия: новые документы обязаны быть в карте прав ────────────────
test("складские документы и ГТД зарегистрированы в ROUTE_TO_MODEL", () => {
	const expected = {
		importdeclarations: "ImportDeclaration",
		importdeclarationitems: "ImportDeclarationItem",
		writeoffs: "WriteOff",
		writeoffitems: "WriteOffItem",
		goodsreceipts: "GoodsReceipt",
		goodsreceiptitems: "GoodsReceiptItem",
		stockcounts: "StockCount",
		stockcountitems: "StockCountItem",
	};
	for (const [route, model] of Object.entries(expected)) {
		assert.equal(ROUTE_TO_MODEL[route], model, `${route} → ${model}`);
	}
});
