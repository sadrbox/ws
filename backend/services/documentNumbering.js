// ─────────────────────────────────────────────────────────────────────────────
// Нумерация документов. Человекочитаемый номер вида «<ПРЕФИКС>-<NNNNNN>» со
// сквозным счётчиком по организации + виду документа + году (сброс с начала
// года). Номер можно задать вручную в payload (тогда автогенерация не нужна) —
// напр. при импорте из старой системы.
//
// Префиксы видов документов заданы в коде (NUMBER_CONFIG) — отдельного UI
// настроек не требуется.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

// docType → префикс номера.
export const NUMBER_CONFIG = {
	sale: "РЕАЛ",
	purchase: "ПОСТ",
	sale_return: "ВЗПК", // возврат от покупателя
	purchase_return: "ВЗПС", // возврат поставщику
	inventory_transfer: "ПЕРЕМ",
	cash_receipt_order: "ПКО",
	cash_expense_order: "РКО",
	bank_statement: "БВ",
	commercial_offer: "КП",
	sales_order: "ЗАКП", // заказ покупателя
	reservation: "РЕЗ",
	outgoing_invoice: "СФ", // счёт-фактура исх.
	incoming_invoice: "СФВ", // счёт-фактура вх.
	payment_invoice: "СЧ", // счёт на оплату
	purchase_order: "ЗАКС", // заказ поставщику
	purchase_requisition: "ЗАЯВ",
	payroll_calculation: "НЗП",
	payroll_payment: "ВЗП",
};

/**
 * Выделяет следующий номер документа (атомарно увеличивает счётчик).
 * @returns {Promise<string|null>} номер «ПРЕФИКС-000123» или null (нет конфига).
 */
export async function allocateNumber(docType, organizationUuid, date, client = prisma) {
	const prefix = NUMBER_CONFIG[docType];
	if (!prefix) return null;
	const year = (date ? new Date(date) : new Date()).getFullYear();
	const org = organizationUuid || "__global__";
	try {
		const row = await client.documentSequence.upsert({
			where: { organizationUuid_docType_year: { organizationUuid: org, docType, year } },
			create: { organizationUuid: org, docType, year, lastValue: 1 },
			update: { lastValue: { increment: 1 } },
		});
		return `${prefix}-${String(row.lastValue).padStart(6, "0")}`;
	} catch (err) {
		console.error(`allocateNumber(${docType}) error:`, err);
		return null;
	}
}

/**
 * Проставляет data.number, если он не задан явно (мутирует data). Вызывать в
 * create-эндпоинтах ПЕРЕД prisma.create.
 */
export async function ensureNumber(docType, data, client = prisma) {
	if (data.number != null && String(data.number).trim() !== "") return data.number;
	const n = await allocateNumber(docType, data.organizationUuid ?? null, data.date ?? null, client);
	if (n) data.number = n;
	return n;
}

export default { NUMBER_CONFIG, allocateNumber, ensureNumber };
