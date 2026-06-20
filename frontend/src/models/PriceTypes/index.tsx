import { createSimpleModel } from "src/utils/createSimpleModel";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import columnsJson from "./columns.json";

const { Form: PriceTypesForm, List: PriceTypesList } = createSimpleModel({
  endpoint: "price-types",
  listName: "PriceTypesList",
  storageKey: "price-types-form",
  formLabel: "Типы цен",
  columnsJson,
  userAccessRight: "Product",
  fields: [
    { key: "name", label: "Наименование типа цены *", required: true, requiredMessage: "Наименование обязательно" },
    { key: "isDefault", label: "По умолчанию", type: "toggle" },
    { key: "sortOrder", label: "Порядок сортировки" },
  ],
  buildPaneLabel: (saved) =>
    makePaneLabel("PriceTypesList", "Типы цен", saved, (saved?.name as string | undefined) || undefined),
  getLabel: (d) => `${(d?.name as string | undefined) || "?"}`,
});

export { PriceTypesList, PriceTypesForm };
