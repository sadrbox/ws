/**
 * Эндпоинт «Присвоить номер»: предпросмотр следующего номера документа.
 *
 * GET /document-number/next?endpoint=<endpoint>&organizationUuid=<uuid?>&date=<iso?>
 *   → { success, number }
 *
 * ЕДИНЫЙ источник с автонумерацией при сохранении: peekNextNumber использует тот
 * же счётчик document_sequences с самовосстановлением до максимума журнала за год
 * (см. services/documentNumbering.js). Поэтому превью совпадает с тем, что реально
 * присвоит allocateNumber, год учитывается, гонок/расхождения нет. Счётчик НЕ
 * трогается (это только предпросмотр).
 */
import express from "express";
import { resolveDocumentNumber } from "../../services/documentNumberAssign.js";
import { lookupDocumentNumber, isNumberTaken, peekNextNumber } from "../../services/documentNumbering.js";

const router = express.Router();

// endpoint → docType. Имена фиксированы в коде (НЕ из ввода). Направление
// (receipt/expense для cash_orders) уже закодировано в docType.
const ENDPOINT_DOCTYPE = {
	"sales": "sale",
	"purchases": "purchase",
	"sale-returns": "sale_return",
	"purchase-returns": "purchase_return",
	"inventory-transfers": "inventory_transfer",
	"bank-statements": "bank_statement",
	"cash-receipt-orders": "cash_receipt_order",
	"cash-expense-orders": "cash_expense_order",
	"outgoing-invoices": "outgoing_invoice",
	"incoming-invoices": "incoming_invoice",
	"payment-invoices": "payment_invoice",
	"sales-orders": "sales_order",
	"purchase-orders": "purchase_order",
	"commercial-offers": "commercial_offer",
	"reservations": "reservation",
	"importdeclarations": "import_declaration",
	"purchase-requisitions": "purchase_requisition",
	"payroll-calculations": "payroll_calculation",
	"payroll-payments": "payroll_payment",
	"month-closes": "month_close",
};

router.get("/document-number/next", async (req, res) => {
	try {
		const endpoint = String(req.query.endpoint || "");
		const docType = ENDPOINT_DOCTYPE[endpoint];
		if (!docType) return res.status(400).json({ success: false, message: "Неизвестный тип документа" });
		const organizationUuid = req.query.organizationUuid ? String(req.query.organizationUuid) : null;
		// Год берём из даты документа (если передана) — превью соответствует ряду
		// нужного года; иначе текущий год.
		const date = req.query.date ? String(req.query.date) : null;
		// ТОТ ЖЕ алгоритм, что и при сохранении (resolveDocumentNumber, preview).
		// uuid задан (существующий документ) → подтягиваем его номер из БД как
		// existingNumber: если поле очищено — вернём СВОЙ номер (порядок верный),
		// а не следующий. Новый документ (без uuid, пустое поле) → следующий.
		const current = req.query.current ? String(req.query.current).trim() : "";
		const uuid = req.query.uuid ? String(req.query.uuid) : null;
		const existingNumber = uuid ? await lookupDocumentNumber(docType, uuid) : null;
		let number = await resolveDocumentNumber({ docType, organizationUuid, date, manual: current, existingNumber }, { preview: true, reformatExisting: true });
		// Если приведённый к настройкам номер уже занят другим документом (напр. после
		// смены префикса старый «ПКО-000001» совпал с новым «000001») — следующий свободный.
		if (number && await isNumberTaken(docType, number, organizationUuid, date, uuid)) {
			number = await peekNextNumber(docType, organizationUuid, date);
		}
		// number === null → нет конфига: возвращаем пусто.
		return res.json({ success: true, number: number ?? "" });
	} catch (err) {
		console.error("GET /document-number/next error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
