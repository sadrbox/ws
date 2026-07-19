// ─────────────────────────────────────────────────────────────────────────────
// Mock-данные для демонстрации партий (FEFO) и серийных номеров (T6.1).
// Запуск:  node prisma/seed-batch-serial-mock.js
// Идемпотентно: повторный запуск не плодит дубли (ищет по имени товара/номеру док-та).
//
// Создаёт:
//   • партионный товар «Молоко 1л (FEFO-демо)» + 3 партии с разными сроками годности;
//   • серийный товар «Ноутбук (демо серий)»;
//   • проведённое «Оприходование», которое приходует партии на склад (движения
//     регистра с batchUuid) и заводит серии ноутбука.
// После — печатает FEFO-порядок доступных партий.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./prisma-client.js";
import { reconcileDocumentRegister } from "../services/productRegister.js";
import { findOrCreateBatch, availableBatchesFEFO } from "../services/batches.js";
import { setReceiptSerials, issueSerials } from "../services/serialNumbers.js";
import { serialGap, batchGap } from "../services/openingBalance.js";

const day = (offset) => new Date(Date.now() + offset * 86400000);

async function ensureProduct(name, data) {
	const ex = await prisma.product.findFirst({ where: { name } });
	if (ex) return prisma.product.update({ where: { uuid: ex.uuid }, data });
	return prisma.product.create({ data: { name, ...data } });
}

