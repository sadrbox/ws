// КР-7 и КР-8 аудита 27.09 — предпроверка остатка и резервы. Headless: фейковый prisma в
// памяти (__tests__/_fakePrisma.js) проверяет select по схеме, как настоящая Prisma.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { prisma, pool } from "../prisma/prisma-client.js";
import { fakeDb, installFake, withApp, matches } from "./_fakePrisma.js";
import productRegisterRouter from "../api/router/productregister.js";
import salesRouter from "../api/router/sales.js";
import { _setRecomputeLockRunner } from "../services/recomputeCosting.js";
import {
	computeStockChangeShortages,
	assertStockForPosting,
	StockShortageError,
	formatShortageMessage,
	savedDocumentForCheck,
} from "../services/productRegister.js";

const D = (s) => new Date(`${s}T10:00:00+05:00`);
const user = { uuid: "u", username: "u", organizationUuid: "o", allowedOrgUuids: ["o"], isSuperAdmin: false, operatorDataAccess: true };
const mv = (id, documentType, documentUuid, documentId, movementType, quantity, warehouseUuid, date) => ({
	id, uuid: `pr-${id}`, documentType, documentUuid, documentId, movementType, quantity, amount: quantity * 100,
	productUuid: "p", warehouseUuid, organizationUuid: "o", date: D(date),
});
const refs = () => ({
	organization: [{ id: 1, uuid: "o", name: "Орг" }],
	warehouse: [{ id: 2, uuid: "wA", name: "Склад A", organizationUuid: "o" }, { id: 3, uuid: "wB", name: "Склад B", organizationUuid: "o" }],
	product: [{ id: 4, uuid: "p", name: "Товар", sku: "", isService: false }],
});

// Продано на основании резерва: saleItem с фильтром по связанной реализации (связей фейк не знает).
const saleItemsByBasis = ({ where }, db) => {
	const { sale: saleWhere, ...rest } = where ?? {};
	const sales = db._tables.sale ?? [];
	return (db._tables.saleItem ?? []).flatMap((it) => {
		const s = sales.find((x) => x.uuid === it.saleUuid);
		if (!s || !matches(it, rest) || !matches(s, saleWhere ?? {})) return [];
		return [{ productUuid: it.productUuid, quantity: it.quantity, sale: { basisDocumentUuid: s.basisDocumentUuid, warehouseUuid: s.warehouseUuid } }];
	});
};

// ─── КР-7: предпроверка пересохранения проведённого документа, все 4 расходных типа ───
const TYPES = {
	sale: { model: "sale", head: { warehouseUuid: "wA", basisDocumentType: null, basisDocumentUuid: null }, moves: [["out", "wA"]], body: { warehouseUuid: "wA" } },
	inventory_transfer: { model: "inventoryTransfer", head: { fromWarehouseUuid: "wA", toWarehouseUuid: "wB" }, moves: [["out", "wA"], ["in", "wB"]], body: { fromWarehouseUuid: "wA" } },
	purchase_return: { model: "purchaseReturn", head: { warehouseUuid: "wA", basisDocumentType: null, basisDocumentUuid: null }, moves: [["out", "wA"]], body: { warehouseUuid: "wA" } },
	write_off: { model: "writeOff", head: { warehouseUuid: "wA", basisDocumentType: null, basisDocumentUuid: null }, moves: [["out", "wA"]], body: { warehouseUuid: "wA" } },
};

function precheckSeed(type) {
	const t = TYPES[type];
	return {
		...refs(),
		[t.model]: [{ id: 50, uuid: "doc", number: "1", organizationUuid: "o", date: D("2026-09-02"), posted: true, deletedAt: null, ...t.head }],
		productRegister: [
			mv(1, "purchase", "pur-1", 1, "in", 10, "wA", "2026-09-01"),
			...t.moves.map(([dir, wh], i) => mv(2 + i, type, "doc", 50, dir, 10, wh, "2026-09-02")),
			// Перемещение: со склада-получателя уже продано — без его склада из сохранённого
			// документа приход «пропадал» бы, и была бы ложная нехватка на складе B.
			...(type === "inventory_transfer" ? [mv(9, "sale", "sale-9", 90, "out", 10, "wB", "2026-09-03")] : []),
		],
	};
}

