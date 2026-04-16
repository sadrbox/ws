import { translate } from "src/i18";

/**
 * Формирует метку панели формы.
 *
 * Формат:
 *  - Если есть shortName: "ListName→shortName №ID"
 *  - Если нет shortName:  "ListName №ID"
 *
 * @param listName — ключ перевода (напр. "OrganizationsList")
 * @param fallback — русский fallback (напр. "Организации")
 * @param saved — сохранённая запись (должна содержать id, может содержать shortName)
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
    ? `${name}: ${detail} №${id}`
    : `${name} №${id}`;
}

/**
 * Формирует начальную метку панели при открытии из списка/таблицы.
 *
 * Формат единый с makePaneLabel:
 *  - Редактирование: "ListName→displayValue №ID"
 *  - Создание:       "ListName: Новый"
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
    ? `${name}: ${detail} №${id}`
    : `${name} №${id}`;
}
