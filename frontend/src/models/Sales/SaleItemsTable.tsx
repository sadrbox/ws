import { Dispatch, FC, SetStateAction, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import apiClient from "src/services/api/client";
import LookupField from "src/components/Field/LookupField";
import { Button, ButtonImage } from "src/components/Button";
import { Divider, FieldNumber } from "src/components/Field";
import Modal from "src/components/Modal";
import styles from "src/components/Table/Table.module.scss";
import reloadImage_16 from "src/assets/reload_16.png";
import settingsForm_16 from "src/assets/form-setting_16.png";
import searchField_16 from "src/assets/search-field_16.png";

import { DndContext, closestCenter } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PiDotsThreeVerticalDuotone } from "react-icons/pi";

import { TypeFormAction, TypeFormMethod } from "src/components/Table/types";

// ────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────

interface SaleItemRow {
  id?: number;
  uuid?: string;
  lineNumber: number;
  productUuid: string;
  productName: string;
  quantity: string;
  price: string;
  amount: string;
  isNew?: boolean;
  isDirty?: boolean;
  selected?: boolean;
}

interface SaleItemsTableProps {
  saleUuid: string;
  disabled?: boolean;
  onTotalChange?: (total: number) => void;
}

interface SaleItemColumn {
  key: string;
  label: string;
  visible: boolean;
  width?: string;
  minWidth?: string;
  textAlign?: "left" | "center" | "right";
  inlist?: boolean; // показывать в настройках колонок
}

const STORAGE_KEY = "saleItemsTable_columns";

const DEFAULT_COLUMNS: SaleItemColumn[] = [
  { key: "checkbox", label: "", visible: true, width: "30px", minWidth: "30px", textAlign: "center", inlist: false },
  { key: "lineNumber", label: "N", visible: true, width: "40px", minWidth: "40px", textAlign: "center", inlist: true },
  { key: "product", label: "Номенклатура", visible: true, minWidth: "200px", textAlign: "left", inlist: true },
  { key: "quantity", label: "Кол-во", visible: true, width: "100px", minWidth: "80px", textAlign: "right", inlist: true },
  { key: "price", label: "Цена", visible: true, width: "100px", minWidth: "80px", textAlign: "right", inlist: true },
  { key: "amount", label: "Сумма", visible: true, width: "110px", minWidth: "80px", textAlign: "right", inlist: true },
  { key: "actions", label: "", visible: true, width: "60px", minWidth: "60px", textAlign: "center", inlist: false },
];

const loadColumnsFromStorage = (): SaleItemColumn[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed: SaleItemColumn[] = JSON.parse(saved);
      // Мерж с дефолтными (на случай добавления новых колонок)
      return DEFAULT_COLUMNS.map(def => {
        const found = parsed.find(p => p.key === def.key);
        return found ? { ...def, visible: found.visible, width: found.width ?? def.width } : def;
      });
    }
  } catch { /* ignore */ }
  return DEFAULT_COLUMNS.map(c => ({ ...c }));
};

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────

const EMPTY_ROW = (lineNumber: number): SaleItemRow => ({
  lineNumber,
  productUuid: "",
  productName: "",
  quantity: "",
  price: "",
  amount: "",
  isNew: true,
  isDirty: false,
  selected: false,
});

const calcRowAmount = (qty: string, prc: string): string => {
  const q = parseFloat(qty) || 0;
  const p = parseFloat(prc) || 0;
  return (Math.round(q * p * 100) / 100).toString();
};

// ────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────

