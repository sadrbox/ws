/**
 * formRegistry.ts — Утилита для открытия формы модели по endpoint + uuid.
 * Используется в журнале уведомлений для перехода к объекту.
 */

import { getByEndpoint, loadFormByEndpoint } from "./modelRegistry";
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
  });
}
