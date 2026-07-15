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
import { SalesForm } from "src/models/Sales";

const MODEL_ENDPOINT = "reservations";
const LIST_NAME = "ReservationsList";

const ReservationsForm: FC<Partial<TPane>> = createInvoiceLikeForm({
  endpoint: MODEL_ENDPOINT,
  itemsEndpoint: "reservation-items",
  itemsParentField: "reservationUuid",
  storageKey: "reservations-form",
  listName: LIST_NAME,
  formLabel: "Резервирование товара",
  itemsTabLabel: "Товары, услуги",
  itemsComponentName: "ReservationItemsList_part",
  accessPermissionModel: "Reservation",
  formDisplayName: "ReservationsForm",
  docType: "reservation",
  // Резерв ПРОВОДИТСЯ: только проведённый двигает регистр резервов (уменьшает
  // доступный к продаже остаток), поэтому тоггл «Проведён» нужен на форме.
  hasWarehouse: true,
  printConfig: {
    buildLayout: (fields, items, cols) => (
      <TradeDocumentPrint title="РЕЗЕРВИРОВАНИЕ ТОВАРА" counterpartyLabel="Покупатель" totalLabel="Итого" data={{
        documentId: fields.id, documentNumber: fields.number || undefined, documentDate: fields.date,
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
    columnsKey: "reservation",
    fileBaseName: (f) => `Резерв_${f.number || "новый"}`,
    title: (f) => `Резервирование № ${f.number || "—"}`,
  },
  basisConfig: {
    allowedTypes: [{ type: "sales_order", endpoint: "sales-orders" }],
  },
  createFromBasisTargets: [
    {
      docLabel: "Реализация товаров",
      FormComponent: SalesForm,
      basisType: "reservation",
      sourceItemsEndpoint: "reservation-items",
      sourceItemsParentField: "reservationUuid",
      mapFields: mapCommonTradeFields,
      existingCheckEndpoint: "sales",
    },
  ],
});

const ReservationsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }> = (
  { variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }
) => (
  <ModelList
    endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={ReservationsForm}
    getLabel={(d) => d?.date ? getFormatDateOnly(d.date as string) : ""}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField} extraQueryParams={extraQueryParams}
    defaultSort={{ id: "desc" }} enableDateRange
    renderCell={renderPostedCell}
  />
);
ReservationsList.displayName = LIST_NAME;

export { ReservationsForm, ReservationsList };
