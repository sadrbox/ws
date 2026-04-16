import columnsJson from "./columns.json";
import { createDocumentModel } from "src/utils/createDocumentModel";

const { Form: CashExpenseOrdersForm, List: CashExpenseOrdersList } = createDocumentModel({
  endpoint: "cash-expense-orders",
  listName: "CashExpenseOrdersList",
  formLabel: "РКО",
  storageKey: "cash-expense-orders-form",
  columnsJson,
});

export { CashExpenseOrdersList, CashExpenseOrdersForm };
