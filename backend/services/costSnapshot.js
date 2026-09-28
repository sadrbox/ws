// ─────────────────────────────────────────────────────────────────────────────
// Снапшоты себестоимости на границе закрытого периода (материализация ФИФО-слоёв).
//
// Мотивация: costing (fifoCost/avgCost) переигрывает ВСЮ историю движений товара.
// После инварианта регистра фаза 2 (проводки) читает себестоимость из регистра, но
// фаза 1 (пересбор регистра) всё ещё оценивает каждый документ хвоста, читая всю
// историю слоёв → при длинной истории дорого. Снапшот хранит остаточные ФИФО-слои
// (и остаток qty/value) по паре товар+склад НА конец закрытого периода; costing
// стартует от снапшота и переигрывает только движения ПОСЛЕ его даты.
//
// БЕЗОПАСНОСТЬ (чистая оптимизация): снапшот берётся только на границе ≤ закрытого
// периода (период неизменен → снапшот стабилен). Товары, у которых остаток в истории
// уходил в минус ИЛИ на дату снапшота отрицателен, НЕ снимаются — costing по ним
// падает на полный replay. Любая операция, перестраивающая закрытую историю (полный
// recomputeCosting / reconcile-all / удаление month_close), удаляет снапшоты.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";
import { compareMovements } from "./costingReplay.js";
import { withLongStatements } from "./documentLock.js";
import { r2, r4, roundTo } from "./money.js";

// Округления — общие из money.js (P3 аудита 27.09): прежние `Math.round(x*100)/100` теряли
// «половинки» (1.005 → 1.00).
const r6 = (n) => roundTo(n, 6);
const EPS = 1e-6;

/**
 * Построить снапшоты себестоимости организации ПО состоянию на asOfDate (вкл.).
 * Полностью заменяет снапшоты этой организации с этой же asOfDate.
 *
 * @returns {Promise<number>} число снятых снапшотов (чистых товаров).
 */
export async function buildSnapshotsAt(organizationUuid, asOfDate, client = prisma) {
	if (!organizationUuid || !asOfDate) return 0;
	// Вся история регистра до границы — на большой базе дольше 30 с пула: свой предел запроса
	// (КР-15 аудита 27.09), а замена снапшотов (удалить + записать) — одной транзакцией.
	return withLongStatements(client, (c) => buildSnapshotsIn(organizationUuid, asOfDate, c));
}

async function buildSnapshotsIn(organizationUuid, asOfDate, client) {
	// Порядок — единый порядок регистра (compareMovements: при равной дате приход раньше
	// расхода, затем тип и id документа), как у себестоимости в проводках (У8 аудита 26.09).
	const rows = (await client.productRegister.findMany({
		where: { organizationUuid, date: { lte: asOfDate } },
		select: { id: true, date: true, documentType: true, documentId: true, productUuid: true, warehouseUuid: true, movementType: true, quantity: true, amount: true },
		orderBy: [{ date: "asc" }, { documentId: "asc" }, { id: "asc" }],
	})).sort(compareMovements);

	// Группируем по товар|склад и последовательно проигрываем ФИФО + среднюю.
	const groups = new Map();
	for (const r of rows) {
		if (!r.productUuid || !r.warehouseUuid) continue;
		const key = `${r.productUuid}|${r.warehouseUuid}`;
		let g = groups.get(key);
		if (!g) {
			g = { productUuid: r.productUuid, warehouseUuid: r.warehouseUuid, layers: [], avgQty: 0, avgValue: 0, minQty: 0, clean: true };
			groups.set(key, g);
		}
		const q = Number(r.quantity) || 0;
		if (q <= 0) continue;
		if (r.movementType === "in") {
			const amt = Number(r.amount) || 0;
			g.layers.push({ q, unit: q > 0 ? amt / q : 0 });
			g.avgQty += q;
			g.avgValue += amt;
		} else {
			// Расход: ФИФО — списываем старейшие слои; средняя — по текущей средней.
			const avg = g.avgQty > EPS ? g.avgValue / g.avgQty : 0;
			g.avgQty -= q;
			g.avgValue -= avg * q;
			if (g.avgQty < g.minQty) g.minQty = g.avgQty;
			if (g.avgQty < -EPS) g.clean = false; // уход в минус — снапшот не берём
			let need = q;
			while (need > EPS && g.layers.length) {
				const layer = g.layers[0];
				const take = Math.min(need, layer.q);
				layer.q -= take;
				need -= take;
				if (layer.q <= EPS) g.layers.shift();
			}
			if (need > EPS) g.clean = false; // списание сверх слоёв — нечисто
		}
	}

	await client.productCostSnapshot.deleteMany({ where: { organizationUuid, asOfDate } });

	const data = [];
	for (const g of groups.values()) {
		if (!g.clean) continue; // нечистый товар → costing уйдёт в полный replay
		if (g.avgQty < -EPS) continue;
		const layers = g.layers.filter((l) => l.q > EPS).map((l) => ({ q: r4(l.q), unit: r6(l.unit) }));
		const quantity = r4(g.avgQty);
		if (quantity <= EPS && layers.length === 0) continue; // нулевой остаток не храним
		data.push({
			organizationUuid,
			productUuid: g.productUuid,
			warehouseUuid: g.warehouseUuid,
			asOfDate,
			quantity,
			value: r2(g.avgValue), // средняя-стоимость остатка (для AVERAGE-старта)
			layers, // ФИФО-слои (для FIFO-старта); Σ q*unit — ФИФО-стоимость (≠ value)
		});
	}
	if (data.length) await client.productCostSnapshot.createMany({ data });
	return data.length;
}

/**
 * Удалить снапшоты организации с asOfDate ПОЗЖЕ границы (или все, если граница null).
 * Вызывается при перестройке закрытой истории / сдвиге границы назад.
 */
export async function deleteSnapshotsAfter(organizationUuid, boundary = null, client = prisma) {
	const where = organizationUuid ? { organizationUuid } : {};
	if (boundary) where.asOfDate = { gt: boundary };
	await client.productCostSnapshot.deleteMany({ where });
}

/**
 * Снапшот на границе закрытого периода для пары товар+склад: последний с
 * asOfDate ≤ boundary. Возвращает {asOfDate, quantity, value, layers} или null.
 */
export async function getSnapshotFor(organizationUuid, productUuid, warehouseUuid, boundary, client = prisma) {
	if (!organizationUuid || !productUuid || !warehouseUuid || !boundary) return null;
	const snap = await client.productCostSnapshot.findFirst({
		where: { organizationUuid, productUuid, warehouseUuid, asOfDate: { lte: boundary } },
		orderBy: { asOfDate: "desc" },
		select: { asOfDate: true, quantity: true, value: true, layers: true },
	});
	return snap ?? null;
}

export default { buildSnapshotsAt, deleteSnapshotsAfter, getSnapshotFor };
