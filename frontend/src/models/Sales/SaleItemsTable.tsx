import { FC, useCallback, useEffect, useState } from "react";
import apiClient from "src/services/api/client";
import LookupField from "src/components/Field/LookupField";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface SaleItemRow {
  id?: number;
  uuid?: string;
  lineNumber: number;
  productUuid: string;
  productName: string;
  quantity: string;
  price: string;
  amount: string;
  isNew?: boolean;   // строка ещё не сохранена
  isDirty?: boolean;  // строка изменена
}

interface SaleItemsTableProps {
  saleUuid: string;
  disabled?: boolean;
  onTotalChange?: (total: number) => void;
}

const EMPTY_ROW = (lineNumber: number): SaleItemRow => ({
  lineNumber,
  productUuid: "",
  productName: "",
  quantity: "",
  price: "",
  amount: "",
  isNew: true,
  isDirty: false,
});

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

const SaleItemsTable: FC<SaleItemsTableProps> = ({ saleUuid, disabled = false, onTotalChange }) => {
  const [rows, setRows] = useState<SaleItemRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingRows, setSavingRows] = useState<Set<number>>(new Set());

  // ── Загрузка строк ────────────────────────────────────────────────────
  const loadItems = useCallback(async () => {
    if (!saleUuid) return;
    setIsLoading(true); setError(null);
    try {
      const res = await apiClient.get(`/saleitems?saleUuid=${saleUuid}`);
      const items = res.data?.items ?? [];
      const mapped: SaleItemRow[] = items.map((d: any) => ({
        id: d.id,
        uuid: d.uuid,
        lineNumber: d.lineNumber ?? 0,
        productUuid: d.productUuid ?? "",
        productName: d.product?.shortName ?? "",
        quantity: d.quantity != null ? String(Number(d.quantity)) : "",
        price: d.price != null ? String(Number(d.price)) : "",
        amount: d.amount != null ? String(Number(d.amount)) : "",
        isNew: false,
        isDirty: false,
      }));
      setRows(mapped);
      recalcTotal(mapped);
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка загрузки строк"); }
    finally { setIsLoading(false); }
  }, [saleUuid]);

  useEffect(() => { loadItems(); }, [loadItems]);

  // ── Пересчёт итого ───────────────────────────────────────────────────
  const recalcTotal = useCallback((items: SaleItemRow[]) => {
    const total = items.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    onTotalChange?.(Math.round(total * 100) / 100);
  }, [onTotalChange]);

  // ── Авто-пересчёт суммы строки ────────────────────────────────────────
  const calcRowAmount = (qty: string, prc: string): string => {
    const q = parseFloat(qty) || 0;
    const p = parseFloat(prc) || 0;
    return (Math.round(q * p * 100) / 100).toString();
  };

  // ── Изменение поля строки ─────────────────────────────────────────────
  const updateRow = useCallback((idx: number, field: keyof SaleItemRow, value: string) => {
    setRows(prev => {
      const next = [...prev];
      const row = { ...next[idx], [field]: value, isDirty: true };

      if (field === "quantity" || field === "price") {
        row.amount = calcRowAmount(
          field === "quantity" ? value : row.quantity,
          field === "price" ? value : row.price
        );
      }
      next[idx] = row;
      recalcTotal(next);
      return next;
    });
  }, [recalcTotal]);

  // ── Выбор номенклатуры ────────────────────────────────────────────────
  const handleProductSelect = useCallback((idx: number, uuid: string, name: string) => {
    setRows(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], productUuid: uuid, productName: name, isDirty: true };
      return next;
    });
  }, []);

  const handleProductClear = useCallback((idx: number) => {
    setRows(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], productUuid: "", productName: "", isDirty: true };
      return next;
    });
  }, []);

  // ── Сохранение строки ─────────────────────────────────────────────────
  const saveRow = useCallback(async (idx: number) => {
    const row = rows[idx];
    if (!row) return;

    setSavingRows(prev => new Set(prev).add(idx));
    try {
      const payload = {
        saleUuid,
        productUuid: row.productUuid || null,
        quantity: parseFloat(row.quantity) || 0,
        price: parseFloat(row.price) || 0,
        lineNumber: row.lineNumber,
      };

      let saved: any;
      if (row.isNew) {
        const res = await apiClient.post("/saleitems", payload);
        saved = res.data?.item ?? res.data;
      } else if (row.uuid) {
        const res = await apiClient.put(`/saleitems/${row.uuid}`, payload);
        saved = res.data?.item ?? res.data;
      }

      if (saved) {
        setRows(prev => {
          const next = [...prev];
          next[idx] = {
            id: saved.id,
            uuid: saved.uuid,
            lineNumber: saved.lineNumber ?? idx + 1,
            productUuid: saved.productUuid ?? "",
            productName: saved.product?.shortName ?? row.productName,
            quantity: saved.quantity != null ? String(Number(saved.quantity)) : "",
            price: saved.price != null ? String(Number(saved.price)) : "",
            amount: saved.amount != null ? String(Number(saved.amount)) : "",
            isNew: false,
            isDirty: false,
          };
          recalcTotal(next);
          return next;
        });
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "Ошибка сохранения строки");
    } finally {
      setSavingRows(prev => { const s = new Set(prev); s.delete(idx); return s; });
    }
  }, [rows, saleUuid, recalcTotal]);

  // ── Добавление строки ─────────────────────────────────────────────────
  const addRow = useCallback(() => {
    setRows(prev => [...prev, EMPTY_ROW(prev.length + 1)]);
  }, []);

  // ── Удаление строки ───────────────────────────────────────────────────
  const deleteRow = useCallback(async (idx: number) => {
    const row = rows[idx];
    if (!row) return;

    if (row.isNew) {
      setRows(prev => { const next = prev.filter((_, i) => i !== idx); recalcTotal(next); return next; });
      return;
    }

    if (row.uuid) {
      try {
        await apiClient.delete(`/saleitems/${row.uuid}`);
        setRows(prev => { const next = prev.filter((_, i) => i !== idx); recalcTotal(next); return next; });
      } catch (err: any) {
        setError(err.response?.data?.message || "Ошибка удаления строки");
      }
    }
  }, [rows, recalcTotal]);

  // ── Рендер ────────────────────────────────────────────────────────────
  const totalAmount = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "4px 0" }}>
      {error && <div style={{ color: "red", padding: "6px 12px", background: "#ffebee", borderRadius: "4px", fontSize: 13 }}>{error}</div>}

      {/* Панель кнопок */}
      <div style={{ display: "flex", gap: "8px", padding: "0 4px", alignItems: "center" }}>
        <button
          onClick={addRow}
          disabled={disabled || isLoading}
          style={{
            padding: "4px 12px", fontSize: 13, cursor: "pointer",
            border: "1px solid #ccc", borderRadius: 4, background: "#f5f5f5",
          }}
        >
          + Добавить строку
        </button>
        <button
          onClick={loadItems}
          disabled={isLoading}
          style={{
            padding: "4px 12px", fontSize: 13, cursor: "pointer",
            border: "1px solid #ccc", borderRadius: 4, background: "#f5f5f5",
          }}
        >
          ↻ Обновить
        </button>
        <span style={{ fontSize: 13, color: "#555", marginLeft: "auto" }}>
          Итого: <strong>{totalAmount.toFixed(2)}</strong>
        </span>
      </div>

      {/* Таблица */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f8f8f8", borderBottom: "2px solid #ddd" }}>
              <th style={{ width: 40, padding: "6px 4px", textAlign: "center" }}>№</th>
              <th style={{ minWidth: 250, padding: "6px 8px", textAlign: "left" }}>Номенклатура</th>
              <th style={{ width: 110, padding: "6px 8px", textAlign: "right" }}>Кол-во</th>
              <th style={{ width: 110, padding: "6px 8px", textAlign: "right" }}>Цена</th>
              <th style={{ width: 120, padding: "6px 8px", textAlign: "right" }}>Сумма</th>
              <th style={{ width: 80, padding: "6px 4px", textAlign: "center" }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !isLoading && (
              <tr><td colSpan={6} style={{ padding: "16px", textAlign: "center", color: "#999" }}>Нет строк. Нажмите «+ Добавить строку»</td></tr>
            )}
            {isLoading && rows.length === 0 && (
              <tr><td colSpan={6} style={{ padding: "16px", textAlign: "center", color: "#999" }}>Загрузка...</td></tr>
            )}
            {rows.map((row, idx) => {
              const isSaving = savingRows.has(idx);
              const rowStyle: React.CSSProperties = {
                borderBottom: "1px solid #eee",
                background: row.isDirty ? "#fffde7" : (idx % 2 === 0 ? "#fff" : "#fafafa"),
              };
              return (
                <tr key={row.uuid || `new-${idx}`} style={rowStyle}>
                  <td style={{ padding: "4px", textAlign: "center", color: "#999" }}>{idx + 1}</td>
                  <td style={{ padding: "4px 8px" }}>
                    <LookupField
                      label=""
                      name={`saleitem_product_${idx}`}
                      value={row.productUuid}
                      displayValue={row.productName}
                      endpoint="products"
                      displayField="shortName"
                      columns={[
                        { key: "shortName", label: "Наименование" },
                        { key: "sku", label: "Артикул" },
                        { key: "brand.shortName", label: "Бренд" },
                      ]}
                      onSelect={(uuid, display) => handleProductSelect(idx, uuid, display)}
                      onClear={() => handleProductClear(idx)}
                      disabled={disabled || isSaving}
                      minWidth="200px"
                    />
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <input
                      type="number"
                      step="0.0001"
                      value={row.quantity}
                      onChange={e => updateRow(idx, "quantity", e.target.value)}
                      disabled={disabled || isSaving}
                      style={{ width: "100%", textAlign: "right", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 3, fontSize: 13, boxSizing: "border-box" }}
                    />
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <input
                      type="number"
                      step="0.01"
                      value={row.price}
                      onChange={e => updateRow(idx, "price", e.target.value)}
                      disabled={disabled || isSaving}
                      style={{ width: "100%", textAlign: "right", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 3, fontSize: 13, boxSizing: "border-box" }}
                    />
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 500 }}>
                    {row.amount ? parseFloat(row.amount).toFixed(2) : "0.00"}
                  </td>
                  <td style={{ padding: "4px", textAlign: "center" }}>
                    <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                      {row.isDirty && (
                        <button
                          onClick={() => saveRow(idx)}
                          disabled={isSaving}
                          title="Сохранить строку"
                          style={{ padding: "2px 8px", fontSize: 12, cursor: "pointer", border: "1px solid #4caf50", borderRadius: 3, background: "#e8f5e9", color: "#2e7d32" }}
                        >
                          {isSaving ? "..." : "💾"}
                        </button>
                      )}
                      <button
                        onClick={() => deleteRow(idx)}
                        disabled={disabled || isSaving}
                        title="Удалить строку"
                        style={{ padding: "2px 8px", fontSize: 12, cursor: "pointer", border: "1px solid #ef5350", borderRadius: 3, background: "#ffebee", color: "#c62828" }}
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

SaleItemsTable.displayName = "SaleItemsTable";
export default SaleItemsTable;
