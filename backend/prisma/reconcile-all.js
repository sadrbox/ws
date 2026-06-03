// ─────────────────────────────────────────────────────────────────────────────
// Разовая пересборка регистров товаров и бухпроводок по ВСЕМ проведённым
// документам. Нужна после изменения базиса оценки (себестоимость без НДС) и
// разнесения НДС (1420/3130): прежние движения/проводки хранят суммы по-старому.
//
// Порядок важен: сначала регистры (нетто-себестоимость), затем проводки —
// COGS реализации считается по скользящей средней из регистра.
//
// Запуск:  node prisma/reconcile-all.js
// Идемпотентно и безопасно (delete+rebuild). Делать на копии перед прод.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./prisma-client.js";
import { reconcileDocumentRegister, REGISTER_DOC_TYPES } from "../services/productRegister.js";
import { reconcileDocumentEntries, POSTING_DOC_TYPES } from "../services/accountingPosting.js";

const MODEL_BY_TYPE = {
	purchase: "purchase",
	sale: "sale",
	inventory_transfer: "inventoryTransfer",
	sale_return: "saleReturn",
	purchase_return: "purchaseReturn",
	cash_receipt_order: "cashReceiptOrder",
	cash_expense_order: "cashExpenseOrder",
	bank_statement: "bankStatement",
	payroll_calculation: "payrollCalculation",
	payroll_payment: "payrollPayment",
};

async function rebuild(types, fn, label) {
	for (const type of types) {
		const model = MODEL_BY_TYPE[type];
		if (!model || !prisma[model]) continue;
		const docs = await prisma[model].findMany({
			where: { posted: true, deletedAt: null },
			select: { uuid: true },
		});
		for (const d of docs) await fn(type, d.uuid);
		console.log(`  ${label} ${type}: ${docs.length}`);
	}
}

async function run() {
	console.log("1) Регистры товаров (нетто-себестоимость)…");
	await rebuild(REGISTER_DOC_TYPES, reconcileDocumentRegister, "регистр");
	console.log("2) Бухпроводки (разнесение НДС 1420/3130)…");
	await rebuild(POSTING_DOC_TYPES, reconcileDocumentEntries, "проводки");
	console.log("✅ Пересборка завершена");
}

run()
	.then(() => process.exit(0))
	.catch((e) => { console.error(e); process.exit(1); });
