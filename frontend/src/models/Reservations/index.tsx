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
import { SalesForm } from "src/models/Sales";

const MODEL_ENDPOINT = "reservations";
const LIST_NAME = "ReservationsList";

const ReservationsForm: FC<Partial<TPane>> = createInvoiceLikeForm({
  endpoint: MODEL_ENDPOINT,
  itemsEndpoint: "reservation-items",
  itemsParentField: "reservationUuid",
  storageKey: "reservations-form",
  listName: LIST_NAME,
  formLabel: "Резервирование товара",
  itemsTabLabel: "Товары, услуги",
  itemsComponentName: "ReservationItemsList_part",
  accessRightModel: "Reservation",
  formDisplayName: "ReservationsForm",
  docType: "reservation",
  hidePosted: true,
  basisConfig: {
    allowedTypes: [{ type: "sales_order", endpoint: "sales-orders" }],
  },
  createFromBasisTargets: [
    {
      docLabel: "Реализация товаров",
      FormComponent: SalesForm,
      basisType: "reservation",
      sourceItemsEndpoint: "reservation-items",
      sourceItemsParentField: "reservationUuid",
      mapFields: mapCommonTradeFields,
      existingCheckEndpoint: "sales",
    },
  ],
});

const ReservationsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={ReservationsForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
    defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
ReservationsList.displayName = LIST_NAME;

export { ReservationsForm, ReservationsList };
