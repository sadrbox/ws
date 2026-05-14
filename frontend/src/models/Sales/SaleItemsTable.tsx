/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-floating-promises */
import { FC, useCallback, useMemo, useState } from "react";
import { useAppContext } from "src/app";
import { useQueryClient } from "@tanstack/react-query";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { FieldNumber } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import apiClient from "src/services/api/client";
import SaleItemsForm from "./SaleItemsForm";
import columnsJson from "./saleItemsColumns.json";
import SubTable, { ReadOnlyCell, type SubTableContext, type TCellValidator, useSubTableContext } from "src/components/SubTable";
import { makePaneLabelFromData } from "src/utils/buildPaneLabel";
import { withSaleItemRecalc, withSaleItemRecalcFromDiscountAmount } from "./saleItemDraft";
import { parseNumericInput } from "src/components/Table/services";
import useOrgAccountingSettings from "src/hooks/useOrgAccountingSettings";
import { Toolbar } from "src/components/Toolbar";
import { useTableContext } from "src/components/Table";
import { isEquivalent } from "src/utils/normalize";

const MODEL_ENDPOINT = "saleitems";
const COMPONENT_NAME = "SaleItemsList_part";

/** Идентификаторы колонок, относящихся к НДС. Скрываются, если useVat=false в НУО. */
const VAT_COLUMN_IDS = new Set(["vatRate", "vatAmount"]);
/** Колонки скидок — скрываются, если useDiscount=false в настройках учёта. */
const DISCOUNT_COLUMN_IDS = new Set(["discountPercent", "discountAmount"]);
/** Колонки акциза — скрываются, если useExcise=false (НК РК ст. 463). */
const EXCISE_COLUMN_IDS = new Set(["exciseRate", "exciseAmount"]);
/** «Облагаемый оборот НДС» и «Стоимость» — скрываются при выключённом НДС (без НДС равно amount). */
const AMOUNT_WITHOUT_VAT_IDS = new Set(["amountWithoutVat", "amountNetOfIndirectTaxes"]);

/**
 * Переводит фокус на следующий незаблокированный input в той же строке таблицы (<tr>).
 * Если текущее поле — последнее в строке, переходит на первое поле следующей строки.
 */
const focusNextInRow = (currentTarget: EventTarget | null) => {
  if (!(currentTarget instanceof HTMLElement)) return;
  const tr = currentTarget.closest("tr");
  if (!tr) return;
  const inputs = Array.from(
    tr.querySelectorAll<HTMLInputElement>('input:not([disabled]):not([type="checkbox"])')
  );
  const idx = inputs.indexOf(currentTarget as HTMLInputElement);
  if (idx >= 0 && idx < inputs.length - 1) {
    // Есть следующее поле в той же строке
    const next = inputs[idx + 1];
    next.focus();
    try { next.select(); } catch { /* игнорируем */ }
  } else {
    // Последнее поле строки → переходим на первое поле следующей строки
    let nextTr = tr.nextElementSibling as HTMLElement | null;
    // Пропускаем вспомогательные строки (padding tr без input-ов)
    while (nextTr && nextTr.tagName === "TR") {
      const nextInputs = Array.from(
        nextTr.querySelectorAll<HTMLInputElement>('input:not([disabled]):not([type="checkbox"])')
      );
      if (nextInputs.length > 0) {
        nextInputs[0].focus();
        try { nextInputs[0].select(); } catch { /* игнорируем */ }
        return;
      }
      nextTr = nextTr.nextElementSibling as HTMLElement | null;
    }
  }
};

interface SaleItemsTableProps {
  saleUuid: string;
  /** UUID организации документа — для подбора активных TaxSettings и динамических колонок налогов. */
  organizationUuid?: string | null;
  /** Дата документа (ISO YYYY-MM-DD). Используется для исторического подбора
   *  настроек учёта организации (НДС/скидки отображаются согласно тому, что
   *  действовало на эту дату). При изменении даты колонки автоматически
   *  пересчитываются. */
  documentDate?: string | null;
  /** Описание родительского документа (напр. "Реализация №123 · 21.04.2026") — попадает в заголовок вкладки строки. */
  parentLabel?: string;
  disabled?: boolean;
  onTotalChange?: (total: number) => void;
  /** Если true — не отправлять изменения на сервер, хранить локально (для отложенного сохранения) */
  deferRemoteChanges?: boolean;
  /** Колбэк при изменении строк (для формы-родителя) */
  onItemsChange?: (items: TDataItem[]) => void;
  /** Начальные pending-строки (для восстановления из sessionStorage) */
  initialPendingRows?: TDataItem[];
}

