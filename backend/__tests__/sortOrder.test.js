// ─────────────────────────────────────────────────────────────────────────────
// Безопасная сортировка (utils/sortOrder.js).
//
// Регрессия: клиент шлёт id КОЛОНОК таблицы, среди которых есть ВИРТУАЛЬНЫЕ
// (serials/batch/lineNumber/deviation) — полей с такими именами в БД нет. Роутеры
// подставляли имя в Prisma «как есть», и запрос падал:
//   GET /saleitems?sort={"serials":"asc"} → Unknown argument `serials` → 500.
// Теперь имена валидируются по схеме (Prisma.dmmf).
// ─────────────────────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrderBy } from "../utils/sortOrder.js";

const j = (o) => JSON.stringify(o);

test("виртуальные колонки не попадают в Prisma (это и роняло запрос)", () => {
	for (const virt of ["serials", "batch", "lineNumber", "deviation", "accountingQuantity"]) {
		assert.deepEqual(
			buildOrderBy("saleItem", j({ [virt]: "asc" })),
			[{ id: "asc" }],
			`${virt} — виртуальная колонка, в orderBy её быть не должно`,
		);
	}
});

test("реальные скалярные поля пропускаются + стабильный тай-брейк по id", () => {
	assert.deepEqual(buildOrderBy("saleItem", j({ quantity: "desc" })), [{ quantity: "desc" }, { id: "asc" }]);
	assert.deepEqual(buildOrderBy("saleItem", j({ price: "asc" })), [{ price: "asc" }, { id: "asc" }]);
});

test("пути «связь.поле» валидируются по схеме на КАЖДОМ сегменте", () => {
	// связь есть, поле связанной модели есть → nested orderBy
	assert.deepEqual(buildOrderBy("saleItem", j({ "product.name": "asc" })), [{ product: { name: "asc" } }, { id: "asc" }]);
	assert.deepEqual(buildOrderBy("sale", j({ "counterparty.name": "asc" })), [{ counterparty: { name: "asc" } }, { id: "asc" }]);
	// связь есть, а такого поля у неё НЕТ → отбрасываем
	assert.deepEqual(buildOrderBy("sale", j({ "counterparty.несуществует": "asc" })), [{ id: "asc" }]);
	// такой связи нет вовсе → отбрасываем
	assert.deepEqual(buildOrderBy("sale", j({ "выдуманное.name": "asc" })), [{ id: "asc" }]);
});

test("мусор на входе не роняет выдачу", () => {
	assert.deepEqual(buildOrderBy("sale", "не json"), [{ id: "asc" }]);
	assert.deepEqual(buildOrderBy("sale", null), [{ id: "asc" }]);
	assert.deepEqual(buildOrderBy("sale", j({ id: "боком" })), [{ id: "asc" }], "направление только asc/desc");
	assert.deepEqual(buildOrderBy("несуществующаяМодель", j({ x: "asc" })), [{ id: "asc" }]);
});

test("fallback: списки документов сортируются id desc (новые сверху), справочники — своим порядком", () => {
	assert.deepEqual(buildOrderBy("sale", null, { fallback: { id: "desc" } }), [{ id: "desc" }]);
	// невалидное поле → тоже падаем на fallback, а не на asc
	assert.deepEqual(buildOrderBy("sale", j({ serials: "asc" }), { fallback: { id: "desc" } }), [{ id: "desc" }]);
	// составной fallback (справочники)
	assert.deepEqual(
		buildOrderBy("subkontoType", null, { fallback: [{ sortOrder: "asc" }, { name: "asc" }] }),
		[{ sortOrder: "asc" }, { name: "asc" }],
	);
});
