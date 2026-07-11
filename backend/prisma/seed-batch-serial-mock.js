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
import { setReceiptSerials } from "../services/serialNumbers.js";

const day = (offset) => new Date(Date.now() + offset * 86400000);

async function ensureProduct(name, data) {
	const ex = await prisma.product.findFirst({ where: { name } });
	if (ex) return prisma.product.update({ where: { uuid: ex.uuid }, data });
	return prisma.product.create({ data: { name, ...data } });
}

async function main() {
	const org = await prisma.organization.findFirst({ where: { deletedAt: null }, select: { uuid: true, name: true } });
	const wh = await prisma.warehouse.findFirst({ where: { deletedAt: null, ...(org ? { organizationUuid: org.uuid } : {}) }, select: { uuid: true, name: true } });
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

	// ── Печать FEFO-порядка ─────────────────────────────────────────────────────
	const fefo = await availableBatchesFEFO({ organizationUuid: org.uuid, warehouseUuid: wh.uuid, productUuid: milk.uuid });
	console.log("\nFEFO-порядок доступных партий молока (раньше истекает — раньше уходит):");
	for (const b of fefo) console.log(`  ${b.batchNumber}  срок ${new Date(b.expiryDate).toISOString().slice(0, 10)}  остаток ${b.quantity}`);
	console.log("\nГотово.");
	console.log("• Серии: открой «Оприходование/Списание» с ноутбуком → ячейка «Серии» (UI готов).");
	console.log("• Партии: FEFO-логика и данные готовы; UI-ячейка выбора партии — Stage 2c (в работе).");
	console.log("  Проверить FEFO сейчас: GET /api/v1/productbatches/available?productUuid=" + milk.uuid + "&warehouseUuid=" + wh.uuid);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
