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
import { SalesOrdersForm } from "src/models/SalesOrders";

const MODEL_ENDPOINT = "commercial-offers";
const LIST_NAME = "CommercialOffersList";

const CommercialOffersForm: FC<Partial<TPane>> = createInvoiceLikeForm({
  endpoint: MODEL_ENDPOINT,
  itemsEndpoint: "commercial-offer-items",
  itemsParentField: "commercialOfferUuid",
  storageKey: "commercial-offers-form",
  listName: LIST_NAME,
  formLabel: "Коммерческое предложение",
  itemsTabLabel: "Товары, услуги",
  itemsComponentName: "CommercialOfferItemsList_part",
  accessRightModel: "CommercialOffer",
  formDisplayName: "CommercialOffersForm",
  docType: "commercial_offer",
  hidePosted: true,
  createFromBasisTargets: [
    {
      docLabel: "Заказ покупателя",
      FormComponent: SalesOrdersForm,
      basisType: "commercial_offer",
      sourceItemsEndpoint: "commercial-offer-items",
      sourceItemsParentField: "commercialOfferUuid",
      mapFields: mapCommonTradeFields,
      existingCheckEndpoint: "sales-orders",
    },
  ],
});

const CommercialOffersList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={CommercialOffersForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
    defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
CommercialOffersList.displayName = LIST_NAME;

export { CommercialOffersForm, CommercialOffersList };
