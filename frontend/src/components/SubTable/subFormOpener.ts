/**
 * openSubFormPane — единый механизм открытия формы элемента из sub-таблицы.
 *
 * Инкапсулирует общий паттерн для ВСЕХ моделей с `openFormFor` (Contacts,
 * BankAccounts, Contracts, Warehouses, Cashboxes, Employees, AccessRights,
 * AccessPermissions, …), чтобы три легко забываемых правила были в ОДНОМ месте:
 *
 *   1. Временная (несохранённая) строка НЕ считается существующей. У неё uuid вида
 *      «tmp-…» и отрицательный id; `!!uuid` дал бы isEdit=true → форма грузила бы
 *      запись по фейковому uuid (GET /…/tmp-… → 404).
 *   2. НОВАЯ форма предзаполняется значениями из строки (`...data`) + контекстом
 *      родителя — иначе набранное inline в таблице теряется.
 *   3. После УСПЕШНОГО сохранения исходная temp-строка убирается из таблицы
 *      (ctx.removeRow(sourceRow)) — иначе останется дублем рядом с созданным
 *      элементом. Только на onSave, НЕ на onClose (иначе закрытие теряло бы черновик).
 *
 * Раньше это дублировалось в каждой модели, и часть правил забывали — отсюда
 * баги 404 / пустые поля / дубль после сохранения.
 */
import type { FC } from "react";
import type { TPane } from "src/app/types";
import type { TDataItem } from "src/components/Table/types";
import type { SubTableContext } from "./index";
import { isUnsavedRow } from "./rowModel";

export interface SubFormOpenerCfg {
  addPane: (pane: Partial<TPane>) => void;
  /** Инвалидация кэша списка после сохранения/закрытия (обычно invalidateQueries по эндпоинту). */
  invalidate: () => void;
  component: FC<Partial<TPane>>;
  /** Заголовок панели: (data, isEdit) → строка. */
  label: (data: TDataItem | undefined, isEdit: boolean) => string;
  /** Поля контекста родителя/владельца для НОВОЙ записи (перекрывают значения строки). */
  newContext?: (data: TDataItem | undefined) => Record<string, unknown>;
  /** Заблокировать создание (напр. нет права) — вернуть true, чтобы не открывать. */
  blockNew?: () => boolean;
}

export function openSubFormPane(
  cfg: SubFormOpenerCfg,
  data: TDataItem | undefined,
  ctx: SubTableContext,
  sourceRow?: TDataItem,
): void {
  const isEdit = !!data?.uuid && !isUnsavedRow(data);
  if (!isEdit && cfg.blockNew?.()) return;

  const refresh = () => {
    cfg.invalidate();
    ctx.refetch();
  };
  // Удаление исходной temp-строки — ТОЛЬКО при сохранении, не при закрытии.
  const onSaved = () => {
    if (sourceRow) void ctx.removeRow(sourceRow);
    refresh();
  };

  cfg.addPane({
    label: cfg.label(data, isEdit),
    component: cfg.component,
    data: (isEdit
      ? data
      : { ...((data as Record<string, unknown>) ?? {}), ...(cfg.newContext?.(data) ?? {}) }) as Partial<TDataItem>,
    onSave: onSaved,
    onClose: refresh,
  });
}
