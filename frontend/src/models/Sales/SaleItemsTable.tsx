import { FC, useCallback, useMemo } from "react";
import { useAppContext } from "src/app";
import { useQueryClient } from "@tanstack/react-query";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { FieldNumber } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import SaleItemsForm from "./SaleItemsForm";
import { translate } from "src/i18";
import columnsJson from "./saleItemsColumns.json";
import SubTable, { type SubTableContext, type TCellValidator } from "src/components/SubTable";

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
  const t = translate;

  // ── Пересчёт общей суммы при изменении строк ──────────────────────────
  const handleItemsChange = useCallback((items: TDataItem[]) => {
    if (onTotalChange) {
      const sum = items.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      onTotalChange(Math.round(sum * 100) / 100);
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
  }), []);

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
            onChange={e => ctx.handleInlineChange(row, "quantity", e.target.value)}
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
            onChange={e => ctx.handleInlineChange(row, "price", e.target.value)}
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
    return undefined;
  }, []);

  // ── openFormFor ────────────────────────────────────────────────────────
  const openFormFor = useCallback((data: TDataItem | undefined, _ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: [MODEL_ENDPOINT] });
      _ctx.refetch();
    };
    addPane({
      label: isEdit
        ? `${t("SaleItemsList")}: ${(data as any)?.product?.shortName || t("noName")} • ${data?.id ?? "?"}`
        : `${t("SaleItemsList")}: ${t("new")}`,
      component: SaleItemsForm,
      data: { ...(data ?? {}), saleUuid } as any,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, t, saleUuid, queryClient]);

  // ── defaultNewRow ───────────────────────────────────────────────────────
  const defaultNewRow = useMemo(() => ({
    productUuid: null,
    quantity: 0,
    price: 0,
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
      validationRules={validationRules}
    />
  );
};

SaleItemsTable.displayName = "SaleItemsTable";
export default SaleItemsTable;
