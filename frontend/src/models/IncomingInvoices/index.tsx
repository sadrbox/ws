import { FC } from "react";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { getFormatDateOnly } from "src/utils/datetime";
import ModelList from "src/components/ModelList";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";
import { createInvoiceLikeForm } from "src/models/_shared/createInvoiceLikeForm";
import OutgoingInvoicePrint from "src/models/OutgoingInvoices/OutgoingInvoicePrint";
import type { SaleInvoicePrintColumns } from "src/models/Sales/SaleInvoicePrint";
import { mapCommonTradeFields } from "src/utils/createFromBasis";
import { PurchasesForm } from "src/models/Purchases";

const MODEL_ENDPOINT = "incoming-invoices";
const LIST_NAME = "IncomingInvoicesList";

const IncomingInvoicesForm: FC<Partial<TPane>> = createInvoiceLikeForm({
  endpoint: MODEL_ENDPOINT,
  itemsEndpoint: "incominginvoiceitems",
  itemsParentField: "incomingInvoiceUuid",
  storageKey: "incoming-invoices-form",
  listName: LIST_NAME,
  formLabel: "Счет-фактура входящая",
  itemsTabLabel: "Товары, услуги",
  itemsComponentName: "IncomingInvoiceItemsList_part",
  userAccessRightModel: "IncomingInvoice",
  formDisplayName: "IncomingInvoicesForm",
  docType: "incoming_invoice",
  defaultHiddenItemColumns: ["amountNetOfIndirectTaxes"],
  printConfig: {
    buildLayout: (fields, items, cols) => (
      <OutgoingInvoicePrint data={{
        direction: "incoming",
        documentId: fields.id,
        documentNumber: fields.number || undefined,
        documentDate: fields.date,
        organizationName: fields.organizationName,
        counterpartyName: fields.counterpartyName,
        contractName: fields.contractName,
        items: items.map((r, i) => ({ number: i + 1, name: r.name, unit: r.unit, quantity: r.quantity, price: r.price, discountPercent: r.discountPercent, discountAmount: r.discountAmount, exciseRate: r.exciseRate, exciseAmount: r.exciseAmount, amountWithoutVat: r.amountWithoutVat, vatRate: r.vatRate, vatAmount: r.vatAmount, amount: r.amount })),
        totalAmount: items.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0),
        totalAmountWithoutVat: items.reduce((s: number, r: any) => s + Number(r.amountWithoutVat ?? 0), 0),
        totalVatAmount: items.reduce((s: number, r: any) => s + Number(r.vatAmount ?? 0), 0),
        totalDiscountAmount: items.reduce((s: number, r: any) => s + Number(r.discountAmount ?? 0), 0),
        totalExciseAmount: items.reduce((s: number, r: any) => s + Number(r.exciseAmount ?? 0), 0),
        columns: cols as SaleInvoicePrintColumns,
      }} />
    ),
    columnDefs: [
      { key: "discountPercent", label: "Скидка, %", defaultVisible: false },
      { key: "discountAmount", label: "Сумма скидки", defaultVisible: false },
      { key: "amountNetOfIndirectTaxes", label: "Сумма без налогов", defaultVisible: false },
      { key: "amountWithoutVat", label: "Облагаемый оборот", defaultVisible: true },
      { key: "exciseRate", label: "Ставка акциза, %", defaultVisible: false },
      { key: "exciseAmount", label: "Сумма акциза", defaultVisible: false },
      { key: "vatRate", label: "Ставка НДС, %", defaultVisible: true },
      { key: "vatAmount", label: "Сумма НДС", defaultVisible: true },
    ],
    columnsKey: "incoming_invoice",
    fileBaseName: (f) => `СчФактура_вх_${f.number || "новый"}`,
    title: (f) => `Счёт-фактура вх. № ${f.number || "—"}`,
  },
  createFromBasisTargets: [
    {
      docLabel: "Поступление товаров",
      FormComponent: PurchasesForm,
      basisType: "incoming_invoice",
      sourceItemsEndpoint: "incominginvoiceitems",
      sourceItemsParentField: "incomingInvoiceUuid",
      mapFields: mapCommonTradeFields,
      existingCheckEndpoint: "purchases",
    },
  ],
});

const IncomingInvoicesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={IncomingInvoicesForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
    defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
IncomingInvoicesList.displayName = LIST_NAME;

export { IncomingInvoicesForm, IncomingInvoicesList };
