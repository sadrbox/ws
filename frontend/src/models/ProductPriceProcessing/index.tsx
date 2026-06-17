import React, { FC, useEffect, useMemo, useRef, useState } from "react";
import { translate } from "src/i18";
import { FieldDate, FieldNumber, FieldSelect, FieldFile } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { HelpBox, helpMarker } from "src/components/HelpBox";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { Button } from "src/components/Button";
import Tabs from "src/components/Tabs";
import priceColumns from "../Products/priceColumns.json";
import { GroupRow } from "src/components/UI";
import mainStyles from "src/styles/main.module.scss";
import styles from "./ProductPriceProcessing.module.scss";
import apiClient from "src/services/api/client";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { useAppContext } from "src/app";
import { showToast } from "src/components/UIToast";
import type { TPane } from "src/app/types";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { getFormatDateOnly } from "src/utils/datetime";
import * as XLSX from "xlsx";

// Бэкенд-маршрут цен номенклатуры (см. backend/api/router/productprices.js).
const ENDPOINT = "product-prices";

const todayDateOnly = () => new Date().toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
const toNum = (v: unknown): number | null =>
  v == null || v === "" ? null : Number.isNaN(Number(v)) ? null : Number(v);

// Колонки для «Корректировки»: добавлены «Старая цена» и «Δ, %».
const colBy = (id: string) => (priceColumns as any[]).find((c) => c.identifier === id);
const correctionColumns = [
  colBy("product.name"),
  { identifier: "oldPrice", type: "number", width: "120px", minWidth: "90px", alignment: "right", visible: true, inlist: true, sortable: false },
  colBy("price"),
  { identifier: "priceDelta", type: "number", width: "90px", minWidth: "70px", alignment: "right", visible: true, inlist: true, sortable: false },
  colBy("date"),
  colBy("priceType.name"),
].filter(Boolean);

// ─── Общий рендер ячеек ────────────────────────────────────────────────────
const priceCellRenderer = (
  row: TDataItem,
  col: TColumn,
  ctx: SubTableContext,
): React.ReactNode | undefined => {
  const r: any = row;
  if (col.identifier === "product.name") {
    const isImportRow = "_matched" in r;
    const warn = isImportRow && !r.productUuid;
    if (ctx.inlineEditing)
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {warn && <span title={translate("notMatched")} style={{ color: "#c5221f" }}>⚠</span>}
          <LookupField
            label="" name={`ppp_product_${r.id}`} value={r.productUuid ?? ""}
            displayValue={String(r.product?.name ?? "")}
            endpoint="products" displayField="name" disabled={ctx.disabled} variant="table"
            onSelect={(u, display) => ctx.handleLookupChange(r, "productUuid", u, { product: { name: display }, _matched: !!u })}
            onClear={() => ctx.handleLookupChange(r, "productUuid", null, { product: null, _matched: false })}
          />
        </div>
      );
    return <span style={warn ? { color: "#c5221f" } : undefined}>{warn ? "⚠ " : ""}{String(r.product?.name ?? "")}</span>;
  }
  if (col.identifier === "oldPrice") {
    return <span style={{ color: "#888" }}>{r._origPrice != null ? String(r._origPrice) : ""}</span>;
  }
  if (col.identifier === "priceDelta") {
    const orig = toNum(r._origPrice);
    const cur = toNum(r.price);
    if (orig == null || orig === 0 || cur == null) return <span />;
    const d = ((cur - orig) / orig) * 100;
    if (!Number.isFinite(d)) return <span />;
    const color = d > 0 ? "#137333" : d < 0 ? "#c5221f" : "#666";
    return <span style={{ color, fontWeight: 600 }}>{d > 0 ? "+" : ""}{d.toFixed(1)}</span>;
  }
  if (col.identifier === "priceType.name") {
    if (ctx.inlineEditing)
      return (
        <LookupField
          label="" name={`ppp_priceType_${r.id}`} value={r.priceTypeUuid ?? ""}
          displayValue={String(r.priceType?.name ?? "")}
          endpoint="price-types" displayField="name" disabled={ctx.disabled} variant="table"
          onSelect={(u, display) => ctx.handleLookupChange(r, "priceTypeUuid", u, { priceType: { name: display } })}
          onClear={() => ctx.handleLookupChange(r, "priceTypeUuid", null, { priceType: null })}
        />
      );
    return <span>{String(r.priceType?.name ?? "")}</span>;
  }
  if (col.identifier === "date") {
    if (ctx.inlineEditing)
      return (
        <FieldDate
          label="" name={`ppp_date_${r.id}`} value={r.date ?? ""} variant="table" disabled={ctx.disabled}
          onChange={(e) => ctx.updateLocalRow(r, { date: e.target.value })}
        />
      );
    return <span>{getFormatDateOnly(r.date)}</span>;
  }
  if (col.identifier === "price") {
    const changed = r._origPrice != null && toNum(r._origPrice) !== toNum(r.price);
    if (ctx.inlineEditing)
      return (
        <FieldNumber
          label="" name={`ppp_price_${r.id}`} value={String(r.price ?? "")} width="140px" variant="table" disabled={ctx.disabled}
          onChange={(e) => ctx.handleInlineChange(r, "price", e.target.value)}
        />
      );
    return <span style={changed ? { fontWeight: 700, color: "#137333" } : undefined}>{r.price != null ? String(r.price) : ""}</span>;
  }
  return undefined;
};