for (const type of Object.keys(TYPES)) {
	test(`КР-7: пересохранение проведённого «${type}» с теми же строками — check-availability ok:true`, async () => {
		const restore = installFake(prisma, fakeDb(precheckSeed(type)), { pool });
		try {
			await withApp(express, productRegisterRouter, user, async (call) => {
				const r = await call("POST", "/product-register/check-availability", {
					organizationUuid: "o", date: D("2026-09-02").toISOString(), documentType: type, documentUuid: "doc",
					...TYPES[type].body, items: [{ productUuid: "p", quantity: 10 }],
				});
				assert.equal(r.status, 200);
				assert.equal(r.body.ok, true, `ложная нехватка: ${JSON.stringify(r.body.shortages)}`);
			});
		} finally {
			restore();
		}
	});
}

test("КР-7: выборка сохранённого документа — только поля модели (у перемещения нет основания)", async () => {
	const db = fakeDb(precheckSeed("inventory_transfer"));
	const saved = await savedDocumentForCheck("inventory_transfer", "doc", db);
	assert.deepEqual(saved, { id: 50, organizationUuid: "o", fromWarehouseUuid: "wA", toWarehouseUuid: "wB" });
	const sale = await savedDocumentForCheck("sale", "doc", fakeDb(precheckSeed("sale")));
	assert.equal(sale.basisDocumentType, null);
	assert.equal(await savedDocumentForCheck("unknown", "doc", db), null);
});

test("КР-7: сбой выборки документа не глушится — 500, а не ложная нехватка", async () => {
	const db = fakeDb(precheckSeed("inventory_transfer"), {
		overrides: { "inventoryTransfer.findUnique": async () => { throw new Error("db down"); } },
	});
	const restore = installFake(prisma, db, { pool });
	const origError = console.error;
	console.error = () => {};
	try {
		await withApp(express, productRegisterRouter, user, async (call) => {
			const r = await call("POST", "/product-register/check-availability", {
				organizationUuid: "o", documentType: "inventory_transfer", documentUuid: "doc", fromWarehouseUuid: "wA", items: [{ productUuid: "p", quantity: 10 }],
			});
			assert.equal(r.status, 500);
		});
	} finally {
		console.error = origError;
		restore();
	}
});

// ─── КР-8: резервы и хронология ───────────────────────────────────────────────
// Приход 10 (01.08), продажа 3 (05.08), приход 100 (01.09), резерв 100 (10.09): итог 107, свободно 7.
function reserveSeed() {
	return {
		...refs(),
		sale: [{ id: 60, uuid: "s1", organizationUuid: "o", date: D("2026-08-05"), posted: true, warehouseUuid: "wA", basisDocumentType: null, basisDocumentUuid: null, deletedAt: null }],
		saleItem: [{ id: 61, uuid: "si1", saleUuid: "s1", productUuid: "p", quantity: 3, deletedAt: null }],
		productRegister: [
			mv(1, "purchase", "pur-1", 1, "in", 10, "wA", "2026-08-01"),
			mv(2, "sale", "s1", 60, "out", 3, "wA", "2026-08-05"),
			mv(3, "purchase", "pur-2", 2, "in", 100, "wA", "2026-09-01"),
		],
		reservationRegister: [{ id: 70, reservationUuid: "res-1", productUuid: "p", warehouseUuid: "wA", quantity: 100, date: D("2026-09-10"), organizationUuid: "o" }],
	};
}
const reserveDb = () => fakeDb(reserveSeed(), { overrides: { "saleItem.findMany": saleItemsByBasis } });
const newSale = (date) => ({ organizationUuid: "o", warehouseUuid: "wA", date: D(date), posted: true, deletedAt: null });

test("КР-8: правка продажи задним числом 3→4 при резерве 100 (итог 106) — проходит", async () => {
	const db = reserveDb();
	const s1 = db._tables.sale[0];
	const found = await computeStockChangeShortages({ documentType: "sale", documentUuid: "s1", doc: s1, items: [{ productUuid: "p", quantity: 4 }] }, db);
	assert.deepEqual(found, []);
});

test("КР-8: новая продажа 20.08 на 2 шт. при резерве — проходит; та же сверх свободного — отказ с верным числом", async () => {
	const db = reserveDb();
	assert.deepEqual(await computeStockChangeShortages({ documentType: "sale", doc: newSale("2026-08-20"), items: [{ productUuid: "p", quantity: 2 }] }, db), []);
	const [s] = await computeStockChangeShortages({ documentType: "sale", doc: newSale("2026-09-27"), items: [{ productUuid: "p", quantity: 8 }] }, db);
	assert.equal(s.kind, "out");
	assert.equal(s.requested, 8);
	assert.equal(s.deficit, 1, "не хватает 1 (свободно 7), а не «94»");
	assert.equal(s.available, 7);
	assert.equal(s.reserved, 100);
	assert.match(formatShortageMessage([s]), /нужно 8, доступно 7 с учётом резерва 100 \(не хватает 1\)/);
});

