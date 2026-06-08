import { createSimpleModel } from "src/utils/createSimpleModel";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import columnsJson from "./columns.json";

const { Form: CurrenciesForm, List: CurrenciesList } = createSimpleModel({
  endpoint: "currencies",
  listName: "CurrenciesList",
  storageKey: "currencies-form",
  formLabel: "Валюты",
  columnsJson,
  userAccessRight: "Currency",
  fields: [
    { key: "code", label: "Код валюты (ISO) *", required: true, requiredMessage: "Код валюты обязателен", minWidth: "150px" },
    { key: "name", label: "Наименование *", required: true, requiredMessage: "Наименование обязательно" },
    { key: "symbol", label: "Символ", minWidth: "100px" },
  ],
  buildPaneLabel: (saved) =>
    makePaneLabel("CurrenciesList", "Валюты", saved, [saved.code, saved.name].filter(Boolean).join(" ") || undefined),
  getLabel: (d) => `${(d?.code as string | undefined) || "?"} — ${(d?.name as string | undefined) || "?"}`,
});

export { CurrenciesList, CurrenciesForm };
