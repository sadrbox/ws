/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-floating-promises */
// ─────────────────────────────────────────────────────────────────────────────
// TradeDocumentItemsTable — обобщённая таблица строк (позиций) торгового
// документа РК. Структура и алгоритм идентичны SaleItemsTable, но параметры
// (endpoint, parentField, componentName) задаются через props, что позволяет
// использовать один компонент для Покупок, Счёт-фактур (исх/вх),
// Счёт на оплату, и (в режиме hasTaxes=false) Перемещения ТМЗ.
//
// Соответствие законодательству РК:
//   • НК РК ст. 412 — графы ЭСФ: 4/6/7/8/13/14/15/16/17
//   • НК РК ст. 422 — Ставка НДС, % 0..100%
//   • НК РК ст. 463 — акциз (база afterDiscount, метод ADDED)
//   • НК РК ст. 372 п.2 пп.3 — внутренние перемещения ТМЗ не являются
//                              облагаемым оборотом (hasTaxes=false)
// ─────────────────────────────────────────────────────────────────────────────
import { FC, useCallback, useMemo, useState, useRef } from "react";
import type { MutableRefObject, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { Field, FieldNumber, FieldSelect } from "src/components/Field";
import FieldActionButton from "src/components/Field/FieldActionButton";
import LookupField from "src/components/Field/LookupField";
import { ClassifierLookup } from "src/components/Field/ClassifierLookup";
import { useEsfDictionaries } from "src/services/esf/dictionaries";
import styles from "./TradeDocumentItemsTable.module.scss";
import apiClient from "src/services/api/client";
import columnsJson from "./documentItemsColumns.json";
import SubTable, { ReadOnlyCell, type SubTableContext, type SubTableApi, type TCellValidator } from "src/components/SubTable";
import { SerialNumbersCell } from "./SerialNumbersCell";
import { useSubTableContext } from "src/components/SubTable/context";
import { withSaleItemRecalc, withSaleItemRecalcFromDiscountAmount, recalcSaleItemAmounts } from "src/models/Sales/saleItemDraft";
import { parseNumericInput } from "src/components/Table/services";
import useOrgAccountingSettings from "src/hooks/useOrgAccountingSettings";
import { Toolbar } from "src/components/Toolbar";
import { useTableContext } from "src/components/Table";
import { isEquivalent } from "src/utils/normalize";

const VAT_COLUMN_IDS = new Set(["vatRate", "vatAmount"]);
const DISCOUNT_COLUMN_IDS = new Set(["discountPercent", "discountAmount"]);
const EXCISE_COLUMN_IDS = new Set(["exciseRate", "exciseAmount"]);
const AMOUNT_WITHOUT_VAT_IDS = new Set(["amountWithoutVat", "amountNetOfIndirectTaxes"]);
// ЭСФ-метаданные строки (из карточки товара) — только для СФ исходящей.
const ESF_COLUMN_IDS = new Set(["product.tnvedCode", "product.truOriginCode", "productDeclaration", "productNumberInDeclaration"]);
// Ценовые колонки — не нужны для документов без стоимостной части (напр.
// Перемещение ТМЗ только двигает товар: ни цены, ни скидки, ни суммы продажи).
const PRICING_COLUMN_IDS = new Set(["price", "amount", "discountPercent", "discountAmount"]);
// Колонки Инвентаризации: учётное количество (из регистра) и отклонение
// (факт − учёт). Обе только для чтения; «факт» вводится в колонке quantity.
const STOCKCOUNT_COLUMN_IDS = new Set(["accountingQuantity", "deviation"]);
// Колонка серийных номеров (T6.1) — только если документ в роли receipt/issue.
const SERIAL_COLUMN_IDS = new Set(["serials"]);

const focusNextInRow = (currentTarget: EventTarget | null) => {
  if (!(currentTarget instanceof HTMLElement)) return;
  const tr = currentTarget.closest("tr");
  if (!tr) return;
  const inputs = Array.from(tr.querySelectorAll<HTMLInputElement>('input:not([disabled]):not([type="checkbox"])'));
  const idx = inputs.indexOf(currentTarget as HTMLInputElement);
  if (idx >= 0 && idx < inputs.length - 1) {
    const next = inputs[idx + 1];
    next.focus();
    try { next.select(); } catch { /* */ }
  } else {
    let nextTr = tr.nextElementSibling as HTMLElement | null;
    while (nextTr && nextTr.tagName === "TR") {
      const nextInputs = Array.from(nextTr.querySelectorAll<HTMLInputElement>('input:not([disabled]):not([type="checkbox"])'));
      if (nextInputs.length > 0) {
        nextInputs[0].focus();
        try { nextInputs[0].select(); } catch { /* */ }
        return;
      }
      nextTr = nextTr.nextElementSibling as HTMLElement | null;
    }
  }
};

export interface TradeDocumentItemsTableProps {
  /** UUID родительского документа. */
  parentUuid: string;
  /** Имя поля FK (purchaseUuid / outgoingInvoiceUuid / …). */
  parentField: string;
  /** REST-эндпоинт (purchaseitems / outgoinginvoiceitems / …). */
  endpoint: string;
  /** Уникальное имя компонента для хранения настроек таблицы. */
  componentName: string;
  /** UUID организации — для подбора настроек учёта (НДС/скидки). */
  organizationUuid?: string | null;
  /** Дата документа (ISO YYYY-MM-DD) — для исторического подбора настроек. */
  documentDate?: string | null;
  /** Заголовок-префикс для подвкладок строк. */
  parentLabel?: string;
  disabled?: boolean;
  onTotalChange?: (total: number, items?: TDataItem[]) => void;
  deferRemoteChanges?: boolean;
  onItemsChange?: (items: TDataItem[]) => void;
  initialPendingRows?: TDataItem[];
  /** Если false (ТМЗ) — НДС/акциз/Сумма скидки отключаются принудительно. */
  hasTaxes?: boolean;
  /** Если false — документ без стоимостной части (напр. Перемещение ТМЗ только
   *  двигает товар): скрываются колонки Цена / Сумма / Процент скидки / Сумма скидки. */
  hasPricing?: boolean;
  /** Сообщение, когда у документа нет строк. */
  emptyMessage?: string;
  /** Показывать подсветку обязательных полей (только после неудачной попытки сохранения). */
  showRequiredHighlight?: boolean;
  /** Колбэк при любом обновлении кэша строк (включая загрузку с сервера). Используется для печати. */
  onAllItemsChange?: (rows: TDataItem[]) => void;
  /** Колонки, скрытые по умолчанию для данного типа документа (пользователь может включить через настройки). */
  defaultHiddenColumns?: string[];
  /** Показывать ЭСФ-метаданные строк (ТН ВЭД, признак происхождения — из карточки товара). Для СФ исходящей. */
  showEsfColumns?: boolean;
  /** Показывать колонки Инвентаризации: «Кол-во по учёту» и «Отклонение» (обе — только чтение). */
  showStockCountColumns?: boolean;
  /** Роль документа для серийных номеров: "receipt" (приёмка) | "issue" (выбытие).
   *  Включает колонку «Серии» для товаров с учётом по серийным номерам. */
  serialMode?: "receipt" | "issue";
  /** documentType для операций с сериями (goods_receipt/purchase/sale/write_off/…). */
  serialDocType?: string;
  /** Склад документа — нужен для приёмки/выбора серий. */
  warehouseUuid?: string;
  /** Переопределяет кнопку «Обновить» в тулбаре SubTable (вместо handleCleanRefresh). */
  onRefresh?: () => void;
  /** Запретить добавление строк (независимо от disabled). */
  disableAddRows?: boolean;
  /** Запретить удаление строк (независимо от disabled), но редактирование разрешено. */
  disableDeleteRows?: boolean;
  /**
   * Сделать поля строк нередактируемыми (только чтение). При этом inline-режим
   * остаётся активным, поэтому навигация activeRow/activeCell работает, а попытка
   * редактирования (Enter / двойной клик) вызывает анимацию-пульс «нельзя
   * редактировать» (data-pulse). Используется когда у документа есть основание.
   */
  fieldsReadOnly?: boolean;
  /** Императивный API SubTable (внешнее добавление строк — например корзина терминала). */
  apiRef?: MutableRefObject<SubTableApi | null>;
  /** Замыкающая колонка действий строки (кнопки в ячейке, например ✕ удалить). */
  rowActions?: (row: TDataItem, ctx: SubTableContext) => ReactNode;
  /** Кнопки −/+ вокруг поля «Количество» (быстрое изменение, для терминала/кассы). */
  quantityStepper?: boolean;
  /** Тип цены документа («Тип цены» в шапке). При выборе номенклатуры в строке
   *  поле «Цена» автозаполняется из истории цен товара по этому типу. */
  priceTypeUuid?: string | null;
}

const TradeDocumentItemsTable: FC<TradeDocumentItemsTableProps> = ({
  parentUuid,
  parentField,
  endpoint,
  componentName,
  organizationUuid,
  documentDate,
  disabled = false,
  onTotalChange,
  deferRemoteChanges = false,
  onItemsChange,
  initialPendingRows,
  hasTaxes = true,
  hasPricing = true,
  emptyMessage = "Сохраните документ для добавления позиций.",
  showRequiredHighlight = false,
  onAllItemsChange,
  defaultHiddenColumns,
  showEsfColumns = false,
  showStockCountColumns = false,
  serialMode,
  serialDocType,
  warehouseUuid,
  onRefresh,
  disableAddRows = false,
  disableDeleteRows = false,
  fieldsReadOnly = false,
  apiRef,
  rowActions,
  quantityStepper = false,
  priceTypeUuid,
}) => {
  const queryClient = useQueryClient();
  // Тип цены документа в ref — чтобы асинхронный автоподбор цены при выборе
  // номенклатуры читал актуальное значение, а не захваченное в замыкании.
  const priceTypeUuidRef = useRef<string | null | undefined>(priceTypeUuid);
  priceTypeUuidRef.current = priceTypeUuid;
  const settings = useOrgAccountingSettings(organizationUuid ?? null, documentDate ?? null);
  const esfDict = useEsfDictionaries();
  // Если hasTaxes=false — принудительно отключаем все косвенные налоги.
  const useDiscount = settings.useDiscount;
  const isVatEnabled = hasTaxes && settings.isVatEnabled;
  const useExcise = hasTaxes && settings.useExcise;
  const orgExciseRate = hasTaxes && settings.exciseRate;
  const orgVatRate = hasTaxes && settings.vatRate;
  const vatCalculationMethod = hasTaxes && settings.vatCalculationMethod;

  const recalcedInitialPendingRows = useMemo(() => {
    if (!initialPendingRows || initialPendingRows.length === 0) return initialPendingRows;
    const method = vatCalculationMethod || "INCLUDED";
    return initialPendingRows.map((row) => {
      const calc = recalcSaleItemAmounts(
        row.quantity, row.price, row.vatRate, row.discountPercent, method, row.exciseRate,
      );
      return { ...row, ...calc };
    });
  }, [initialPendingRows, vatCalculationMethod]);

  const dynamicColumns = useMemo(() => {
    let base = (columnsJson as unknown as TColumn[]).filter((c) => {
      const id = c.identifier;
      if (!hasPricing && PRICING_COLUMN_IDS.has(id)) return false;
      if (!isVatEnabled && VAT_COLUMN_IDS.has(id)) return false;
      if (!useDiscount && DISCOUNT_COLUMN_IDS.has(id)) return false;
      if (!useExcise && EXCISE_COLUMN_IDS.has(id)) return false;
      if (!isVatEnabled && AMOUNT_WITHOUT_VAT_IDS.has(id)) return false;
      if (!showEsfColumns && ESF_COLUMN_IDS.has(id)) return false;
      if (!showStockCountColumns && STOCKCOUNT_COLUMN_IDS.has(id)) return false;
      if (!serialMode && SERIAL_COLUMN_IDS.has(id)) return false;
      return true;
    });

    const dynHints: Record<string, { name?: string; hint: string }> = {};
    if (!isVatEnabled && !useExcise) {
      dynHints["price"] = { hint: "Цена (тариф) за единицу — графа 8 ЭСФ РК" };
    }
    if (useDiscount) {
      let baseNote: string;
      if (isVatEnabled && useExcise) baseNote = "Итого Сумма скидки вычитается из базы для НДС и акциза";
      else if (isVatEnabled) baseNote = "Итого Сумма скидки вычитается из базы для НДС";
      else if (useExcise) baseNote = "Итого Сумма скидки вычитается из базы для акциза";
      else baseNote = "Уменьшает итоговую Сумма без налогов строки";
      dynHints["discountAmount"] = {
        hint: "Сумма скидки (надбавки).\nСумма скидки = Количество × Цена × Процент скидки, % ÷ 100\n(" + baseNote + ")",
      };
    }
    if (isVatEnabled) {
      const formula = useDiscount ? "Сумма без налогов = Количество × Цена − Сумма скидки" : "Сумма без налогов = Количество × Цена";
      const baseFor = useExcise ? "= база до начисления акциза и НДС" : "= база до начисления НДС";
      const afterDiscount = useDiscount ? ", после скидки" : "";
      dynHints["amountNetOfIndirectTaxes"] = {
        hint: `Облагаемый оборот по НДС и без акциза — графа 13 ЭСФ РК (ст. 412 НК РК)${afterDiscount}.\n${formula}\n${baseFor}`,
      };
    }
    if (isVatEnabled) {
      const lines: string[] = ["Облагаемый оборот по НДС (НК РК ст. 381 п. 1 пп. 4)."];
      if (useExcise) lines.push("Облагаемый оборот НДС = Сумма без налогов + Сумма акциза");
      else if (useDiscount) lines.push("Облагаемый оборот НДС = Количество × Цена − Сумма скидки");
      else lines.push("Облагаемый оборот НДС = Количество × Цена");
      lines.push("= база для расчёта НДС");
      lines.push("НДС = Облагаемый оборот × Ставка НДС, % ÷ 100");
      dynHints["amountWithoutVat"] = { hint: lines.join("\n") };
    }
    if (useExcise) {
      const baseLabel = isVatEnabled ? "Сумма без налогов" : (useDiscount ? "(Количество × Цена − Сумма скидки)" : "(Количество × Цена)");
      dynHints["exciseAmount"] = {
        hint: `Сумма акциза — графа 14 ЭСФ РК.\nСумма акциза = ${baseLabel} × Ставка акциза, % ÷ 100\n(НК РК ст. 463; начисляется сверху — ADDED)`,
      };
    }
    {
      const lines: string[] = [];
      let name: string | undefined;
      if (isVatEnabled) {
        lines.push("Сумма без налогов товаров (работ, услуг) с косвенными налогами — графа 17 ЭСФ РК.");
        lines.push("Сумма = Облагаемый оборот + Сумма НДС");
      } else {
        name = "Сумма без налогов";
        if (useExcise) {
          lines.push("Сумма без налогов товаров (работ, услуг) с акцизом.");
          if (useDiscount) lines.push("Сумма без налогов = Количество × Цена − Сумма скидки + Сумма акциза");
          else lines.push("Сумма без налогов = Количество × Цена + Сумма акциза");
        } else {
          lines.push("Сумма без налогов товаров (работ, услуг).");
          if (useDiscount) lines.push("Сумма без налогов = Количество × Цена − Сумма скидки");
          else lines.push("Сумма без налогов = Количество × Цена");
        }
      }
      lines.push("= итоговая сумма к оплате по строке");
      dynHints["amount"] = { hint: lines.join("\n"), ...(name ? { name } : {}) };
    }
    base = base.map((c) => {
      const id = c.identifier;
      const patch = dynHints[id];
      return patch ? { ...c, ...patch } : c;
    });
    if (isVatEnabled && Number(orgVatRate) > 0) {
      const methodLabel = vatCalculationMethod === "ADDED" ? "сверху" : "в сумме";
      base = base.map((c) => {
        if (c.identifier === "vatAmount") {
          return {
            ...c,
            name: `Сумма НДС (${orgVatRate}%) ${methodLabel}`,
            hint: vatCalculationMethod === "ADDED" ? "НДС начисляется сверху к стоимости" : "НДС включён в цену (в т.ч.)",
          };
        }
        return c;
      });
    }
    if (defaultHiddenColumns && defaultHiddenColumns.length > 0) {
      const hidden = new Set(defaultHiddenColumns);
      base = base.map((c) => hidden.has(c.identifier) ? { ...c, visible: false } : c);
    }
    return base;
  }, [isVatEnabled, useDiscount, useExcise, orgVatRate, vatCalculationMethod, defaultHiddenColumns, hasPricing, showEsfColumns, showStockCountColumns, serialMode]);

  const taxSig = useMemo(
    () => "vat:" + (isVatEnabled ? "1" : "0") + "|disc:" + (useDiscount ? "1" : "0") + "|exc:" + (useExcise ? "1" : "0") + "|m:" + vatCalculationMethod + "|r:" + String(orgVatRate ?? ""),
    [isVatEnabled, useDiscount, useExcise, vatCalculationMethod, orgVatRate],
  );

  const recalcWithFlags = useCallback(
    (row: any, patch: Record<string, unknown>): Record<string, unknown> => {
      const enforced: Record<string, unknown> = { ...patch };
      if (enforced.vatRate === "") enforced.vatRate = 0;
      if (enforced.exciseRate === "") enforced.exciseRate = 0;
      if (!isVatEnabled) enforced.vatRate = 0;
      if (!useDiscount) { enforced.discountPercent = 0; enforced.discountAmount = 0; }
      if (!useExcise) { enforced.exciseRate = 0; enforced.exciseAmount = 0; }
      const merged = { ...row, ...enforced } as Record<string, unknown>;
      // Для ТМЗ (hasTaxes=false) — простая формула: amount = qty × price
      if (!hasTaxes) {
        const qty = Number(merged.quantity ?? 0) || 0;
        const prc = Number(merged.price ?? 0) || 0;
        return { ...enforced, amount: Math.round(qty * prc * 100) / 100 };
      }
      return withSaleItemRecalc({ ...row, ...enforced, vatCalculationMethod }, enforced);
    },
    [isVatEnabled, useDiscount, useExcise, vatCalculationMethod, orgVatRate, orgExciseRate, hasTaxes],
  );

  // Автоподбор цены при выборе номенклатуры в строке — ТОЛЬКО по выбранному в
  // шапке «Тип цены»: берём последнюю цену товара этого типа из истории цен.
  // Если «Тип цены» НЕ выбран или цены по типу нет — поле «Цена» не трогаем.
  const autofillRowPrice = useCallback(async (
    ctx: SubTableContext,
    row: TDataItem,
    productUuid: string,
  ) => {
    const typeUuid = (priceTypeUuidRef.current || "").trim();
    if (!typeUuid) return; // тип цены не задан → не подставляем цену
    let price: number | null = null;
    try {
      const resp = await apiClient.get<{ items?: Array<{ price?: number | string | null }> }>(
        "product-prices",
        { params: { productUuid, priceTypeUuid: typeUuid, limit: 1 } },
      );
      const p = resp.data?.items?.[0]?.price;
      if (p != null && p !== "") price = Number(p);
    } catch { /* нет цены/ошибка → не трогаем поле */ }
    if (price == null || Number.isNaN(price)) return;
    if (ctx.deferRemoteChanges) ctx.updateLocalRow(row, recalcWithFlags(row as any, { price }));
    else ctx.handleInlineChange(row, "price", String(price));
  }, [recalcWithFlags]);

  // Автозаполнение реквизитов декларации (ГТД № и № товара в декларации) из
  // последней проведённой «ГТД по импорту», которой приходовался товар. Значения
  // подставляются как значения по умолчанию — пользователь может переопределить.
  const autofillEsfDeclaration = useCallback(async (
    ctx: SubTableContext,
    row: TDataItem,
    productUuid: string,
  ) => {
    try {
      const resp = await apiClient.get<{ source?: { declarationNumber?: string | null; positionNumber?: string | null } | null }>(
        "importdeclarations/product-source",
        { params: { productUuid, ...(organizationUuid ? { organizationUuid } : {}) } },
      );
      const src = resp.data?.source;
      if (!src) return;
      const patch: Record<string, unknown> = {};
      if (src.declarationNumber) patch.productDeclaration = src.declarationNumber;
      if (src.positionNumber) patch.productNumberInDeclaration = src.positionNumber;
      if (Object.keys(patch).length === 0) return;
      if (ctx.deferRemoteChanges) ctx.updateLocalRow(row, recalcWithFlags(row as any, patch));
      else for (const [k, v] of Object.entries(patch)) ctx.handleInlineChange(row, k, String(v));
    } catch { /* нет данных/ошибка → поля не трогаем */ }
  }, [recalcWithFlags, organizationUuid]);

  const allRequiredFields = useMemo(() => (
    hasPricing
      ? ["product.name", "quantity", "price", "unitOfMeasure.name"]
      : ["product.name", "quantity", "unitOfMeasure.name"]
  ), [hasPricing]);
  const requiredFields = showRequiredHighlight ? allRequiredFields : undefined;

  const handleItemsChange = useCallback((items: TDataItem[]) => {
    if (onTotalChange) {
      // Итоги считаем ТОЛЬКО по видимым строкам — строки, помеченные на удаление
      // (_pendingAction === "delete"), сохраняют свой старый amount, но из суммы
      // должны исключаться. Иначе при «Перезаполнить по основанию» / «Обновить»
      // (старые строки → delete, новые → create) итог удваивается.
      const visible = items.filter(r => (r as { _pendingAction?: string })._pendingAction !== "delete");
      const sum = visible.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      onTotalChange(Math.round(sum * 100) / 100, visible);
    }
    // onItemsChange получает ВСЕ строки (включая delete-маркеры) — они нужны
    // форме для удаления записей на сервере при сохранении.
    onItemsChange?.(items);
  }, [onTotalChange, onItemsChange]);

  const validationRules = useMemo<Record<string, TCellValidator>>(() => {
    const toStr = (v: unknown): string => typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
    return {
      quantity: (value) => {
        if (value === "" || value == null) return undefined;
        const n = parseNumericInput(toStr(value));
        if (n === null) return "Должно быть числом";
        if (n < 0) return "Не может быть отрицательным";
        return undefined;
      },
      price: (value) => {
        if (value === "" || value == null) return undefined;
        const n = parseNumericInput(toStr(value));
        if (n === null) return "Должно быть числом";
        if (n < 0) return "Не может быть отрицательным";
        return undefined;
      },
      vatRate: (value) => {
        if (value === "" || value == null) return undefined;
        const n = parseNumericInput(toStr(value));
        if (n === null) return "Должно быть числом";
        if (n < 0 || n > 100) return "0…100% (НК РК ст. 422)";
        return undefined;
      },
      discountPercent: (value) => {
        if (value === "" || value == null) return undefined;
        const n = parseNumericInput(toStr(value));
        if (n === null) return "Должно быть числом";
        return undefined;
      },
      exciseRate: (value) => {
        if (value === "" || value == null) return undefined;
        const n = parseNumericInput(toStr(value));
        if (n === null) return "Должно быть числом";
        if (n < 0) return "Не может быть отрицательным";
        return undefined;
      },
    };
  }, []);

  const customInlineChange = useCallback(async (row: TDataItem, field: string, value: string) => {
    if (!row.uuid) return;
    const payload = ["quantity", "price", "discountPercent", "vatRate", "exciseRate"].includes(field)
      ? recalcWithFlags(row as any, { [field]: value })
      : { [field]: value };
    await apiClient.put(`/${endpoint}/${row.uuid}`, payload);
    await queryClient.invalidateQueries({ queryKey: [endpoint] });
  }, [queryClient, recalcWithFlags, endpoint]);

  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    const id = col.identifier;
    // Поля редактируемы только если включён inline-режим И не задан fieldsReadOnly.
    // При fieldsReadOnly все ячейки рендерятся как read-only, но inline-режим
    // SubTable остаётся активным — поэтому попытка редактирования (Enter / двойной
    // клик) запускает анимацию-пульс «нельзя редактировать» (data-pulse).
    const cellEditable = ctx.inlineEditing && !fieldsReadOnly;
    // Записать пер-строчное поле (без пересчёта сумм).
    const setRowField = (field: string, value: string) => {
      if (ctx.deferRemoteChanges) { ctx.updateLocalRow(row, { ...row, [field]: value }); return; }
      ctx.handleInlineChange(row, field, value);
    };
    // ЭСФ-метаданные строки: ТН ВЭД (ссылка на классификатор) и признак происхождения (справочник).
    // Значение — пер-строчное (item), с fallback на карточку товара.
    if (id === "product.tnvedCode") {
      const val = (row.tnvedCode as string) || (row.product as { tnvedCode?: string } | undefined)?.tnvedCode || "";
      if (!cellEditable) return <span>{val}</span>;
      return <ClassifierLookup type="tnved" name={`docitem_tnved_${row.id}`} value={val} width="100%" variant="table"
        disabled={ctx.disabled} onChange={(code) => setRowField("tnvedCode", code)} />;
    }
    if (id === "product.truOriginCode") {
      const val = (row.truOriginCode as string) || (row.product as { truOriginCode?: string } | undefined)?.truOriginCode || "";
      if (!cellEditable) return <span>{val}</span>;
      return <FieldSelect name={`docitem_truorigin_${row.id}`} value={val} variant="table" disabled={ctx.disabled}
        onChange={(e) => setRowField("truOriginCode", e.target.value)}
        options={[{ value: "", label: "—" }, ...(esfDict?.truOrigin ?? []).map((o) => ({ value: o.code, label: `${o.code} — ${o.label}` }))]} />;
    }
    if (id === "productDeclaration" || id === "productNumberInDeclaration") {
      const val = (row[id] as string) ?? "";
      if (!cellEditable) return <span>{val}</span>;
      return <Field name={`docitem_${id}_${row.id}`} value={val} width="100%" variant="table" disabled={ctx.disabled}
        onChange={(e) => setRowField(id, e.target.value)} />;
    }
    if (id === "lineNumber") {
      const idx = ctx.rows.indexOf(row);
      const value = idx >= 0 ? idx + 1 : (row.lineNumber as string | number | null | undefined) ?? "";
      return <ReadOnlyCell value={String(value)} />;
    }
    // Серийные номера: кнопка-модалка ввода (приёмка) / выбора (выбытие) серий.
    if (id === "serials") {
      const pUuid = (row.productUuid as string) ?? "";
      if (!pUuid || !serialMode) return <span />;
      return (
        <SerialNumbersCell
          productUuid={pUuid}
          quantity={Number(row.quantity) || 0}
          docType={serialDocType ?? ""}
          docUuid={parentUuid}
          mode={serialMode}
          organizationUuid={organizationUuid ?? undefined}
          warehouseUuid={warehouseUuid ?? undefined}
          disabled={ctx.disabled}
        />
      );
    }
    // Инвентаризация: учёт — из регистра (не редактируется), отклонение = факт − учёт.
    if (id === "accountingQuantity") return <ReadOnlyCell value={row.accountingQuantity ?? 0} column={col} />;
    if (id === "deviation") {
      const dev = (Number(row.quantity) || 0) - (Number(row.accountingQuantity) || 0);
      return <ReadOnlyCell value={Math.round(dev * 10000) / 10000} column={col} />;
    }
    if (id === "vatAmount") return <ReadOnlyCell value={row.vatAmount ?? 0} column={col} />;
    if (id === "amount") return <ReadOnlyCell value={row.amount ?? 0} column={col} />;
    if (id === "amountWithoutVat") return <ReadOnlyCell value={row.amountWithoutVat ?? 0} column={col} />;
    if (id === "amountNetOfIndirectTaxes") {
      const netVal = Number(row.amountWithoutVat ?? 0) - Number(row.exciseAmount ?? 0);
      return <ReadOnlyCell value={netVal} column={col} />;
    }
    if (id === "exciseAmount") return <ReadOnlyCell value={row.exciseAmount ?? 0} column={col} />;
    if (id === "discountAmount") {
      if (!cellEditable) return <ReadOnlyCell value={row.discountAmount ?? 0} column={col} />;
      return (
        <FieldNumber
          name={`docitem_discamt_${row.id}`}
          value={row.discountAmount != null ? String(row.discountAmount as number | string) : "0"}
          onChange={e => {
            if (ctx.deferRemoteChanges) {
              ctx.updateLocalRow(row, withSaleItemRecalcFromDiscountAmount({ ...(row as any), vatCalculationMethod }, e.target.value));
              return;
            }
            const recalc = withSaleItemRecalcFromDiscountAmount({ ...(row as any), vatCalculationMethod }, e.target.value);
            ctx.handleInlineChange(row, "discountPercent", String(recalc.discountPercent));
          }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); focusNextInRow(e.currentTarget); } }}
          disabled={ctx.disabled}
          step="0.01"
          min="0"
          decimals={2}
          textAlign="right"
          width="100%"
          actions={[]}
          variant="table"
        />
      );
    }
    if (!cellEditable) return undefined;

    if (id === "product.name") {
      return (
        <LookupField
          label=""
          name={`docitem_product_${row.id}`}
          value={(row.productUuid as string) ?? ""}
          displayValue={(row.product as any)?.name ?? ""}
          endpoint="products"
          displayField="name"
          columns={[
            { key: "name", label: "Наименование" },
            { key: "sku", label: "Артикул" },
            { key: "brand.name", label: "Бренд" },
          ]}
          onSelect={(uuid, _dv, item) => {
            const extra: Record<string, unknown> = {
              product: item && uuid ? { uuid, name: item.name ?? "" } : null,
            };
            const umUuid = item?.unitOfMeasureUuid as string | undefined;
            const um = item?.unitOfMeasure as { uuid?: string; name?: string } | undefined;
            if (umUuid) {
              extra.unitOfMeasureUuid = umUuid;
              extra.unitOfMeasure = um ? { uuid: um.uuid ?? umUuid, name: um.name ?? "" } : { uuid: umUuid, name: "" };
            }
            // Автозаполнение ЭСФ-метаданных строки из карточки товара (можно переопределить).
            if (showEsfColumns && item) {
              extra.tnvedCode = (item.tnvedCode as string) ?? null;
              extra.truOriginCode = (item.truOriginCode as string) ?? null;
            }
            ctx.handleLookupChange(row, "productUuid", uuid, extra);
            // Автозаполнение цены из истории цен товара по типу цены документа.
            if (uuid) void autofillRowPrice(ctx, row, uuid);
            // Автозаполнение реквизитов декларации (ГТД) из последней проведённой ГТД по импорту.
            if (uuid && showEsfColumns) void autofillEsfDeclaration(ctx, row, uuid);
          }}
          onClear={() => ctx.handleLookupChange(row, "productUuid", null, { product: null })}
          onEnterKey={() => focusNextInRow(document.activeElement)}
          onAfterSelect={() => focusNextInRow(document.activeElement)}
          disabled={ctx.disabled}
          width="100%"
          variant="table"
        />
      );
    }
    if (id === "quantity") {
      const field = (
        <FieldNumber
          name={`docitem_qty_${row.id}`}
          value={row.quantity != null ? String(row.quantity as number | string) : ""}
          onChange={e => {
            if (ctx.deferRemoteChanges) { ctx.updateLocalRow(row, recalcWithFlags(row as any, { quantity: e.target.value })); return; }
            ctx.handleInlineChange(row, "quantity", e.target.value);
          }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); focusNextInRow(e.currentTarget); } }}
          disabled={ctx.disabled}
          decimals={4}
          textAlign={quantityStepper ? "center" : "right"}
          width="100%"
          actions={[]}
          variant="table"
        />
      );
      if (!quantityStepper) return field;
      const setQty = (nq: number) => {
        const q = Math.max(0, nq);
        if (ctx.deferRemoteChanges) { ctx.updateLocalRow(row, recalcWithFlags(row as any, { quantity: q })); return; }
        ctx.handleInlineChange(row, "quantity", String(q));
      };
      const cur = Number(row.quantity) || 0;
      return (
        <div className={styles.QtyStepper}>
          <FieldActionButton icon="minus" label="−1" disabled={ctx.disabled} onClick={() => setQty(cur - 1)} />
          <div className={styles.QtyStepperField}>{field}</div>
          <FieldActionButton icon="plus" label="+1" disabled={ctx.disabled} onClick={() => setQty(cur + 1)} />
        </div>
      );
    }
    if (id === "price") {
      return (
        <FieldNumber
          name={`docitem_price_${row.id}`}
          value={row.price != null ? String(row.price as number | string) : ""}
          onChange={e => {
            if (ctx.deferRemoteChanges) { ctx.updateLocalRow(row, recalcWithFlags(row as any, { price: e.target.value })); return; }
            ctx.handleInlineChange(row, "price", e.target.value);
          }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); focusNextInRow(e.currentTarget); } }}
          disabled={ctx.disabled}
          step="0.1"
          decimals={2}
          textAlign="right"
          width="100%"
          actions={[]}
          variant="table"
        />
      );
    }
    if (id === "unitOfMeasure.name") {
      return (
        <LookupField
          label=""
          name={`docitem_uom_${row.id}`}
          value={(row.unitOfMeasureUuid as string) ?? ""}
          displayValue={(row.unitOfMeasure as any)?.name ?? ""}
          endpoint="unit-of-measures"
          displayField="name"
          columns={[
            { key: "name", label: "Наименование" },
            { key: "code", label: "Код" },
          ]}
          onSelect={(uuid, _dv, item) => ctx.handleLookupChange(row, "unitOfMeasureUuid", uuid, {
            unitOfMeasure: item && uuid ? { uuid, name: item.name ?? "" } : null,
          })}
          onClear={() => ctx.handleLookupChange(row, "unitOfMeasureUuid", null, { unitOfMeasure: null })}
          onEnterKey={() => focusNextInRow(document.activeElement)}
          onAfterSelect={() => focusNextInRow(document.activeElement)}
          disabled={ctx.disabled}
          width="100%"
          variant="table"
          visibleActions={["quickselect"]}
        />
      );
    }
    if (id === "discountPercent") {
      return (
        <FieldNumber
          name={`docitem_discount_${row.id}`}
          value={row.discountPercent != null ? String(row.discountPercent as number | string) : ""}
          onChange={e => {
            if (ctx.deferRemoteChanges) { ctx.updateLocalRow(row, recalcWithFlags(row as any, { discountPercent: e.target.value })); return; }
            ctx.handleInlineChange(row, "discountPercent", e.target.value);
          }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); focusNextInRow(e.currentTarget); } }}
          disabled={ctx.disabled}
          step="0.1" min="0" max="100" decimals={4}
          textAlign="right" width="100%" actions={[]} variant="table"
        />
      );
    }
    if (id === "exciseRate") {
      return (
        <FieldNumber
          name={`docitem_exciserate_${row.id}`}
          value={row.exciseRate != null ? String(row.exciseRate as number | string) : ""}
          onChange={e => {
            if (ctx.deferRemoteChanges) { ctx.updateLocalRow(row, recalcWithFlags(row as any, { exciseRate: e.target.value })); return; }
            ctx.handleInlineChange(row, "exciseRate", e.target.value);
          }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); focusNextInRow(e.currentTarget); } }}
          disabled={ctx.disabled}
          step="0.01" min="0" decimals={4}
          textAlign="right" width="100%" actions={[]} variant="table"
        />
      );
    }
    if (id === "vatRate") {
      return (
        <FieldNumber
          name={`docitem_vatrate_${row.id}`}
          value={row.vatRate != null ? String(row.vatRate as number | string) : ""}
          onChange={e => {
            if (ctx.deferRemoteChanges) { ctx.updateLocalRow(row, recalcWithFlags(row as any, { vatRate: e.target.value })); return; }
            ctx.handleInlineChange(row, "vatRate", e.target.value);
          }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); focusNextInRow(e.currentTarget); } }}
          disabled={ctx.disabled}
          step="0.01" min="0" max="100" decimals={2}
          textAlign="right" width="100%" actions={[]} variant="table"
        />
      );
    }
    return undefined;
  }, [recalcWithFlags, vatCalculationMethod, fieldsReadOnly, quantityStepper, esfDict, showEsfColumns]);

  const defaultNewRow = useMemo(() => ({
    productUuid: null,
    quantity: null,
    price: null,
    unitOfMeasureUuid: null,
    vatRate: isVatEnabled ? Number(orgVatRate) || 0 : 0,
    discountPercent: null,
    discountAmount: null,
    exciseRate: useExcise ? Number(orgExciseRate) || 0 : 0,
    exciseAmount: null,
    vatAmount: null,
    amountWithoutVat: null,
    amount: null,
  }), [isVatEnabled, orgVatRate, useExcise, orgExciseRate]);

  return (
    <SubTable
      key={taxSig}
      model={endpoint}
      componentName={componentName}
      columnsJson={dynamicColumns}
      parentKey={parentField}
      parentUuid={parentUuid}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      disableAdd={disabled || disableAddRows}
      disableDelete={disableDeleteRows}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={recalcedInitialPendingRows}
      emptyMessage={emptyMessage}
      renderCell={renderCell}
      defaultNewRow={defaultNewRow}
      onItemsChange={handleItemsChange}
      onAllItemsChange={onAllItemsChange}
      customInlineChange={customInlineChange}
      validationRules={validationRules}
      requiredFields={requiredFields}
      computeRow={(row) => ({
        amountNetOfIndirectTaxes: Number(row.amountWithoutVat ?? 0) - Number(row.exciseAmount ?? 0),
      })}
      onRefresh={onRefresh}
      showEditModeToggle={false}
      apiRef={apiRef}
      rowActions={rowActions}
      extraButtons={
        <>
          <Toolbar.Divider />
          <RecalcAllButton
            endpoint={endpoint}
            disabled={disabled}
            recalcRow={(row) => {
              const refDefaults: Record<string, unknown> = {};
              const product = row.product as { unitOfMeasureUuid?: string | null; unitOfMeasure?: { uuid?: string; name?: string; } | null; } | null | undefined;
              if (!row.unitOfMeasureUuid && product?.unitOfMeasureUuid) {
                refDefaults.unitOfMeasureUuid = product.unitOfMeasureUuid;
                if (product.unitOfMeasure) refDefaults.unitOfMeasure = product.unitOfMeasure;
              }
              if (row.discountPercent == null) refDefaults.discountPercent = 0;
              if (row.exciseRate == null) refDefaults.exciseRate = 0;
              if (row.vatRate == null) refDefaults.vatRate = 0;
              return recalcWithFlags(row as any, refDefaults);
            }} /></>
      }
    />
  );
};

