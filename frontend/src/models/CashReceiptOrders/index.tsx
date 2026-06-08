import columnsJson from "./columns.json";
import { createCashOrderForm } from "src/models/_shared/createCashOrderForm";

const { Form: CashReceiptOrdersForm, List: CashReceiptOrdersList } = createCashOrderForm({
  endpoint: "cash-receipt-orders",
  listName: "CashReceiptOrdersList",
  formLabel: "ПКО",
  storageKey: "cash-receipt-orders-form",
  userAccessRightModel: "CashReceiptOrder",
  docType: "cash_receipt_order",
  formDisplayName: "CashReceiptOrdersForm",
  columnsJson,
});

export { CashReceiptOrdersForm, CashReceiptOrdersList };
