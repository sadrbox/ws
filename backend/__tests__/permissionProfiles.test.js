// Профили прав (О2 плана PLAN_INSTALL_MODES_2026-09-24.md).
//
// Headless: определения профилей намеренно живут в коде и не знают про Prisma, поэтому
// проверяются в гейте `verify`. Закрепляем здесь то, что легко сломать незаметно: покрытие всех
// моделей, приоритет правил и границы между «работой» и «властью».
import test from "node:test";
import assert from "node:assert/strict";
import {
	LEVELS, allModels, listProfiles, findProfile, expandProfile, defaultProfileFor,
} from "../services/permissionProfiles.js";

test("профиль разворачивается по ВСЕМ моделям, а не только по названным", () => {
	// Иначе «не упомянут» означало бы «как было», и смена профиля оставляла бы хвосты прежнего.
	const models = allModels();
	assert.ok(models.length > 50, "карта прав не должна пустеть незаметно");
	for (const code of listProfiles().map((p) => p.code)) {
		const out = expandProfile(code);
		assert.deepEqual(Object.keys(out).sort(), models, `профиль ${code} покрывает не все модели`);
		for (const lvl of Object.values(out)) assert.ok(LEVELS.includes(lvl), `${code}: уровень ${lvl}`);
	}
});

test("владелец получает полный доступ, в том числе к правам", () => {
	const owner = expandProfile("owner");
	assert.ok(Object.values(owner).every((l) => l === "full"));
});

test("бухгалтер ведёт учёт, но доступом не распоряжается", () => {
	const a = expandProfile("accountant");
	assert.equal(a.Sale, "full");
	assert.equal(a.AccountingEntry, "full");
	assert.equal(a.Counterparty, "full");
	// Работа и власть — разные обязанности: совмещать их в одном профиле нельзя.
	assert.equal(a.User, "readonly");
	assert.equal(a.AccessPermission, "readonly");
});

test("кассиру не открыты продажи на запись, кладовщику — касса", () => {
	const cashier = expandProfile("cashier");
	assert.equal(cashier.CashReceiptOrder, "full");
	assert.equal(cashier.Sale, "readonly");
	assert.equal(cashier.InventoryTransfer, "none", "склад кассира не касается");

	const store = expandProfile("storekeeper");
	assert.equal(store.InventoryTransfer, "full");
	assert.equal(store.Product, "readonly");
	assert.equal(store.CashReceiptOrder, "none");
});

test("руководитель видит всё и правит только задачи и сделки", () => {
	const m = expandProfile("manager");
	assert.equal(m.Sale, "readonly");
	assert.equal(m.Todo, "full");
	assert.equal(m.Deal, "full");
	// Права — не то, что смотрят «просто посмотреть».
	assert.equal(m.AccessPermission, "none");
});

test("обслуживающий бухгалтер не трогает доступ клиента", () => {
	// Чужой учёт ведут — чужим доступом не распоряжаются (К2 плана).
	const s = expandProfile("service_accountant");
	assert.equal(s.Sale, "full");
	assert.equal(s.User, "none");
	assert.equal(s.AccessPermission, "none");
	assert.equal(s.Organization, "none");
});

test("явное упоминание главнее базового уровня, full — последнее слово", () => {
	const v = expandProfile("viewer");
	assert.equal(v.Sale, "readonly", "база");
	assert.equal(v.User, "none", "явный none перекрывает базу");
});

test("профиль по умолчанию: владельцу полный, приглашённому — просмотр", () => {
	// Пустота означала бы «вошёл и не видит ничего, хотя всё в порядке».
	assert.equal(defaultProfileFor("admin"), "owner");
	assert.equal(defaultProfileFor("member"), "viewer");
	assert.equal(defaultProfileFor(undefined), "viewer");
});

test("неизвестный профиль — null, а не пустой набор", () => {
	assert.equal(findProfile("нет такого"), null);
	assert.equal(expandProfile("нет такого"), null);
});
