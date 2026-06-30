// ─────────────────────────────────────────────────────────────────────────────
// Пересчёт себестоимости/проводок по проведённым документам (по запросу).
//
// Две фазы (как prisma/reconcile-all.js): сначала ПОЛНОСТЬЮ перестраиваем регистр
// товаров, затем бухпроводки. COGS реализации считается против УЖЕ полного
// регистра, поэтому корректно учитывает документы, введённые задним числом
// (ретроактив): достаточно перезапустить пересчёт после такого ввода.
//
// Идемпотентно и обратимо: каждая фаза делает delete+rebuild из текущего
// состояния документов. Диапазон ограничивается, чтобы не трогать закрытые
// периоды (вызывающий передаёт dateFilter строго после границы закрытия).
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";
import { reconcileDocumentRegister, REGISTER_DOC_TYPES } from "./productRegister.js";
import { reconcileDocumentEntries, POSTING_DOC_TYPES } from "./accountingPosting.js";

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

/**
 * @param {object} scope
 * @param {string|null} [scope.organizationUuid] — ограничить организацией.
 * @param {object|null} [scope.dateFilter] — Prisma-условие по полю date
 *        (например { gt: boundary } или { gte: fromDate }). null → без ограничения.
 * @param {object} [client] — prisma client/transaction.
 * @returns {Promise<{registers:number, entries:number}>} счётчики обработанных док-тов.
 */
export async function recomputeCosting({ organizationUuid = null, dateFilter = null } = {}, client = prisma) {
	const docWhere = { posted: true, deletedAt: null };
	if (organizationUuid) docWhere.organizationUuid = organizationUuid;
	if (dateFilter) docWhere.date = dateFilter;

	async function phase(types, fn) {
		let count = 0;
		for (const type of types) {
			const model = MODEL_BY_TYPE[type];
			if (!model || !client[model]) continue;
			const docs = await client[model].findMany({ where: docWhere, select: { uuid: true } });
			for (const d of docs) await fn(type, d.uuid, client);
			count += docs.length;
		}
		return count;
	}

	// Порядок важен: регистр целиком, затем проводки (COGS из полного регистра).
	const registers = await phase(REGISTER_DOC_TYPES, reconcileDocumentRegister);
	const entries = await phase(POSTING_DOC_TYPES, reconcileDocumentEntries);
	return { registers, entries };
}

export default { recomputeCosting };
