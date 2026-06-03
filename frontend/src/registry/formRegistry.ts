/**
 * formRegistry.ts — Утилита для открытия формы модели по endpoint + uuid.
 * Используется в журнале уведомлений для перехода к объекту.
 */

import {
  getByEndpoint,
  getAllEntries,
  loadFormByEndpoint,
  loadListByEndpoint,
  type ModelRegistryEntry,
} from "./modelRegistry";
import type { TDataItem } from "src/components/Table/types";

/**
 * Открыть форму модели по endpoint и uuid.
 */
export async function openFormByEndpoint(
  endpoint: string,
  uuid: string,
  addPane: (options: any) => void,
): Promise<void> {
  const entry = getByEndpoint(endpoint);
  if (!entry) return;
  const FormComponent = await loadFormByEndpoint(endpoint);
  if (!FormComponent) return;
  addPane({
    label: `${entry.label} → загрузка…`,
    component: FormComponent,
    data: { uuid } as TDataItem,
    restore: { kind: "form", endpoint, uuid },
  });
}

/**
 * Резолвит запись реестра по «ссылке»: это может быть endpoint ("sales",
 * "cash-receipt-orders") ИЛИ имя модели/компонента ("Sales", "SalesList",
 * "SalesForm", "CashReceiptOrders").
 */
function resolveEntryByRef(ref: string): ModelRegistryEntry | undefined {
  const low = ref.trim().toLowerCase();
  // 1) прямое совпадение по endpoint.
  const direct = getByEndpoint(low);
  if (direct) return direct;
  // 2) по имени: listName/formName или endpoint без дефисов
  //    (Sales→sales, CashReceiptOrders→cash-receipt-orders).
  const noDash = low.replace(/[-_]/g, "");
  return getAllEntries().find(
    (e) =>
      e.endpoint.replace(/[-_]/g, "") === noDash ||
      e.listName.toLowerCase() === low ||
      e.formName.toLowerCase() === low ||
      e.listName.toLowerCase() === `${low}list` ||
      e.formName.toLowerCase() === `${low}form`,
  );
}

/**
 * Открыть СПИСОК модели в новой панели по «ссылке» (endpoint или имя модели).
 * Аналог openFormByRef, но открывает *List-компонент (а не форму).
 *
 * ```ts
 * openListByRef("Sales", addPane);             // откроет SalesList
 * openListByRef("cash-receipt-orders", addPane);
 * ```
 */
export async function openListByRef(
  ref: string,
  addPane: (options: any) => void,
  paneLabel?: string,
): Promise<void> {
  const entry = resolveEntryByRef(ref);
  if (!entry) {
    console.warn(`[openListByRef] неизвестная модель: "${ref}"`);
    return;
  }
  const ListComponent = await loadListByEndpoint(entry.endpoint);
  if (!ListComponent) {
    console.warn(`[openListByRef] не найден List-компонент для "${entry.endpoint}"`);
    return;
  }
  addPane({
    component: ListComponent,
    label: paneLabel ?? entry.label,
    restore: { kind: "list", ref: entry.endpoint },
  });
}
