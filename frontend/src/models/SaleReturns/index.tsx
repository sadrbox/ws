// ─────────────────────────────────────────────────────────────────────────────
// SaleReturnsForm — Возврат от покупателя. Через единую фабрику createTradeDocForm.
// Особенности: без «Типа цены», без контроля остатка (приход на склад), печать.
// ─────────────────────────────────────────────────────────────────────────────
import { createTradeDocForm } from "src/models/_shared/createTradeDocForm";
import columnsJson from "./columns.json";
import SalesReturnPrint from "./SalesReturnPrint";

const PRINT_COLUMN_DEFS = [
  { key: "discountPercent", label: "Скидка, %", defaultVisible: false },
  { key: "discountAmount", label: "Сумма скидки", defaultVisible: false },
  { key: "amountWithoutVat", label: "Облагаемый оборот", defaultVisible: true },
  { key: "exciseRate", label: "Ставка акциза, %", defaultVisible: false },
  { key: "exciseAmount", label: "Сумма акциза", defaultVisible: false },
  { key: "vatRate", label: "Ставка НДС, %", defaultVisible: true },
  { key: "vatAmount", label: "Сумма НДС", defaultVisible: true },
];

const { Form: SaleReturnsForm, List: SaleReturnsList } = createTradeDocForm({
  endpoint: "sale-returns",
  itemsEndpoint: "sale-return-items",
  itemsParentField: "saleReturnUuid",
  itemsBatchEndpoint: "sale-return-items/batch",
  storageKey: "sale-returns-form",
  listName: "SaleReturnsList",
  formLabel: "Возврат от покупателя",
  formDisplayName: "SaleReturnsForm",
  itemsComponentName: "SaleReturnItemsList_part",
  itemsTableLabel: "Товары возврата",
  parentLabelListKey: "SaleReturnsList",
  accessPermissionModel: "SaleReturn",
  docType: "sale_return",
  columnsJson,
  // Возврат от покупателя — приход на склад: партия задаётся (receipt).
  // Серии: режим "return" — не приёмка (серия не появляется заново), а РЕИНСТЕЙТ
  // ранее проданной: пользователь выбирает из проданных серий (при наличии
  // документа-основания — именно из его серий), и они возвращаются в in_stock.
  serialMode: "return",
  serialDocType: "sale_return",
  batchMode: "receipt",
  basisAllowedTypes: [{ type: "sale", endpoint: "sales" }],
  hasPriceType: false,
  defaultHiddenColumns: ["amountNetOfIndirectTaxes", "amountWithoutVat"],
  print: {
    columnsKey: "sale_return",
    columnDefs: PRINT_COLUMN_DEFS,
    title: (f) => `Возврат от покупателя № ${f.id ?? "—"}`,
    fileBaseName: (f) => `ВозвратПокуп_${f.id ?? "новый"}`,
    buildLayout: ({ fields, rows, cols }) => (
      <SalesReturnPrint data={{
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

export { SaleReturnsForm, SaleReturnsList };
