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
import TradeDocumentPrint from "src/models/_shared/TradeDocumentPrint";
import { SalesOrdersForm } from "src/models/SalesOrders";
import { SalesForm } from "src/models/Sales";

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
  accessPermissionModel: "CommercialOffer",
  formDisplayName: "CommercialOffersForm",
  docType: "commercial_offer",
  hidePosted: true,
  printConfig: {
    buildLayout: (fields, items, cols) => (
      <TradeDocumentPrint title="КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ" counterpartyLabel="Покупатель" totalLabel="Итого по КП" data={{
        documentId: fields.id, documentNumber: fields.number || undefined, documentDate: fields.date,
        organizationName: fields.organizationName, counterpartyName: fields.counterpartyName, contractName: fields.contractName,
        items: items.map((r, i) => ({ number: i + 1, name: r.name, unit: r.unit, quantity: r.quantity, price: r.price, vatRate: r.vatRate, vatAmount: r.vatAmount, amount: r.amount })),
        totalAmount: items.reduce((s: number, r: TDataItem) => s + Number(r.amount ?? 0), 0),
        totalVatAmount: items.reduce((s: number, r: TDataItem) => s + Number(r.vatAmount ?? 0), 0),
        columns: cols,
      }} />
    ),
    columnDefs: [
      { key: "vatRate", label: "Ставка НДС, %", defaultVisible: true },
      { key: "vatAmount", label: "Сумма НДС", defaultVisible: true },
    ],
    columnsKey: "commercial_offer",
    fileBaseName: (f) => `КП_${f.number || "новый"}`,
    title: (f) => `Коммерческое предложение № ${f.number || "—"}`,
  },
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
    {
      docLabel: "Реализация товаров",
      FormComponent: SalesForm,
      basisType: "commercial_offer",
      sourceItemsEndpoint: "commercial-offer-items",
      sourceItemsParentField: "commercialOfferUuid",
      mapFields: mapCommonTradeFields,
      existingCheckEndpoint: "sales",
    },
  ],
});

const CommercialOffersList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }> = (
  { variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={CommercialOffersForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField} extraQueryParams={extraQueryParams}
    defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
CommercialOffersList.displayName = LIST_NAME;

export { CommercialOffersForm, CommercialOffersList };
