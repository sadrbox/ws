// ─────────────────────────────────────────────────────────────────────────────
// Регистр резервов товаров (жёсткий резерв).
//
// Зарезервированное по документу «Резервирование» количество уменьшает
// доступный для продажи остаток. Регистр пересобирается из позиций документа
// (идемпотентный reconcile) при любом его изменении и удаляется при удалении
// документа. Зеркалит подход productRegister.js.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";
import { inDocumentTransaction } from "./documentLock.js";
import { r4 } from "./money.js";

/**
 * Полный пересбор строк регистра резервов по документу «Резервирование».
 * Удаляет прежние строки и создаёт новые из текущих позиций (если документ не
 * удалён). Идемпотентно.
 */
export async function reconcileReservationRegister(reservationUuid, client = prisma) {
	if (!reservationUuid) return;
	// Удаление и запись — одной транзакцией под блокировкой документа, ошибка
	// пробрасывается (как у регистра товаров, У2 аудита 26.09).
	await inDocumentTransaction(client, "reservation", reservationUuid, async (tx) => {
		await tx.reservationRegister.deleteMany({ where: { reservationUuid } });

		const doc = await tx.reservation.findUnique({ where: { uuid: reservationUuid } });
		// Регистр движет только ПРОВЕДЁННЫЙ резерв — как и регистр товаров
		// (productRegister: doc.posted !== true → выходим). Иначе черновик резерва
		// молча уменьшал бы доступный к продаже остаток.
		if (!doc || doc.deletedAt || doc.posted !== true) return;

		const items = await tx.reservationItem.findMany({
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
		if (rows.length) await tx.reservationRegister.createMany({ data: rows });
	});
}

/** Удалить строки регистра по документу (при удалении документа «Резервирование»). */
export async function removeReservationRegister(reservationUuid, client = prisma) {
	if (!reservationUuid) return;
	await client.reservationRegister.deleteMany({ where: { reservationUuid } });
}

/**
 * Активный резерв по парам товар+склад (одним запросом на все пары).
 *
 * РЕЗЕРВ ЗАКРЫВАЕТСЯ РЕАЛИЗАЦИЕЙ (аудит 26.09): раньше проведённая реализация «на
 * основании» резерва его не гасила — зарезервированное продолжало уменьшать доступный
 * остаток и после отгрузки. Теперь активный остаток резерва = зарезервировано − уже
 * продано проведёнными реализациями на его основании (по товару и складу), не меньше 0.
 * Регистр при этом не переписывается: закрытие считается при чтении, поэтому
 * распроведение или удаление реализации сразу возвращает резерв.
 *
 * @param {Array<{productUuid:string, warehouseUuid:string|null}>} pairs
 * @param {string|null} excludeReservationUuid — резерв-основание самой проверяемой реализации
 * @returns {Promise<Map<string, number>>} `${productUuid}|${warehouseUuid??""}` → количество
 */
export async function reservedQuantities(pairs, excludeReservationUuid = null, client = prisma) {
	const out = new Map();
	const list = (pairs ?? []).filter((p) => p?.productUuid);
	if (!list.length) return out;
	const key = (p, w) => `${p}|${w ?? ""}`;
	const wanted = new Set(list.map((p) => key(p.productUuid, p.warehouseUuid)));
	const productUuids = [...new Set(list.map((p) => p.productUuid))];
	const where = { productUuid: { in: productUuids } };
	if (excludeReservationUuid) where.NOT = { reservationUuid: excludeReservationUuid };
	const rows = await client.reservationRegister.groupBy({
		by: ["reservationUuid", "productUuid", "warehouseUuid"],
		where,
		_sum: { quantity: true },
	});
	const relevant = rows.filter((r) => wanted.has(key(r.productUuid, r.warehouseUuid)));
	if (!relevant.length) return out;

	// Продано на основании этих резервов (проведённые, не удалённые реализации).
	const reservationUuids = [...new Set(relevant.map((r) => r.reservationUuid))];
	const soldRows = await client.saleItem.findMany({
		where: {
			deletedAt: null,
			productUuid: { in: productUuids },
			sale: { posted: true, deletedAt: null, basisDocumentType: "reservation", basisDocumentUuid: { in: reservationUuids } },
		},
		select: { productUuid: true, quantity: true, sale: { select: { basisDocumentUuid: true, warehouseUuid: true } } },
	});
	const sold = new Map(); // reservation|product|warehouse → qty
	for (const it of soldRows) {
		const k = `${it.sale?.basisDocumentUuid}|${key(it.productUuid, it.sale?.warehouseUuid)}`;
		sold.set(k, (sold.get(k) ?? 0) + (Number(it.quantity) || 0));
	}
	for (const r of relevant) {
		const pk = key(r.productUuid, r.warehouseUuid);
		const reserved = Number(r._sum?.quantity) || 0;
		const active = Math.max(0, reserved - (sold.get(`${r.reservationUuid}|${pk}`) ?? 0));
		out.set(pk, r4((out.get(pk) ?? 0) + active));
	}
	return out;
}

/**
 * Активный резерв по паре товар+склад (сумма quantity), исключая один документ
 * резервирования (excludeReservationUuid) — обычно это резерв-основание самой
 * реализации, который ею и закрывается. Обёртка над reservedQuantities.
 */
export async function reservedQuantity(productUuid, warehouseUuid, excludeReservationUuid, client = prisma) {
	if (!productUuid) return 0;
	const m = await reservedQuantities([{ productUuid, warehouseUuid: warehouseUuid ?? null }], excludeReservationUuid, client);
	return m.get(`${productUuid}|${warehouseUuid ?? ""}`) ?? 0;
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
	reservedQuantities,
	reconcileReservationByParentModel,
};
