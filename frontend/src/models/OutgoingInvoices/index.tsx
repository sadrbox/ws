import { FC } from "react";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { getFormatDateOnly } from "src/utils/main.module";
import ModelList from "src/components/ModelList";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";
import { createInvoiceLikeForm } from "src/models/_shared/createInvoiceLikeForm";

const MODEL_ENDPOINT = "outgoing-invoices";
const LIST_NAME = "OutgoingInvoicesList";

const OutgoingInvoicesForm: FC<Partial<TPane>> = createInvoiceLikeForm({
  endpoint: MODEL_ENDPOINT,
  itemsEndpoint: "outgoinginvoiceitems",
  itemsParentField: "outgoingInvoiceUuid",
  storageKey: "outgoing-invoices-form",
  listName: LIST_NAME,
  formLabel: "СФ исходящая",
  itemsTabLabel: "Товары СФ исходящей",
  itemsComponentName: "OutgoingInvoiceItemsList_part",
  accessRightModel: "OutgoingInvoice",
  formDisplayName: "OutgoingInvoicesForm",
  docType: "outgoing_invoice",
});

const OutgoingInvoicesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={OutgoingInvoicesForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
    defaultSort={{ id: "desc" }}
    renderCell={renderPostedCell}
  />
);
OutgoingInvoicesList.displayName = LIST_NAME;

export { OutgoingInvoicesForm, OutgoingInvoicesList };
