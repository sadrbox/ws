import columnsJson from "./columns.json";
import { createDocumentModel } from "src/utils/createDocumentModel";

const { Form: IncomingInvoicesForm, List: IncomingInvoicesList } = createDocumentModel({
  endpoint: "incoming-invoices",
  listName: "IncomingInvoicesList",
  formLabel: "СФ входящая",
  storageKey: "incoming-invoices-form",
  columnsJson,
});

export { IncomingInvoicesList, IncomingInvoicesForm };
