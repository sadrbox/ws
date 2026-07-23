// Справочник «Статусы задач» (E9.5) — набор статусов настраивается, т.к. команды
// ведут учёт по-своему. `code` хранится в Todo.status и после создания НЕ меняется
// (иначе осиротели бы уже созданные задачи) — сервер игнорирует его в PUT.
// `isFinal` помечает завершающие статусы: по нему считается просрочка на доске.
import { createSimpleModel } from "src/utils/createSimpleModel";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import columnsJson from "./columns.json";

const { Form: TodoStatusesForm, List: TodoStatusesList } = createSimpleModel({
  endpoint: "todo-statuses",
  listName: "TodoStatusesList",
  storageKey: "todo-statuses-form",
  formLabel: "Статусы задач",
  columnsJson,
  accessPermission: "Todo",
  fields: [
    { key: "name", label: "Наименование статуса *", required: true, requiredMessage: "Наименование обязательно" },
    { key: "code", label: "Код (латиницей, задаётся один раз)" },
    { key: "sortOrder", label: "Порядок колонки на доске" },
    { key: "isFinal", label: "Завершающий (задача не считается просроченной)", type: "toggle" },
  ],
  buildPaneLabel: (saved) =>
    makePaneLabel("TodoStatusesList", "Статусы задач", saved, (saved?.name as string | undefined) || undefined),
  getLabel: (d) => `${(d?.name as string | undefined) || "?"}`,
});

export { TodoStatusesList, TodoStatusesForm };
