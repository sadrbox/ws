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
import { ReservationsForm } from "src/models/Reservations";
import { SalesForm } from "src/models/Sales";

const MODEL_ENDPOINT = "sales-orders";
const LIST_NAME = "SalesOrdersList";

const SalesOrdersForm: FC<Partial<TPane>> = createInvoiceLikeForm({
  endpoint: MODEL_ENDPOINT,
  itemsEndpoint: "sales-order-items",
  itemsParentField: "salesOrderUuid",
  storageKey: "sales-orders-form",
  listName: LIST_NAME,
  formLabel: "Заказ покупателя",
  itemsTabLabel: "Товары, услуги",
  itemsComponentName: "SalesOrderItemsList_part",
  accessRightModel: "SalesOrder",
  formDisplayName: "SalesOrdersForm",
  docType: "sales_order",
  hidePosted: true,
  printConfig: {
    buildLayout: (fields, items, cols) => (
      <TradeDocumentPrint title="ЗАКАЗ ПОКУПАТЕЛЯ" counterpartyLabel="Покупатель" totalLabel="Итого по заказу" data={{
        documentId: fields.id, documentDate: fields.date,
        organizationName: fields.organizationName, counterpartyName: fields.counterpartyName, contractName: fields.contractName,
        items: items.map((r, i) => ({ number: i + 1, name: r.name, unit: r.unit, quantity: r.quantity, price: r.price, vatRate: r.vatRate, vatAmount: r.vatAmount, amount: r.amount })),
        totalAmount: items.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0),
        totalVatAmount: items.reduce((s: number, r: any) => s + Number(r.vatAmount ?? 0), 0),
        columns: cols,
      }} />
    ),
    columnDefs: [
      { key: "vatRate", label: "Ставка НДС, %", defaultVisible: true },
      { key: "vatAmount", label: "Сумма НДС", defaultVisible: true },
    ],
    columnsKey: "sales_order",
    fileBaseName: (f) => `ЗаказПокупателя_${f.id ?? "новый"}`,
    title: (f) => `Заказ покупателя № ${f.id ?? "—"}`,
  },
  basisConfig: {
    allowedTypes: [{ type: "commercial_offer", endpoint: "commercial-offers" }],
  },
  createFromBasisTargets: [
    {
      docLabel: "Резервирование товара",
      FormComponent: ReservationsForm,
      basisType: "sales_order",
      sourceItemsEndpoint: "sales-order-items",
      sourceItemsParentField: "salesOrderUuid",
      mapFields: mapCommonTradeFields,
      existingCheckEndpoint: "reservations",
    },
    {
      docLabel: "Реализация товаров",
      FormComponent: SalesForm,
      basisType: "sales_order",
      sourceItemsEndpoint: "sales-order-items",
      sourceItemsParentField: "salesOrderUuid",
      mapFields: mapCommonTradeFields,
      existingCheckEndpoint: "sales",
    },
  ],
});

const SalesOrdersList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={SalesOrdersForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
    defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
SalesOrdersList.displayName = LIST_NAME;

export { SalesOrdersForm, SalesOrdersList };