TradeDocumentItemsTable.displayName = "TradeDocumentItemsTable";
export default TradeDocumentItemsTable;

interface RecalcAllButtonProps {
  endpoint: string;
  disabled?: boolean;
  recalcRow: (row: TDataItem) => Record<string, unknown>;
}

const RecalcAllButton: FC<RecalcAllButtonProps> = ({ endpoint, disabled = false, recalcRow }) => {
  const subCtx = useSubTableContext();
  const tableCtx = useTableContext();
  const [busy, setBusy] = useState(false);

  const handleClick = useCallback(async () => {
    const rows = subCtx?.rows ?? tableCtx.rows;
    if (!rows || rows.length === 0) return;
    setBusy(true);
    try {
      const patches: Array<{ row: TDataItem; payload: Record<string, unknown> }> = [];
      for (const row of rows) {
        const payload = recalcRow(row);
        const realPatch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(payload)) {
          const prev = (row as Record<string, unknown>)[k];
          if (!isEquivalent(prev, v)) realPatch[k] = v;
        }
        if (Object.keys(realPatch).length === 0) continue;
        patches.push({ row, payload: realPatch });
        subCtx?.updateLocalRow(row, realPatch);
      }
      if (!subCtx?.deferRemoteChanges) {
        await Promise.all(patches.map(({ row, payload }) =>
          row.uuid ? apiClient.put(`/${endpoint}/${row.uuid}`, payload).catch(() => undefined) : Promise.resolve(),
        ));
      }
    } finally { setBusy(false); }
  }, [subCtx, tableCtx, recalcRow, endpoint]);

  const rowsForCheck = subCtx?.rows ?? tableCtx.rows;
  const empty = !rowsForCheck || rowsForCheck.length === 0;

  return (
    <Toolbar.RecalcButton
      onClick={handleClick}
      disabled={disabled || busy || empty}
      loading={busy}
      title={busy ? "Пересчёт…" : "Пересчитать суммы и итоги по всем строкам"}
    />
  );
};
