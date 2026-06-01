// ─────────────────────────────────────────────────────────────────────────────
// Тесты жёсткого резерва: регистр резервов уменьшает доступный для продажи
// остаток, а резерв-основание самой реализации исключается из вычитания.
//
// Запуск: npm test  (из backend). Требует доступ к БД и базовые справочники.
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import { computeShortages } from "../services/productRegister.js";
import {
	reconcileReservationRegister,
	removeReservationRegister,
	reservedQuantity,
} from "../services/reservationRegister.js";

let fx = {};

before(async () => {
	const [org, warehouse, user] = await Promise.all([
		prisma.organization.findFirst({ select: { uuid: true } }),
		prisma.warehouse.findFirst({ select: { uuid: true } }),
		prisma.user.findFirst({ select: { uuid: true } }),
	]);
	fx = { orgUuid: org?.uuid, warehouseUuid: warehouse?.uuid, userUuid: user?.uuid };
});

after(async () => {
	await prisma.$disconnect();
});

test("Жёсткий резерв: уменьшает доступный остаток; резерв-основание реализации исключается", async (t) => {
	if (!fx.orgUuid || !fx.warehouseUuid || !fx.userUuid) return t.skip("нет фикстур");

	// Изолированный товар, остаток 100 на складе (приход в регистре товаров).
	const product = await prisma.product.create({
		data: { name: `__test_reserve_${Date.now()}`, organizationUuid: fx.orgUuid },
	});
	const stockRow = await prisma.productRegister.create({
		data: {
			date: new Date(Date.now() - 86400000), movementType: "in", quantity: 100, amount: 100000,
			productUuid: product.uuid, warehouseUuid: fx.warehouseUuid, organizationUuid: fx.orgUuid,
			documentType: "purchase", documentUuid: crypto.randomUUID(),
		},
	});

	// Резерв 30 ед. по этому товару/складу.
	const reservation = await prisma.reservation.create({
		data: {
			date: new Date(), organizationUuid: fx.orgUuid, warehouseUuid: fx.warehouseUuid,
			authorUuid: fx.userUuid,
		},
	});
	const resItem = await prisma.reservationItem.create({
		data: { reservationUuid: reservation.uuid, productUuid: product.uuid, quantity: 30, price: 1000, amount: 30000 },
	});

	try {
		await reconcileReservationRegister(reservation.uuid);

		// Регистр резервов отражает 30.
		const reserved = await reservedQuantity(product.uuid, fx.warehouseUuid, null);
		assert.equal(reserved, 30, "активный резерв = 30");

		const saleDoc = { warehouseUuid: fx.warehouseUuid };
		const items = [{ productUuid: product.uuid, quantity: 80 }];

		// Продажа 80 при остатке 100 и резерве 30 → доступно 70 → дефицит 10.
		const shortages = await computeShortages({ documentType: "sale", doc: saleDoc, items });
		assert.equal(shortages.length, 1, "должен быть дефицит (доступно 70 < 80)");
		assert.equal(shortages[0].available, 70, "доступно = 100 − 30 резерв");
		assert.equal(shortages[0].deficit, 10);

		// Та же продажа, но НА ОСНОВАНИИ этого резерва → резерв исключается →
		// доступно 100 → дефицита нет.
		const saleFromReserve = { warehouseUuid: fx.warehouseUuid, basisDocumentType: "reservation", basisDocumentUuid: reservation.uuid };
		const shortages2 = await computeShortages({ documentType: "sale", doc: saleFromReserve, items });
		assert.equal(shortages2.length, 0, "реализация по своему резерву не блокируется");

		// Удаление резерва освобождает остаток.
		await removeReservationRegister(reservation.uuid);
		const reservedAfter = await reservedQuantity(product.uuid, fx.warehouseUuid, null);
		assert.equal(reservedAfter, 0, "после удаления резерва — 0");
	} finally {
		await prisma.reservationRegister.deleteMany({ where: { reservationUuid: reservation.uuid } }).catch(() => {});
		await prisma.reservationItem.delete({ where: { uuid: resItem.uuid } }).catch(() => {});
		await prisma.reservation.delete({ where: { uuid: reservation.uuid } }).catch(() => {});
		await prisma.productRegister.delete({ where: { uuid: stockRow.uuid } }).catch(() => {});
		await prisma.product.delete({ where: { uuid: product.uuid } }).catch(() => {});
	}
});
