// Область записи справочника: «организации» или «общая» (Г3 плана PLAN_INSTALL_MODES_2026-09-24.md).
import test from "node:test";
import assert from "node:assert/strict";
import {
	SHARED_CAPABLE, ALWAYS_ORG_SCOPED, modeAllowsShared, sharedAllowed, resolveNewScope, listIncludesShared,
} from "../services/recordScope.js";

test("общие записи разрешены только группе", () => {
	assert.equal(modeAllowsShared("group"), true);
	// Арендаторы друг другу посторонние: общий справочник у них — утечка, а не удобство.
	assert.equal(modeAllowsShared("isolated"), false);
	// Общий контрагент у двух клиентов фирмы — перемешанный учёт разных юрлиц.
	assert.equal(modeAllowsShared("service"), false);
});

test("режим не выбран — общие не прячем", () => {
	// На работающей установке общие записи уже есть (у нас это весь план счетов), и прятать
	// их из-за ненастроенного режима значит сломать учёт на ровном месте.
	assert.equal(modeAllowsShared(null), true);
	assert.equal(modeAllowsShared(undefined), true);
});

test("склады и кассы принадлежат организации при любом режиме", () => {
	// Физический объект конкретного юрлица: «общий склад» не имеет смысла ни в учёте, ни в жизни.
	for (const m of ALWAYS_ORG_SCOPED) {
		assert.equal(sharedAllowed(m, "group"), false, m);
		assert.equal(sharedAllowed(m, null), false, m);
	}
});

test("справочники, где общая запись осмысленна", () => {
	for (const m of ["Counterparty", "Product", "Brand", "PriceType"]) {
		assert.ok(SHARED_CAPABLE.includes(m), m);
		assert.equal(sharedAllowed(m, "group"), true, m);
		assert.equal(sharedAllowed(m, "isolated"), false, m);
	}
	// Документ общим быть не может в принципе — он всегда чей-то.
	assert.equal(sharedAllowed("Sale", "group"), false);
});

test("общую запись заводит только тот, кто распоряжается организацией", () => {
	const ok = resolveNewScope({ requested: "shared", model: "Counterparty", mode: "group", isOrgAdmin: true });
	assert.deepEqual(ok, { scope: "shared", reason: null });

	// Видна всем — завести «нечаянно» значит показать своего поставщика соседнему юрлицу.
	const denied = resolveNewScope({ requested: "shared", model: "Counterparty", mode: "group", isOrgAdmin: false });
	assert.deepEqual(denied, { scope: "organization", reason: "NOT_ALLOWED_TO_SHARE" });
});

test("отказ объясняется причиной, а не молчанием", () => {
	assert.equal(resolveNewScope({ requested: "shared", model: "Warehouse", mode: "group", isOrgAdmin: true }).reason,
		"OBJECT_IS_ORG_BOUND");
	assert.equal(resolveNewScope({ requested: "shared", model: "Counterparty", mode: "isolated", isOrgAdmin: true }).reason,
		"MODE_FORBIDS_SHARED");
	// Обычная запись — без причины: отказа не было.
	assert.deepEqual(resolveNewScope({ requested: "organization", model: "Product", mode: "group" }),
		{ scope: "organization", reason: null });
});

test("список и лукап показывают общие по ОДНОМУ правилу", () => {
	// Ровно в расхождении этих двух витрин и была беда: контрагент существовал или нет
	// в зависимости от того, откуда на него смотрят.
	for (const m of SHARED_CAPABLE) {
		assert.equal(listIncludesShared(m, "group"), sharedAllowed(m, "group"), m);
	}
});
