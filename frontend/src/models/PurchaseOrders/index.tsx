import { FC } from "react";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { getFormatDateOnly } from "src/utils/datetime";
import ModelList from "src/components/ModelList";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";
import { createInvoiceLikeForm } from "src/models/_shared/createInvoiceLikeForm";
import { mapCommonTradeFields, mapPaymentFromBasis } from "src/utils/createFromBasis";
import { CashExpenseOrdersForm } from "src/models/CashExpenseOrders";
import { translate } from "src/i18";
import TradeDocumentPrint from "src/models/_shared/TradeDocumentPrint";
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
  accessPermissionModel: "PurchaseOrder",
  formDisplayName: "PurchaseOrdersForm",
  docType: "purchase_order",
  hidePosted: true,
  hasWarehouse: true,
  printConfig: {
    buildLayout: (fields, items, cols) => (
      <TradeDocumentPrint title="ЗАКАЗ ПОСТАВЩИКУ" counterpartyLabel="Поставщик" totalLabel="Итого по заказу" data={{
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
    columnsKey: "purchase_order",
    fileBaseName: (f) => `ЗаказПоставщику_${f.number || "новый"}`,
    title: (f) => `Заказ поставщику № ${f.number || "—"}`,
  },
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
    {
      docLabel: translate("CashExpenseOrdersList"),
      FormComponent: CashExpenseOrdersForm,
      basisType: "purchase_order",
      sourceItemsEndpoint: "purchase-order-items",
      sourceItemsParentField: "purchaseOrderUuid",
      mapFields: mapPaymentFromBasis,
      mapItems: () => [],
      existingCheckEndpoint: "cash-expense-orders",
    },
  ],
});

const PurchaseOrdersList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }> = (
  { variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={PurchaseOrdersForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField} extraQueryParams={extraQueryParams}
    defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
PurchaseOrdersList.displayName = LIST_NAME;

export { PurchaseOrdersForm, PurchaseOrdersList };
