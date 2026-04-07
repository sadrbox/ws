import { FC, useMemo, useCallback, useState, useEffect, useRef } from "react";
import { useAppContext } from "src/app";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./saleItemsColumns.json";
import { useInfiniteModelList, GLOBAL_ADAPTIVE_LIMIT_REF } from "src/hooks/useInfiniteModelList";
import { useModelDelete } from "src/hooks/useModelDelete";
import { Divider, FieldNumber } from "src/components/Field";
import { ButtonImage } from "src/components/Button";
import apiClient from "src/services/api/client";
import editInlineIcon from "src/assets/edit-inline_16.svg";
import LookupField from "src/components/Field/LookupField";
import SaleItemsForm from "./SaleItemsForm";
import { translate } from "src/i18";

const MODEL_ENDPOINT = "saleitems";
const COMPONENT_NAME = "SaleItemsList_part";

interface SaleItemsTableProps {
  saleUuid: string;
  disabled?: boolean;
  onTotalChange?: (total: number) => void;
}

const SaleItemsTable: FC<SaleItemsTableProps> = ({ saleUuid, disabled = false, onTotalChange }) => {
  const { addPane } = useAppContext().windows;
  const t = translate;

  const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(columnsJson, COMPONENT_NAME, "part"));
  const [sort, setSort] = useState<Record<string, "asc" | "desc">>({ lineNumber: "asc" });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Record<string, { value: unknown; operator: string }> | undefined>(undefined);
  const [inlineEditing, setInlineEditing] = useState(true);

  const [adaptiveLimit, setAdaptiveLimit] = useState(500);
  useEffect(() => { GLOBAL_ADAPTIVE_LIMIT_REF.current = adaptiveLimit; }, [adaptiveLimit]);
  const updateAdaptiveLimit = useCallback((n: number) => setAdaptiveLimit(n), []);

  const params = useMemo(() => ({
    sort, search, filter,
    extra: saleUuid ? { saleUuid } : undefined,
  }), [sort, search, filter, saleUuid]);

  const { allItems, total, isAnythingLoading, isFetchingNextPage, hasNextPage, error, refetch, fetchNextPage } =
    useInfiniteModelList<TDataItem>({ model: MODEL_ENDPOINT, params, queryOptions: {} });

  const handleDelete = useModelDelete(MODEL_ENDPOINT, refetch);

  // ── Пересчёт общей суммы ──────────────────────────────────────────────
  useEffect(() => {
    if (!onTotalChange) return;
    const sum = allItems.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    onTotalChange(Math.round(sum * 100) / 100);
  }, [allItems, onTotalChange]);

  // ── Кеширование строк ─────────────────────────────────────────────────
  const cachedRowsRef = useRef<TDataItem[]>([]);
  const [cacheVersion, setCacheVersion] = useState(0);
  useEffect(() => { cachedRowsRef.current = allItems; setCacheVersion(v => v + 1); }, [allItems]);
  const rows = useMemo(() => cachedRowsRef.current, [cacheVersion]);

  const handleSortChange = useCallback((s: typeof sort) => {
    cachedRowsRef.current = []; setCacheVersion(0); updateAdaptiveLimit(500); setSort(s ?? { lineNumber: "asc" });
  }, [updateAdaptiveLimit]);

  const handleFilterChange = useCallback((field: string, value: unknown, operator = "contains") => {
    setFilter((prev) => {
      const next = { ...(prev ?? {}) };
      if (value == null || value === "") delete next[field];
      else next[field] = { value, operator };
      return Object.keys(next).length > 0 ? next : undefined;
    });
  }, []);

  const handleSearch = useCallback((v: string) => setSearch(v.trim()), []);
  const clearFilters = useCallback(() => { setSearch(""); setFilter(undefined); }, []);

  const handleCleanRefresh = useCallback(() => {
    cachedRowsRef.current = []; setCacheVersion(0);
    setSearch(""); setFilter(undefined); setSort({ lineNumber: "asc" }); updateAdaptiveLimit(500);
    refetch();
  }, [refetch, updateAdaptiveLimit]);

  // ── Inline-редактирование ──────────────────────────────────────────────

  const handleInlineChange = useCallback(async (row: TDataItem, field: string, value: string) => {
    if (!row.uuid) return;
    try {
      await apiClient.put(`/${MODEL_ENDPOINT}/${row.uuid}`, { [field]: value });
      refetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Ошибка сохранения");
    }
  }, [refetch]);

  const handleProductSelect = useCallback(async (row: TDataItem, uuid: string) => {
    if (!row.uuid) return;
    try {
      await apiClient.put(`/${MODEL_ENDPOINT}/${row.uuid}`, { productUuid: uuid });
      refetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Ошибка сохранения");
    }
  }, [refetch]);

  const handleProductClear = useCallback(async (row: TDataItem) => {
    if (!row.uuid) return;
    try {
      await apiClient.put(`/${MODEL_ENDPOINT}/${row.uuid}`, { productUuid: null });
      refetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Ошибка сохранения");
    }
  }, [refetch]);

  const handleInlineAdd = useCallback(async () => {
    if (!saleUuid) return;
    try {
      await apiClient.post(`/${MODEL_ENDPOINT}`, {
        saleUuid,
        productUuid: null,
        quantity: 0,
        price: 0,
      });
      refetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Ошибка создания строки");
    }
  }, [saleUuid, refetch]);

  // ── renderCell: оба режима ─────────────────────────────────────────────

  const renderCell = useCallback((row: TDataItem, col: TColumn): React.ReactNode | undefined => {
    if (col.identifier === "product.shortName") {
      if (inlineEditing) {
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
            onSelect={(uuid) => handleProductSelect(row, uuid)}
            onClear={() => handleProductClear(row)}
            disabled={disabled}
            width="100%"
            variant="table"
          />
        );
      }
      return undefined;
    }
    if (col.identifier === "quantity") {
      if (inlineEditing) {
        return (
          <FieldNumber
            name={`saleitem_qty_${row.id}`}
            value={row.quantity != null ? String(Number(row.quantity)) : ""}
            onChange={e => handleInlineChange(row, "quantity", e.target.value)}
            disabled={disabled}
            step="0.0001"
            textAlign="right"
            width="100%"
            actions={[]}
            variant="table"
          />
        );
      }
      return undefined;
    }
    if (col.identifier === "price") {
      if (inlineEditing) {
        return (
          <FieldNumber
            name={`saleitem_price_${row.id}`}
            value={row.price != null ? String(Number(row.price)) : ""}
            onChange={e => handleInlineChange(row, "price", e.target.value)}
            disabled={disabled}
            step="0.01"
            textAlign="right"
            width="100%"
            actions={[]}
            variant="table"
          />
        );
      }
      return undefined;
    }
    return undefined;
  }, [handleInlineChange, handleProductSelect, handleProductClear, disabled, inlineEditing]);

  const toggleInlineEditing = useCallback(() => setInlineEditing(prev => !prev), []);

  // ── openModelForm ─────────────────────────────────────────────────────
  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    addPane({
      label: isEdit
        ? `${t("SaleItemsList")}: ${(d as any)?.product?.shortName || t("noName")} • ${d?.id ?? "?"}`
        : `${t("SaleItemsList")}: ${t("new")}`,
      component: SaleItemsForm,
      data: { ...(d ?? {}), saleUuid } as any,
      onSave: () => refetch(),
      onClose: () => refetch(),
    });
  }, [addPane, t, refetch, saleUuid]);

  const extraButtons = useMemo(() => (
    <>
      <Divider />
      <ButtonImage onClick={toggleInlineEditing} active={inlineEditing} title={inlineEditing ? "Редактирование через форму" : "Редактирование в таблице"}>
        <img src={editInlineIcon} alt="Inline edit" height={16} width={16} />
      </ButtonImage>
    </>
  ), [toggleInlineEditing, inlineEditing]);

  const tableProps = useMemo(() => ({
    variant: "embedded" as TTableVariant,
    enableDateRange: false,
    componentName: COMPONENT_NAME,
    rows,
    columns,
    total,
    totalPages: Math.ceil(total / adaptiveLimit),
    isLoading: isAnythingLoading,
    isFetching: isAnythingLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    pagination: { page: 1, limit: adaptiveLimit, onPageChange: () => { }, onLimitChange: () => { } },
    sorting: { sort, onSortChange: handleSortChange },
    filtering: { filters: filter, onFilterChange: handleFilterChange, onClearAll: clearFilters },
    search: { value: search, onChange: handleSearch },
    actions: { openModelForm, refetch: handleCleanRefresh, setColumns, fetchNextPage, setAdaptiveLimit: updateAdaptiveLimit },
    onDelete: handleDelete,
    extraButtons,
    inlineEditing,
    renderCell,
    onInlineAdd: inlineEditing ? handleInlineAdd : undefined,
  }), [rows, columns, total, adaptiveLimit, isAnythingLoading, error,
    sort, search, filter, handleSortChange, handleFilterChange, handleSearch, clearFilters,
    openModelForm, setColumns, hasNextPage, isFetchingNextPage, fetchNextPage, updateAdaptiveLimit, handleCleanRefresh, handleDelete,
    extraButtons, inlineEditing, renderCell, handleInlineAdd]);

  if (!saleUuid) {
    return (
      <div style={{ padding: "24px", color: "#999", textAlign: "center" }}>
        Сохраните документ для добавления товаров.
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container"><div className="error-message">
        <h3>Ошибка загрузки</h3>
        <p>{(error as Error)?.message || "Неизвестная ошибка"}</p>
        <button onClick={() => refetch()} className="retry-button">Повторить</button>
      </div></div>
    );
  }

  return <Table {...tableProps} />;
};

SaleItemsTable.displayName = "SaleItemsTable";
export default SaleItemsTable;
