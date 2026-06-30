// ─────────────────────────────────────────────────────────────────────────────
// PurchaseReturnsForm — Возврат поставщику. Через единую фабрику createTradeDocForm.
// Особенности: без «Типа цены», контроль остатка при проведении, печать.
// ─────────────────────────────────────────────────────────────────────────────
import { createTradeDocForm } from "src/models/_shared/createTradeDocForm";
import columnsJson from "./columns.json";
import PurchaseReturnPrint from "./PurchaseReturnPrint";

const PRINT_COLUMN_DEFS = [
  { key: "discountPercent", label: "Скидка, %", defaultVisible: false },
  { key: "discountAmount", label: "Сумма скидки", defaultVisible: false },
  { key: "amountWithoutVat", label: "Облагаемый оборот", defaultVisible: true },
  { key: "exciseRate", label: "Ставка акциза, %", defaultVisible: false },
  { key: "exciseAmount", label: "Сумма акциза", defaultVisible: false },
  { key: "vatRate", label: "Ставка НДС, %", defaultVisible: true },
  { key: "vatAmount", label: "Сумма НДС", defaultVisible: true },
];

const { Form: PurchaseReturnsForm, List: PurchaseReturnsList } = createTradeDocForm({
  endpoint: "purchase-returns",
  itemsEndpoint: "purchase-return-items",
  itemsParentField: "purchaseReturnUuid",
  itemsBatchEndpoint: "purchase-return-items/batch",
  storageKey: "purchase-returns-form",
  listName: "PurchaseReturnsList",
  formLabel: "Возврат поставщику",
  formDisplayName: "PurchaseReturnsForm",
  itemsComponentName: "PurchaseReturnItemsList_part",
  itemsTableLabel: "Товары возврата",
  parentLabelListKey: "PurchaseReturnsList",
  userAccessRightModel: "PurchaseReturn",
  docType: "purchase_return",
  columnsJson,
  basisAllowedTypes: [{ type: "purchase", endpoint: "purchases" }],
  hasPriceType: false,
  defaultHiddenColumns: ["amountNetOfIndirectTaxes", "amountWithoutVat"],
  stockCheckDocType: "purchase_return",
  print: {
    columnsKey: "purchase_return",
    columnDefs: PRINT_COLUMN_DEFS,
    title: (f) => `Возврат поставщику № ${f.id ?? "—"}`,
    fileBaseName: (f) => `ВозвратПост_${f.id ?? "новый"}`,
    buildLayout: ({ fields, rows, cols }) => (
      <PurchaseReturnPrint data={{
        documentId: fields.id,
        documentNumber: fields.number || undefined,
        documentDate: fields.date,
        organizationName: fields.organizationName,
        counterpartyName: fields.counterpartyName,
        contractName: fields.contractName,
        items: rows,
        totalAmount: rows.reduce((s, r) => s + Number(r.amount ?? 0), 0),
        totalVatAmount: rows.reduce((s, r) => s + Number(r.vatAmount ?? 0), 0),
        totalAmountWithoutVat: rows.reduce((s, r) => s + Number(r.amountWithoutVat ?? 0), 0),
        totalExciseAmount: rows.reduce((s, r) => s + Number(r.exciseAmount ?? 0), 0),
        totalDiscountAmount: rows.reduce((s, r) => s + Number(r.discountAmount ?? 0), 0),
        columns: cols,
      }} />
    ),
  },
});

export { PurchaseReturnsForm, PurchaseReturnsList };
