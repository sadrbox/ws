import { createSimpleModel } from "src/utils/createSimpleModel";
import columnsJson from "./columns.json";

const { Form: BrandsForm, List: BrandsList } = createSimpleModel({
  endpoint: "brands",
  listName: "BrandsList",
  storageKey: "brands-form",
  formLabel: "Бренды",
  columnsJson,
  accessPermission: "Brand",
  fields: [
    { key: "name", label: "Наименование", required: true, requiredMessage: "Наименование обязательно" },
  ],
});

export { BrandsList, BrandsForm };
