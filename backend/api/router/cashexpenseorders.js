// Расходный кассовый ордер (РКО) — таблица cash_orders, direction="expense".
import { createCashOrderRouter } from "./_cashOrderFactory.js";

export default createCashOrderRouter({
	direction: "expense",
	route: "cash-expense-orders",
	docType: "cash_expense_order",
});
