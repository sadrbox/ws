// Принадлежность маршрутов модулям (О7 плана PLAN_INSTALL_MODES_2026-09-24.md).
import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ROUTES, moduleOfRoute, guardMode } from "../services/moduleRoutes.js";
import { MODULE_KEYS } from "../services/moduleAccess.js";

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
	for (const seg of ["sales", "sale-returns", "sales-orders", "commercial-offers",
		"reservations", "outgoing-invoices", "fiscal-receipts"]) {
		assert.equal(moduleOfRoute(seg), "sales", seg);
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
