import { FC } from "react";
import { mapCommonTradeFields } from "src/utils/createFromBasis";
import { SalesForm } from "src/models/Sales";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { getFormatDateOnly } from "src/utils/main.module";
import ModelList from "src/components/ModelList";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";
import { createInvoiceLikeForm } from "src/models/_shared/createInvoiceLikeForm";
import PaymentInvoicePrint from "./PaymentInvoicePrint";

const MODEL_ENDPOINT = "payment-invoices";
const LIST_NAME = "PaymentInvoicesList";

const PaymentInvoicesForm: FC<Partial<TPane>> = createInvoiceLikeForm({
  endpoint: MODEL_ENDPOINT,
  itemsEndpoint: "paymentinvoiceitems",
  itemsParentField: "paymentInvoiceUuid",
  storageKey: "payment-invoices-form",
  listName: LIST_NAME,
  formLabel: "Счёт на оплату",
  itemsTabLabel: "Товары, услуги",
  itemsComponentName: "PaymentInvoiceItemsList_part",
  accessRightModel: "PaymentInvoice",
  formDisplayName: "PaymentInvoicesForm",
  docType: "payment_invoice",
  printConfig: {
    buildLayout: (fields: any, items, cols) => (
      <PaymentInvoicePrint data={{
        documentId: fields.id,
        documentDate: fields.date,
        organizationName: fields.organizationName,
        organizationBin: fields.organization?.bin ?? fields.organization?.iin ?? undefined,
        counterpartyName: fields.counterpartyName,
        counterpartyBin: fields.counterparty?.bin ?? fields.counterparty?.iin ?? undefined,
        contractName: fields.contractName,
        items: items.map((r) => ({ number: r.number, name: r.name, unit: r.unit, quantity: r.quantity, price: r.price, vatRate: r.vatRate, vatAmount: r.vatAmount, amount: r.amount })),
        totalAmount: items.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0),
        totalVatAmount: items.reduce((s: number, r: any) => s + Number(r.vatAmount ?? 0), 0),
        columns: cols,
      }} />
    ),
    columnDefs: [
      { key: "vatRate", label: "Ставка НДС, %", defaultVisible: true },
      { key: "vatAmount", label: "Сумма НДС", defaultVisible: true },
    ],
    columnsKey: "payment_invoice",
    fileBaseName: (f) => `СчётОплата_${f.id ?? "новый"}`,
    title: (f) => `Счёт на оплату № ${f.id ?? "—"}`,
  },
  createFromBasisTargets: [
    {
      docLabel: "Реализация товара и услуг",
      FormComponent: SalesForm,
      basisType: "payment_invoice",
      sourceItemsEndpoint: "paymentinvoiceitems",
      sourceItemsParentField: "paymentInvoiceUuid",
      mapFields: mapCommonTradeFields,
      existingCheckEndpoint: "sales",
    },
  ],
  hidePosted: true,
  // Счёт на оплату — не ЭСФ: скрыть графы акциза и промежуточных оборотов
  defaultHiddenItemColumns: ["amountNetOfIndirectTaxes", "amountWithoutVat", "discountPercent", "discountAmount"],
});

const PaymentInvoicesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={PaymentInvoicesForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
    defaultSort={{ id: "desc" }}
    renderCell={renderPostedCell}
  />
);
PaymentInvoicesList.displayName = LIST_NAME;

export { PaymentInvoicesForm, PaymentInvoicesList };
