// ─────────────────────────────────────────────────────────────────────────────
// ВВОД ОСТАТКОВ СЕРИЙ / ПАРТИЙ.
//
// ЗАЧЕМ. Учёт по сериям/партиям включают на товар, у которого УЖЕ есть остаток,
// набранный приходами без маркировки. После включения система требует серию (или
// партию) на каждую единицу выбытия — а под остаток их не существует и взять
// неоткуда. Товар становится непродаваемым: остаток есть, продать нельзя.
// Здесь — механизм «разметить существующий остаток», не меняя его количества.
//
// СЕРИИ — просто. Серии живут в отдельной таблице (SerialNumber) и регистра не
// касаются: создаём записи со статусом in_stock и receiptDocType="opening_balance".
// Количество ограничено «дырой» = остаток по регистру − уже заведённые серии.
//
// ПАРТИИ — сложнее, и вот почему. Остаток по партии считается из строк РЕГИСТРА
// (`productRegister.batchUuid`), а строки регистра ПЕРЕСОБИРАЮТСЯ из документов
// (reconcileDocumentRegister удаляет их по documentUuid и пишет заново). Поэтому
// «дописать партию» в старые строки НЕЛЬЗЯ — правку сотрёт при первом же сохранении
// того документа.
//
// Решение — ПЕРЕМАРКИРОВКА: пара движений одной датой (расход немаркированного
// остатка + приход того же количества уже с партией). Количество на складе не
// меняется, стоимость сохраняется (amount обоих движений равен себестоимости
// снимаемого остатка). Строки помечены documentType="opening_balance" и синтетическим
// documentUuid — ни reconcile (удаляет по documentUuid), ни recomputeCosting
// (перебирает только 8 типов документов-регистраторов) их не затрагивают.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import { resolveUnitCost } from "./accountingPosting.js";
import { normalizeSerials } from "./serialNumbers.js";
import { warehouseBatchBalances } from "./batches.js";

export const OPENING_DOC_TYPE = "opening_balance";

/** Ошибка ввода остатков — роутер отдаёт 422 (это ошибка ДАННЫХ, не сбой). */
export class OpeningBalanceError extends Error {
	constructor(message) {
		super(message);
		this.name = "OpeningBalanceError";
	}
}

/** Express-хелпер: OpeningBalanceError → 422. */
export function respondOpeningBalanceError(err, res) {
	if (err instanceof OpeningBalanceError) {
		res.status(422).json({ success: false, message: err.message });
		return true;
	}
	return false;
}

/** Остаток товара по регистру (приход − расход). Без склада — по всем складам
 *  (нужно для предупреждения при включении учёта: «у товара есть остаток»). */
async function stockOf(productUuid, warehouseUuid, organizationUuid, client = prisma) {
	const where = {
		productUuid,
		...(warehouseUuid ? { warehouseUuid } : {}),
		...(organizationUuid ? { organizationUuid } : {}),
	};
	const [i, o] = await Promise.all([
		client.productRegister.aggregate({ where: { ...where, movementType: "in" }, _sum: { quantity: true } }),
		client.productRegister.aggregate({ where: { ...where, movementType: "out" }, _sum: { quantity: true } }),
	]);
	return Number(i._sum.quantity ?? 0) - Number(o._sum.quantity ?? 0);
}

/** Товар уже участвует в учёте — есть движения регистра (приход/расход). */
async function movementsCount(productUuid, warehouseUuid, organizationUuid, client = prisma) {
	return client.productRegister.count({
		where: {
			productUuid,
			...(warehouseUuid ? { warehouseUuid } : {}),
			...(organizationUuid ? { organizationUuid } : {}),
		},
	});
}

/**
 * Сколько единиц остатка ещё НЕ размечено сериями.
 * @returns {{stock:number, marked:number, gap:number, movements:number}}
 *   movements — число движений товара: >0 значит товар УЖЕ в учёте (даже если
 *   остаток нулевой), и включение учёта повлияет на дальнейшую работу.
 */
export async function serialGap({ productUuid, warehouseUuid = null, organizationUuid = null }, client = prisma) {
	const stock = await stockOf(productUuid, warehouseUuid, organizationUuid, client);
	const marked = await client.serialNumber.count({
		where: {
			productUuid,
			...(warehouseUuid ? { warehouseUuid } : {}),
			status: "in_stock", deletedAt: null,
		},
	});
	return {
		stock, marked, gap: Math.max(0, stock - marked),
		movements: await movementsCount(productUuid, warehouseUuid, organizationUuid, client),
	};
}

/**
 * Сколько единиц остатка ещё НЕ размечено партиями.
 * @returns {{stock:number, marked:number, gap:number}}
 */
export async function batchGap({ productUuid, warehouseUuid = null, organizationUuid = null }, client = prisma) {
	const stock = await stockOf(productUuid, warehouseUuid, organizationUuid, client);
	let marked = 0;
	if (warehouseUuid) {
		const balances = await warehouseBatchBalances({ organizationUuid, warehouseUuid, productUuid }, client);
		for (const q of balances.values()) marked += Number(q) || 0;
	} else {
		// Без склада: суммарно по всем складам (для предупреждения при включении учёта).
		const rows = await client.productRegister.findMany({
			where: { productUuid, batchUuid: { not: null }, ...(organizationUuid ? { organizationUuid } : {}) },
			select: { movementType: true, quantity: true },
		});
		for (const r of rows) marked += (r.movementType === "in" ? 1 : -1) * (Number(r.quantity) || 0);
	}
	return {
		stock, marked: Math.max(0, marked),
		gap: Math.max(0, stock - Math.max(0, marked)),
		movements: await movementsCount(productUuid, warehouseUuid, organizationUuid, client),
	};
}

