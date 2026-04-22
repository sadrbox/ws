import { createSimpleModel } from "src/utils/createSimpleModel";
import columnsJson from "./columns.json";

const { Form: UnitOfMeasuresForm, List: UnitOfMeasuresList } = createSimpleModel({
  endpoint: "unit-of-measures",
  listName: "UnitOfMeasuresList",
  storageKey: "unit-of-measures-form",
  formLabel: "Единицы измерения",
  columnsJson,
  accessRight: "UnitOfMeasure",
  fields: [
    { key: "shortName", label: "Наименование *", required: true, requiredMessage: "Наименование обязательно" },
    { key: "code", label: "Код" },
  ],
});

export { UnitOfMeasuresList, UnitOfMeasuresForm };
