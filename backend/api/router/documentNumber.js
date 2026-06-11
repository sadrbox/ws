/**
 * Эндпоинт «Присвоить номер»: вычисляет следующий номер документа по ЧИСЛОВОМУ
 * максимуму в журнале (устойчиво к разной ширине/префиксам и «грязным» данным).
 *
 * GET /document-number/next?endpoint=<endpoint>&organizationUuid=<uuid?>
 *   → { success, number }
 *
 * Числовой максимум берётся как MAX(только-цифры(number)::bigint) — поэтому "9"
 * не считается больше "10", а "ыва34234" даёт 34234. Номер форматируется тем же
 * префиксом/шириной, что и автонумерация (peekNextNumber), и НЕ трогает счётчик.
 */
import express from "express";
import { pool } from "../../prisma/prisma-client.js";
import { getNumberFormat, formatDocNumber } from "../../services/documentNumbering.js";

const router = express.Router();

// endpoint → { table (имя таблицы в БД), docType, direction? (для cash_orders) }.
// Имена таблиц/направление — из фикс-карты (НЕ из ввода) → безопасны для SQL.
const NUMBER_JOURNALS = {
	"sales": { table: "sales", docType: "sale" },
	"purchases": { table: "purchases", docType: "purchase" },
	"sale-returns": { table: "sale_returns", docType: "sale_return" },
	"purchase-returns": { table: "purchase_returns", docType: "purchase_return" },
	"inventory-transfers": { table: "inventory_transfers", docType: "inventory_transfer" },
	"cash-receipt-orders": { table: "cash_orders", docType: "cash_receipt_order", direction: "receipt" },
	"cash-expense-orders": { table: "cash_orders", docType: "cash_expense_order", direction: "expense" },
	"outgoing-invoices": { table: "outgoing_invoices", docType: "outgoing_invoice" },
	"incoming-invoices": { table: "incoming_invoices", docType: "incoming_invoice" },
	"payment-invoices": { table: "payment_invoices", docType: "payment_invoice" },
	"sales-orders": { table: "sales_orders", docType: "sales_order" },
	"purchase-orders": { table: "purchase_orders", docType: "purchase_order" },
	"commercial-offers": { table: "commercial_offers", docType: "commercial_offer" },
	"reservations": { table: "reservations", docType: "reservation" },
	"purchase-requisitions": { table: "purchase_requisitions", docType: "purchase_requisition" },
};

router.get("/document-number/next", async (req, res) => {
	try {
		const endpoint = String(req.query.endpoint || "");
		const cfg = NUMBER_JOURNALS[endpoint];
		if (!cfg) return res.status(400).json({ success: false, message: "Неизвестный тип документа" });
		const organizationUuid = req.query.organizationUuid ? String(req.query.organizationUuid) : null;

		// Формат нумерации (префикс/ширина) — определяет, ЗА КАКУЮ последовательность
		// (по префиксу) ищем максимум. Best practice: ряды разделены по префиксу.
		const fmt = (await getNumberFormat(cfg.docType, organizationUuid)) ?? { prefix: "", padding: 9 };
		const { prefix, padding } = fmt;

		const params = [];
		let where = `"deletedAt" IS NULL AND "number" IS NOT NULL`;
		if (cfg.direction) where += ` AND "direction" = '${cfg.direction}'`;
		if (organizationUuid) {
			params.push(organizationUuid);
			where += ` AND "organizationUuid" = $${params.length}`;
		}

		// Максимум ТОЛЬКО по номерам текущей последовательности (того же префикса):
		//  • префикс пуст → чистые цифры «^\d+$» (напр. «000034235»), «ыва34234» НЕ входит;
		//  • префикс P    → «P-цифры» (напр. «РЕАЛ-000006»), хвост — только цифры.
		// Параметризовано (starts_with/substring), без интерполяции префикса в SQL.
		let maxExpr;
		if (prefix) {
			params.push(prefix);
			const p = `$${params.length}`;
			maxExpr = `MAX(CASE WHEN starts_with("number", ${p} || '-')
			                AND substring("number" from char_length(${p}) + 2) ~ '^[0-9]+$'
			               THEN substring("number" from char_length(${p}) + 2)::bigint END)`;
		} else {
			maxExpr = `MAX(CASE WHEN "number" ~ '^[0-9]+$' THEN "number"::bigint END)`;
		}

		const { rows } = await pool.query(
			`SELECT COALESCE(${maxExpr}, 0) AS maxnum FROM "${cfg.table}" WHERE ${where}`,
			params,
		);
		const maxNumeric = rows[0]?.maxnum ?? 0;
		const number = formatDocNumber(prefix, padding, Number(maxNumeric) + 1);
		return res.json({ success: true, number });
	} catch (err) {
		console.error("GET /document-number/next error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