/**
 * Ввод остатков СЕРИЙ: привязать серии к уже имеющемуся остатку.
 * Регистр НЕ трогаем — серии в нём не участвуют.
 */
export async function addOpeningSerials(
	{ productUuid, warehouseUuid, organizationUuid = null, serials },
	client = prisma,
) {
	if (!productUuid || !warehouseUuid) {
		throw new OpeningBalanceError("Укажите товар и склад");
	}
	const product = await client.product.findUnique({
		where: { uuid: productUuid },
		select: { name: true, trackSerialNumbers: true },
	});
	if (!product) throw new OpeningBalanceError("Товар не найден");
	if (!product.trackSerialNumbers) {
		throw new OpeningBalanceError(`«${product.name}»: учёт по серийным номерам выключен — вводить серии незачем`);
	}

	const list = normalizeSerials(serials);
	if (!list.length) throw new OpeningBalanceError("Не указано ни одного серийного номера");

	// Нельзя разметить больше, чем реально лежит на складе.
	const { stock, marked, gap } = await serialGap({ productUuid, warehouseUuid, organizationUuid }, client);
	if (list.length > gap) {
		throw new OpeningBalanceError(
			`Остаток «${product.name}» на складе — ${stock} шт, из них уже размечено ${marked}. ` +
			`Можно ввести ещё ${gap}, а указано ${list.length}.`,
		);
	}

	// Серия не может принадлежать двум товарам/экземплярам одновременно.
	const conflicts = await client.serialNumber.findMany({
		where: { serialNumber: { in: list }, productUuid, deletedAt: null },
		select: { serialNumber: true },
	});
	if (conflicts.length) {
		throw new OpeningBalanceError(
			`Эти серии уже заведены: ${conflicts.map((c) => c.serialNumber).join(", ")}`,
		);
	}

	await client.serialNumber.createMany({
		data: list.map((serialNumber) => ({
			serialNumber,
			productUuid,
			warehouseUuid,
			organizationUuid,
			status: "in_stock",
			receiptDocType: OPENING_DOC_TYPE,
		})),
	});
	return { created: list.length, ...(await serialGap({ productUuid, warehouseUuid, organizationUuid }, client)) };
}

/**
 * Ввод остатков ПАРТИЙ: перевести часть немаркированного остатка в партию.
 *
 * Пишет ПАРУ движений одной датой (расход без партии + приход с партией) на одно и
 * то же количество и одну и ту же стоимость: количество на складе не меняется,
 * стоимость сохраняется. См. шапку файла — почему нельзя просто дописать batchUuid
 * в старые строки.
 */
export async function addOpeningBatch(
	{ productUuid, warehouseUuid, organizationUuid = null, batchNumber, expiryDate = null, quantity },
	client = prisma,
) {
	if (!productUuid || !warehouseUuid) throw new OpeningBalanceError("Укажите товар и склад");
	const qty = Number(quantity) || 0;
	if (qty <= 0) throw new OpeningBalanceError("Количество должно быть больше нуля");
	if (!batchNumber || !String(batchNumber).trim()) throw new OpeningBalanceError("Укажите номер партии");

	const product = await client.product.findUnique({
		where: { uuid: productUuid },
		select: { name: true, trackBatches: true },
	});
	if (!product) throw new OpeningBalanceError("Товар не найден");
	if (!product.trackBatches) {
		throw new OpeningBalanceError(`«${product.name}»: учёт по партиям выключен — вводить партии незачем`);
	}

	const { stock, marked, gap } = await batchGap({ productUuid, warehouseUuid, organizationUuid }, client);
	if (qty > gap) {
		throw new OpeningBalanceError(
			`Остаток «${product.name}» на складе — ${stock} шт, из них уже размечено ${marked}. ` +
			`Можно разметить ещё ${gap}, а указано ${qty}.`,
		);
	}

	// Себестоимость снимаемого остатка — её же переносим в приход, чтобы
	// перемаркировка не изменила стоимость запаса.
	const unit = await resolveUnitCost(organizationUuid, productUuid, warehouseUuid, new Date(), qty);
	const amount = Math.round((Number(unit) || 0) * qty * 100) / 100;

	const batch = await client.productBatch.create({
		data: {
			batchNumber: String(batchNumber).trim(),
			expiryDate: expiryDate ? new Date(expiryDate) : null,
			productUuid,
			organizationUuid,
		},
	});

	// Синтетический «документ»: reconcile удаляет строки по documentUuid, а
	// recomputeCosting перебирает только документы-регистраторы — эти строки
	// не будут стёрты ни тем, ни другим.
	const documentUuid = crypto.randomUUID();
	const date = new Date();
	const base = { date, productUuid, warehouseUuid, organizationUuid, documentType: OPENING_DOC_TYPE, documentUuid };

	await client.productRegister.createMany({
		data: [
			{ ...base, movementType: "out", quantity: qty, amount },                    // снимаем немаркированный
			{ ...base, movementType: "in", quantity: qty, amount, batchUuid: batch.uuid }, // возвращаем уже с партией
		],
	});

	return {
		batchUuid: batch.uuid,
		quantity: qty,
		amount,
		...(await batchGap({ productUuid, warehouseUuid, organizationUuid }, client)),
	};
}

export default {
	serialGap, batchGap, addOpeningSerials, addOpeningBatch,
	OpeningBalanceError, respondOpeningBalanceError, OPENING_DOC_TYPE,
};