const SaleItemsTable: FC<SaleItemsTableProps> = ({ saleUuid, disabled = false, onTotalChange }) => {
  const [rows, setRows] = useState<SaleItemRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingRows, setSavingRows] = useState<Set<number>>(new Set());
  const [activeRowIdx, setActiveRowIdx] = useState<number | null>(null);

  // ── Columns config ──
  const [columns, setColumns] = useState<SaleItemColumn[]>(loadColumnsFromStorage);
  const [configModalAction, setConfigModalAction] = useState<TypeFormAction>("");
  const [visibleFastSearch, setVisibleFastSearch] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  // ── Data loading ──

  const recalcTotal = useCallback((items: SaleItemRow[]) => {
    const total = items.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    onTotalChange?.(Math.round(total * 100) / 100);
  }, [onTotalChange]);

  const loadItems = useCallback(async () => {
    if (!saleUuid) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.get("/saleitems?saleUuid=" + saleUuid);
      const items = res.data?.items ?? [];
      const mapped: SaleItemRow[] = items.map((d: any) => ({
        id: d.id, uuid: d.uuid,
        lineNumber: d.lineNumber ?? 0,
        productUuid: d.productUuid ?? "",
        productName: d.product?.shortName ?? "",
        quantity: d.quantity != null ? String(Number(d.quantity)) : "",
        price: d.price != null ? String(Number(d.price)) : "",
        amount: d.amount != null ? String(Number(d.amount)) : "",
        isNew: false, isDirty: false, selected: false,
      }));
      setRows(mapped);
      recalcTotal(mapped);
    } catch (err: any) {
      setError(err.response?.data?.message || "Ошибка загрузки строк");
    } finally {
      setIsLoading(false);
    }
  }, [saleUuid, recalcTotal]);

  useEffect(() => { loadItems(); }, [loadItems]);

  // ── Row mutations ──

  const updateRow = useCallback((idx: number, field: keyof SaleItemRow, value: string) => {
    setRows(prev => {
      const next = [...prev];
      const row = { ...next[idx], [field]: value, isDirty: true };
      if (field === "quantity" || field === "price") {
        row.amount = calcRowAmount(
          field === "quantity" ? value : row.quantity,
          field === "price" ? value : row.price,
        );
      }
      next[idx] = row;
      recalcTotal(next);
      return next;
    });
  }, [recalcTotal]);

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

  // ── Selection ──

  const selectedCount = useMemo(() => rows.filter(r => r.selected).length, [rows]);
  const isAllSelected = rows.length > 0 && selectedCount === rows.length;
  const isIndeterminate = selectedCount > 0 && !isAllSelected;

  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = isIndeterminate;
  }, [isIndeterminate]);

  const toggleAll = useCallback(() => {
    const v = !isAllSelected;
    setRows(prev => prev.map(r => ({ ...r, selected: v })));
  }, [isAllSelected]);

  const toggleRow = useCallback((idx: number) => {
    setRows(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], selected: !next[idx].selected };
      return next;
    });
  }, []);

  // ── Save / Delete ──

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
        saved = (await apiClient.put("/saleitems/" + row.uuid, payload)).data?.item;
      }
      if (saved) {
        setRows(prev => {
          const next = [...prev];
          next[idx] = {
            id: saved.id, uuid: saved.uuid,
            lineNumber: saved.lineNumber ?? idx + 1,
            productUuid: saved.productUuid ?? "",
            productName: saved.product?.shortName ?? row.productName,
            quantity: saved.quantity != null ? String(Number(saved.quantity)) : "",
            price: saved.price != null ? String(Number(saved.price)) : "",
            amount: saved.amount != null ? String(Number(saved.amount)) : "",
            isNew: false, isDirty: false, selected: row.selected,
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

  const saveAllDirty = useCallback(async () => {
    const dirtyIdxs = rows.map((r, i) => r.isDirty ? i : -1).filter(i => i >= 0);
    for (const idx of dirtyIdxs) await saveRow(idx);
  }, [rows, saveRow]);

  const addRow = useCallback(() => {
    setRows(prev => {
      const next = [...prev, EMPTY_ROW(prev.length + 1)];
      setActiveRowIdx(next.length - 1);
      return next;
    });
  }, []);

  const deleteSelected = useCallback(async () => {
    const toDelete = rows.filter(r => r.selected);
    if (toDelete.length === 0) return;
    for (const row of toDelete) {
      if (row.uuid && !row.isNew) {
        try { await apiClient.delete("/saleitems/" + row.uuid); }
        catch (err: any) { setError(err.response?.data?.message || "Ошибка удаления"); return; }
      }
    }
    setRows(prev => { const next = prev.filter(r => !r.selected); recalcTotal(next); return next; });
  }, [rows, recalcTotal]);

  const deleteRow = useCallback(async (idx: number) => {
    const row = rows[idx];
    if (!row) return;
    if (row.isNew) {
      setRows(prev => { const next = prev.filter((_, i) => i !== idx); recalcTotal(next); return next; });
      return;
    }
    if (row.uuid) {
      try {
        await apiClient.delete("/saleitems/" + row.uuid);
        setRows(prev => { const next = prev.filter((_, i) => i !== idx); recalcTotal(next); return next; });
      } catch (err: any) { setError(err.response?.data?.message || "Ошибка удаления строки"); }
    }
  }, [rows, recalcTotal]);

  // ── Computed ──

  const totalAmount = useMemo(() => rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0), [rows]);
  const hasDirty = useMemo(() => rows.some(r => r.isDirty), [rows]);

  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);

  // Локальная фильтрация строк по поисковому запросу
  const filteredRows = useMemo(() => {
    if (!searchValue.trim()) return rows;
    const q = searchValue.toLowerCase();
    return rows.filter(r =>
      r.productName.toLowerCase().includes(q) ||
      r.quantity.toLowerCase().includes(q) ||
      r.price.toLowerCase().includes(q) ||
      r.amount.toLowerCase().includes(q) ||
      String(r.lineNumber).includes(q)
    );
  }, [rows, searchValue]);

  // Индекс-маппинг: filteredRows[i] → оригинальный rows index
  const filteredIndexMap = useMemo(() => {
    if (!searchValue.trim()) return rows.map((_, i) => i);
    const q = searchValue.toLowerCase();
    return rows.reduce<number[]>((acc, r, i) => {
      if (
        r.productName.toLowerCase().includes(q) ||
        r.quantity.toLowerCase().includes(q) ||
        r.price.toLowerCase().includes(q) ||
        r.amount.toLowerCase().includes(q) ||
        String(r.lineNumber).includes(q)
      ) acc.push(i);
      return acc;
    }, []);
  }, [rows, searchValue]);

  // ── Column config handlers ──

  const handleConfigOpen = useCallback(() => setConfigModalAction("open"), []);
  const handleSearchToggle = useCallback(() => setVisibleFastSearch(v => !v), []);

  // ── Column Resize ──

  const resizingRef = useRef<{ colIndex: number; startX: number; startWidth: number } | null>(null);
  const isResizingRef = useRef(false);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    const th = (e.target as HTMLElement).closest("th");
    if (!th) return;
    const startWidth = th.getBoundingClientRect().width;

    resizingRef.current = { colIndex, startX: e.clientX, startWidth };
    isResizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const col = visibleColumns[resizingRef.current.colIndex];
      const minW = parseInt(col.minWidth ?? "50", 10);
      const newWidth = Math.max(minW, resizingRef.current.startWidth + delta);
      // Обновляем DOM напрямую для плавности
      th.style.width = newWidth + "px";
      const table = th.closest("table");
      if (table) {
        const colEl = table.querySelector("colgroup")?.children[resizingRef.current.colIndex] as HTMLElement;
        if (colEl) colEl.style.width = newWidth + "px";
      }
    };

    const onMouseUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const col = visibleColumns[resizingRef.current.colIndex];
      const minW = parseInt(col.minWidth ?? "50", 10);
      const newWidth = Math.max(minW, resizingRef.current.startWidth + delta);
      // Коммитим в стейт
      const updated = columns.map(c =>
        c.key === col.key ? { ...c, width: newWidth + "px" } : c
      );
      setColumns(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      resizingRef.current = null;
      setTimeout(() => { isResizingRef.current = false; }, 0);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [visibleColumns, columns, setColumns]);

  // ────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────

  const colSpan = visibleColumns.length;

  return (
    <div className={styles.TableWrapper}>
      {/* ═══ Config Modal ═══ */}
      {configModalAction === "open" && (
        <SaleItemsConfigModal
          method={{ get: configModalAction, set: setConfigModalAction }}
          columns={columns}
          setColumns={setColumns}
        />
      )}

      {/* ═══ Panel ═══ */}
      <div className={styles.TablePanel}>
        <div className={styles.TablePanelLeft}>
          <div className={[styles.colGroup, styles.gap6].join(" ")} style={{ justifyContent: "flex-start" }}>
            <Button onClick={addRow} disabled={disabled || isLoading}><span>Добавить</span></Button>
            <Button onClick={deleteSelected} disabled={disabled || isLoading || selectedCount === 0}><span>Удалить</span></Button>
            <Divider />
            {hasDirty && (<>
              <Button variant="primary" onClick={saveAllDirty} disabled={isLoading}><span>Сохранить всё</span></Button>
              <Divider />
            </>)}
            <ButtonImage onClick={loadItems} title="Обновить" disabled={isLoading}>
              <img src={reloadImage_16} alt="Reload" height={16} width={16} className={isLoading ? styles.animationLoop : ""} />
            </ButtonImage>
            <ButtonImage onClick={handleConfigOpen} title="Настройки колонок">
              <img src={settingsForm_16} alt="Settings" height={16} width={16} />
            </ButtonImage>
            <Divider />
            <ButtonImage onClick={handleSearchToggle} active={visibleFastSearch} title="Поиск">
              <img src={searchField_16} alt="Search" height={16} width={16} />
            </ButtonImage>
            <Divider />
          </div>
        </div>
        {visibleFastSearch && (
          <div className={styles.TablePanelRight}>
            <FieldFastSearch value={searchValue} onChange={setSearchValue} />
          </div>
        )}
      </div>

      {/* ═══ Info bar ═══ */}
      <div style={{ fontSize: 13, color: "#555", padding: "0 6px", whiteSpace: "nowrap" }}>
        Строк: <strong>{rows.length}</strong>{" | "}Итого: <strong>{totalAmount.toFixed(2)}</strong>
      </div>

      {error && (
        <div style={{ color: "red", padding: "4px 12px", background: "#ffebee", borderRadius: 4, fontSize: 13 }}>{error}</div>
      )}

      {/* ═══ Scroll area ═══ */}
      <div className={styles.TableScrollContainer}>
        <div className={styles.TableScrollWrapper}>
          <table>
            <colgroup>
              {visibleColumns.map((col, i) => {
                const isLast = i === visibleColumns.length - 1;
                return (
                  <col
                    key={col.key}
                    style={{
                      width: isLast ? "auto" : (col.width ?? "auto"),
                      minWidth: col.minWidth ?? "auto",
                      ...(col.width && !isLast ? { maxWidth: col.width } : {}),
                    }}
                  />
                );
              })}
            </colgroup>

            {/* ── Header ── */}
            <thead>
              <tr>
                {visibleColumns.map((col, colIdx) => {
                  const isLast = colIdx === visibleColumns.length - 1;
                  if (col.key === "checkbox") {
                    return (
                      <th key={col.key} style={{ width: 30, textAlign: "center" }}>
                        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
                          <input ref={headerCheckboxRef} type="checkbox" checked={isAllSelected} onChange={toggleAll} disabled={isLoading || rows.length === 0} />
                        </div>
                      </th>
                    );
                  }
                  return (
                    <th key={col.key}>
                      <div className={styles.TableHeaderCell} style={{ justifyContent: col.textAlign === "right" ? "flex-end" : col.textAlign === "center" ? "center" : "flex-start" }}>
                        <span>{col.label}</span>
                      </div>
                      {!isLast && (
                        <div
                          className={styles.ResizeHandle}
                          onMouseDown={e => handleResizeMouseDown(e, colIdx)}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>

            {/* ── Body ── */}
            <tbody>
              {filteredRows.length === 0 && !isLoading && (
                <tr><td colSpan={colSpan}>
                  <div className={styles.TableBodyCell} style={{ justifyContent: "center", color: "#999", padding: "16px 0" }}>
                    <span>{searchValue ? "Ничего не найдено" : "Нет строк. Нажмите «Добавить»"}</span>
                  </div>
                </td></tr>
              )}
              {isLoading && rows.length === 0 && (
                <tr><td colSpan={colSpan}>
                  <div className={styles.TableBodyCell} style={{ justifyContent: "center", color: "#999", padding: "16px 0" }}>
                    <span>Загрузка...</span>
                  </div>
                </td></tr>
              )}
              {filteredRows.map((row, fi) => {
                const idx = filteredIndexMap[fi];
                const isSaving = savingRows.has(idx);
                const isActive = activeRowIdx === idx;
                return (
                  <tr
                    key={row.uuid || "new-" + idx}
                    className={isActive ? styles.activeRow : undefined}
                    onClick={() => setActiveRowIdx(idx)}
                    style={{ opacity: isLoading ? 0.4 : 1, background: row.isDirty ? "#fffde7" : undefined }}
                  >
                    {visibleColumns.map(col => {
                      switch (col.key) {
                        case "checkbox":
                          return (
                            <td key={col.key} style={{ textAlign: "center" }}>
                              <div className={styles.TableBodyCell} style={{ justifyContent: "center" }}>
                                <input type="checkbox" checked={!!row.selected} onChange={() => toggleRow(idx)} onClick={e => e.stopPropagation()} disabled={isLoading} />
                              </div>
                            </td>
                          );
                        case "lineNumber":
                          return (
                            <td key={col.key}>
                              <div className={styles.TableBodyCell} style={{ justifyContent: "center" }}>
                                <span style={{ color: "#999" }}>{idx + 1}</span>
                              </div>
                            </td>
                          );
                        case "product":
                          return (
                            <td key={col.key}>
                              <div className={styles.TableBodyCell}>
                                <LookupField
                                  label=""
                                  name={"saleitem_product_" + idx}
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
                                  width="100%"
                                  variant="table"
                                />
                              </div>
                            </td>
                          );
                        case "quantity":
                          return (
                            <td key={col.key}>
                              <div className={styles.TableBodyCell}>
                                <FieldNumber
                                  name={"saleitem_qty_" + idx}
                                  value={row.quantity}
                                  onChange={e => updateRow(idx, "quantity", e.target.value)}
                                  disabled={disabled || isSaving}
                                  step="0.0001"
                                  textAlign="right"
                                  width="100%"
                                  actions={[]}
                                  variant="table"
                                />
                              </div>
                            </td>
                          );
                        case "price":
                          return (
                            <td key={col.key}>
                              <div className={styles.TableBodyCell}>
                                <FieldNumber
                                  name={"saleitem_price_" + idx}
                                  value={row.price}
                                  onChange={e => updateRow(idx, "price", e.target.value)}
                                  disabled={disabled || isSaving}
                                  step="0.01"
                                  textAlign="right"
                                  width="100%"
                                  actions={[]}
                                  variant="table"
                                />
                              </div>
                            </td>
                          );
                        case "amount":
                          return (
                            <td key={col.key}>
                              <div className={styles.TableBodyCell} style={{ justifyContent: "flex-end" }}>
                                <span style={{ fontWeight: 500 }}>{row.amount ? parseFloat(row.amount).toFixed(2) : "0.00"}</span>
                              </div>
                            </td>
                          );
                        case "actions":
                          return (
                            <td key={col.key}>
                              <div className={styles.TableBodyCell} style={{ justifyContent: "center", gap: 2 }}>
                                {row.isDirty && (
                                  <button
                                    onClick={e => { e.stopPropagation(); saveRow(idx); }}
                                    disabled={isSaving}
                                    title="Сохранить строку"
                                    style={{ padding: "1px 6px", fontSize: 11, cursor: "pointer", border: "1px solid #4caf50", borderRadius: 3, background: "#e8f5e9", color: "#2e7d32", lineHeight: "16px" }}
                                  >
                                    {isSaving ? "..." : "✓"}
                                  </button>
                                )}
                                <button
                                  onClick={e => { e.stopPropagation(); deleteRow(idx); }}
                                  disabled={disabled || isSaving}
                                  title="Удалить строку"
                                  style={{ padding: "1px 6px", fontSize: 11, cursor: "pointer", border: "1px solid #ef5350", borderRadius: 3, background: "#ffebee", color: "#c62828", lineHeight: "16px" }}
                                >
                                  ✕
                                </button>
                              </div>
                            </td>
                          );
                        default:
                          return null;
                      }
                    })}
                  </tr>
                );
              })}
            </tbody>

            {/* ── Footer ── */}
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  {visibleColumns.map(col => {
                    if (col.key === "amount") {
                      return <td key={col.key}><div className={styles.TableFooterCell}><span style={{ fontWeight: 600 }}>{totalAmount.toFixed(2)}</span></div></td>;
                    }
                    if (col.key === "price") {
                      return <td key={col.key}><div className={styles.TableFooterCell}><span>Итого:</span></div></td>;
                    }
                    return <td key={col.key} />;
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {isLoading && (
          <div className={styles.TableLoadingOverlay}>
            <div className={styles.TableSpinner} />
          </div>
        )}
      </div>
    </div>
  );
};

SaleItemsTable.displayName = "SaleItemsTable";

// ────────────────────────────────────────────────
// FieldFastSearch — быстрый поиск (локальный, с debounce)
// ────────────────────────────────────────────────

const FieldFastSearch = memo(({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const [inputValue, setInputValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setInputValue(value); }, [value]);

  const handleChange = useCallback((v: string) => {
    setInputValue(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { onChange(v); timerRef.current = null; }, 300);
  }, [onChange]);

  const handleClear = useCallback(() => {
    setInputValue("");
    if (timerRef.current) clearTimeout(timerRef.current);
    onChange("");
  }, [onChange]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div className={styles.FilterGroup}>
      <div className={styles.SearchContainer}>
        <input
          type="text"
          value={inputValue}
          onChange={e => handleChange(e.target.value)}
          placeholder="Быстрый поиск..."
          className={styles.SearchInput}
        />
        <button onClick={handleClear} className={styles.ClearButton}>✕</button>
      </div>
    </div>
  );
});
FieldFastSearch.displayName = "FieldFastSearch";

// ────────────────────────────────────────────────
// SaleItemsConfigModal — модальное окно настроек колонок
// ────────────────────────────────────────────────

interface SaleItemsConfigModalProps {
  method: TypeFormMethod;
  columns: SaleItemColumn[];
  setColumns: Dispatch<SetStateAction<SaleItemColumn[]>>;
}

const SaleItemsConfigModal: FC<SaleItemsConfigModalProps> = ({ method, columns, setColumns }) => {
  const [draft, setDraft] = useState<SaleItemColumn[]>(columns);

  useEffect(() => { setDraft(columns); }, [columns]);

  const onApply = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    setColumns(draft);
  }, [draft, setColumns]);

  return (
    <Modal title="Колонки таблицы" method={method} onApply={onApply} style={{ width: "400px" }}>
      <SaleItemsConfigColumns columns={draft} setColumns={setDraft} />
    </Modal>
  );
};

// ────────────────────────────────────────────────
// SaleItemsConfigColumns — DnD-список колонок
// ────────────────────────────────────────────────

const SaleItemsConfigColumns: FC<{ columns: SaleItemColumn[]; setColumns: Dispatch<SetStateAction<SaleItemColumn[]>> }> = ({ columns, setColumns }) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const toggleVisibility = useCallback((key: string, visible: boolean) => {
    setColumns(prev => prev.map(c => c.key === key ? { ...c, visible } : c));
  }, [setColumns]);

  const onDragEnd = useCallback((event: any) => {
    const { active, over } = event;
    setDraggingId(null);
    if (active.id !== over?.id) {
      setColumns(prev => {
        const oldIdx = prev.findIndex(c => c.key === active.id);
        const newIdx = prev.findIndex(c => c.key === over?.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  }, [setColumns]);

  const dndItems = useMemo(() => columns.filter(c => c.inlist).map(c => c.key), [columns]);

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd} onDragStart={(e) => setDraggingId(String(e.active.id))}>
      <SortableContext items={dndItems} strategy={verticalListSortingStrategy}>
        <ul className={styles.CheckboxList}>
          {columns.filter(c => c.inlist).map(col => (
            <SaleItemsConfigItem
              key={col.key}
              column={col}
              isDragging={col.key === draggingId}
              toggleVisibility={toggleVisibility}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
};

// ────────────────────────────────────────────────
// SaleItemsConfigItem — одна колонка в DnD-списке
// ────────────────────────────────────────────────

const SaleItemsConfigItem: FC<{
  column: SaleItemColumn;
  isDragging: boolean;
  toggleVisibility: (key: string, visible: boolean) => void;
}> = memo(({ column, isDragging, toggleVisibility }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: column.key });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${styles.ListItem} ${isDragging ? styles.dragging : ""}`}
    >
      <div {...listeners} {...attributes} className={styles.DragAndDrop} title="Переместить">
        <PiDotsThreeVerticalDuotone size={17} strokeWidth={5} />
      </div>
      <div className={styles.CheckboxWrapper}>
        <input
          type="checkbox"
          id={`sicol-${column.key}`}
          checked={column.visible}
          onChange={e => toggleVisibility(column.key, e.target.checked)}
        />
        <label htmlFor={`sicol-${column.key}`}>{column.label}</label>
      </div>
    </li>
  );
});
SaleItemsConfigItem.displayName = "SaleItemsConfigItem";

export default SaleItemsTable;