const SaleItemsTable: FC<SaleItemsTableProps> = ({ saleUuid, organizationUuid, documentDate, parentLabel, disabled = false, onTotalChange, deferRemoteChanges = false, onItemsChange, initialPendingRows }) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();
  const {
    isVatEnabled,
    useDiscount,
    useExcise,
    exciseRate: orgExciseRate,
    vatRate: orgVatRate,
    vatCalculationMethod,
  } = useOrgAccountingSettings(organizationUuid ?? null, documentDate ?? null);

  const dynamicColumns = useMemo(() => {
    let base = (columnsJson as Array<Record<string, unknown>>).filter((c) => {
      const id = c.identifier as string;
      // Скрываем НДС-колонки, если НДС не настроен
      if (!isVatEnabled && VAT_COLUMN_IDS.has(id)) return false;
      // Скрываем колонки скидок, если useDiscount=false
      if (!useDiscount && DISCOUNT_COLUMN_IDS.has(id)) return false;
      // Скрываем колонки акциза, если useExcise=false
      if (!useExcise && EXCISE_COLUMN_IDS.has(id)) return false;
      // «Стоимость без НДС» имеет смысл только при включённом НДС
      if (!isVatEnabled && AMOUNT_WITHOUT_VAT_IDS.has(id)) return false;
      return true;
    });

    // ── Динамические подсказки (hint) и имена (name) ─────────────────────
    // Подсказки в JSON содержат полные формулы со всеми терминами (скидка,
    // акциз, НДС). Если организация не использует какие-то из этих опций
    // (useDiscount=false / useExcise=false / isVatEnabled=false), термины
    // отключённых опций исключаются из формул, чтобы соответствовать
    // реальному учёту по НК РК.
    const dynHints: Record<string, { name?: string; hint: string }> = {};

    // price — «без косвенных налогов» имеет смысл только если есть НДС или акциз
    if (!isVatEnabled && !useExcise) {
      dynHints["price"] = { hint: "Цена (тариф) за единицу — графа 8 ЭСФ РК" };
    }

    // discountAmount — пояснение, из какой базы вычитается скидка
    if (useDiscount) {
      let baseNote: string;
      if (isVatEnabled && useExcise) baseNote = "Итого скидка вычитается из базы для НДС и акциза";
      else if (isVatEnabled) baseNote = "Итого скидка вычитается из базы для НДС";
      else if (useExcise) baseNote = "Итого скидка вычитается из базы для акциза";
      else baseNote = "Уменьшает итоговую стоимость строки";
      dynHints["discountAmount"] = {
        hint:
          "Сумма скидки (надбавки).\n" +
          "Сумма скидки = Количество × Цена × Скидка % ÷ 100\n" +
          `(${baseNote})`,
      };
    }

    // amountNetOfIndirectTaxes — графа 13 ЭСФ: «Стоимость»
    // Формула базы зависит от наличия скидки; пояснение «база до начисления»
    // — от наличия НДС/акциза.
    if (isVatEnabled) {
      const formula = useDiscount
        ? "Стоимость = Количество × Цена − Сумма скидки"
        : "Стоимость = Количество × Цена";
      let baseFor: string;
      if (isVatEnabled && useExcise) baseFor = "= база до начисления акциза и НДС";
      else if (isVatEnabled) baseFor = "= база до начисления НДС";
      else if (useExcise) baseFor = "= база до начисления акциза";
      else baseFor = "";
      const afterDiscount = useDiscount ? ", после скидки" : "";
      dynHints["amountNetOfIndirectTaxes"] = {
        hint:
          `Стоимость без НДС и без акциза — графа 13 ЭСФ РК (ст. 412 НК РК)${afterDiscount}.\n` +
          formula +
          (baseFor ? "\n" + baseFor : ""),
      };
    }

    // amountWithoutVat — графа «Облагаемый оборот НДС».
    // С акцизом: = Стоимость + Сумма акциза.
    // Без акциза: = Стоимость (т.е. = Кол-во × Цена [− Скидка]).
    if (isVatEnabled) {
      const lines: string[] = [
        "Облагаемый оборот по НДС (НК РК ст. 381 п. 1 пп. 4).",
      ];
      if (useExcise) {
        lines.push("Облагаемый оборот НДС = Стоимость + Сумма акциза");
      } else if (useDiscount) {
        lines.push("Облагаемый оборот НДС = Количество × Цена − Сумма скидки");
      } else {
        lines.push("Облагаемый оборот НДС = Количество × Цена");
      }
      lines.push("= база для расчёта НДС");
      lines.push("НДС = Облагаемый оборот × Ставка НДС ÷ 100");
      dynHints["amountWithoutVat"] = { hint: lines.join("\n") };
    }

    // exciseAmount — база зависит от наличия скидки и НДС.
    if (useExcise) {
      const baseLabel = isVatEnabled
        ? "Стоимость"
        : (useDiscount ? "(Количество × Цена − Сумма скидки)" : "(Количество × Цена)");
      dynHints["exciseAmount"] = {
        hint:
          "Сумма акциза — графа 14 ЭСФ РК.\n" +
          `Сумма акциза = ${baseLabel} × Ставка акциза ÷ 100\n` +
          "(НК РК ст. 463; начисляется сверху — ADDED)",
      };
    }

    // amount — итоговая стоимость строки. Имя и формула зависят от того,
    // включён ли НДС (без НДС колонка отображает просто «Стоимость»).
    {
      const lines: string[] = [];
      let name: string | undefined;
      if (isVatEnabled) {
        lines.push("Стоимость товаров (работ, услуг) с косвенными налогами — графа 17 ЭСФ РК.");
        lines.push("Стоимость с НДС = Облагаемый оборот + Сумма НДС");
      } else {
        // Без НДС — название без «с НДС»
        name = "Стоимость";
        if (useExcise) {
          lines.push("Стоимость товаров (работ, услуг) с акцизом.");
          if (useDiscount) lines.push("Стоимость = Количество × Цена − Сумма скидки + Сумма акциза");
          else lines.push("Стоимость = Количество × Цена + Сумма акциза");
        } else {
          lines.push("Стоимость товаров (работ, услуг).");
          if (useDiscount) lines.push("Стоимость = Количество × Цена − Сумма скидки");
          else lines.push("Стоимость = Количество × Цена");
        }
      }
      lines.push("= итоговая сумма к оплате по строке");
      dynHints["amount"] = { hint: lines.join("\n"), ...(name ? { name } : {}) };
    }

    // Применяем динамические подсказки/имена
    base = base.map((c) => {
      const id = c.identifier as string;
      const patch = dynHints[id];
      return patch ? { ...c, ...patch } : c;
    });

    // Динамическое имя для НДС-колонки «vatAmount»: включаем в подпись
    // числовую ставку НДС из настроек НУО и метод расчёта (в т.ч. / сверху).
    if (isVatEnabled && Number(orgVatRate) > 0) {
      const methodLabel = vatCalculationMethod === "ADDED" ? "сверху" : "в сумме";
      base = base.map((c) => {
        if (c.identifier === "vatAmount") {
          return {
            ...c,
            name: `Сумма НДС (${orgVatRate}%) ${methodLabel}`,
            hint:
              vatCalculationMethod === "ADDED"
                ? `НДС начисляется сверху к стоимости`
                : `НДС включён в цену (в т.ч.)`,
          };
        }
        return c;
      });
    }

    return base;
  }, [isVatEnabled, useDiscount, useExcise, orgVatRate, vatCalculationMethod]);

  // Сигнатура для key — пересоздаёт SubTable при изменении набора колонок
  const taxSig = useMemo(
    () =>
      "vat:" +
      (isVatEnabled ? "1" : "0") +
      "|disc:" +
      (useDiscount ? "1" : "0") +
      "|exc:" +
      (useExcise ? "1" : "0") +
      "|m:" +
      vatCalculationMethod +
      "|r:" +
      String(orgVatRate ?? ""),
    [isVatEnabled, useDiscount, useExcise, vatCalculationMethod, orgVatRate],
  );

  /**
   * При редактировании quantity/price/discount/vatRate/exciseRate
   * используем withSaleItemRecalc, который рассчитывает НДС внутри
   * строки (vatAmount, amount). Метод расчёта (INCLUDED/ADDED) берётся
   * из настроек учёта организации (vatCalculationMethod).
   *
   * Принудительно обнуляет НДС-поля если isVatEnabled=false, поля скидки
   * если useDiscount=false, и поля акциза если useExcise=false — гарантируя,
   * что отключённые опции не дают значимых расчётов.
   */
  const recalcWithFlags = useCallback(
    (row: any, patch: Record<string, unknown>): Record<string, unknown> => {
      const enforced: Record<string, unknown> = { ...patch };
      if (!isVatEnabled) {
        enforced.vatRate = 0;
      }
      if (!useDiscount) {
        enforced.discountPercent = 0;
        enforced.discountAmount = 0;
      }
      if (!useExcise) {
        enforced.exciseRate = 0;
        enforced.exciseAmount = 0;
      }
      // ── Авто-подстановка ставок из настроек учёта ──────────────────────
      // Если итоговая ставка НДС/акциза получается «пустой» (null/undefined/""),
      // НО при этом не равна явному 0 — подставляем дефолт из настроек
      // организации. Явный 0, введённый пользователем, не перетирается:
      // он означает «без налога по этой строке» (необлагаемая позиция).
      const merged = { ...row, ...enforced } as Record<string, unknown>;
      const isBlank = (v: unknown) => v === null || v === undefined || v === "";
      if (isVatEnabled && isBlank(merged.vatRate)) {
        const d = Number(orgVatRate);
        if (Number.isFinite(d) && d > 0) enforced.vatRate = d;
      }
      if (useExcise && isBlank(merged.exciseRate)) {
        const d = Number(orgExciseRate);
        if (Number.isFinite(d) && d > 0) enforced.exciseRate = d;
      }
      return withSaleItemRecalc({ ...row, ...enforced, vatCalculationMethod }, enforced);
    },
    [isVatEnabled, useDiscount, useExcise, vatCalculationMethod, orgVatRate, orgExciseRate],
  );

  const requiredFields = useMemo(() => {
    return ["product.shortName", "quantity", "price", "unitOfMeasure.shortName"];
  }, []);


  // ── Пересчёт общей суммы при изменении строк ──────────────────────────
  const handleItemsChange = useCallback((items: TDataItem[]) => {
    if (onTotalChange) {
      const sum = items.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      (onTotalChange as any)(Math.round(sum * 100) / 100, items);
    }
    onItemsChange?.(items);
  }, [onTotalChange, onItemsChange]);

  // ── Правила валидации ячеек ────────────────────────────────────────────
  const validationRules = useMemo<Record<string, TCellValidator>>(() => {
    // Сужаем value: unknown → string безопасной строковой формой (без [object Object])
    const toStr = (v: unknown): string =>
      typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
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
        // Зажим 0–100 обрабатывается в FieldNumber (min/max props), ошибка здесь не нужна
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

    await apiClient.put(`/${MODEL_ENDPOINT}/${row.uuid}`, payload);
    await queryClient.invalidateQueries({ queryKey: [MODEL_ENDPOINT] });
  }, [queryClient, recalcWithFlags]);

  // ── renderCell ─────────────────────────────────────────────────────────
  // Стратегия: возвращаем undefined для чистого "только чтение" → Table сам
  // вызовет дефолтный getFormatColumnValue. Кастомный JSX отдаём только там,
  // где нужно: inline-редактирование, ReadOnlyCell-обёртка (мигание при клике),
  // вычисляемый lineNumber.
  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    const id = col.identifier;

    // ── lineNumber: всегда позиция строки в таблице ──────────────────────
    if (id === "lineNumber") {
      const idx = ctx.rows.indexOf(row);
      const value = idx >= 0 ? idx + 1 : (row.lineNumber as string | number | null | undefined) ?? "";
      return <ReadOnlyCell value={String(value)} inlineEditing={ctx.inlineEditing} />;
    }

    // ── Read-only вычисляемые суммы (мигание при клике в inline-режиме) ──
    // Форматирование (ru-RU, разделители групп) делегируется ReadOnlyCell
    // через column (column.type="number" → getFormatColumnValue).
    if (id === "vatAmount") return <ReadOnlyCell value={row.vatAmount ?? 0} column={col} inlineEditing={ctx.inlineEditing} />;
    if (id === "amount") return <ReadOnlyCell value={row.amount ?? 0} column={col} inlineEditing={ctx.inlineEditing} />;
    if (id === "amountWithoutVat") return <ReadOnlyCell value={row.amountWithoutVat ?? 0} column={col} inlineEditing={ctx.inlineEditing} />;
    if (id === "amountNetOfIndirectTaxes") {
      // Графа 13 ЭСФ РК: стоимость без НДС и без акциза = amountWithoutVat − exciseAmount.
      const netVal = Number(row.amountWithoutVat ?? 0) - Number(row.exciseAmount ?? 0);
      return <ReadOnlyCell value={netVal} column={col} inlineEditing={ctx.inlineEditing} />;
    }
    if (id === "exciseAmount") return <ReadOnlyCell value={row.exciseAmount ?? 0} column={col} inlineEditing={ctx.inlineEditing} />;

    // ── discountAmount: read-only вне inline / FieldNumber внутри ────────
    if (id === "discountAmount") {
      if (!ctx.inlineEditing) {
        return <ReadOnlyCell value={row.discountAmount ?? 0} column={col} inlineEditing={false} />;
      }
      return (
        <FieldNumber
          name={`saleitem_discamt_${row.id}`}
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
          textAlign="right"
          width="100%"
          actions={[]}
          variant="table"
        />
      );
    }

    // ── Вне inline-режима для обычных колонок — дефолтный рендер Table ───
    if (!ctx.inlineEditing) return undefined;

    // ── Inline-режим: контролы редактирования ────────────────────────────
    if (id === "product.shortName") {
      return (
        <LookupField
          label=""
          name={`saleitem_product_${row.id}`}
          value={(row.productUuid as string) ?? ""}
          displayValue={(row.product as any)?.shortName ?? ""}
          endpoint="products"
          displayField="shortName"
          columns={[
            { key: "shortName", label: "Наименование" },
            { key: "sku", label: "Артикул" },
            { key: "brand.shortName", label: "Бренд" },
          ]}
          onSelect={(uuid, _displayValue, item) => {
            const extra: Record<string, unknown> = {
              product: item && uuid ? { uuid, shortName: item.shortName ?? "" } : null,
            };
            const umUuid = item?.unitOfMeasureUuid as string | undefined;
            const um = item?.unitOfMeasure as { uuid?: string; shortName?: string; name?: string } | undefined;
            if (umUuid) {
              extra.unitOfMeasureUuid = umUuid;
              extra.unitOfMeasure = um
                ? { uuid: um.uuid ?? umUuid, shortName: um.shortName ?? um.name ?? "" }
                : { uuid: umUuid, shortName: "" };
            }
            ctx.handleLookupChange(row, "productUuid", uuid, extra);
          }}
          onClear={() => {
            ctx.handleLookupChange(row, "productUuid", null, { product: null });
          }}
          onEnterKey={() => focusNextInRow(document.activeElement)}
          onAfterSelect={() => focusNextInRow(document.activeElement)}
          disabled={ctx.disabled}
          width="100%"
          variant="table"
        />
      );
    }

    if (id === "quantity") {
      return (
        <FieldNumber
          name={`saleitem_qty_${row.id}`}
          value={row.quantity != null ? String(row.quantity as number | string) : "0"}
          onChange={e => {
            if (ctx.deferRemoteChanges) {
              ctx.updateLocalRow(row, recalcWithFlags(row as any, { quantity: e.target.value }));
              return;
            }
            ctx.handleInlineChange(row, "quantity", e.target.value);
          }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); focusNextInRow(e.currentTarget); } }}
          disabled={ctx.disabled}
          textAlign="right"
          width="100%"
          actions={[]}
          variant="table"
        />
      );
    }

    if (id === "price") {
      return (
        <FieldNumber
          name={`saleitem_price_${row.id}`}
          value={row.price != null ? String(row.price as number | string) : "0"}
          onChange={e => {
            if (ctx.deferRemoteChanges) {
              ctx.updateLocalRow(row, recalcWithFlags(row as any, { price: e.target.value }));
              return;
            }
            ctx.handleInlineChange(row, "price", e.target.value);
          }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); focusNextInRow(e.currentTarget); } }}
          disabled={ctx.disabled}
          step="0.1"
          textAlign="right"
          width="100%"
          actions={[]}
          variant="table"
        />
      );
    }

    if (id === "unitOfMeasure.shortName") {
      return (
        <LookupField
          label=""
          name={`saleitem_uom_${row.id}`}
          value={(row.unitOfMeasureUuid as string) ?? ""}
          displayValue={(row.unitOfMeasure as any)?.shortName ?? ""}
          endpoint="unit-of-measures"
          displayField="shortName"
          columns={[
            { key: "shortName", label: "Наименование" },
            { key: "code", label: "Код" },
          ]}
          onSelect={(uuid, _displayValue, item) => {
            ctx.handleLookupChange(row, "unitOfMeasureUuid", uuid, {
              unitOfMeasure: item && uuid ? { uuid, shortName: item.shortName ?? "" } : null,
            });
          }}
          onClear={() => {
            ctx.handleLookupChange(row, "unitOfMeasureUuid", null, { unitOfMeasure: null });
          }}
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
          name={`saleitem_discount_${row.id}`}
          value={row.discountPercent != null ? String(row.discountPercent as number | string) : "0"}
          onChange={e => {
            if (ctx.deferRemoteChanges) {
              ctx.updateLocalRow(row, recalcWithFlags(row as any, { discountPercent: e.target.value }));
              return;
            }
            ctx.handleInlineChange(row, "discountPercent", e.target.value);
          }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); focusNextInRow(e.currentTarget); } }}
          disabled={ctx.disabled}
          step="0.1"
          min="0"
          max="100"
          textAlign="right"
          width="100%"
          actions={[]}
          variant="table"
        />
      );
    }

    if (id === "exciseRate") {
      return (
        <FieldNumber
          name={`saleitem_exciserate_${row.id}`}
          value={row.exciseRate != null ? String(row.exciseRate as number | string) : "0"}
          onChange={e => {
            if (ctx.deferRemoteChanges) {
              ctx.updateLocalRow(row, recalcWithFlags(row as any, { exciseRate: e.target.value }));
              return;
            }
            ctx.handleInlineChange(row, "exciseRate", e.target.value);
          }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); focusNextInRow(e.currentTarget); } }}
          disabled={ctx.disabled}
          step="0.01"
          min="0"
          textAlign="right"
          width="100%"
          actions={[]}
          variant="table"
        />
      );
    }

    // Ручное редактирование ставки НДС в строке (НК РК ст. 422: 0..100%).
    // Значение по умолчанию подставляется из настроек учёта организации,
    // но пользователь может скорректировать его для конкретной строки
    // (например, экспорт со ставкой 0% или льготная категория).
    if (id === "vatRate") {
      return (
        <FieldNumber
          name={`saleitem_vatrate_${row.id}`}
          value={row.vatRate != null ? String(row.vatRate as number | string) : "0"}
          onChange={e => {
            if (ctx.deferRemoteChanges) {
              ctx.updateLocalRow(row, recalcWithFlags(row as any, { vatRate: e.target.value }));
              return;
            }
            ctx.handleInlineChange(row, "vatRate", e.target.value);
          }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); focusNextInRow(e.currentTarget); } }}
          disabled={ctx.disabled}
          step="0.01"
          min="0"
          max="100"
          textAlign="right"
          width="100%"
          actions={[]}
          variant="table"
        />
      );
    }

    return undefined;
  }, [recalcWithFlags]);

  // ── openFormFor ────────────────────────────────────────────────────────
  const buildItemLabel = (data: TDataItem | undefined, isEdit: boolean) => {
    const d = data as Record<string, any> | undefined;
    const own = makePaneLabelFromData("SaleItemsList", "Товары реализации", isEdit ? d ?? null : null);
    return parentLabel ? `${parentLabel} · ${own}` : own;
  };
  const openFormFor = useCallback((data: TDataItem | undefined, _ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    if (deferRemoteChanges && data) {
      addPane({
        label: buildItemLabel(data, isEdit),
        component: SaleItemsForm,
        data: {
          ...(data ?? {}),
          saleUuid,
          organizationUuid: organizationUuid ?? null,
          saleDate: documentDate ?? null,
          _embeddedSaleItem: {
            applyDraft: (nextRow: Record<string, unknown>) => {
              _ctx.updateLocalRow(data, nextRow);
            },
            organizationUuid: organizationUuid ?? null,
            saleDate: documentDate ?? null,
          },
        } as any,
      });
      return;
    }
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: [MODEL_ENDPOINT] });
      _ctx.refetch();
    };
    addPane({
      label: buildItemLabel(data, isEdit),
      component: SaleItemsForm,
      data: {
        ...(data ?? {}),
        saleUuid,
        organizationUuid: organizationUuid ?? null,
        saleDate: documentDate ?? null,
      } as any,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, saleUuid, queryClient, deferRemoteChanges, organizationUuid, documentDate]);

  // ── defaultNewRow ───────────────────────────────────────────────────────
  // При добавлении новой строки подставляем ставку НДС из настроек учёта.
  const defaultNewRow = useMemo(() => ({
    productUuid: null,
    quantity: 0,
    price: 0,
    unitOfMeasureUuid: null,
    vatRate: isVatEnabled ? Number(orgVatRate) || 0 : 0,
    discountPercent: 0,
    discountAmount: 0,
    exciseRate: useExcise ? Number(orgExciseRate) || 0 : 0,
    exciseAmount: 0,
    vatAmount: 0,
    amountWithoutVat: 0,
    amount: 0,
  }), [isVatEnabled, orgVatRate, useExcise, orgExciseRate]);


  return (
    <SubTable
      key={taxSig}
      model={MODEL_ENDPOINT}
      componentName={COMPONENT_NAME}
      columnsJson={dynamicColumns}
      parentKey="saleUuid"
      parentUuid={saleUuid}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      emptyMessage="Сохраните документ для добавления товаров."
      renderCell={renderCell}
      openFormFor={openFormFor}
      defaultNewRow={defaultNewRow}
      onItemsChange={handleItemsChange}
      customInlineChange={customInlineChange}
      validationRules={validationRules}
      requiredFields={requiredFields}
      computeRow={(row) => ({
        // Графа 13 ЭСФ РК: стоимость без НДС и без акциза = amountWithoutVat − exciseAmount.
        // Поле отсутствует в БД (dynamic: true в saleItemsColumns.json), вычисляется на клиенте,
        // чтобы клиентская сортировка по этой колонке находила значение через getNestedValue.
        amountNetOfIndirectTaxes:
          Number(row.amountWithoutVat ?? 0) - Number(row.exciseAmount ?? 0),
      })}
      extraButtons={
        <RecalcAllButton
          disabled={disabled}
          recalcRow={(row) => {
            // Дозаполняем только то, что в строке отсутствует:
            //   - unitOfMeasure из номенклатуры (product.unitOfMeasureUuid),
            //     если строка ещё не имеет своей единицы измерения;
            //   - discountPercent/exciseRate → 0, если значения null/undefined
            //     (нормализация для стабильного пересчёта).
            //
            // ВАЖНО: vatRate и exciseRate, явно установленные пользователем
            // (включая значение 0 — допустимо по НК РК для экспорта/льгот),
            // НЕ перезаписываются настройками НУО. Кнопка «Пересчитать»
            // уважает выбор пользователя в каждой строке.
            const refDefaults: Record<string, unknown> = {};
            const product = row.product as { unitOfMeasureUuid?: string | null; unitOfMeasure?: { uuid?: string; shortName?: string } | null } | null | undefined;
            if (!row.unitOfMeasureUuid && product?.unitOfMeasureUuid) {
              refDefaults.unitOfMeasureUuid = product.unitOfMeasureUuid;
              if (product.unitOfMeasure) {
                refDefaults.unitOfMeasure = product.unitOfMeasure;
              }
            }
            // Нормализуем числовые поля (если null/undefined → 0), чтобы
            // пересчёт всегда давал стабильный результат. Значение 0,
            // явно установленное пользователем — НЕ перезаписываем.
            if (row.discountPercent == null) refDefaults.discountPercent = 0;
            if (row.exciseRate == null) refDefaults.exciseRate = 0;
            if (row.vatRate == null) refDefaults.vatRate = 0;
            return recalcWithFlags(row as any, refDefaults);
          }}
        />
      }
    />
  );
};

