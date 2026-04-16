import columnsJson from "./columns.json";
import { createDocumentModel } from "src/utils/createDocumentModel";

const { Form: PurchasesForm, List: PurchasesList } = createDocumentModel({
  endpoint: "purchases",
  listName: "PurchasesList",
  formLabel: "Поступление",
  storageKey: "purchases-form",
  columnsJson,
});

export { PurchasesList, PurchasesForm };