async function main() {
	// Берём организацию, У КОТОРОЙ ЕСТЬ СКЛАД, а не первую попавшуюся: организации
	// из интеграции с 1С складов не имеют, и скрипт молча падал на «нужен склад».
	const wh = await prisma.warehouse.findFirst({
		where: { deletedAt: null, organizationUuid: { not: null } },
		select: { uuid: true, name: true, organizationUuid: true },
		orderBy: { id: "asc" },
	});
	const org = wh
		? await prisma.organization.findUnique({ where: { uuid: wh.organizationUuid }, select: { uuid: true, name: true } })
		: null;
	const uom = await prisma.unitOfMeasure.findFirst({ select: { uuid: true } });
	const user = await prisma.user.findFirst({ select: { uuid: true } });
	if (!org || !wh || !user) { console.error("Нужны организация, склад и пользователь в БД."); process.exit(1); }
	console.log(`Организация: ${org.name} | Склад: ${wh.name}`);

	// ── Товары ────────────────────────────────────────────────────────────────
	const milk = await ensureProduct("Молоко 1л (FEFO-демо)", { trackBatches: true, unitOfMeasureUuid: uom?.uuid ?? null, organizationUuid: org.uuid });
	const laptop = await ensureProduct("Ноутбук (демо серий)", { trackSerialNumbers: true, unitOfMeasureUuid: uom?.uuid ?? null, organizationUuid: org.uuid });
	console.log(`Товары: «${milk.name}» (партии), «${laptop.name}» (серии)`);

	// ── Партии молока: три срока годности (FEFO ⇒ раньше истекает — раньше уходит) ──
	const batchDefs = [
		{ batchNumber: "M-2609", expiryDate: day(9), qty: 30 },   // истекает через 9 дней — уйдёт ПЕРВЫМ
		{ batchNumber: "M-2620", expiryDate: day(20), qty: 40 },
		{ batchNumber: "M-2640", expiryDate: day(40), qty: 50 },  // истекает позже — уйдёт последним
	];

	// ── Оприходование партий молока ─────────────────────────────────────────────
	const grNumber = "ОПРХ-ДЕМО-МОЛОКО";
	let gr = await prisma.goodsReceipt.findFirst({ where: { number: grNumber } });
	if (!gr) {
		gr = await prisma.goodsReceipt.create({ data: { number: grNumber, date: day(-1), organizationUuid: org.uuid, warehouseUuid: wh.uuid, authorUuid: user.uuid, posted: true } });
	}
	// строки под каждую партию (идемпотентно: пересоздаём строки документа)
	await prisma.goodsReceiptItem.deleteMany({ where: { goodsReceiptUuid: gr.uuid } });
	for (const b of batchDefs) {
		const batch = await findOrCreateBatch({ productUuid: milk.uuid, batchNumber: b.batchNumber, expiryDate: b.expiryDate, organizationUuid: org.uuid });
		await prisma.goodsReceiptItem.create({ data: {
			goodsReceiptUuid: gr.uuid, productUuid: milk.uuid, quantity: b.qty, price: 400, amount: b.qty * 400,
			unitOfMeasureUuid: uom?.uuid ?? null, organizationUuid: org.uuid, batchUuid: batch.uuid,
		} });
	}
	await reconcileDocumentRegister("goods_receipt", gr.uuid);
	console.log(`Оприходование «${grNumber}»: 3 партии молока (30/40/50) проведено.`);

	// ── Оприходование ноутбуков + серийные номера ───────────────────────────────
	const grLap = "ОПРХ-ДЕМО-НОУТ";
	let grL = await prisma.goodsReceipt.findFirst({ where: { number: grLap } });
	if (!grL) {
		grL = await prisma.goodsReceipt.create({ data: { number: grLap, date: day(-1), organizationUuid: org.uuid, warehouseUuid: wh.uuid, authorUuid: user.uuid, posted: true } });
	}
	await prisma.goodsReceiptItem.deleteMany({ where: { goodsReceiptUuid: grL.uuid } });
	await prisma.goodsReceiptItem.create({ data: {
		goodsReceiptUuid: grL.uuid, productUuid: laptop.uuid, quantity: 3, price: 350000, amount: 1050000,
		unitOfMeasureUuid: uom?.uuid ?? null, organizationUuid: org.uuid,
	} });
	await reconcileDocumentRegister("goods_receipt", grL.uuid);
	await setReceiptSerials({ docType: "goods_receipt", docUuid: grL.uuid, productUuid: laptop.uuid, warehouseUuid: wh.uuid, organizationUuid: org.uuid, serials: ["NB-0001", "NB-0002", "NB-0003"] });
	console.log(`Оприходование «${grLap}»: 3 ноутбука + серии NB-0001..0003.`);

	// ── Товар с ОСТАТКОМ БЕЗ МАРКИРОВКИ (сценарий «Ввод остатков») ───────────────
	// Так выглядит реальная ситуация: учёт включили на товар, у которого уже лежит
	// остаток, набранный приходами без серий/партий. Продать его нельзя, пока
	// остаток не разметить — для этого и сделан «Ввод остатков».
	const legacy = await ensureProduct("Дрель (учёт включён задним числом)", {
		trackSerialNumbers: true,
		serialTrackingSince: day(0),           // учёт включён СЕГОДНЯ
		unitOfMeasureUuid: uom?.uuid ?? null,
		organizationUuid: org.uuid,
	});
	const grOld = "ОПРХ-ДЕМО-ДРЕЛЬ";
	let grO = await prisma.goodsReceipt.findFirst({ where: { number: grOld } });
	if (!grO) {
		grO = await prisma.goodsReceipt.create({ data: { number: grOld, date: day(-30), organizationUuid: org.uuid, warehouseUuid: wh.uuid, authorUuid: user.uuid, posted: true } });
	}
	await prisma.goodsReceiptItem.deleteMany({ where: { goodsReceiptUuid: grO.uuid } });
	await prisma.goodsReceiptItem.create({ data: {
		goodsReceiptUuid: grO.uuid, productUuid: legacy.uuid, quantity: 5, price: 20000, amount: 100000,
		unitOfMeasureUuid: uom?.uuid ?? null, organizationUuid: org.uuid,
	} });
	await reconcileDocumentRegister("goods_receipt", grO.uuid);

	// ── РАСХОД: продажа с сериями + FEFO-списанием партий ───────────────────────
	const saleNumber = "РЕАЛ-ДЕМО-СЕРИИ-ПАРТИИ";
	let sale = await prisma.sale.findFirst({ where: { number: saleNumber } });
	if (!sale) {
		sale = await prisma.sale.create({ data: {
			number: saleNumber, date: new Date(), organizationUuid: org.uuid, warehouseUuid: wh.uuid,
			counterpartyUuid: (await prisma.counterparty.findFirst({ select: { uuid: true } }))?.uuid ?? null,
			authorUuid: user.uuid, posted: true,
		} });
	}
	await prisma.saleItem.deleteMany({ where: { saleUuid: sale.uuid } });

	// Партии: продаём 45 молока → FEFO должен взять M-2609 (30) и добить M-2620 (15).
	const fefoBefore = await availableBatchesFEFO({ organizationUuid: org.uuid, warehouseUuid: wh.uuid, productUuid: milk.uuid });
	const firstBatch = fefoBefore[0];
	await prisma.saleItem.create({ data: {
		saleUuid: sale.uuid, productUuid: milk.uuid, quantity: 30, price: 600, amount: 18000,
		unitOfMeasureUuid: uom?.uuid ?? null, organizationUuid: org.uuid, batchUuid: firstBatch?.uuid ?? null,
	} });
	// Серии: продаём 1 ноутбук.
	await prisma.saleItem.create({ data: {
		saleUuid: sale.uuid, productUuid: laptop.uuid, quantity: 1, price: 450000, amount: 450000,
		unitOfMeasureUuid: uom?.uuid ?? null, organizationUuid: org.uuid,
	} });
	await reconcileDocumentRegister("sale", sale.uuid);
	const nb1 = await prisma.serialNumber.findFirst({ where: { productUuid: laptop.uuid, serialNumber: "NB-0001" } });
	if (nb1) await issueSerials({ docType: "sale", docUuid: sale.uuid, serialUuids: [nb1.uuid] });
	console.log(`Реализация «${saleNumber}»: 30 молока (партия ${firstBatch?.batchNumber ?? "—"}) + 1 ноутбук (серия NB-0001).`);

	// ── СВЕРКА: приход и расход ────────────────────────────────────────────────
	const stock = async (p) => {
		const i = await prisma.productRegister.aggregate({ where: { productUuid: p, warehouseUuid: wh.uuid, movementType: "in" }, _sum: { quantity: true } });
		const o = await prisma.productRegister.aggregate({ where: { productUuid: p, warehouseUuid: wh.uuid, movementType: "out" }, _sum: { quantity: true } });
		return { in: Number(i._sum.quantity ?? 0), out: Number(o._sum.quantity ?? 0), balance: Number(i._sum.quantity ?? 0) - Number(o._sum.quantity ?? 0) };
	};

	console.log("\n─── ДВИЖЕНИЕ ТОВАРА (регистр) ───");
	for (const [name, uuid] of [["Молоко (партии)", milk.uuid], ["Ноутбук (серии)", laptop.uuid], ["Дрель (без маркировки)", legacy.uuid]]) {
		const s = await stock(uuid);
		console.log(`  ${name.padEnd(26)} приход ${String(s.in).padStart(4)}  расход ${String(s.out).padStart(4)}  остаток ${String(s.balance).padStart(4)}`);
	}

	console.log("\n─── ПАРТИИ: FEFO после продажи ───");
	const fefoAfter = await availableBatchesFEFO({ organizationUuid: org.uuid, warehouseUuid: wh.uuid, productUuid: milk.uuid });
	for (const b of fefoAfter) console.log(`  ${b.batchNumber}  срок ${new Date(b.expiryDate).toISOString().slice(0, 10)}  остаток ${b.quantity}`);

	console.log("\n─── СЕРИИ: статусы ───");
	const byStatus = await prisma.serialNumber.groupBy({ by: ["status"], where: { productUuid: laptop.uuid }, _count: { _all: true } });
	for (const g of byStatus) console.log(`  ${g.status.padEnd(12)} ${g._count._all}`);

	console.log("\n─── ВВОД ОСТАТКОВ: что ждёт разметки ───");
	const sg = await serialGap({ productUuid: legacy.uuid, warehouseUuid: wh.uuid, organizationUuid: org.uuid });
	console.log(`  Дрель: остаток ${sg.stock}, размечено сериями ${sg.marked} → нужно ввести ${sg.gap}`);
	console.log(`  Пока не разметить — продать нельзя (система потребует серию на каждую единицу).`);
	const bg = await batchGap({ productUuid: milk.uuid, warehouseUuid: wh.uuid, organizationUuid: org.uuid });
	console.log(`  Молоко: остаток ${bg.stock}, в партиях ${bg.marked} → без партии ${bg.gap}`);

	console.log("\nГотово. Проверить в UI:");
	console.log("  • Реализация «" + saleNumber + "» — ячейки «Серии» и «Партия» в позициях;");
	console.log("  • Номенклатура → «Дрель» — включённый учёт серий на товаре с остатком;");
	console.log("  • Ввод остатков: POST /api/v1/opening-balance/serials { productUuid, warehouseUuid, serials }");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
