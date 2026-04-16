import columnsJson from "./columns.json";
import { createDocumentModel } from "src/utils/createDocumentModel";

const { Form: OutgoingInvoicesForm, List: OutgoingInvoicesList } = createDocumentModel({
  endpoint: "outgoing-invoices",
  listName: "OutgoingInvoicesList",
  formLabel: "СФ исходящая",
  storageKey: "outgoing-invoices-form",
  columnsJson,
});

export { OutgoingInvoicesList, OutgoingInvoicesForm };
