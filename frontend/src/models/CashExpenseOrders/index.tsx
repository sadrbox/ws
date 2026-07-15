import columnsJson from "./columns.json";
import { createCashOrderForm } from "src/models/_shared/createCashOrderForm";

const { Form: CashExpenseOrdersForm, List: CashExpenseOrdersList } = createCashOrderForm({
  endpoint: "cash-expense-orders",
  listName: "CashExpenseOrdersList",
  formLabel: "РКО",
  storageKey: "cash-expense-orders-form",
  accessPermissionModel: "CashExpenseOrder",
  docType: "cash_expense_order",
  formDisplayName: "CashExpenseOrdersForm",
  columnsJson,
});

export { CashExpenseOrdersList, CashExpenseOrdersForm };
