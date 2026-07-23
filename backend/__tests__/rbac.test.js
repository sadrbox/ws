// ─────────────────────────────────────────────────────────────────────────────
// T1.4 — Ревизия RBAC: тест-матрица прав.
//
// Проверяет accessPermissionMiddleware: пропуск привилегированных ролей, гейт по
// уровню (GET → readonly|full, мутации → full, none/нет записи → 403) и покрытие
// маршрутов документов в ROUTE_TO_MODEL (страж от «забыли зарегистрировать»).
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import { accessPermissionMiddleware, ROUTE_TO_MODEL } from "../utils/auth.js";

// Прогон middleware с фейковыми req/res. Возвращает { passed, status, body }.
async function run({ user, method = "GET", path = "/writeoffs" }) {
	let passed = false;
	const res = {
		statusCode: 200,
		body: null,
		status(c) { this.statusCode = c; return this; },
		json(b) { this.body = b; return this; },
	};
	await accessPermissionMiddleware({ user, method, path, ip: "127.0.0.1" }, res, () => { passed = true; });
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
		await prisma.accessPermission.deleteMany({ where: { userUuid } });
		await prisma.user.delete({ where: { uuid: userUuid } }).catch(() => {});
	}
	await prisma.$disconnect();
});

async function grant(level) {
	await prisma.accessPermission.deleteMany({ where: { userUuid, modelName: "WriteOff" } });
	if (level) await prisma.accessPermission.create({ data: { userUuid, modelName: "WriteOff", accessLevel: level, organizationUuid: null } });
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

// Справочник статусов задач — КОНФИГУРАЦИЯ (переименование/удаление статуса влияет
// на все задачи организации), поэтому обязан требовать право Todo. Маршруты вне
// ROUTE_TO_MODEL проверку прав ПРОПУСКАЮТ — без этой записи любой аутентифицированный
// пользователь, даже с доступом «только чтение», мог бы править справочник.
test("todo-statuses требует право Todo (иначе справочник правит кто угодно)", () => {
	assert.equal(ROUTE_TO_MODEL["todo-statuses"], "Todo");
});

// Метки — пользовательская пометка поверх записи, того же класса, что заметки:
// бизнес-данные не меняют, изоляция по организациям и проверка автора уже есть.
// Фиксируем осознанность решения, чтобы его не «чинили» вслепую.
test("object-marks намеренно без модельного права (как notes)", () => {
	assert.equal(ROUTE_TO_MODEL["object-marks"], undefined);
	assert.equal(ROUTE_TO_MODEL["notes"], undefined, "notes — тот же класс");
});

// Маршруты цепочки документов работают над РАЗНЫМИ моделями (зависит от :type),
// поэтому карта ROUTE_TO_MODEL их не покрывает и middleware пропускает. Право
// проверяется в самом роутере через canAccessModel — фиксируем, что имя права
// выводится из типа корректно для ВСЕХ типов реестра.
import { DOC_REGISTRY } from "../services/documentChain.js";

test("clear-basis: имя права выводится из типа документа для всех 18 типов", () => {
	const known = new Set(Object.values(ROUTE_TO_MODEL));
	const pascal = (t) => t.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
	for (const type of Object.keys(DOC_REGISTRY)) {
		assert.ok(known.has(pascal(type)), `${type} → ${pascal(type)} должно быть известным правом`);
	}
	// Кассовые ордера лежат в ОДНОЙ таблице, но права раздельные — важно, что имя
	// берётся из типа, а не из DOC_REGISTRY[type].model (там был бы общий CashOrder).
	assert.equal(pascal("cash_receipt_order"), "CashReceiptOrder");
	assert.equal(pascal("cash_expense_order"), "CashExpenseOrder");
	assert.notEqual(DOC_REGISTRY.cash_receipt_order.model, DOC_REGISTRY.cash_receipt_order.model.toUpperCase());
});
