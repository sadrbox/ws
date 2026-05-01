import {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppContext } from "src/app";
import apiClient from "src/services/api/client";
import type { TPane } from "src/app/types";
import type { TDataItem } from "src/components/Table/types";
import { Button } from "src/components/Button";
import { Field, FieldDate, FieldSelect, FieldNumber } from "src/components/Field";
import { Divider } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import Toolbar from "src/components/Toolbar";
import { setPaneDirty } from "src/hooks/useFormStore";
import useUID from "src/hooks/useUID";
import styles from "src/styles/main.module.scss";

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════

interface SaleDoc {
  id?: number;
  uuid?: string;
  documentNumber: string;
  date: string;
  description: string;
  amount: string;
  status: string;
  posted: boolean;
  organizationUuid: string;
  organizationName: string;
  counterpartyUuid: string;
  counterpartyName: string;
}

const EMPTY_SALE: SaleDoc = {
  documentNumber: "",
  date: "",
  description: "",
  amount: "",
  status: "draft",
  posted: false,
  organizationUuid: "",
  organizationName: "",
  counterpartyUuid: "",
  counterpartyName: "",
};

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
}

interface ProductRow {
  id: number;
  uuid: string;
  shortName: string;
  sku: string;
  brandName: string;
}

const STATUS_OPTIONS = [
  { value: "draft", label: "Черновик" },
  { value: "approved", label: "Утверждён" },
  { value: "cancelled", label: "Отменён" },
];

const STATUS_LABEL: Record<string, string> = {
  draft: "Черновик",
  approved: "Утверждён",
  cancelled: "Отменён",
};

const calcRowAmount = (qty: string, prc: string): string => {
  const q = parseFloat(qty) || 0;
  const p = parseFloat(prc) || 0;
  return (Math.round(q * p * 100) / 100).toString();
};

// ════════════════════════════════════════════════════════════════════════
// SalesBoardForm — основная рабочая область продавца
// ════════════════════════════════════════════════════════════════════════

