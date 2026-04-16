import { createSimpleModel } from "src/utils/createSimpleModel";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import columnsJson from "./columns.json";

const { Form: CurrenciesForm, List: CurrenciesList } = createSimpleModel({
  endpoint: "currencies",
  listName: "CurrenciesList",
  storageKey: "currencies-form",
  formLabel: "Валюты",
  columnsJson,
  accessRight: "Currency",
  fields: [
    { key: "code", label: "Код валюты (ISO) *", required: true, requiredMessage: "Код валюты обязателен", minWidth: "150px" },
    { key: "shortName", label: "Наименование *", required: true, requiredMessage: "Наименование обязательно" },
    { key: "symbol", label: "Символ", minWidth: "100px" },
  ],
  buildPaneLabel: (saved) =>
    makePaneLabel("CurrenciesList", "Валюты", saved, [saved.code, saved.shortName].filter(Boolean).join(" ") || undefined),
  getLabel: (d) => `${d?.code || "?"} — ${d?.shortName || "?"}`,
});

export { CurrenciesList, CurrenciesForm };
