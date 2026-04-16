import columnsJson from "./columns.json";
import { createDocumentModel } from "src/utils/createDocumentModel";

const { Form: CashReceiptOrdersForm, List: CashReceiptOrdersList } = createDocumentModel({
  endpoint: "cash-receipt-orders",
  listName: "CashReceiptOrdersList",
  formLabel: "ПКО",
  storageKey: "cash-receipt-orders-form",
  columnsJson,
});

export { CashReceiptOrdersList, CashReceiptOrdersForm };