const SalesBoardForm: FC<Partial<TPane>> = ({ onClose, uniqId }) => {
  const {
    windows: { requestClose, registerBeforeClose },
    actions: { confirm },
  } = useAppContext();
  const formUid = useUID();

  // ── State: текущий документ продажи ──
  const [sale, setSale] = useState<SaleDoc>({ ...EMPTY_SALE });
  const [saleItems, setSaleItems] = useState<SaleItemRow[]>([]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [saleLoading, setSaleLoading] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [savingItems, setSavingItems] = useState<Set<number>>(new Set());

  // ── State: список документов продаж ──
  const [salesList, setSalesList] = useState<TDataItem[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesSearch, setSalesSearch] = useState("");
  const [selectedSaleUuid, setSelectedSaleUuid] = useState<string | null>(null);

  // ── State: каталог товаров ──
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsSearch, setProductsSearch] = useState("");

  // ── State: панели (можно сворачивать каталог) ──
  const [catalogVisible, setCatalogVisible] = useState(true);
  const cleanSaleSnapshotRef = useRef(JSON.stringify(EMPTY_SALE));
  const hasDirtyItems = useMemo(() => saleItems.some((r) => r.isDirty), [saleItems]);
  const isSaleDirty = JSON.stringify(sale) !== cleanSaleSnapshotRef.current;
  const isDirty = isSaleDirty || hasDirtyItems;

  // ════════════════════════════════════════════════════════════════════
  // API: загрузка списка продаж
  // ════════════════════════════════════════════════════════════════════

  const loadSalesList = useCallback(async () => {
    setSalesLoading(true);
    try {
      const params: Record<string, string> = {
        limit: "500",
        sort: JSON.stringify({ id: "desc" }),
      };
      if (salesSearch.trim()) params.search = salesSearch.trim();
      const res = await apiClient.get("/sales", { params });
      setSalesList(res.data?.items ?? []);
    } catch {
      /* silently */
    } finally {
      setSalesLoading(false);
    }
  }, [salesSearch]);

  useEffect(() => {
    loadSalesList();
  }, [loadSalesList]);

  // ════════════════════════════════════════════════════════════════════
  // API: загрузка каталога товаров
  // ════════════════════════════════════════════════════════════════════

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const params: Record<string, string> = {
        limit: "500",
        sort: JSON.stringify({ shortName: "asc" }),
      };
      if (productsSearch.trim()) params.search = productsSearch.trim();
      const res = await apiClient.get("/products", { params });
      const items = (res.data?.items ?? []).map((p: any) => ({
        id: p.id,
        uuid: p.uuid,
        shortName: p.shortName ?? "",
        sku: p.sku ?? "",
        brandName: p.brand?.shortName ?? "",
      }));
      setProducts(items);
    } catch {
      /* silently */
    } finally {
      setProductsLoading(false);
    }
  }, [productsSearch]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // ════════════════════════════════════════════════════════════════════
  // API: загрузка одного документа продажи + его строк
  // ════════════════════════════════════════════════════════════════════

  const loadSale = useCallback(
    async (uuid: string) => {
      setSaleLoading(true);
      setSaleError(null);
      try {
        const res = await apiClient.get(`/sales/${uuid}`);
        const d = res.data?.item ?? res.data;
        const nextSale = {
          id: d.id,
          uuid: d.uuid,
          documentNumber: d.documentNumber ?? "",
          date: d.date?.slice(0, 10) ?? "",
          description: d.description ?? "",
          amount: d.amount != null ? String(d.amount) : "",
          status: d.status ?? "draft",
          posted: d.posted === true,
          organizationUuid: d.organizationUuid ?? "",
          organizationName: d.organization?.shortName ?? "",
          counterpartyUuid: d.counterpartyUuid ?? "",
          counterpartyName: d.counterparty?.shortName ?? "",
        };
        setSale(nextSale);
        cleanSaleSnapshotRef.current = JSON.stringify(nextSale);
        setIsEditMode(true);
        // Загружаем строки
        const itemsRes = await apiClient.get(`/saleitems?saleUuid=${uuid}`);
        const items = (itemsRes.data?.items ?? []).map((r: any) => ({
          id: r.id,
          uuid: r.uuid,
          lineNumber: r.lineNumber ?? 0,
          productUuid: r.productUuid ?? "",
          productName: r.product?.shortName ?? "",
          quantity: r.quantity != null ? String(Number(r.quantity)) : "",
          price: r.price != null ? String(Number(r.price)) : "",
          amount: r.amount != null ? String(Number(r.amount)) : "",
          isNew: false,
          isDirty: false,
        }));
        setSaleItems(items);
      } catch (err: any) {
        setSaleError(err.response?.data?.message || "Ошибка загрузки документа");
      } finally {
        setSaleLoading(false);
      }
    },
    []
  );

  // ── Выбор документа из списка ──
  const handleSelectSale = useCallback(
    async (item: TDataItem) => {
      const uuid = item.uuid as string;
      if (uuid === selectedSaleUuid) return;
      const hasUnsaved = JSON.stringify(sale) !== cleanSaleSnapshotRef.current || hasDirtyItems;
      if (hasUnsaved) {
        const answer = await confirm(
          "Имеются несохранённые изменения.\nПерейти к другому документу без сохранения?",
        );
        if (!answer) return;
      }
      setSelectedSaleUuid(uuid);
      loadSale(uuid);
    },
    [selectedSaleUuid, loadSale, sale, hasDirtyItems, confirm]
  );

  // ════════════════════════════════════════════════════════════════════
  // Новый документ продажи
  // ════════════════════════════════════════════════════════════════════

  const handleNewSale = useCallback(async () => {
    const hasUnsaved = JSON.stringify(sale) !== cleanSaleSnapshotRef.current || hasDirtyItems;
    if (hasUnsaved) {
      const answer = await confirm(
        "Имеются несохранённые изменения.\nСоздать новый документ без сохранения текущего?",
      );
      if (!answer) return;
    }
    setSelectedSaleUuid(null);
    setSale({ ...EMPTY_SALE });
    cleanSaleSnapshotRef.current = JSON.stringify(EMPTY_SALE);
    setSaleItems([]);
    setIsEditMode(false);
    setSaleError(null);
  }, [sale, hasDirtyItems, confirm]);

  // ════════════════════════════════════════════════════════════════════
  // Сохранение документа
  // ════════════════════════════════════════════════════════════════════

  const saveSale = useCallback(async (): Promise<string | null> => {
    setSaleLoading(true);
    setSaleError(null);
    const payload: Record<string, unknown> = {
      documentNumber: sale.documentNumber?.trim() || null,
      date: sale.date || null,
      description: sale.description?.trim() || null,
      amount: sale.amount ? parseFloat(sale.amount) : null,
      status: sale.status || "draft",
      posted: sale.posted === true,
      organizationUuid: sale.organizationUuid || null,
      counterpartyUuid: sale.counterpartyUuid || null,
    };
    try {
      const res =
        isEditMode && sale.uuid
          ? await apiClient.put(`/sales/${sale.uuid}`, payload)
          : await apiClient.post("/sales", payload);
      const saved = res.data?.item ?? res.data;
      setSale((prev) => {
        const nextSale = {
          ...prev,
          id: saved.id,
          uuid: saved.uuid,
          documentNumber: saved.documentNumber ?? "",
          date: saved.date?.slice(0, 10) ?? "",
          description: saved.description ?? "",
          amount: saved.amount != null ? String(saved.amount) : "",
          status: saved.status ?? "draft",
          posted: saved.posted === true,
          organizationUuid: saved.organizationUuid ?? prev.organizationUuid,
          organizationName: saved.organization?.shortName ?? prev.organizationName,
          counterpartyUuid: saved.counterpartyUuid ?? prev.counterpartyUuid,
          counterpartyName: saved.counterparty?.shortName ?? prev.counterpartyName,
        };
        cleanSaleSnapshotRef.current = JSON.stringify(nextSale);
        return nextSale;
      });
      setIsEditMode(true);
      setSelectedSaleUuid(saved.uuid);
      loadSalesList();
      return saved.uuid;
    } catch (err: any) {
      setSaleError(err.response?.data?.message || "Ошибка сохранения");
      return null;
    } finally {
      setSaleLoading(false);
    }
  }, [sale, isEditMode, loadSalesList]);

  const handleSave = useCallback(() => {
    saveSale();
  }, [saveSale]);

  // ════════════════════════════════════════════════════════════════════
  // Строки документа: добавление / удаление / редактирование
  // ════════════════════════════════════════════════════════════════════

  const recalcTotal = useCallback((items: SaleItemRow[]) => {
    const total = items.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    setSale((prev) => ({ ...prev, amount: String(Math.round(total * 100) / 100) }));
  }, []);

  const addItemRow = useCallback(() => {
    setSaleItems((prev) => {
      const next = [
        ...prev,
        {
          lineNumber: prev.length + 1,
          productUuid: "",
          productName: "",
          quantity: "1",
          price: "",
          amount: "",
          isNew: true,
          isDirty: true,
        },
      ];
      return next;
    });
  }, []);

  const updateItemRow = useCallback(
    (idx: number, field: keyof SaleItemRow, value: string) => {
      setSaleItems((prev) => {
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
    },
    [recalcTotal]
  );

  const handleItemProductSelect = useCallback(
    (idx: number, uuid: string, name: string) => {
      setSaleItems((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], productUuid: uuid, productName: name, isDirty: true };
        return next;
      });
    },
    []
  );

  const handleItemProductClear = useCallback((idx: number) => {
    setSaleItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], productUuid: "", productName: "", isDirty: true };
      return next;
    });
  }, []);

  const saveItemRow = useCallback(
    async (idx: number) => {
      const row = saleItems[idx];
      if (!row || !sale.uuid) return;
      setSavingItems((prev) => new Set(prev).add(idx));
      try {
        const payload = {
          saleUuid: sale.uuid,
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
          setSaleItems((prev) => {
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
        setSaleError(err.response?.data?.message || "Ошибка сохранения строки");
      } finally {
        setSavingItems((prev) => {
          const s = new Set(prev);
          s.delete(idx);
          return s;
        });
      }
    },
    [saleItems, sale.uuid, recalcTotal]
  );

  const saveAllDirtyItems = useCallback(async () => {
    const dirtyIdxs = saleItems
      .map((r, i) => (r.isDirty ? i : -1))
      .filter((i) => i >= 0);
    for (const idx of dirtyIdxs) await saveItemRow(idx);
  }, [saleItems, saveItemRow]);

  const deleteItemRow = useCallback(
    async (idx: number) => {
      const row = saleItems[idx];
      if (!row) return;
      if (row.isNew) {
        setSaleItems((prev) => {
          const next = prev.filter((_, i) => i !== idx);
          recalcTotal(next);
          return next;
        });
        return;
      }
      if (row.uuid) {
        try {
          await apiClient.delete("/saleitems/" + row.uuid);
          setSaleItems((prev) => {
            const next = prev.filter((_, i) => i !== idx);
            recalcTotal(next);
            return next;
          });
        } catch (err: any) {
          setSaleError(err.response?.data?.message || "Ошибка удаления строки");
        }
      }
    },
    [saleItems, recalcTotal]
  );

  // ════════════════════════════════════════════════════════════════════
  // Быстрое добавление товара из каталога в текущий документ
  // ════════════════════════════════════════════════════════════════════

  const addProductToSale = useCallback(
    async (product: ProductRow) => {
      // Если документ ещё не сохранён — сначала сохраняем
      let saleUuid = sale.uuid;
      if (!saleUuid) {
        saleUuid = await saveSale() ?? undefined;
        if (!saleUuid) return; // ошибка сохранения
      }
      // Проверяем, есть ли уже этот товар в строках
      const existingIdx = saleItems.findIndex(
        (r) => r.productUuid === product.uuid
      );
      if (existingIdx >= 0) {
        // Увеличиваем количество на 1
        const row = saleItems[existingIdx];
        const newQty = String((parseFloat(row.quantity) || 0) + 1);
        updateItemRow(existingIdx, "quantity", newQty);
        return;
      }
      // Добавляем новую строку
      setSaleItems((prev) => {
        const newRow: SaleItemRow = {
          lineNumber: prev.length + 1,
          productUuid: product.uuid,
          productName: product.shortName,
          quantity: "1",
          price: "",
          amount: "",
          isNew: true,
          isDirty: true,
        };
        return [...prev, newRow];
      });
    },
    [sale.uuid, saleItems, saveSale, updateItemRow]
  );

  // ── Computed ──
  const totalAmount = useMemo(
    () => saleItems.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0),
    [saleItems]
  );

  const handleFieldChange = useCallback(
    (field: keyof SaleDoc, value: string) => {
      setSale((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  useEffect(() => {
    if (!uniqId) return;
    setPaneDirty(uniqId, isDirty);
  }, [uniqId, isDirty]);

  useEffect(() => {
    if (!uniqId) return undefined;
    return registerBeforeClose(uniqId, async () => {
      if (!isDirty) {
        setPaneDirty(uniqId, false);
        onClose?.();
        return true;
      }
      const answer = await confirm(
        "Имеются несохранённые изменения.\nЗакрыть без сохранения?",
      );
      if (!answer) return false;
      setPaneDirty(uniqId, false);
      onClose?.();
      return true;
    });
  }, [uniqId, isDirty, confirm, onClose, registerBeforeClose]);

  useEffect(() => {
    if (!uniqId) return undefined;
    return () => setPaneDirty(uniqId, false);
  }, [uniqId]);

  const handleClose = useCallback(async () => {
    if (uniqId) {
      await requestClose(uniqId);
      return;
    }
    if (isDirty) {
      const answer = await confirm(
        "Имеются несохранённые изменения.\nЗакрыть без сохранения?",
      );
      if (!answer) return;
    }
    onClose?.();
  }, [onClose, requestClose, uniqId, isDirty, confirm]);

  // ════════════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════════════

  return (
    <div className={styles.FormWrapper} style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* ═══ Панель кнопок ═══ */}
      <Toolbar>
        <Button variant="primary" onClick={handleNewSale} disabled={saleLoading}>
          <span>Новый документ</span>
        </Button>
        <Toolbar.Divider />
        <Button onClick={handleSave} disabled={saleLoading}>
          <span>Сохранить</span>
        </Button>
        <Button onClick={handleClose} disabled={saleLoading}>
          <span>Закрыть</span>
        </Button>
        <Toolbar.Divider />
        {isEditMode && sale.uuid && (
          <Toolbar.ReloadButton onClick={() => sale.uuid && loadSale(sale.uuid)} disabled={saleLoading} />
        )}
        <Toolbar.IconButton
          onClick={() => setCatalogVisible((v) => !v)}
          title={catalogVisible ? "Скрыть каталог товаров" : "Показать каталог товаров"}
          active={catalogVisible}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>☰</span>
        </Toolbar.IconButton>
      </Toolbar>

      {saleError && (
        <div
          style={{
            color: "red",
            padding: "4px 12px",
            background: "#ffebee",
            borderRadius: 4,
            fontSize: 13,
          }}
        >
          {saleError}
        </div>
      )}

      {/* ═══ Основная область: три секции ═══ */}
      <div
        style={{
          display: "flex",
          flex: 1,
          overflow: "hidden",
          gap: 0,
        }}
      >
        {/* ──────────────────────────────────────────────
            ЛЕВАЯ ПАНЕЛЬ: список документов продаж
        ────────────────────────────────────────────── */}
        <div
          style={{
            width: 320,
            minWidth: 240,
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid #e0e0e0",
            background: "#fafafa",
          }}
        >
          {/* Поиск */}
          <div style={{ padding: "6px 6px 4px 6px" }}>
            <input
              type="text"
              value={salesSearch}
              onChange={(e) => setSalesSearch(e.target.value)}
              placeholder="Поиск документов..."
              style={{
                width: "100%",
                padding: "5px 8px",
                fontSize: 13,
                border: "1px solid #ccc",
                borderRadius: 3,
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Список */}
          <div style={{ flex: 1, overflowY: "auto", fontSize: 13 }}>
            {salesLoading && salesList.length === 0 && (
              <div style={{ padding: 12, color: "#999", textAlign: "center" }}>Загрузка...</div>
            )}
            {!salesLoading && salesList.length === 0 && (
              <div style={{ padding: 12, color: "#999", textAlign: "center" }}>Нет документов</div>
            )}
            {salesList.map((s) => {
              const uuid = s.uuid as string;
              const isActive = uuid === selectedSaleUuid;
              return (
                <div
                  key={uuid}
                  onClick={() => handleSelectSale(s)}
                  style={{
                    padding: "7px 10px",
                    cursor: "pointer",
                    background: isActive ? "#e3f2fd" : "transparent",
                    borderBottom: "1px solid #eee",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "#f5f5f5";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "transparent";
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 500 }}>
                      №{String(s.documentNumber || "—")}{" "}
                      <span style={{ color: "#999", fontWeight: 400 }}>
                        ({STATUS_LABEL[String(s.status ?? "")] ?? String(s.status ?? "")})
                      </span>
                      {Boolean(s.posted) && <span style={{ color: "#2e7d32", marginLeft: 4 }} title="Проведён">✔</span>}
                    </span>
                    <span style={{ fontWeight: 600, color: "#1565c0" }}>
                      {s.amount != null ? Number(s.amount).toFixed(2) : "0.00"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, color: "#777", fontSize: 12 }}>
                    <span>
                      {s.date
                        ? new Date(s.date as string).toLocaleDateString("ru-RU")
                        : "—"}
                    </span>
                    <span>{(s as any).counterparty?.shortName || (s as any)["counterparty.shortName"] || ""}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Итого */}
          <div
            style={{
              padding: "6px 10px",
              borderTop: "1px solid #e0e0e0",
              fontSize: 12,
              color: "#555",
              background: "#f5f5f5",
            }}
          >
            Документов: <strong>{salesList.length}</strong>
          </div>
        </div>

        {/* ──────────────────────────────────────────────
            ЦЕНТРАЛЬНАЯ ПАНЕЛЬ: шапка документа + товары
        ────────────────────────────────────────────── */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          {/* Шапка документа */}
          <div
            style={{
              padding: "8px 12px",
              borderBottom: "1px solid #e0e0e0",
              background: "#fff",
              display: "flex",
              flexWrap: "wrap",
              gap: "8px 16px",
              alignItems: "flex-end",
            }}
          >
            <Field
              label="Номер"
              name={`${formUid}_docNum`}
              value={sale.documentNumber}
              onChange={(e) => handleFieldChange("documentNumber", e.target.value)}
              disabled={saleLoading}
              width="120px"
            />
            <FieldDate
              label="Дата"
              name={`${formUid}_docDate`}
              value={sale.date}
              onChange={(e) => handleFieldChange("date", e.target.value)}
              disabled={saleLoading}
              width="180px"
            />
            <FieldSelect
              label="Статус"
              name={`${formUid}_status`}
              value={sale.status}
              options={STATUS_OPTIONS}
              onChange={(e) => handleFieldChange("status", e.target.value)}
              disabled={saleLoading}
            />
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, paddingBottom: 2 }}>
              <input
                type="checkbox"
                id={`${formUid}_posted`}
                checked={sale.posted}
                onChange={(e) => setSale((prev) => ({ ...prev, posted: e.target.checked }))}
                disabled={saleLoading}
              />
              <label htmlFor={`${formUid}_posted`} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>Проведён</label>
            </div>
            <LookupField
              label="Организация"
              name={`${formUid}_org`}
              value={sale.organizationUuid}
              displayValue={sale.organizationName}
              endpoint="organizations"
              displayField="shortName"
              onSelect={(u, d) =>
                setSale((prev) => ({ ...prev, organizationUuid: u, organizationName: d }))
              }
              onClear={() =>
                setSale((prev) => ({ ...prev, organizationUuid: "", organizationName: "" }))
              }
              disabled={saleLoading}
              width="200px"
            />
            <LookupField
              label="Контрагент"
              name={`${formUid}_cpty`}
              value={sale.counterpartyUuid}
              displayValue={sale.counterpartyName}
              endpoint="counterparties"
              displayField="shortName"
              onSelect={(u, d) =>
                setSale((prev) => ({ ...prev, counterpartyUuid: u, counterpartyName: d }))
              }
              onClear={() =>
                setSale((prev) => ({ ...prev, counterpartyUuid: "", counterpartyName: "" }))
              }
              disabled={saleLoading}
              width="200px"
            />
            <Field
              label="Описание"
              name={`${formUid}_desc`}
              value={sale.description}
              onChange={(e) => handleFieldChange("description", e.target.value)}
              disabled={saleLoading}
              width="200px"
            />
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 4,
                paddingBottom: 2,
                fontWeight: 600,
                fontSize: 15,
                color: "#1565c0",
                whiteSpace: "nowrap",
              }}
            >
              Итого: {totalAmount.toFixed(2)}
            </div>
          </div>

          {/* Панель действий над строками */}
          <div
            style={{
              padding: "4px 8px",
              borderBottom: "1px solid #eee",
              display: "flex",
              gap: 6,
              alignItems: "center",
              background: "#fafafa",
            }}
          >
            <Button onClick={addItemRow} disabled={saleLoading || (!isEditMode && !sale.uuid)}>
              <span>Добавить строку</span>
            </Button>
            {hasDirtyItems && (
              <>
                <Divider />
                <Button variant="primary" onClick={saveAllDirtyItems} disabled={saleLoading}>
                  <span>Сохранить строки</span>
                </Button>
              </>
            )}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 13, color: "#555" }}>
              Строк: <strong>{saleItems.length}</strong>
            </span>
          </div>

          {/* Таблица товаров документа */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "40px" }} />
                <col style={{ minWidth: "200px" }} />
                <col style={{ width: "100px" }} />
                <col style={{ width: "100px" }} />
                <col style={{ width: "110px" }} />
                <col style={{ width: "60px" }} />
              </colgroup>
              <thead>
                <tr
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f5f5f5",
                    borderBottom: "2px solid #ddd",
                    zIndex: 1,
                  }}
                >
                  <th style={{ padding: "6px 4px", fontSize: 12, textAlign: "center", color: "#777" }}>N</th>
                  <th style={{ padding: "6px 4px", fontSize: 12, textAlign: "left", color: "#777" }}>Номенклатура</th>
                  <th style={{ padding: "6px 4px", fontSize: 12, textAlign: "right", color: "#777" }}>Кол-во</th>
                  <th style={{ padding: "6px 4px", fontSize: 12, textAlign: "right", color: "#777" }}>Цена</th>
                  <th style={{ padding: "6px 4px", fontSize: 12, textAlign: "right", color: "#777" }}>Сумма</th>
                  <th style={{ padding: "6px 4px", fontSize: 12, textAlign: "center", color: "#777" }}></th>
                </tr>
              </thead>
              <tbody>
                {saleItems.length === 0 && !saleLoading && (
                  <tr>
                    <td colSpan={6} style={{ padding: "20px 0", textAlign: "center", color: "#999", fontSize: 13 }}>
                      {isEditMode
                        ? "Нет строк. Добавьте товар из каталога или нажмите «Добавить строку»"
                        : "Создайте или выберите документ"}
                    </td>
                  </tr>
                )}
                {saleItems.map((row, idx) => {
                  const isSaving = savingItems.has(idx);
                  return (
                    <tr
                      key={row.uuid || "new-" + idx}
                      style={{
                        borderBottom: "1px solid #eee",
                        background: row.isDirty ? "#fffde7" : "#fff",
                        opacity: saleLoading ? 0.5 : 1,
                      }}
                    >
                      <td style={{ textAlign: "center", color: "#999", fontSize: 12, padding: "0 4px" }}>
                        {idx + 1}
                      </td>
                      <td style={{ padding: 0 }}>
                        <LookupField
                          name={`${formUid}_item_prod_${idx}`}
                          value={row.productUuid}
                          displayValue={row.productName}
                          endpoint="products"
                          displayField="shortName"
                          columns={[
                            { key: "shortName", label: "Наименование" },
                            { key: "sku", label: "Артикул" },
                            { key: "brand.shortName", label: "Бренд" },
                          ]}
                          onSelect={(u, d) => handleItemProductSelect(idx, u, d)}
                          onClear={() => handleItemProductClear(idx)}
                          disabled={saleLoading || isSaving}
                          width="100%"
                          variant="table"
                        />
                      </td>
                      <td style={{ padding: 0 }}>
                        <FieldNumber
                          name={`${formUid}_item_qty_${idx}`}
                          value={row.quantity}
                          onChange={(e) => updateItemRow(idx, "quantity", e.target.value)}
                          disabled={saleLoading || isSaving}
                          step="0.1"
                          textAlign="right"
                          width="100%"
                          actions={[]}
                          variant="table"
                        />
                      </td>
                      <td style={{ padding: 0 }}>
                        <FieldNumber
                          name={`${formUid}_item_price_${idx}`}
                          value={row.price}
                          onChange={(e) => updateItemRow(idx, "price", e.target.value)}
                          disabled={saleLoading || isSaving}
                          step="0.1"
                          textAlign="right"
                          width="100%"
                          actions={[]}
                          variant="table"
                        />
                      </td>
                      <td style={{ textAlign: "right", padding: "4px 6px", fontWeight: 500, fontSize: 13 }}>
                        {row.amount ? parseFloat(row.amount).toFixed(2) : "0.00"}
                      </td>
                      <td style={{ textAlign: "center", padding: "2px" }}>
                        <div style={{ display: "flex", justifyContent: "center", gap: 2 }}>
                          {row.isDirty && (
                            <button
                              onClick={() => saveItemRow(idx)}
                              disabled={isSaving}
                              title="Сохранить строку"
                              style={{
                                padding: "1px 6px",
                                fontSize: 11,
                                cursor: "pointer",
                                border: "1px solid #4caf50",
                                borderRadius: 3,
                                background: "#e8f5e9",
                                color: "#2e7d32",
                                lineHeight: "16px",
                              }}
                            >
                              {isSaving ? "..." : "✓"}
                            </button>
                          )}
                          <button
                            onClick={() => deleteItemRow(idx)}
                            disabled={saleLoading || isSaving}
                            title="Удалить строку"
                            style={{
                              padding: "1px 6px",
                              fontSize: 11,
                              cursor: "pointer",
                              border: "1px solid #ef5350",
                              borderRadius: 3,
                              background: "#ffebee",
                              color: "#c62828",
                              lineHeight: "16px",
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {saleItems.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: "2px solid #ddd", background: "#f9f9f9" }}>
                    <td colSpan={4} style={{ textAlign: "right", padding: "6px 8px", fontWeight: 600, fontSize: 13 }}>
                      Итого:
                    </td>
                    <td style={{ textAlign: "right", padding: "6px 6px", fontWeight: 700, fontSize: 14, color: "#1565c0" }}>
                      {totalAmount.toFixed(2)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* ──────────────────────────────────────────────
            ПРАВАЯ ПАНЕЛЬ: каталог товаров
        ────────────────────────────────────────────── */}
        {catalogVisible && (
          <div
            style={{
              width: 300,
              minWidth: 220,
              display: "flex",
              flexDirection: "column",
              borderLeft: "1px solid #e0e0e0",
              background: "#fafafa",
            }}
          >
            {/* Заголовок + поиск */}
            <div style={{ padding: "6px 6px 4px 6px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 4,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 13, color: "#333" }}>Каталог товаров</span>
                <Toolbar.ReloadButton onClick={loadProducts} disabled={productsLoading} />
              </div>
              <input
                type="text"
                value={productsSearch}
                onChange={(e) => setProductsSearch(e.target.value)}
                placeholder="Поиск товаров..."
                style={{
                  width: "100%",
                  padding: "5px 8px",
                  fontSize: 13,
                  border: "1px solid #ccc",
                  borderRadius: 3,
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Список товаров */}
            <div style={{ flex: 1, overflowY: "auto", fontSize: 13 }}>
              {productsLoading && products.length === 0 && (
                <div style={{ padding: 12, color: "#999", textAlign: "center" }}>Загрузка...</div>
              )}
              {!productsLoading && products.length === 0 && (
                <div style={{ padding: 12, color: "#999", textAlign: "center" }}>Нет товаров</div>
              )}
              {products.map((p) => (
                <div
                  key={p.uuid}
                  style={{
                    padding: "6px 10px",
                    borderBottom: "1px solid #eee",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 6,
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = "#e8f5e9";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = "transparent";
                  }}
                  onClick={() => addProductToSale(p)}
                  title={`Добавить «${p.shortName}» в документ`}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.shortName}
                    </div>
                    {(p.sku || p.brandName) && (
                      <div style={{ fontSize: 11, color: "#888", marginTop: 1 }}>
                        {p.sku && <span>Арт: {p.sku}</span>}
                        {p.sku && p.brandName && <span> • </span>}
                        {p.brandName && <span>{p.brandName}</span>}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      color: "#4caf50",
                      fontWeight: 700,
                      fontSize: 16,
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                    title="Добавить в документ"
                  >
                    +
                  </div>
                </div>
              ))}
            </div>

            {/* Итого товаров */}
            <div
              style={{
                padding: "6px 10px",
                borderTop: "1px solid #e0e0e0",
                fontSize: 12,
                color: "#555",
                background: "#f5f5f5",
              }}
            >
              Товаров: <strong>{products.length}</strong>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

SalesBoardForm.displayName = "SalesBoardForm";
export { SalesBoardForm };
