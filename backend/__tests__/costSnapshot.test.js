// ─────────────────────────────────────────────────────────────────────────────
// Снапшоты себестоимости (материализация ФИФО-слоёв на границе закрытого периода).
//
// ГЛАВНОЕ свойство безопасности: снапшот — ЧИСТАЯ оптимизация. Старт costing от
// материализованных слоёв ОБЯЗАН давать ту же себестоимость, что и полное
// переигрывание истории движений. Если это не так — снапшот искажает COGS.
//
// Запуск: npm test  (из backend). Требует доступ к БД и базовые справочники.
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import { buildSnapshotsAt, deleteSnapshotsAfter, getSnapshotFor } from "../services/costSnapshot.js";
import { createCostingContext } from "../services/accountingPosting.js";

const DAY = 86400000;
let fx = {};

before(async () => {
	const [org, user] = await Promise.all([
		prisma.organization.findFirst({ select: { uuid: true } }),
		prisma.user.findFirst({ select: { uuid: true } }),
	]);
	fx = { orgUuid: org?.uuid, userUuid: user?.uuid };
});

after(async () => {
	await prisma.$disconnect();
});

/**
 * Изолированный товар+склад с историей: приход 10×100 (день −10), приход 10×200
 * (день −5), расход 5 (день −2). Граница закрытого периода — день −3 (между
 * последним приходом и расходом), поэтому «хвост» после снапшота непустой.
 */
async function seedHistory() {
	const product = await prisma.product.create({
		data: { name: `__test_snap_${crypto.randomUUID().slice(0, 8)}`, organizationUuid: fx.orgUuid },
	});
	const wh = await prisma.warehouse.create({
		data: { name: `W-SNAP-${crypto.randomUUID().slice(0, 8)}`, organizationUuid: fx.orgUuid },
	});
	const base = {
		productUuid: product.uuid, warehouseUuid: wh.uuid, organizationUuid: fx.orgUuid,
		documentType: "purchase",
	};
	const now = Date.now();
	await prisma.productRegister.create({ data: { ...base, date: new Date(now - 10 * DAY), movementType: "in", quantity: 10, amount: 1000, documentUuid: crypto.randomUUID() } });
	await prisma.productRegister.create({ data: { ...base, date: new Date(now - 5 * DAY), movementType: "in", quantity: 10, amount: 2000, documentUuid: crypto.randomUUID() } });
	await prisma.productRegister.create({ data: { ...base, date: new Date(now - 2 * DAY), movementType: "out", quantity: 5, amount: 500, documentType: "sale", documentUuid: crypto.randomUUID() } });

	return { product, wh, boundary: new Date(now - 3 * DAY), evalDate: new Date(now) };
}

async function cleanup({ product, wh, boundary }) {
	await prisma.productCostSnapshot.deleteMany({ where: { organizationUuid: fx.orgUuid, asOfDate: boundary } }).catch(() => {});
	await prisma.productRegister.deleteMany({ where: { productUuid: product.uuid } }).catch(() => {});
	await prisma.warehouse.delete({ where: { uuid: wh.uuid } }).catch(() => {});
	await prisma.product.delete({ where: { uuid: product.uuid } }).catch(() => {});
}

test("Снапшот материализует остаток и ФИФО-слои на границе (движения ПОСЛЕ границы не входят)", async (t) => {
	if (!fx.orgUuid) return t.skip("нет фикстур");
	const h = await seedHistory();
	try {
		const built = await buildSnapshotsAt(fx.orgUuid, h.boundary);
		assert.ok(built >= 1, "снят хотя бы один снапшот");

		const snap = await getSnapshotFor(fx.orgUuid, h.product.uuid, h.wh.uuid, h.boundary);
		assert.ok(snap, "снапшот по товару+складу найден");
		// На границе: только два прихода (расход дня −2 — ПОСЛЕ границы, не входит).
		assert.equal(Number(snap.quantity), 20, "остаток на границе = 10 + 10");
		assert.equal(Number(snap.value), 3000, "стоимость остатка = 1000 + 2000");
		assert.deepEqual(
			snap.layers.map((l) => ({ q: Number(l.q), unit: Number(l.unit) })),
			[{ q: 10, unit: 100 }, { q: 10, unit: 200 }],
			"ФИФО-слои oldest→newest",
		);
	} finally {
		await cleanup(h);
	}
});

test("Снапшот — чистая оптимизация: старт от слоёв ≡ полное переигрывание (FIFO и AVERAGE)", async (t) => {
	if (!fx.orgUuid) return t.skip("нет фикстур");
	const h = await seedHistory();
	try {
		await buildSnapshotsAt(fx.orgUuid, h.boundary);

		for (const method of ["FIFO", "AVERAGE"]) {
			// Метод задаём ПРЯМО в контексте (beginDocument), а НЕ через настройки
			// организации: настройка общая, а node --test гоняет файлы параллельно на
			// одной БД → мутация costingMethod ломала бы COGS-тесты соседних файлов.
			const ctxFull = await createCostingContext(fx.orgUuid, h.evalDate, {});
			ctxFull.beginDocument(method, null, null);
			const ctxSnap = await createCostingContext(fx.orgUuid, h.evalDate, { boundary: h.boundary });
			ctxSnap.beginDocument(method, null, null);

			// Оценка на дату ПОСЛЕ границы: без boundary — полный replay истории,
			// с boundary — старт от снапшота + только хвост движений.
			const full = await ctxFull.unitCost(h.product.uuid, h.wh.uuid, h.evalDate, 7, { consume: false });
			const viaSnap = await ctxSnap.unitCost(h.product.uuid, h.wh.uuid, h.evalDate, 7, { consume: false });

			assert.equal(viaSnap, full, `${method}: снапшот не должен менять себестоимость`);

			if (method === "FIFO") {
				// Остаток после расхода 5 (списаны из слоя 100): 5×100 + 10×200.
				// Списываем 7 → 5×100 + 2×200 = 900 → удельная 900/7.
				assert.equal(full, 900 / 7, "FIFO: 5×100 + 2×200 на 7 ед");
			} else {
				// Средняя: (3000/20)=150; расход по средней её не меняет.
				assert.equal(full, 150, "AVERAGE: 3000/20 = 150");
			}
		}
	} finally {
		await cleanup(h);
	}
});

test("deleteSnapshotsAfter снимает снапшоты позже границы (откат закрытия периода)", async (t) => {
	if (!fx.orgUuid) return t.skip("нет фикстур");
	const h = await seedHistory();
	try {
		await buildSnapshotsAt(fx.orgUuid, h.boundary);
		assert.ok(await getSnapshotFor(fx.orgUuid, h.product.uuid, h.wh.uuid, h.boundary), "снапшот есть");

		// Граница уехала НАЗАД (закрытие распроведено) → снапшот на старой границе снят.
		const earlier = new Date(h.boundary.getTime() - DAY);
		await deleteSnapshotsAfter(fx.orgUuid, earlier);
		assert.equal(
			await getSnapshotFor(fx.orgUuid, h.product.uuid, h.wh.uuid, h.boundary),
			null,
			"снапшот позже новой границы удалён",
		);
	} finally {
		await cleanup(h);
	}
});
