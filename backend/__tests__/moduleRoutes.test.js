// Принадлежность маршрутов модулям (О7 плана PLAN_INSTALL_MODES_2026-09-24.md).
import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ROUTES, moduleOfRoute, guardMode } from "../services/moduleRoutes.js";
import { MODULE_KEYS, moduleGuardMiddleware } from "../services/moduleAccess.js";
import { prisma } from "../prisma/prisma-client.js";
import { ROUTE_TO_MODEL } from "../utils/routeModels.js";
import { declaredRouteSegments } from "./_routeSegments.js";

test("все маршруты ссылаются на существующие модули", () => {
	for (const [seg, key] of Object.entries(MODULE_ROUTES)) {
		assert.ok(MODULE_KEYS.includes(key), `${seg} → неизвестный модуль ${key}`);
	}
});

test("каждый модуль имеет хотя бы один маршрут", () => {
	// Модуль без маршрутов невозможно ни закрыть, ни проверить: отключение стало бы
	// косметикой в меню — ровно та болезнь, от которой уходим.
	const covered = new Set(Object.values(MODULE_ROUTES));
	const orphan = MODULE_KEYS.filter((k) => !covered.has(k));
	assert.deepEqual(orphan, [], `модули без маршрутов: ${orphan.join(", ")}`);
});

test("ядро под гард не попадает", () => {
	// Без справочников и учёта не работает ни один модуль — отключать их нечем.
	for (const seg of ["products", "counterparties", "warehouses", "organizations", "users",
		"chart-of-accounts", "accounting", "currencies", "contracts"]) {
		assert.equal(moduleOfRoute(seg), null, `${seg} не должен принадлежать модулю`);
	}
});

test("продажи закрываются целиком, а не только созданием документа", () => {
	for (const seg of ["sales", "saleitems", "sale-returns", "sales-orders", "commercial-offers",
		"reservations", "outgoing-invoices", "outgoinginvoiceitems", "fiscal-receipts"]) {
		assert.equal(moduleOfRoute(seg), "sales", seg);
	}
});

// ── Аудит 27.09: карта путей — ровно сегменты маршрутов ──────────────────────
// Гард сверяет первый сегмент пути ТОЧНО. Карта писала часть путей через дефис («sale-items»,
// «import-declarations», «esf-inbound»), а роутеры — слитно («saleitems», «importdeclarations»,
// «esf-inbounds»): строки документов, ГТД и входящие ЭСФ отключённого модуля оставались открыты.

test("каждый путь карты модулей — сегмент, который реально объявлен роутером", () => {
	const declared = declaredRouteSegments();
	assert.deepEqual(declared.unresolved, [], `сканер не понял пути: ${declared.unresolved.join("; ")}`);
	assert.ok(declared.size > 50, "сканер маршрутов сломался — сегментов подозрительно мало");
	const squash = (x) => x.replace(/-/g, "");
	const missing = Object.keys(MODULE_ROUTES).filter((seg) => !declared.has(seg)).map((seg) => {
		const near = [...declared.keys()].filter((d) => squash(d) === squash(seg) || squash(d) === `${squash(seg)}s`);
		return near.length ? `${seg} (маршрут называется: ${near.join(", ")})` : seg;
	});
	assert.deepEqual(missing, [], `пути карты, которых нет среди маршрутов — гард их не закроет: ${missing.join("; ")}`);
});

test("строки и под-маршруты документа — в модуле документа (одна модель прав — один модуль)", () => {
	// Маршруты с одной моделью прав — одна сущность учёта: «purchaseitems» и «purchasefixedassetitems»
	// правятся правом Purchase, как и «purchases». Новый такой роутер без записи в карте оставил бы
	// строки отключённого модуля открытыми — ловим это здесь.
	const declared = declaredRouteSegments();
	const moduleOfModel = new Map();
	for (const [seg, mod] of Object.entries(MODULE_ROUTES)) {
		const model = ROUTE_TO_MODEL[seg];
		if (model) moduleOfModel.set(model, mod);
	}
	const strays = [];
	for (const seg of declared.keys()) {
		const model = ROUTE_TO_MODEL[seg];
		const want = model ? moduleOfModel.get(model) : undefined;
		if (want && MODULE_ROUTES[seg] !== want) strays.push(`${seg} (${model} → ${want}, в карте: ${MODULE_ROUTES[seg] ?? "нет"})`);
	}
	assert.deepEqual(strays, [], `маршруты вне модуля своей модели: ${strays.join("; ")}`);
});

test("строки документов, ГТД и входящие ЭСФ закрываются вместе с модулем", () => {
	const expect = {
		saleitems: "sales", outgoinginvoiceitems: "sales",
		purchaseitems: "purchase", purchasefixedassetitems: "purchase", incominginvoiceitems: "purchase",
		importdeclarations: "purchase", importdeclarationitems: "purchase",
		inventorytransferitems: "warehouse", writeoffitems: "warehouse", goodsreceiptitems: "warehouse", stockcountitems: "warehouse",
		paymentinvoiceitems: "cash",
		"esf-inbounds": "govdocs",
	};
	for (const [seg, mod] of Object.entries(expect)) assert.equal(moduleOfRoute(seg), mod, seg);
});

test("серии и партии — ядро: их подбирают строки продаж и закупок, склад их не закрывает", () => {
	assert.equal(moduleOfRoute("serialnumbers"), null);
	assert.equal(moduleOfRoute("productbatches"), null);
});

test("гард: строки продаж и ГТД отключённого модуля — 403 MODULE_DISABLED; серии — проходят", async () => {
	// Отключены «Продажи» и «Закупки» (у каждой организации запроса — своя, чтобы не мешал кэш гарда).
	const orig = prisma.appSetting.findUnique;
	prisma.appSetting.findUnique = async () => ({ value: JSON.stringify(["sales", "purchase", "warehouse"]) });
	const run = (path, org, method = "GET") => new Promise((resolve) => {
		const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; resolve({ passed: false, status: this.statusCode, body: b }); return this; } };
		moduleGuardMiddleware({ path, method, body: {}, query: {}, user: { organizationUuid: org } }, res, (err) => resolve({ passed: !err, err }));
	});
	try {
		for (const [path, mod] of [["/saleitems", "sales"], ["/saleitems/batch", "sales"], ["/importdeclarations/5", "purchase"], ["/purchaseitems", "purchase"], ["/writeoffitems", "warehouse"]]) {
			const r = await run(path, `org-${path}`);
			assert.equal(r.status, 403, path);
			assert.equal(r.body.code, "MODULE_DISABLED", path);
			assert.equal(r.body.module, mod, path);
		}
		assert.equal((await run("/serialnumbers/available", "org-serials")).passed, true, "серии — ядро");
		assert.equal((await run("/products", "org-products")).passed, true, "справочник — ядро");
	} finally {
		prisma.appSetting.findUnique = orig;
	}
});

test("режим гарда: по умолчанию полный, откат — явной переменной", () => {
	const saved = process.env.MODULE_GUARD;
	try {
		delete process.env.MODULE_GUARD;
		assert.equal(guardMode(), "full");
		process.env.MODULE_GUARD = "create-only";
		assert.equal(guardMode(), "create-only");
		process.env.MODULE_GUARD = "что-то ещё";
		assert.equal(guardMode(), "full", "мусор в переменной не должен ослаблять гард");
	} finally {
		if (saved === undefined) delete process.env.MODULE_GUARD; else process.env.MODULE_GUARD = saved;
	}
});
