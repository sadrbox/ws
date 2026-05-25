import { FC } from "react";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { getFormatDateOnly } from "src/utils/main.module";
import ModelList from "src/components/ModelList";
import { renderPostedCell } from "src/models/_shared/renderPostedCell";
import { createInvoiceLikeForm } from "src/models/_shared/createInvoiceLikeForm";
import { translate } from "src/i18";
import OutgoingInvoicePrint from "./OutgoingInvoicePrint";
import type { SaleInvoicePrintColumns } from "src/models/Sales/SaleInvoicePrint";

const MODEL_ENDPOINT = "outgoing-invoices";
const LIST_NAME = "OutgoingInvoicesList";

const OutgoingInvoicesForm: FC<Partial<TPane>> = createInvoiceLikeForm({
  endpoint: MODEL_ENDPOINT,
  itemsEndpoint: "outgoinginvoiceitems",
  itemsParentField: "outgoingInvoiceUuid",
  storageKey: "outgoing-invoices-form",
  listName: LIST_NAME,
  formLabel: "Счет-фактура исходящая",
  itemsTabLabel: "Товары, услуги",
  itemsComponentName: "OutgoingInvoiceItemsList_part",
  accessRightModel: "OutgoingInvoice",
  formDisplayName: "OutgoingInvoicesForm",
  docType: "outgoing_invoice",
  basisConfig: {
    allowedTypes: [{ type: "sale", endpoint: "sales", label: translate("saleRealization") }],
  },
  printConfig: {
    buildLayout: (fields, items, cols) => (
      <OutgoingInvoicePrint data={{
        direction: "outgoing",
        documentId: fields.id,
        documentDate: fields.date,
        organizationName: fields.organizationName,
        counterpartyName: fields.counterpartyName,
        contractName: fields.contractName,
        items: items.map((r, i) => ({ number: i + 1, name: r.name, unit: r.unit, quantity: r.quantity, price: r.price, discountPercent: r.discountPercent, discountAmount: r.discountAmount, exciseRate: r.exciseRate, exciseAmount: r.exciseAmount, amountWithoutVat: r.amountWithoutVat, amountNetOfIndirectTaxes: Number(r.amountWithoutVat ?? 0) - Number(r.exciseAmount ?? 0), vatRate: r.vatRate, vatAmount: r.vatAmount, amount: r.amount })),
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
    columnsKey: "outgoing_invoice",
    fileBaseName: (f) => `СчФактура_${f.id ?? "новый"}`,
    title: (f) => `Счёт-фактура № ${f.id ?? "—"}`,
  },
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
