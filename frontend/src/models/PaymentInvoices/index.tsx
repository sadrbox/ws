import columnsJson from "./columns.json";
import { createDocumentModel } from "src/utils/createDocumentModel";

const { Form: PaymentInvoicesForm, List: PaymentInvoicesList } = createDocumentModel({
  endpoint: "payment-invoices",
  listName: "PaymentInvoicesList",
  formLabel: "Счёт на оплату",
  storageKey: "payment-invoices-form",
  columnsJson,
});

export { PaymentInvoicesList, PaymentInvoicesForm };
