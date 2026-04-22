import { translate } from "src/i18";
import { getFormatDateOnly } from "src/utils/main.module";

/**
 * Метка для СПРАВОЧНИКОВ: "Организация: №5" или "Организация: №5 · Рога и Копыта"
 */
export function makePaneLabel(
  listName: string,
  fallback: string,
  saved: Record<string, any>,
  displayValue?: string,
): string {
  const name = translate(listName) || fallback;
  const id = saved.id ?? "?";
  const detail = displayValue ?? saved.shortName;
  return detail
    ? `${name}: №${id} · ${detail}`
    : `${name}: №${id}`;
}

/**
 * Метка для ДОКУМЕНТОВ: "Реализация: №4 · 21.04.2026"
 * dateField — имя поля даты в saved (по умолчанию "date")
 */
export function makeDocLabel(
  listName: string,
  fallback: string,
  saved: Record<string, any>,
  dateField = "date",
): string {
  const name = translate(listName) || fallback;
  const id = saved.id ?? "?";
  const date = saved[dateField] ? getFormatDateOnly(String(saved[dateField])) : undefined;
  return date
    ? `${name}: №${id} · ${date}`
    : `${name}: №${id}`;
}

/**
 * Метка при открытии панели из списка/таблицы (до загрузки данных).
 * Единый паттерн: "Label: №id · detail" / "Label: №id" / "Label: Новый"
 */
export function makePaneLabelFromData(
  listName: string,
  fallback: string,
  data?: Record<string, any> | null,
  displayValue?: string,
): string {
  const name = translate(listName) || fallback;
  if (!data?.uuid && !data?.id) return `${name}: ${translate("new") || "Новый"}`;
  const id = data.id ?? "?";
  const detail = displayValue ?? data.shortName;
  return detail
    ? `${name}: №${id} · ${detail}`
    : `${name}: №${id}`;
}