test("КР-8: физическая нехватка в прошлом — отказ с датой и верным числом", async () => {
	const db = reserveDb();
	// 05.08: 10 − 3 − 11 = −4 (приход 100 — только 01.09).
	const [s] = await computeStockChangeShortages({ documentType: "sale", doc: newSale("2026-08-06"), items: [{ productUuid: "p", quantity: 11 }] }, db);
	assert.equal(s.deficit, 4);
	assert.equal(s.available, 7);
	assert.equal(s.reserved, undefined);
	assert.match(formatShortageMessage([s]), /нужно 11, доступно 7 \(не хватает 4\) — на 06\.08\.2026/);
});

test("КР-8: прежний «провал» истории — нехватка равна вкладу изменения, а не глубине провала", async () => {
	const db = reserveDb();
	// Старый провал: продажа 12 шт. 05.08 уже проведена (10 − 3 − 12 = −5 до прихода 01.09).
	db._tables.productRegister.push(mv(4, "sale", "s-old", 61, "out", 12, "wA", "2026-08-05"));
	const [s] = await computeStockChangeShortages({ documentType: "sale", doc: newSale("2026-08-06"), items: [{ productUuid: "p", quantity: 1 }] }, db);
	assert.equal(s.deficit, 1, "изменение ухудшило на 1, а не «не хватает 6»");
	assert.equal(s.available, 0);
});

// s10 инспектора: приход 5, резерв 5, черновик реализации 5.
function basisSeed() {
	return {
		...refs(),
		sale: [{ id: 80, uuid: "s2", number: "2", organizationUuid: "o", counterpartyUuid: "cp", date: D("2026-09-03"), posted: false, warehouseUuid: "wA", basisDocumentType: null, basisDocumentUuid: null, deletedAt: null, amount: 750, amountWithoutVat: 750, vatAmount: 0 }],
		saleItem: [{ id: 81, uuid: "si2", saleUuid: "s2", productUuid: "p", quantity: 5, price: 150, amount: 750, amountWithoutVat: 750, vatAmount: 0, vatRate: 0, deletedAt: null, organizationUuid: "o", posted: false }],
		reservation: [{ id: 90, uuid: "res-2", number: "1", organizationUuid: "o", counterpartyUuid: "cp", warehouseUuid: "wA", date: D("2026-09-02"), posted: true, deletedAt: null }],
		reservationRegister: [{ id: 91, reservationUuid: "res-2", productUuid: "p", warehouseUuid: "wA", quantity: 5, date: D("2026-09-02"), organizationUuid: "o" }],
		productRegister: [mv(1, "purchase", "pur-1", 1, "in", 5, "wA", "2026-09-01")],
		counterparty: [{ id: 92, uuid: "cp", name: "Покупатель", organizationUuid: "o" }],
		chartOfAccount: ["1330", "1210", "6010", "7010", "3130"].map((code, i) => ({ id: 100 + i, uuid: `acc-${code}`, code, name: code, organizationUuid: null, deletedAt: null })),
	};
}

test("КР-8: гард проведения исключает резерв-основание, переданное в prospectiveDoc", async () => {
	const db = fakeDb(basisSeed(), { overrides: { "saleItem.findMany": saleItemsByBasis } });
	await assert.rejects(() => assertStockForPosting("sale", "s2", {}, db), (e) => e instanceof StockShortageError && e.shortages[0].reserved === 5);
	await assertStockForPosting("sale", "s2", { basisDocumentType: "reservation", basisDocumentUuid: "res-2" }, db);
});

test("КР-8: PUT /sales — основание-резерв и «Провести» одним запросом проходит (предпроверка берёт основание из тела)", async () => {
	const db = fakeDb(basisSeed(), { overrides: { "saleItem.findMany": saleItemsByBasis } });
	const restore = installFake(prisma, db, { pool });
	_setRecomputeLockRunner(async () => ({ registers: 0, entries: 0 }));
	try {
		await withApp(express, salesRouter, user, async (call) => {
			const r = await call("PUT", "/sales/s2", { basisDocumentType: "reservation", basisDocumentUuid: "res-2", posted: true });
			assert.equal(r.status, 200, JSON.stringify(r.body));
			assert.equal(r.body.item.posted, true);
			assert.equal(r.body.item.basisDocumentUuid, "res-2");
		});
	} finally {
		_setRecomputeLockRunner(null);
		restore();
	}
});
