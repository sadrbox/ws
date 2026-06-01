// ─────────────────────────────────────────────────────────────────────────────
// Регистр резервов товаров (жёсткий резерв).
//
// Зарезервированное по документу «Резервирование» количество уменьшает
// доступный для продажи остаток. Регистр пересобирается из позиций документа
// (идемпотентный reconcile) при любом его изменении и удаляется при удалении
// документа. Зеркалит подход productRegister.js.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

/**
 * Полный пересбор строк регистра резервов по документу «Резервирование».
 * Удаляет прежние строки и создаёт новые из текущих позиций (если документ не
 * удалён). Идемпотентно.
 */
export async function reconcileReservationRegister(reservationUuid, client = prisma) {
	if (!reservationUuid) return;
	try {
		await client.reservationRegister.deleteMany({ where: { reservationUuid } });

		const doc = await client.reservation.findUnique({ where: { uuid: reservationUuid } });
		if (!doc || doc.deletedAt) return; // удалённый резерв — без строк регистра

		const items = await client.reservationItem.findMany({
			where: { reservationUuid, deletedAt: null },
		});
		const rows = [];
		for (const it of items) {
			if (!it.productUuid) continue; // резервируем только товары (не услуги)
			const qty = Number(it.quantity) || 0;
			if (qty <= 0) continue;
			rows.push({
				date: doc.date ?? new Date(),
				quantity: qty,
				productUuid: it.productUuid,
				warehouseUuid: doc.warehouseUuid ?? null,
				organizationUuid: doc.organizationUuid ?? null,
				reservationUuid,
				reservationItemUuid: it.uuid ?? null,
			});
		}
		if (rows.length) await client.reservationRegister.createMany({ data: rows });
	} catch (err) {
		console.error(`reconcileReservationRegister(${reservationUuid}) error:`, err);
	}
}

/** Удалить строки регистра по документу (при удалении документа «Резервирование»). */
export async function removeReservationRegister(reservationUuid, client = prisma) {
	if (!reservationUuid) return;
	try {
		await client.reservationRegister.deleteMany({ where: { reservationUuid } });
	} catch (err) {
		console.error(`removeReservationRegister(${reservationUuid}) error:`, err);
	}
}

/**
 * Активный резерв по паре товар+склад (сумма quantity), исключая один документ
 * резервирования (excludeReservationUuid) — обычно это резерв-основание самой
 * реализации, который ею и закрывается.
 */
export async function reservedQuantity(productUuid, warehouseUuid, excludeReservationUuid, client = prisma) {
	if (!productUuid) return 0;
	const where = { productUuid, warehouseUuid: warehouseUuid ?? null };
	if (excludeReservationUuid) where.NOT = { reservationUuid: excludeReservationUuid };
	const result = await client.reservationRegister.aggregate({ where, _sum: { quantity: true } });
	return Math.round((Number(result._sum.quantity) || 0) * 10000) / 10000;
}

/** Пересбор по prisma-модели (для фабрики позиций, знающей только PARENT_MODEL). */
export async function reconcileReservationByParentModel(parentModel, parentUuid, client = prisma) {
	if (parentModel !== "reservation") return;
	await reconcileReservationRegister(parentUuid, client);
}

export default {
	reconcileReservationRegister,
	removeReservationRegister,
	reservedQuantity,
	reconcileReservationByParentModel,
};
