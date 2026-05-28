import { FC } from "react";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { getFormatDateOnly } from "src/utils/main.module";
import ModelList from "src/components/ModelList";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";
import { createInvoiceLikeForm } from "src/models/_shared/createInvoiceLikeForm";
import PurchaseRequisitionPrint from "./PurchaseRequisitionPrint";
import { mapCommonTradeFields } from "src/utils/createFromBasis";
import { PurchasesForm } from "src/models/Purchases";

const MODEL_ENDPOINT = "purchase-requisitions";
const LIST_NAME = "PurchaseRequisitionsList";

const PurchaseRequisitionsForm: FC<Partial<TPane>> = createInvoiceLikeForm({
  endpoint: MODEL_ENDPOINT,
  itemsEndpoint: "purchase-requisition-items",
  itemsParentField: "purchaseRequisitionUuid",
  storageKey: "purchase-requisitions-form",
  listName: LIST_NAME,
  formLabel: "Заявка на закупку",
  itemsTabLabel: "Товары, услуги",
  itemsComponentName: "PurchaseRequisitionItemsList_part",
  accessRightModel: "PurchaseRequisition",
  formDisplayName: "PurchaseRequisitionsForm",
  docType: "purchase_requisition",
  printConfig: {
    buildLayout: (fields, items, cols) => (
      <PurchaseRequisitionPrint data={{
        documentId: fields.id,
        documentDate: fields.date,
        organizationName: fields.organizationName,
        counterpartyName: fields.counterpartyName,
        contractName: fields.contractName,
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
    columnsKey: "purchase_requisition",
    fileBaseName: (f) => `ЗаявкаЗакупку_${f.id ?? "новый"}`,
    title: (f) => `Заявка на закупку № ${f.id ?? "—"}`,
  },
  createFromBasisTargets: [
    {
      docLabel: "Поступление товаров",
      FormComponent: PurchasesForm,
      basisType: "purchase_requisition",
      sourceItemsEndpoint: "purchase-requisition-items",
      sourceItemsParentField: "purchaseRequisitionUuid",
      mapFields: mapCommonTradeFields,
      existingCheckEndpoint: "purchases",
    },
  ],
  // Заявка на закупку — внутренний документ: скрыть графы налоговых оборотов и скидок
  defaultHiddenItemColumns: ["amountNetOfIndirectTaxes", "amountWithoutVat", "discountPercent", "discountAmount"],
});

const PurchaseRequisitionsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={PurchaseRequisitionsForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
    defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
PurchaseRequisitionsList.displayName = LIST_NAME;

export { PurchaseRequisitionsForm, PurchaseRequisitionsList };
