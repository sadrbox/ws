// ─────────────────────────────────────────────────────────────────────────────
// PurchasesForm — Поступление товаров (Покупка). Реализована через единую
// фабрику createTradeDocForm (см. models/_shared). Поведение прежнее; различия —
// только в конфиге ниже.
// ─────────────────────────────────────────────────────────────────────────────
import { translate } from "src/i18";
import { createTradeDocForm } from "src/models/_shared/createTradeDocForm";
import { mapCommonTradeFields } from "src/utils/createFromBasis";
import { PurchaseReturnsForm } from "src/models/PurchaseReturns";
import columnsJson from "./columns.json";

const { Form: PurchasesForm, List: PurchasesList } = createTradeDocForm({
  endpoint: "purchases",
  itemsEndpoint: "purchaseitems",
  itemsParentField: "purchaseUuid",
  itemsBatchEndpoint: "purchaseitems/batch",
  storageKey: "purchases-form",
  listName: "PurchasesList",
  formLabel: "Поступление товара и услуг",
  formDisplayName: "PurchasesForm",
  itemsComponentName: "PurchaseItemsList_part",
  itemsTableLabel: "Товары поступления",
  parentLabelListKey: "PurchasesList",
  userAccessRightModel: "Purchase",
  docType: "purchase",
  columnsJson,
  basisAllowedTypes: [
    { type: "purchase_requisition", endpoint: "purchase-requisitions" },
    { type: "purchase_order", endpoint: "purchase-orders" },
    { type: "incoming_invoice", endpoint: "incoming-invoices" },
  ],
  hasPriceType: true,
  priceTypeValueType: "purchasePriceType",
  serialMode: "receipt",
  serialDocType: "purchase",
  batchMode: "receipt",
  defaultHiddenColumns: ["amountNetOfIndirectTaxes", "amountWithoutVat"],
  basisSourceLabelKey: "purchaseReceipt",
  createFromBasisTargets: [
    {
      id: "purchaseReturn",
      optionLabelKey: "PurchaseReturnsList",
      target: {
        docLabel: translate("PurchaseReturnsList"),
        FormComponent: PurchaseReturnsForm,
        basisType: "purchase",
        sourceItemsEndpoint: "purchaseitems",
        sourceItemsParentField: "purchaseUuid",
        mapFields: mapCommonTradeFields,
        existingCheckEndpoint: "purchase-returns",
      },
    },
  ],
});

export { PurchasesForm, PurchasesList };