SaleItemsTable.displayName = "SaleItemsTable";
export { SaleItemsTable };
export default SaleItemsTable;

// ─────────────────────────────────────────────────────────────────────────
// RecalcAllButton — кнопка тулбара "Пересчитать": перевычисляет суммы
// (количество × цена, скидка, НДС) для всех СТРОК В ТАБЛИЦЕ.
//
// Работает чисто на фронтенде через SubTableContext.updateLocalRow:
//   - не выполняет refetch (документ может быть не сохранён);
//   - в режиме deferRemoteChanges изменения остаются локальными до save;
//   - в обычном режиме PUT отправляется параллельно для уже сохранённых
//     строк (row.uuid), но загрузка таблицы не перезапускается —
//     UI обновляется сразу через локальный кэш SubTable.
// ─────────────────────────────────────────────────────────────────────────
interface RecalcAllButtonProps {
  disabled?: boolean;
  recalcRow: (row: TDataItem) => Record<string, unknown>;
}

const RecalcAllButton: FC<RecalcAllButtonProps> = ({ disabled = false, recalcRow }) => {
  const subCtx = useSubTableContext();
  const tableCtx = useTableContext();
  const [busy, setBusy] = useState(false);

  const handleClick = useCallback(async () => {
    const rows = subCtx?.rows ?? tableCtx.rows;
    if (!rows || rows.length === 0) return;
    setBusy(true);
    try {
      // 1) Локальный пересчёт всех строк (включая несохранённые).
      //    Применяем patch только если значения реально изменились —
      //    иначе пустой no-op patch без причины поднимает dirty-флаг.
      const patches: Array<{ row: TDataItem; payload: Record<string, unknown> }> = [];
      for (const row of rows) {
        const payload = recalcRow(row);
        const realPatch: Record<string, unknown> = {};
        for (const [key, nextVal] of Object.entries(payload)) {
          const prev = (row as Record<string, unknown>)[key];
          if (!isEquivalent(prev, nextVal)) {
            realPatch[key] = nextVal;
          }
        }
        if (Object.keys(realPatch).length === 0) continue;
        patches.push({ row, payload: realPatch });
        subCtx?.updateLocalRow(row, realPatch);
      }

      // 2) В обычном (не отложенном) режиме — параллельно сохраняем
      //    изменения для уже существующих строк. Без refetch.
      if (!subCtx?.deferRemoteChanges) {
        await Promise.all(
          patches.map(({ row, payload }) =>
            row.uuid
              ? apiClient.put(`/${MODEL_ENDPOINT}/${row.uuid}`, payload).catch(() => undefined)
              : Promise.resolve(),
          ),
        );
      }
    } finally {
      setBusy(false);
    }
  }, [subCtx, tableCtx, recalcRow]);

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
