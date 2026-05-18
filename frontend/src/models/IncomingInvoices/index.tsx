import { FC } from "react";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { getFormatDateOnly } from "src/utils/main.module";
import ModelList from "src/components/ModelList";
import { Icon } from "src/components/IconButton/icons";
import { createInvoiceLikeForm } from "src/models/_shared/createInvoiceLikeForm";

const MODEL_ENDPOINT = "incoming-invoices";
const LIST_NAME = "IncomingInvoicesList";

const IncomingInvoicesForm: FC<Partial<TPane>> = createInvoiceLikeForm({
  endpoint: MODEL_ENDPOINT,
  itemsEndpoint: "incominginvoiceitems",
  itemsParentField: "incomingInvoiceUuid",
  storageKey: "incoming-invoices-form",
  listName: LIST_NAME,
  formLabel: "СФ входящая",
  itemsTabLabel: "Товары СФ входящей",
  itemsComponentName: "IncomingInvoiceItemsList_part",
  accessRightModel: "IncomingInvoice",
  formDisplayName: "IncomingInvoicesForm",
  docType: "incoming_invoice",
});

const IncomingInvoicesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={IncomingInvoicesForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
    defaultSort={{ id: "desc" }}
    renderCell={(row, col) => {
      if (col.identifier === "posted") {
        const isPosted = row.posted === true;
        return (
          <span title={isPosted ? "Документ проведён" : "Не проведён"}>
            <Icon name={isPosted ? "posted" : "notPosted"} width={17} height={17}
              style={{ color: isPosted ? "#10b981" : "#9ca3af", flexShrink: 0, display: "flex" }} />
          </span>
        );
      }
      return undefined;
    }}
  />
);
IncomingInvoicesList.displayName = LIST_NAME;

export { IncomingInvoicesForm, IncomingInvoicesList };
