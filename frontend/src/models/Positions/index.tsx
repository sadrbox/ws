import { createSimpleModel } from "src/utils/createSimpleModel";
import columnsJson from "./columns.json";

const { Form: PositionsForm, List: PositionsList } = createSimpleModel({
  endpoint: "positions",
  listName: "PositionsList",
  storageKey: "positions-form",
  formLabel: "Должности",
  columnsJson,
  userAccessRight: "Position",
  fields: [
    { key: "name", label: "Наименование", required: true, requiredMessage: "Наименование обязательно" },
    { key: "comment", label: "Описание" },
  ],
});

export { PositionsList, PositionsForm };
