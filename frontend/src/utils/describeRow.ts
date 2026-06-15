import { getByEndpoint } from "src/registry/modelRegistry";
import { makeDocLabel, makePaneLabelFromData, type LabelSource } from "src/utils/buildPaneLabel";

/**
 * Человекочитаемое описание строки таблицы для подтверждений/уведомлений.
 *
 * Документы (есть number/date): «Заявка на закупку: № 5 · 12.02.2026».
 * Справочники: «Контрагент: ID 405 · Поставщик «ТоргДом-1»».
 *
 * Имя сущности берётся из реестра (listName → singular *Form-ключ i18), формат —
 * через те же makeDocLabel / makePaneLabelFromData, что и заголовки панелей.
 */
export function describeRow(endpoint: string, row: LabelSource): string {
  const entry = getByEndpoint(endpoint);
  const listName = entry?.listName ?? endpoint;
  const fallback = entry?.label ?? endpoint;
  const isDocument = row.number != null || row.date != null;
  return isDocument
    ? makeDocLabel(listName, fallback, row, "date")
    : makePaneLabelFromData(listName, fallback, row, typeof row.name === "string" ? row.name : undefined);
}
