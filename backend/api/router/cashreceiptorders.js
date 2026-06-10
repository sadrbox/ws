// Приходный кассовый ордер (ПКО) — таблица cash_orders, direction="receipt".
import { createCashOrderRouter } from "./_cashOrderFactory.js";

export default createCashOrderRouter({
	direction: "receipt",
	route: "cash-receipt-orders",
	docType: "cash_receipt_order",
});
