/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-floating-promises */
import { FC, useCallback, useMemo, useState } from "react";
import { useAppContext } from "src/app";
import { useQueryClient } from "@tanstack/react-query";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { FieldNumber } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import apiClient from "src/services/api/client";
import SaleItemsForm from "./SaleItemsForm";
import columnsJson from "./saleItemsColumns.json";
import SubTable, { type SubTableContext, type TCellValidator } from "src/components/SubTable";
import { makePaneLabelFromData } from "src/utils/buildPaneLabel";
import { withSaleItemRecalc, withSaleItemRecalcFromDiscountAmount } from "./saleItemDraft";
import { getFormatNumerical, parseNumericInput } from "src/components/Table/services";
import fieldStyles from "src/components/Field/Field.module.scss";

const MODEL_ENDPOINT = "saleitems";
const COMPONENT_NAME = "SaleItemsList_part";

/**
 * Безопасно форматирует числовое значение любого типа (number | string | null | undefined)
 * в строку с разделителями групп цифр (формат "999 999 999,99").
 * Возвращает пустую строку если значение не приводимо к числу.
 */
const fmtNum = (value: unknown): string => {
  if (value == null || value === "") return "";
  const n = Number(value);
  return isNaN(n) ? "" : getFormatNumerical(n);
};

/**
 * Ячейка только для чтения: при клике в режиме inline-editing мигает красным,
 * сигнализируя пользователю что поле нередактируемо.
 */
const ReadOnlyCell: FC<{ value: string; inlineEditing: boolean }> = ({ value, inlineEditing }) => {
  const [flashing, setFlashing] = useState(false);

  const handleClick = useCallback((_e: React.MouseEvent) => {
    if (!inlineEditing) return;
    // e.stopPropagation();
    setFlashing(false);
    // Сбрасываем в следующем тике, чтобы повторный клик снова запускал анимацию
    requestAnimationFrame(() => setFlashing(true));
    setTimeout(() => setFlashing(false), 600);
  }, [inlineEditing]);

  return (
    <span
      className={flashing ? fieldStyles.flashReadOnly : undefined}
      onClick={handleClick}
      style={inlineEditing ? { display: "flex", alignItems: "center", flex: 1, width: "100%", height: "100%", justifyContent: "flex-end" } : undefined}
    >
      {value}
    </span>
  );
};

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
  disabled?: boolean;
  onTotalChange?: (total: number) => void;
  /** Если true — не отправлять изменения на сервер, хранить локально (для отложенного сохранения) */
  deferRemoteChanges?: boolean;
  /** Колбэк при изменении строк (для формы-родителя) */
  onItemsChange?: (items: TDataItem[]) => void;
  /** Начальные pending-строки (для восстановления из sessionStorage) */
  initialPendingRows?: TDataItem[];
}