// ═══════════════════════════════════════════════════════════════════════════
// Вкладка «Корректировка цен»
// ═══════════════════════════════════════════════════════════════════════════
const MASS_OPS = [
  { value: "percent", label: translate("changePercent") },
  { value: "multiply", label: translate("multiplyFactor") },
  { value: "set", label: translate("setPrice") },
  { value: "round", label: translate("roundTo") },
];

const PriceCorrectionTab: FC<{
  canWrite: boolean;
  initialProductUuid?: string;
  initialProductName?: string;
}> = ({ canWrite, initialProductUuid = "", initialProductName = "" }) => {
  const { actions: { confirm } } = useAppContext();
  const [priceTypeUuid, setPriceTypeUuid] = useState("");
  const [priceTypeName, setPriceTypeName] = useState("");
  // Фильтр по номенклатуре (подчинённый справочник цен): при выборе товара
  // «Заполнить» загружает все его цены = история цен товара.
  const [productUuid, setProductUuid] = useState(initialProductUuid);
  const [productName, setProductName] = useState(initialProductName);
  // Дата необязательна: пустая = без фильтра по дате (грузим все цены).
  // При записи, если не задана, подставляется сегодня.
  const [date, setDate] = useState("");
  const [pendingRows, setPendingRows] = useState<any[]>([]);
  const [currentRows, setCurrentRows] = useState<any[]>([]);
  const [fillVersion, setFillVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [filled, setFilled] = useState(false);
  const [writeMode, setWriteMode] = useState<"update" | "newDate">("update");
  // Массовые операции
  const [massOp, setMassOp] = useState("percent");
  const [massVal, setMassVal] = useState("");
  const [srcPriceTypeUuid, setSrcPriceTypeUuid] = useState("");
  const [srcPriceTypeName, setSrcPriceTypeName] = useState("");

  // Сводка изменений
  const changedCount = useMemo(
    () => currentRows.filter((r) => r._origPrice == null || toNum(r._origPrice) !== toNum(r.price)).length,
    [currentRows],
  );

  const applyRows = (rows: any[]) => {
    setPendingRows(rows);
    setCurrentRows(rows);
    setFillVersion((v) => v + 1);
  };

  const handleFill = async () => {
    setIsLoading(true);
    try {
      // Все фильтры необязательны: без них загрузим все цены (последние, до limit).
      const params: Record<string, any> = { limit: 5000 };
      if (priceTypeUuid) params.priceTypeUuid = priceTypeUuid;
      if (productUuid) params.productUuid = productUuid;
      if (date) params.date = date; // сырая дата YYYY-MM-DD (UTC-день, как в БД)
      const resp = await apiClient.get(`/${ENDPOINT}`, { params });
      const items = (resp.data?.items ?? []) as any[];
      const rows = items.map((e, i) => {
        const price = e.price != null ? Number(e.price) : null;
        return {
          id: -(i + 1),
          uuid: e.uuid,
          productUuid: e.productUuid,
          product: e.product ? { name: e.product.name } : null,
          priceTypeUuid: e.priceTypeUuid ?? e.priceType?.uuid ?? priceTypeUuid,
          priceType: e.priceType ? { name: e.priceType.name } : { name: priceTypeName },
          date: e.date,
          price,
          _origPrice: price,
          // Помечаем как "create", чтобы SubTable показал инъектированные строки
          // (при parentUuid="" серверной строки нет, а "update"/"delete" без неё
          // отбрасываются mergeServerWithPending). Реальную операцию (update по uuid
          // либо create) определяет buildOps по наличию r.uuid.
          _pendingAction: "create",
        };
      });
      applyRows(rows);
      setFilled(true);
      if (rows.length === 0) showToast("Цены не найдены (в базе нет записей по условиям)", "info");
      else showToast(`Загружено цен: ${rows.length}`, "success");
    } catch (err) {
      console.error(err);
      showToast("Ошибка при загрузке цен", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Если форму открыли из карточки товара (с productUuid) — авто-заполняем один раз.
  const autoFilledRef = useRef(false);
  useEffect(() => {
    if (initialProductUuid && !autoFilledRef.current) {
      autoFilledRef.current = true;
      void handleFill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyMassOp = () => {
    if (currentRows.length === 0) return;
    const v = parseFloat(massVal.replace(",", "."));
    if (Number.isNaN(v)) {
      showToast("Укажите значение операции", "warning");
      return;
    }
    const next = currentRows.map((r) => {
      const base = toNum(r.price);
      let p = base;
      switch (massOp) {
        case "percent": if (base != null) p = round2(base * (1 + v / 100)); break;
        case "multiply": if (base != null) p = round2(base * v); break;
        case "set": p = round2(v); break;
        case "round": if (base != null && v > 0) p = round2(Math.round(base / v) * v); break;
      }
      return { ...r, price: p };
    });
    applyRows(next);
    showToast(`Операция применена к ${next.length} строкам`, "info");
  };

  const copyFromType = async () => {
    if (!srcPriceTypeUuid) { showToast(translate("fromPriceType"), "warning"); return; }
    if (currentRows.length === 0) return;
    setIsLoading(true);
    try {
      const resp = await apiClient.get(`/${ENDPOINT}`, { params: { priceTypeUuid: srcPriceTypeUuid, limit: 5000 } });
      const items = (resp.data?.items ?? []) as any[];
      // Берём самую свежую цену по каждому товару (items отсортированы date desc).
      const srcMap = new Map<string, number>();
      for (const e of items) {
        if (e.productUuid && !srcMap.has(e.productUuid) && e.price != null) srcMap.set(e.productUuid, Number(e.price));
      }
      let applied = 0;
      const next = currentRows.map((r) => {
        if (r.productUuid && srcMap.has(r.productUuid)) { applied++; return { ...r, price: srcMap.get(r.productUuid)! }; }
        return r;
      });
      applyRows(next);
      showToast(`Подставлено из «${srcPriceTypeName}»: ${applied}`, applied ? "success" : "info");
    } catch (err) {
      console.error(err);
      showToast("Ошибка при подстановке из типа цены", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Дата записи: выбранная пользователем либо сегодня (сырая YYYY-MM-DD).
  const writeDate = () => date || todayDateOnly();

  // Реальная серверная строка (а не локально добавленная кнопкой «Добавить»,
  // у которой uuid вида "tmp-…"). По нему отличаем update от create.
  const realUuid = (r: any) => (r.uuid && !String(r.uuid).startsWith("tmp-") ? r.uuid : null);

  const buildOps = () => {
    const ops: any[] = [];
    const wDate = writeDate();
    for (const r of currentRows) {
      const ru = realUuid(r);
      if (r._pendingAction === "delete") { if (ru) ops.push({ action: "delete", uuid: ru }); continue; }
      const price = toNum(r.price);
      if (writeMode === "newDate") {
        if (r.productUuid && price != null)
          ops.push({ action: "create", data: { productUuid: r.productUuid, priceTypeUuid: r.priceTypeUuid ?? priceTypeUuid, date: wDate, price } });
      } else if (ru) {
        const changed = r._origPrice == null || toNum(r._origPrice) !== price;
        if (changed) ops.push({ action: "update", uuid: ru, data: { price, date: r.date ?? wDate, priceTypeUuid: r.priceTypeUuid ?? priceTypeUuid } });
      } else if (r.productUuid && price != null) {
        ops.push({ action: "create", data: { productUuid: r.productUuid, priceTypeUuid: r.priceTypeUuid ?? priceTypeUuid, date: r.date ?? wDate, price } });
      }
    }
    return ops;
  };

  const collectWarnings = () => {
    let zero = 0, jumps = 0;
    for (const r of currentRows) {
      const price = toNum(r.price);
      const orig = toNum(r._origPrice);
      const isChange = writeMode === "newDate" || orig == null || orig !== price;
      if (!isChange) continue;
      if (price == null || price <= 0) { zero++; continue; }
      if (orig != null && orig > 0) {
        const ratio = price / orig;
        if (ratio >= 3 || ratio <= 1 / 3) jumps++;
      }
    }
    const w: string[] = [];
    if (zero > 0) w.push(`нулевая/пустая цена — ${zero}`);
    if (jumps > 0) w.push(`резкое изменение (>3× или <⅓) — ${jumps}`);
    return w;
  };

  const handleWrite = async () => {
    if (!canWrite) return;
    const ops = buildOps();
    if (ops.length === 0) { showToast("Нет изменений для записи", "info"); return; }
    const warnings = collectWarnings();
    const head = writeMode === "newDate"
      ? `Создать ${ops.length} цен на ${getFormatDateOnly(writeDate())}?`
      : `Записать изменения: ${ops.length} строк?`;
    const msg = warnings.length ? `${head} Внимание: ${warnings.join("; ")}.` : head;
    if (!(await confirm(msg))) return;
    setIsLoading(true);
    try {
      const resp = await apiClient.post(`/${ENDPOINT}/batch`, { operations: ops });
      const s = resp.data?.summary;
      showToast(s
        ? `Готово. Обновлено: ${s.updated || 0}, создано: ${s.created || 0}, удалено: ${s.deleted || 0}, пропущено: ${s.skipped || 0}`
        : "Готово", "success");
      await handleFill();
    } catch (err) {
      console.error(err);
      showToast("Ошибка при записи", "error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.tab}>
      <HelpBox title="ℹ️ Корректировка действующих цен номенклатуры">
        <ol>
          <li>Условия отбора необязательны: <b>{translate("priceType")}</b>, <b>{translate("nomenclature")}</b>, <b>{translate("date")}</b>. Без фильтров загрузятся все цены; выбор номенклатуры покажет историю её цен.</li>
          <li>Нажмите <b>«{translate("fill")}»</b> — в таблицу подгрузятся существующие цены (колонка «{translate("oldPrice")}» хранит исходное значение).</li>
          <li>Измените цены вручную или массово (панель ниже): «{translate("changePercent")}», «{translate("multiplyFactor")}», «{translate("roundTo")}», «{translate("fromPriceType")}». Колонка «{translate("priceDelta")}» покажет отклонение.</li>
          <li>Выберите <b>{translate("writeMode")}</b> и нажмите <b>«{translate("writePrices")}»</b>. Перед записью покажем сводку и предупреждения.</li>
        </ol>
      </HelpBox>

      <GroupRow className={mainStyles.GroupRowWrap}>
        <LookupField
          label={translate("priceType")} name="corr_priceType" value={priceTypeUuid} displayValue={priceTypeName}
          endpoint="price-types" displayField="name" disabled={isLoading}
          onSelect={(u, d) => { setPriceTypeUuid(u); setPriceTypeName(d ?? ""); }}
          onClear={() => { setPriceTypeUuid(""); setPriceTypeName(""); }}
        />
        <LookupField
          label={translate("nomenclature")} name="corr_product" value={productUuid} displayValue={productName}
          endpoint="products" displayField="name" disabled={isLoading}
          onSelect={(u, d) => { setProductUuid(u); setProductName(d ?? ""); }}
          onClear={() => { setProductUuid(""); setProductName(""); }}
        />
        <FieldDate label={translate("date")} name="corr_date" value={date} onChange={(e) => setDate(e.target.value)} disabled={isLoading} />
        <Button variant="primary" onClick={handleFill} disabled={isLoading}>{translate("fill")}</Button>
        <FieldSelect
          label={translate("writeMode")} name="corr_writeMode" value={writeMode}
          options={[{ value: "update", label: translate("modeUpdate") }, { value: "newDate", label: translate("modeNewDate") }]}
          onChange={(e) => setWriteMode(e.target.value as "update" | "newDate")} disabled={isLoading}
        />
        <Button onClick={handleWrite} disabled={isLoading || !canWrite || (!filled && currentRows.length === 0)}>{translate("writePrices")}</Button>
      </GroupRow>

      {filled && (
        <div className={styles.massOps}>
          <span className={styles.massOpsTitle}>{translate("bulkChange")}:</span>
          <FieldSelect label="" name="corr_massOp" value={massOp} options={MASS_OPS} onChange={(e) => setMassOp(e.target.value)} disabled={isLoading} variant="table" />
          <FieldNumber label="" name="corr_massVal" value={massVal} width="120px" variant="table" onChange={(e) => setMassVal(e.target.value)} disabled={isLoading} />
          <Button onClick={applyMassOp} disabled={isLoading || currentRows.length === 0}>{translate("apply")}</Button>
          <span className={styles.divider} />
          <LookupField
            label="" name="corr_srcType" value={srcPriceTypeUuid} displayValue={srcPriceTypeName}
            endpoint="price-types" displayField="name" disabled={isLoading} variant="table"
            onSelect={(u, d) => { setSrcPriceTypeUuid(u); setSrcPriceTypeName(d ?? ""); }}
            onClear={() => { setSrcPriceTypeUuid(""); setSrcPriceTypeName(""); }}
          />
          <Button onClick={copyFromType} disabled={isLoading || !srcPriceTypeUuid || currentRows.length === 0}>{translate("fromPriceType")}</Button>
          <span className={styles.divider} />
          <div className={styles.summary}>
            <span className={styles.badge}>{translate("price")}: {currentRows.length}</span>
            <span className={`${styles.badge} ${changedCount ? styles.badgeOk : ""}`}>{translate("previewChanges")}: {changedCount}</span>
          </div>
        </div>
      )}

      <div className={styles.tableWrap}>
        <SubTable
          key={`corr-${fillVersion}`}
          model={ENDPOINT}
          componentName="ProductPriceCorrection_part"
          columnsJson={correctionColumns}
          parentKey="productUuid"
          parentUuid=""
          deferRemoteChanges
          clientSort
          initialPendingRows={pendingRows}
          defaultInlineEditing
          emptyMessage={"Нажмите «Заполнить» — фильтры необязательны"}
          onAllItemsChange={setCurrentRows}
          renderCell={priceCellRenderer}
          defaultNewRow={{
            productUuid: "", product: null,
            priceTypeUuid: priceTypeUuid || "",
            priceType: priceTypeName ? { name: priceTypeName } : null,
            date: date || todayDateOnly(),
            price: "", _origPrice: null,
          }}
        />
      </div>
    </div>
  );
};
PriceCorrectionTab.displayName = "PriceCorrectionTab";

// ═══════════════════════════════════════════════════════════════════════════
// Вкладка «Загрузка цен» (импорт из Excel)
// ═══════════════════════════════════════════════════════════════════════════
async function resolveProducts(skus: string[], barcodes: string[], names: string[]) {
  const resp = await apiClient.post(`/${ENDPOINT}/resolve-products`, { skus, barcodes, names });
  const items = (resp.data?.items ?? []) as any[];
  const skuMap = new Map<string, any>();
  const barcodeMap = new Map<string, any>();
  const nameMap = new Map<string, any>();
  for (const p of items) {
    if (p.sku) skuMap.set(String(p.sku).trim(), p);
    if (p.barcode) barcodeMap.set(String(p.barcode).trim(), p);
    for (const b of p.barcodes ?? []) if (b.barcode) barcodeMap.set(String(b.barcode).trim(), p);
    if (p.name) nameMap.set(String(p.name).trim(), p);
  }
  return { skuMap, barcodeMap, nameMap };
}

// Ключ идемпотентности цены: товар|тип|день|цена — совпадает с проверкой бэкенда.
const priceKey = (productUuid?: string | null, typeUuid?: string | null, dateVal?: string | null, price?: unknown) =>
  `${productUuid ?? ""}|${typeUuid ?? ""}|${String(dateVal ?? "").slice(0, 10)}|${price == null || price === "" ? "" : Number(price)}`;

// Нормализует ячейку даты (строка YYYY-MM-DD / DD.MM.YYYY / объект Date) → YYYY-MM-DD.
function normalizeDateCell(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

// Карта «имя типа цены (lowercase) → {uuid,name}» для восстановления типа из файла.
async function fetchPriceTypeMap() {
  const resp = await apiClient.get(`/price-types`, { params: { limit: 1000 } });
  const map = new Map<string, { uuid: string; name: string }>();
  for (const t of (resp.data?.items ?? []) as any[]) {
    if (t.name) map.set(String(t.name).trim().toLowerCase(), { uuid: t.uuid, name: t.name });
  }
  return map;
}

// Множество ключей уже существующих цен (для опции «Скрыть существующие»).
async function fetchExistingKeySet(): Promise<Set<string>> {
  const resp = await apiClient.get(`/${ENDPOINT}/export`);
  const set = new Set<string>();
  for (const e of (resp.data?.items ?? []) as any[]) {
    set.add(priceKey(e.productUuid, e.priceTypeUuid ?? e.priceType?.uuid, e.date, e.price));
  }
  return set;
}

const PriceImportTab: FC<{ canWrite: boolean }> = ({ canWrite }) => {
  const { actions: { confirm } } = useAppContext();
  const [priceTypeUuid, setPriceTypeUuid] = useState("");
  const [priceTypeName, setPriceTypeName] = useState("");
  const [date, setDate] = useState(todayDateOnly());
  const [file, setFile] = useState<File | null>(null);
  const [allRows, setAllRows] = useState<any[]>([]); // все распарсенные строки (с тегами)
  const [hideExisting, setHideExisting] = useState(false);
  const [pendingRows, setPendingRows] = useState<any[]>([]);
  const [currentRows, setCurrentRows] = useState<any[]>([]);
  const [fillVersion, setFillVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [parsed, setParsed] = useState(false);

  const matchedCount = useMemo(() => allRows.filter((r) => r.productUuid).length, [allRows]);
  const unmatchedCount = allRows.length - matchedCount;
  const existingCount = useMemo(() => allRows.filter((r) => r._existing).length, [allRows]);

  // Показать строки с учётом опции «скрыть существующие».
  const showRows = (rows: any[], hide: boolean) => {
    const shown = hide ? rows.filter((r) => !r._existing) : rows;
    setPendingRows(shown);
    setCurrentRows(shown);
    setFillVersion((v) => v + 1);
  };

  const applyHideExisting = (next: boolean) => {
    setHideExisting(next);
    showRows(allRows, next);
  };

  const handleFill = async () => {
    if (!file) { showToast("Сначала выберите файл (.xlsx, .xls)", "warning"); return; }
    setIsLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
      if (!raw || raw.length === 0) { showToast("Файл пуст", "warning"); return; }
      const header = (raw[0] as any[]).map((h) => String(h ?? "").trim().toLowerCase());
      const col = (names: string[]) => {
        for (const n of names) {
          const idx = header.findIndex((h) => h === n.toLowerCase());
          if (idx >= 0) return idx;
        }
        return -1;
      };
      const skuIdx = col(["sku", "артикул", "article"]);
      const barcodeIdx = col(["barcode", "штрих-код", "штрихкод"]);
      const nameIdx = col(["name", "наименование", "title"]);
      const priceIdx = col(["price", "цена", "стоимость"]);
      const ptIdx = col(["pricetype", "тип цены", "price type", "типцены"]);
      const dateIdx = col(["date", "дата"]);

      const data = (raw.slice(1) as any[])
        .map((r) => {
          const sku = skuIdx >= 0 ? String(r[skuIdx] ?? "").trim() : "";
          const barcode = barcodeIdx >= 0 ? String(r[barcodeIdx] ?? "").trim() : "";
          const name = nameIdx >= 0 ? String(r[nameIdx] ?? "").trim() : "";
          const praw = priceIdx >= 0 ? r[priceIdx] : null;
          const price = praw == null || praw === "" ? null : parseFloat(String(praw).replace(",", "."));
          const ptName = ptIdx >= 0 ? String(r[ptIdx] ?? "").trim() : "";
          const dateCell = dateIdx >= 0 ? normalizeDateCell(r[dateIdx]) : null;
          return { sku, barcode, name, price, ptName, dateCell };
        })
        .filter((d) => d.sku || d.barcode || d.name || d.price != null);

      if (data.length === 0) { showToast("В файле нет строк с данными", "warning"); return; }

      // Параллельно: серверное сопоставление товаров, карта типов цен, ключи существующих.
      const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));
      const [{ skuMap, barcodeMap, nameMap }, ptMap, existingKeys] = await Promise.all([
        resolveProducts(uniq(data.map((d) => d.sku)), uniq(data.map((d) => d.barcode)), uniq(data.map((d) => d.name))),
        fetchPriceTypeMap(),
        fetchExistingKeySet(),
      ]);
      const dateVal = date || todayDateOnly(); // сырая дата YYYY-MM-DD
      const rows = data.map((d, i) => {
        const match =
          (d.sku && skuMap.get(d.sku)) ||
          (d.barcode && barcodeMap.get(d.barcode)) ||
          (d.name && nameMap.get(d.name)) ||
          null;
        // Тип цены: из файла (по имени) либо выбранный в форме.
        const fileType = d.ptName ? ptMap.get(d.ptName.toLowerCase()) : null;
        const effTypeUuid = fileType?.uuid ?? (priceTypeUuid || null);
        const effTypeName = fileType?.name ?? priceTypeName;
        const effDate = d.dateCell ?? dateVal;
        const productUuid = match?.uuid ?? null;
        const _existing = productUuid ? existingKeys.has(priceKey(productUuid, effTypeUuid, effDate, d.price)) : false;
        return {
          id: -(i + 1),
          productUuid,
          product: { name: match?.name ?? d.name ?? "" },
          priceTypeUuid: effTypeUuid,
          priceType: { name: effTypeName },
          date: effDate,
          price: d.price,
          sku: d.sku,
          barcode: d.barcode,
          _matched: !!match,
          _existing,
          _pendingAction: "create",
        };
      });
      setAllRows(rows);
      showRows(rows, hideExisting);
      setParsed(true);
      const unmatched = rows.filter((r) => !r.productUuid).length;
      const existing = rows.filter((r) => r._existing).length;
      showToast(
        `${translate("matched")}: ${rows.length - unmatched}, ${translate("notMatched")}: ${unmatched}, ${translate("alreadyExists")}: ${existing}`,
        unmatched ? "warning" : "success",
      );
    } catch (err) {
      console.error(err);
      showToast("Ошибка чтения файла", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!canWrite) return;
    // Тип цены обязателен: либо выбран в форме, либо есть в каждой строке (из файла).
    if (!priceTypeUuid && currentRows.every((r) => !r.priceTypeUuid)) {
      showToast(`${translate("upload")}: ${translate("priceType")}`, "warning");
      return;
    }
    const ops = currentRows
      .filter((r) => r.productUuid && r.price != null)
      .map((r) => ({ action: "create", data: { productUuid: r.productUuid, priceTypeUuid: r.priceTypeUuid ?? priceTypeUuid ?? null, date: r.date ?? date ?? todayDateOnly(), price: r.price } }));
    if (ops.length === 0) { showToast("Нет строк с сопоставленной номенклатурой и ценой", "warning"); return; }
    const unmatched = currentRows.filter((r) => !r.productUuid).length;
    const msg = unmatched > 0
      ? `Загрузить ${ops.length} цен? ${unmatched} строк без сопоставления будут пропущены.`
      : `Загрузить ${ops.length} цен?`;
    if (!(await confirm(msg))) return;

    setIsLoading(true);
    try {
      const resp = await apiClient.post(`/${ENDPOINT}/batch`, { operations: ops });
      const s = resp.data?.summary;
      showToast(s ? `Загрузка завершена. Создано: ${s.created || 0}, пропущено: ${s.skipped || 0}` : "Загрузка завершена", "success");
      setFile(null);
      setAllRows([]);
      setPendingRows([]);
      setCurrentRows([]);
      setParsed(false);
      setFillVersion((v) => v + 1);
    } catch (err) {
      console.error(err);
      showToast("Ошибка при загрузке", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportUnmatched = () => {
    const rows = allRows.filter((r) => !r.productUuid);
    if (rows.length === 0) { showToast("Несопоставленных строк нет", "info"); return; }
    const aoa = [["sku", "barcode", "name", "price"], ...rows.map((r) => [r.sku ?? "", r.barcode ?? "", r.product?.name ?? "", r.price ?? ""])];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, "unmatched");
    XLSX.writeFile(wb, "unmatched_prices.xlsx");
  };

  // Бэкап всех цен в xlsx. Формат = формат импорта (round-trip).
  const handleDownloadBackup = async () => {
    setIsLoading(true);
    try {
      const resp = await apiClient.get(`/${ENDPOINT}/export`);
      const items = (resp.data?.items ?? []) as any[];
      if (items.length === 0) { showToast("Цен для бэкапа нет", "info"); return; }
      const aoa = [
        ["sku", "barcode", "name", "brand", "priceType", "date", "price"],
        ...items.map((e) => [
          e.product?.sku ?? "",
          e.product?.barcode ?? "",
          e.product?.name ?? "",
          e.product?.brand?.name ?? "",
          e.priceType?.name ?? "",
          String(e.date ?? "").slice(0, 10),
          e.price ?? "",
        ]),
      ];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, "prices");
      XLSX.writeFile(wb, `product_prices_backup_${new Date().toISOString().slice(0, 10)}.xlsx`);
      showToast(`${translate("downloadBackup")}: ${items.length}`, "success");
    } catch (err) {
      console.error(err);
      showToast("Ошибка при выгрузке бэкапа", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadTemplate = () => {
    try {
      const header = [["sku", "barcode", "name", "brand", "priceType", "date", "price"]];
      const sample = [["ART-001", "0123456789012", "Пример товара", "", "Цена продажи", new Date().toISOString().slice(0, 10), "123.45"]];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([...header, ...sample]);
      XLSX.utils.book_append_sheet(wb, ws, "template");
      XLSX.writeFile(wb, "product_prices_template.xlsx");
    } catch (err) {
      console.error("download template error", err);
      showToast("Не удалось сформировать шаблон", "error");
    }
  };

  return (
    <div className={styles.tab}>
      <HelpBox title="ℹ️ Загрузка цен из файла Excel (.xlsx, .xls)">
        <ol>
          <li>Укажите <b>{translate("priceType")}</b> и <b>{translate("date")}</b> — значения по умолчанию для строк без этих колонок.</li>
          <li>Выберите файл (кнопка <b>«{translate("downloadTemplate")}»</b> — шаблон; <b>«{translate("downloadBackup")}»</b> — выгрузка всех цен для бэкапа/восстановления).</li>
          <li>Нажмите <b>«{translate("fill")}»</b> — строки попадут в таблицу, номенклатура сопоставится по артикулу / штрих-коду / наименованию.</li>
          <li>Строки без товара помечаются <span className={helpMarker.warn}>⚠</span>. Опцией <b>«{translate("hideExisting")}»</b> можно скрыть уже существующие цены.</li>
          <li>Нажмите <b>«{translate("upload")}»</b> — цены создадутся (повторы и строки без товара пропускаются).</li>
        </ol>
        <div className={styles.notice}>
          Колонки файла: «sku / артикул», «barcode / штрих-код», «name / наименование», «price / цена». Необязательные: «priceType / тип цены», «date / дата» (для восстановления из бэкапа).
        </div>
      </HelpBox>

      <GroupRow className={mainStyles.GroupRowWrap}>
        <LookupField
          label={translate("priceType")} name="imp_priceType" value={priceTypeUuid} displayValue={priceTypeName}
          endpoint="price-types" displayField="name" disabled={isLoading}
          onSelect={(u, d) => { setPriceTypeUuid(u); setPriceTypeName(d ?? ""); }}
          onClear={() => { setPriceTypeUuid(""); setPriceTypeName(""); }}
        />
        <FieldDate label={translate("date")} name="imp_date" value={date} onChange={(e) => setDate(e.target.value)} disabled={isLoading} />
        <FieldFile
          key={`file-${fillVersion}`} name="imp_file" accept=".xls,.xlsx" disabled={isLoading || !canWrite}
          loading={isLoading} onSelect={(f) => { setFile(f); setParsed(false); }}
        />
        <Button variant="primary" onClick={handleFill} disabled={isLoading || !file}>{translate("fill")}</Button>
        <Button onClick={handleUpload} disabled={isLoading || !canWrite || !parsed}>{translate("upload")}</Button>
        <Button onClick={handleDownloadTemplate} type="button">{translate("downloadTemplate")}</Button>
        <Button onClick={handleDownloadBackup} type="button" disabled={isLoading}>{translate("downloadBackup")}</Button>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={hideExisting} onChange={(e) => applyHideExisting(e.target.checked)} disabled={isLoading} />
          {translate("hideExisting")}
        </label>
      </GroupRow>

      {parsed && (
        <div className={styles.summary}>
          <span className={`${styles.badge} ${styles.badgeOk}`}>{translate("matched")}: {matchedCount}</span>
          <span className={`${styles.badge} ${unmatchedCount ? styles.badgeWarn : ""}`}>{translate("notMatched")}: {unmatchedCount}</span>
          <span className={styles.badge}>{translate("alreadyExists")}: {existingCount}</span>
          {unmatchedCount > 0 && <Button onClick={handleExportUnmatched} type="button">{translate("exportUnmatched")}</Button>}
        </div>
      )}

      <div className={styles.tableWrap}>
        <SubTable
          key={`imp-${fillVersion}`}
          model={ENDPOINT}
          componentName="ProductPriceImport_part"
          columnsJson={priceColumns}
          parentKey="productUuid"
          parentUuid=""
          deferRemoteChanges
          clientSort
          initialPendingRows={pendingRows}
          defaultInlineEditing
          emptyMessage={"Выберите файл и нажмите «Заполнить»"}
          onAllItemsChange={setCurrentRows}
          renderCell={priceCellRenderer}
        />
      </div>
    </div>
  );
};
PriceImportTab.displayName = "PriceImportTab";

// ═══════════════════════════════════════════════════════════════════════════
// Форма «Корректировка цен номенклатуры» — две вкладки.
// ═══════════════════════════════════════════════════════════════════════════
export const ProductPriceProcessing: FC<Partial<TPane>> = (paneProps) => {
  // Отдельное право на массовое изменение цен; при отсутствии — откат на «Product».
  const priceRight = useUserAccessRight("ProductPrice");
  const productRight = useUserAccessRight("Product");
  const canWrite = priceRight.accessLevel !== "none" ? priceRight.canWrite : productRight.canWrite;

  // Если форму открыли из карточки товара — приходит productUuid/productName.
  const data = paneProps.data as { productUuid?: string; productName?: string } | undefined;
  const initialProductUuid = data?.productUuid ?? "";
  const initialProductName = data?.productName ?? "";

  const tabs = useMemo(
    () => [
      {
        id: "correction", label: translate("priceCorrectionTab"),
        component: <PriceCorrectionTab canWrite={canWrite} initialProductUuid={initialProductUuid} initialProductName={initialProductName} />,
      },
      { id: "import", label: translate("priceImportTab"), component: <PriceImportTab canWrite={canWrite} /> },
    ],
    [canWrite, initialProductUuid, initialProductName],
  );

  return (
    <div className={mainStyles.FormWrapper}>
      <div className={mainStyles.FormBody}>
        <Tabs tabs={tabs} />
      </div>
    </div>
  );
};
ProductPriceProcessing.displayName = "ProductPriceProcessing";

export default ProductPriceProcessing;
