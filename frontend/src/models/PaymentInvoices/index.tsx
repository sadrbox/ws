import { FC } from "react";
import { translate } from "src/i18";
import { mapCommonTradeFields, mapPaymentFromBasis } from "src/utils/createFromBasis";
import { SalesForm } from "src/models/Sales";
import { BankStatementsForm } from "src/models/BankStatements";
import { CashReceiptOrdersForm } from "src/models/CashReceiptOrders";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { getFormatDateOnly } from "src/utils/datetime";
import ModelList from "src/components/ModelList";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";
import { createInvoiceLikeForm } from "src/models/_shared/createInvoiceLikeForm";
import PaymentInvoicePrint from "./PaymentInvoicePrint";

const MODEL_ENDPOINT = "payment-invoices";
const LIST_NAME = "PaymentInvoicesList";

/** БИН/ИИН лежат во ВЛОЖЕННЫХ серверных объектах, которых нет в полях формы. */
type TaxIds = { bin?: string; iin?: string };
const orgTax = (f: unknown): TaxIds => ((f as { organization?: TaxIds })?.organization ?? {});
const cpTax = (f: unknown): TaxIds => ((f as { counterparty?: TaxIds })?.counterparty ?? {});

const PaymentInvoicesForm: FC<Partial<TPane>> = createInvoiceLikeForm({
  endpoint: MODEL_ENDPOINT,
  itemsEndpoint: "paymentinvoiceitems",
  itemsParentField: "paymentInvoiceUuid",
  storageKey: "payment-invoices-form",
  listName: LIST_NAME,
  formLabel: "Счёт на оплату",
  itemsTabLabel: "Товары, услуги",
  itemsComponentName: "PaymentInvoiceItemsList_part",
  accessPermissionModel: "PaymentInvoice",
  formDisplayName: "PaymentInvoicesForm",
  docType: "payment_invoice",
  printConfig: {
    buildLayout: (fields, items, cols) => (
      <PaymentInvoicePrint data={{
        documentId: fields.id,
        documentNumber: fields.number || undefined,
        documentDate: fields.date,
        organizationName: fields.organizationName,
        organizationBin: orgTax(fields).bin ?? orgTax(fields).iin ?? undefined,
        counterpartyName: fields.counterpartyName,
        counterpartyBin: cpTax(fields).bin ?? cpTax(fields).iin ?? undefined,
        contractName: fields.contractName,
        items: items.map((r) => ({ number: r.number, name: r.name, unit: r.unit, quantity: r.quantity, price: r.price, vatRate: r.vatRate, vatAmount: r.vatAmount, amount: r.amount })),
        totalAmount: items.reduce((s: number, r: TDataItem) => s + Number(r.amount ?? 0), 0),
        totalVatAmount: items.reduce((s: number, r: TDataItem) => s + Number(r.vatAmount ?? 0), 0),
        columns: cols,
      }} />
    ),
    columnDefs: [
      { key: "vatRate", label: "Ставка НДС, %", defaultVisible: true },
      { key: "vatAmount", label: "Сумма НДС", defaultVisible: true },
    ],
    columnsKey: "payment_invoice",
    fileBaseName: (f) => `СчётОплата_${f.number || "новый"}`,
    title: (f) => `Счёт на оплату № ${f.number || "—"}`,
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
    {
      docLabel: translate("BankStatementsList"),
      FormComponent: BankStatementsForm,
      basisType: "payment_invoice",
      sourceItemsEndpoint: "paymentinvoiceitems",
      sourceItemsParentField: "paymentInvoiceUuid",
      mapFields: mapPaymentFromBasis,
      mapItems: () => [],
      existingCheckEndpoint: "bankstatements",
    },
    {
      docLabel: translate("CashReceiptOrdersList"),
      FormComponent: CashReceiptOrdersForm,
      basisType: "payment_invoice",
      sourceItemsEndpoint: "paymentinvoiceitems",
      sourceItemsParentField: "paymentInvoiceUuid",
      mapFields: mapPaymentFromBasis,
      mapItems: () => [],
      existingCheckEndpoint: "cash-receipt-orders",
    },
  ],
  hidePosted: true,
  // Счёт на оплату — не ЭСФ: скрыть графы акциза и промежуточных оборотов
  defaultHiddenItemColumns: ["amountNetOfIndirectTaxes", "amountWithoutVat", "discountPercent", "discountAmount"],
});

const PaymentInvoicesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }> = (
  { variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={PaymentInvoicesForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField} extraQueryParams={extraQueryParams}
    defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
PaymentInvoicesList.displayName = LIST_NAME;

export { PaymentInvoicesForm, PaymentInvoicesList };
