import { FC } from "react";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { getFormatDateOnly } from "src/utils/datetime";
import ModelList from "src/components/ModelList";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";
import { createInvoiceLikeForm } from "src/models/_shared/createInvoiceLikeForm";
import { mapCommonTradeFields } from "src/utils/createFromBasis";
import { PurchasesForm } from "src/models/Purchases";

const MODEL_ENDPOINT = "purchase-orders";
const LIST_NAME = "PurchaseOrdersList";

const PurchaseOrdersForm: FC<Partial<TPane>> = createInvoiceLikeForm({
  endpoint: MODEL_ENDPOINT,
  itemsEndpoint: "purchase-order-items",
  itemsParentField: "purchaseOrderUuid",
  storageKey: "purchase-orders-form",
  listName: LIST_NAME,
  formLabel: "Заказ поставщику",
  itemsTabLabel: "Товары, услуги",
  itemsComponentName: "PurchaseOrderItemsList_part",
  accessRightModel: "PurchaseOrder",
  formDisplayName: "PurchaseOrdersForm",
  docType: "purchase_order",
  hidePosted: true,
  basisConfig: {
    allowedTypes: [{ type: "purchase_requisition", endpoint: "purchase-requisitions" }],
  },
  createFromBasisTargets: [
    {
      docLabel: "Поступление товаров",
      FormComponent: PurchasesForm,
      basisType: "purchase_order",
      sourceItemsEndpoint: "purchase-order-items",
      sourceItemsParentField: "purchaseOrderUuid",
      mapFields: mapCommonTradeFields,
      existingCheckEndpoint: "purchases",
    },
  ],
});

const PurchaseOrdersList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={PurchaseOrdersForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
    defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
PurchaseOrdersList.displayName = LIST_NAME;

export { PurchaseOrdersForm, PurchaseOrdersList };