const SaleItemsTable: FC<SaleItemsTableProps> = ({ saleUuid, disabled = false, onTotalChange, deferRemoteChanges = false, onItemsChange, initialPendingRows }) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();


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
      vatRate: () => undefined,
      discountPercent: (value) => {
        if (value === "" || value == null) return undefined;
        const n = parseNumericInput(toStr(value));
        if (n === null) return "Должно быть числом";
        // Зажим 0–100 обрабатывается в FieldNumber (min/max props), ошибка здесь не нужна
        return undefined;
      },
    };
  }, []);

  const customInlineChange = useCallback(async (row: TDataItem, field: string, value: string) => {
    if (!row.uuid) return;

    const payload = ["quantity", "price", "discountPercent", "vatRate"].includes(field)
      ? withSaleItemRecalc(row as any, { [field]: value })
      : { [field]: value };

    await apiClient.put(`/${MODEL_ENDPOINT}/${row.uuid}`, payload);
    await queryClient.invalidateQueries({ queryKey: [MODEL_ENDPOINT] });
  }, [queryClient]);

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
      const value = String(idx >= 0 ? idx + 1 : (row.lineNumber as string | number | null | undefined) ?? "");
      return <ReadOnlyCell value={value} inlineEditing={ctx.inlineEditing} />;
    }

    // ── Read-only вычисляемые суммы (мигание при клике в inline-режиме) ──
    if (id === "vatAmount") return <ReadOnlyCell value={fmtNum(row.vatAmount) || "0"} inlineEditing={ctx.inlineEditing} />;
    if (id === "amount") return <ReadOnlyCell value={fmtNum(row.amount) || "0"} inlineEditing={ctx.inlineEditing} />;

    // ── discountAmount: read-only вне inline / FieldNumber внутри ────────
    if (id === "discountAmount") {
      if (!ctx.inlineEditing) {
        return <ReadOnlyCell value={fmtNum(row.discountAmount) || "0"} inlineEditing={false} />;
      }
      return (
        <FieldNumber
          name={`saleitem_discamt_${row.id}`}
          value={row.discountAmount != null ? String(row.discountAmount as number | string) : "0"}
          onChange={e => {
            if (ctx.deferRemoteChanges) {
              ctx.updateLocalRow(row, withSaleItemRecalcFromDiscountAmount(row as any, e.target.value));
              return;
            }
            const recalc = withSaleItemRecalcFromDiscountAmount(row as any, e.target.value);
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
            ctx.handleLookupChange(row, "productUuid", uuid, {
              product: item && uuid ? { uuid, shortName: item.shortName ?? "" } : null,
            });
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
              ctx.updateLocalRow(row, withSaleItemRecalc(row as any, { quantity: e.target.value }));
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
              ctx.updateLocalRow(row, withSaleItemRecalc(row as any, { price: e.target.value }));
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

    if (id === "vatRateRef.shortName") {
      return (
        <LookupField
          label=""
          name={`saleitem_vatRate_${row.id}`}
          value={(row.vatRateUuid as string) ?? ""}
          displayValue={(row.vatRateRef as any)?.shortName ?? ""}
          endpoint="vat-rates"
          displayField="shortName"
          columns={[
            { key: "shortName", label: "Наименование" },
            { key: "rate", label: "%" },
          ]}
          onSelect={(uuid, _displayValue, item) => {
            if (ctx.deferRemoteChanges) {
              ctx.updateLocalRow(row, withSaleItemRecalc(row as any, {
                vatRateUuid: uuid,
                vatRateRef: item && uuid ? { uuid, shortName: item.shortName ?? "", rate: item.rate } : null,
                vatRate: item?.rate ?? 0,
              }));
              return;
            }
            ctx.handleLookupChange(row, "vatRateUuid", uuid, {
              vatRateRef: item && uuid ? { uuid, shortName: item.shortName ?? "", rate: item.rate } : null,
              vatRate: item?.rate ?? 0,
              ...withSaleItemRecalc(row as any, { vatRate: item?.rate ?? 0 }),
            });
          }}
          onClear={() => {
            if (ctx.deferRemoteChanges) {
              ctx.updateLocalRow(row, withSaleItemRecalc(row as any, {
                vatRateUuid: null,
                vatRateRef: null,
                vatRate: 0,
              }));
              return;
            }
            ctx.handleLookupChange(row, "vatRateUuid", null, {
              vatRateRef: null,
              vatRate: 0,
              ...withSaleItemRecalc(row as any, { vatRate: 0 }),
            });
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
              ctx.updateLocalRow(row, withSaleItemRecalc(row as any, { discountPercent: e.target.value }));
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

    return undefined;
  }, []);

  // ── openFormFor ────────────────────────────────────────────────────────
  const openFormFor = useCallback((data: TDataItem | undefined, _ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    if (deferRemoteChanges && data) {
      addPane({
        label: makePaneLabelFromData("SaleItemsList", "Товары реализации", isEdit ? data as any : null),
        component: SaleItemsForm,
        data: {
          ...(data ?? {}),
          saleUuid,
          _embeddedSaleItem: {
            applyDraft: (nextRow: Record<string, unknown>) => {
              _ctx.updateLocalRow(data, nextRow);
            },
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
      label: makePaneLabelFromData("SaleItemsList", "Товары реализации", isEdit ? data as any : null),
      component: SaleItemsForm,
      data: { ...(data ?? {}), saleUuid } as any,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, saleUuid, queryClient, deferRemoteChanges]);

  // ── defaultNewRow ───────────────────────────────────────────────────────
  const defaultNewRow = useMemo(() => ({
    productUuid: null,
    quantity: 0,
    price: 0,
    unitOfMeasureUuid: null,
    vatRateUuid: null,
    vatRate: 0,
    discountPercent: 0,
    discountAmount: 0,
    vatAmount: 0,
    amount: 0,
  }), []);


  return (
    <SubTable
      model={MODEL_ENDPOINT}
      componentName={COMPONENT_NAME}
      columnsJson={columnsJson}
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
      requiredFields={["product.shortName", "quantity", "price", "unitOfMeasure.shortName", "vatRateRef.shortName"]}
    />
  );
};

SaleItemsTable.displayName = "SaleItemsTable";
export { SaleItemsTable };
export default SaleItemsTable;
