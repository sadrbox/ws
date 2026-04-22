/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-floating-promises */
import { FC, useCallback, useMemo } from "react";
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
import { withSaleItemRecalc } from "./saleItemDraft";

const MODEL_ENDPOINT = "saleitems";
const COMPONENT_NAME = "SaleItemsList_part";

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
  const validationRules = useMemo<Record<string, TCellValidator>>(() => ({
    quantity: (value) => {
      const n = Number(value);
      if (value === "" || value == null) return undefined;
      if (isNaN(n)) return "Должно быть числом";
      if (n < 0) return "Не может быть отрицательным";
      return undefined;
    },
    price: (value) => {
      const n = Number(value);
      if (value === "" || value == null) return undefined;
      if (isNaN(n)) return "Должно быть числом";
      if (n < 0) return "Не может быть отрицательным";
      return undefined;
    },
    vatRate: (_value) => undefined,
    discountPercent: (value) => {
      const n = Number(value);
      if (value === "" || value == null) return undefined;
      if (isNaN(n)) return "Должно быть числом";
      if (n < 0 || n > 100) return "От 0 до 100";
      return undefined;
    },
  }), []);

  const customInlineChange = useCallback(async (row: TDataItem, field: string, value: string) => {
    if (!row.uuid) return;

    const payload = ["quantity", "price", "discountPercent", "vatRate"].includes(field)
      ? withSaleItemRecalc(row as any, { [field]: value })
      : { [field]: value };

    await apiClient.put(`/${MODEL_ENDPOINT}/${row.uuid}`, payload);
    await queryClient.invalidateQueries({ queryKey: [MODEL_ENDPOINT] });
  }, [queryClient]);

  // ── renderCell ─────────────────────────────────────────────────────────
  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "product.shortName") {
      if (ctx.inlineEditing) {
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
            disabled={ctx.disabled}
            width="100%"
            variant="table"
          />
        );
      }
      return <span>{(row.product as any)?.shortName ?? ""}</span>;
    }
    if (col.identifier === "quantity") {
      if (ctx.inlineEditing) {
        return (
          <FieldNumber
            name={`saleitem_qty_${row.id}`}
            value={row.quantity != null ? String(Number(row.quantity)) : ""}
            onChange={e => {
              if (ctx.deferRemoteChanges) {
                ctx.updateLocalRow(row, withSaleItemRecalc(row as any, { quantity: e.target.value }));
                return;
              }
              ctx.handleInlineChange(row, "quantity", e.target.value);
            }}
            disabled={ctx.disabled}
            step="0.0001"
            textAlign="right"
            width="100%"
            actions={[]}
            variant="table"
          />
        );
      }
      return <span style={{ textAlign: "right", display: "block" }}>{row.quantity != null ? String(Number(row.quantity)) : ""}</span>;
    }
    if (col.identifier === "price") {
      if (ctx.inlineEditing) {
        return (
          <FieldNumber
            name={`saleitem_price_${row.id}`}
            value={row.price != null ? String(Number(row.price)) : ""}
            onChange={e => {
              if (ctx.deferRemoteChanges) {
                ctx.updateLocalRow(row, withSaleItemRecalc(row as any, { price: e.target.value }));
                return;
              }
              ctx.handleInlineChange(row, "price", e.target.value);
            }}
            disabled={ctx.disabled}
            step="0.01"
            textAlign="right"
            width="100%"
            actions={[]}
            variant="table"
          />
        );
      }
      return <span style={{ textAlign: "right", display: "block" }}>{row.price != null ? String(Number(row.price)) : ""}</span>;
    }
    if (col.identifier === "unitOfMeasure.shortName") {
      if (ctx.inlineEditing) {
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
            disabled={ctx.disabled}
            width="100%"
            variant="table"
            visibleActions={["quickselect"]}
          />
        );
      }
      return <span style={{ textAlign: "center", display: "block" }}>{(row.unitOfMeasure as any)?.shortName ?? ""}</span>;
    }
    if (col.identifier === "vatRateRef.shortName") {
      if (ctx.inlineEditing) {
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
            disabled={ctx.disabled}
            width="100%"
            variant="table"
            visibleActions={["quickselect"]}
          />
        );
      }
      return <span style={{ textAlign: "center", display: "block" }}>{(row.vatRateRef as any)?.shortName ?? ""}</span>;
    }
    if (col.identifier === "discountPercent") {
      if (ctx.inlineEditing) {
        return (
          <FieldNumber
            name={`saleitem_discount_${row.id}`}
            value={row.discountPercent != null ? String(Number(row.discountPercent)) : "0"}
            onChange={e => {
              if (ctx.deferRemoteChanges) {
                ctx.updateLocalRow(row, withSaleItemRecalc(row as any, { discountPercent: e.target.value }));
                return;
              }
              ctx.handleInlineChange(row, "discountPercent", e.target.value);
            }}
            disabled={ctx.disabled}
            step="0.01"
            textAlign="right"
            width="100%"
            actions={[]}
            variant="table"
          />
        );
      }
      return <span style={{ textAlign: "right", display: "block" }}>{row.discountPercent != null ? String(Number(row.discountPercent)) : "0"}</span>;
    }
    if (col.identifier === "vatAmount") {
      return <span style={{ textAlign: "right", display: "block" }}>{row.vatAmount != null ? String(Number(row.vatAmount)) : "0"}</span>;
    }
    if (col.identifier === "discountAmount") {
      return <span style={{ textAlign: "right", display: "block" }}>{row.discountAmount != null ? String(Number(row.discountAmount)) : "0"}</span>;
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
      defaultSort={{ lineNumber: "asc" }}
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
    />
  );
};

SaleItemsTable.displayName = "SaleItemsTable";
export default SaleItemsTable;
