import React, { FC, useMemo, useState } from "react";
import { translate } from "src/i18";
import { Field, FieldFile, FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { HelpBox, HelpText } from "src/components/HelpBox";
import { Button } from "src/components/Button";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { GroupRow } from "src/components/UI";
import mainStyles from "src/styles/main.module.scss";
import styles from "./ProductImportExport.module.scss";
import apiClient from "src/services/api/client";
import { useAccessPermission } from "src/hooks/useAccessPermission";
import { useAppContext } from "src/app/context";
import { showToast } from "src/components/UIToast";
import type { TPane } from "src/app/types";
import type { TColumn, TDataItem } from "src/components/Table/types";
import * as XLSX from "xlsx";

const ENDPOINT = "products";
const today = () => new Date().toISOString().slice(0, 10);

// Фиксированные колонки файла (RU/EN-синонимы). Остальные колонки = типы цен.
const FIXED: Record<string, string[]> = {
  sku: ["sku", "артикул", "article"],
  name: ["name", "наименование", "title", "номенклатура"],
  brand: ["brand", "бренд"],
  unit: ["unit", "ед. изм.", "ед.изм.", "ед изм", "единица", "unitofmeasure"],
  isService: ["isservice", "услуга", "is service", "service"],
  barcodes: ["barcodes", "штрих-коды", "штрихкоды", "barcode", "штрих-код", "штрихкод"],
};

const splitBarcodes = (s: unknown): string[] =>
  String(s ?? "").split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);

const lc = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** Строка разобранного файла: известные колонки + произвольные (типы цен). */
interface SheetRow {
  sku?: unknown;
  name?: unknown;
  brand?: unknown;
  unit?: unknown;
  isService?: unknown;
  barcodes?: unknown;
  [key: string]: unknown;
}

/** Товар из справочника (ответ resolve-products) — для сопоставления строк файла. */
interface CatalogProduct {
  uuid?: string;
  sku?: string | null;
  name?: string | null;
  barcode?: string | null;
  barcodes?: Array<{ barcode?: string | null }>;
  brand?: { name?: string | null } | null;
  unitOfMeasure?: { name?: string | null } | null;
  isService?: boolean | null;
  /** История цен (export-full), отсортирована по дате desc. */
  productPrices?: Array<{ priceType?: { name?: string | null } | null; price?: unknown }>;
  [key: string]: unknown;
}

// Серверное сопоставление номенклатуры (для предпросмотра импорта, #6):
// строим карты ШК / «артикул+бренд» / артикул / наименование.
async function resolveImportProducts(rows: SheetRow[]) {
  const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));
  const allBarcodes = rows.flatMap((r) => splitBarcodes(r.barcodes));
  const skus = rows.map((r) => String(r.sku ?? ""));
  const names = rows.map((r) => String(r.name ?? ""));
  const resp = await apiClient.post(`/product-prices/resolve-products`, {
    skus: uniq(skus), barcodes: uniq(allBarcodes), names: uniq(names),
  });
  const items = (resp.data?.items ?? []) as CatalogProduct[];
  const byBarcode = new Map<string, CatalogProduct>();
  const bySkuBrand = new Map<string, CatalogProduct>();
  const bySku = new Map<string, CatalogProduct>();
  const byName = new Map<string, CatalogProduct>();
  for (const p of items) {
    if (p.barcode) byBarcode.set(String(p.barcode).trim(), p);
    for (const b of p.barcodes ?? []) if (b.barcode) byBarcode.set(String(b.barcode).trim(), p);
    if (p.sku) {
      bySku.set(lc(p.sku), p);
      bySkuBrand.set(`${lc(p.sku)}|${lc(p.brand?.name)}`, p);
    }
    if (p.name) byName.set(lc(p.name), p);
  }
  // Приоритет #6: ШК → (артикул+бренд) → артикул → наименование.
  return (r: SheetRow) => {
    for (const bc of splitBarcodes(r.barcodes)) { const p = byBarcode.get(bc); if (p) return p; }
    if (r.sku) {
      const sb = bySkuBrand.get(`${lc(r.sku)}|${lc(r.brand)}`); if (sb) return sb;
      const s = bySku.get(lc(r.sku)); if (s) return s;
    }
    if (r.name) { const n = byName.get(lc(r.name)); if (n) return n; }
    return null;
  };
}

const IMPORT_COLUMNS = [
  { identifier: "sku", type: "string", width: "120px", minWidth: "90px", alignment: "left", hint: "Артикул", visible: true, inlist: true },
  { identifier: "name", type: "string", width: "260px", minWidth: "160px", alignment: "left", hint: "Наименование", visible: true, inlist: true },
  { identifier: "brand", type: "string", width: "150px", minWidth: "100px", alignment: "left", hint: "Бренд", visible: true, inlist: true },
  { identifier: "unit", type: "string", width: "100px", minWidth: "70px", alignment: "left", hint: "Ед. изм.", visible: true, inlist: true },
  { identifier: "isService", type: "boolean", width: "80px", minWidth: "60px", alignment: "center", hint: "Услуга", visible: true, inlist: true },
  { identifier: "barcodes", type: "string", width: "210px", minWidth: "120px", alignment: "left", hint: "Штрих-коды", visible: true, inlist: true },
  { identifier: "prices", type: "string", width: "260px", minWidth: "140px", alignment: "left", hint: "Цены", visible: true, inlist: true },
];

const pricesSummary = (r: TDataItem): string =>
  ((r.prices ?? []) as Array<{ typeName?: string; value?: unknown }>).map((p) => `${p.typeName}=${p.value}`).join("; ");

// Фабрика рендера ячеек: замыкает дату цен (для колонки «Цены» — #5).
const makeCellRenderer = (priceDate: string) =>
  (row: TDataItem, col: TColumn, ctx: SubTableContext): React.ReactNode | undefined => {
    const r = row as TDataItem & Record<string, any>;
    // «Номенклатура» — LookupField на справочник товаров (#2). allowFreeText
    // позволяет ввести новое наименование (товар будет создан при импорте).
    if (col.identifier === "name") {
      if (ctx.inlineEditing)
        return (
          <LookupField
            label="" name={`pie_name_${r.id}`} value={String(r.productUuid ?? "")} displayValue={String(r.name ?? "")}
            endpoint="products" displayField="name" variant="table" disabled={ctx.disabled}
            allowFreeText
            prefix={
              <span title={r.productUuid ? "Сопоставлено с существующим" : "Новый товар (будет создан)"}
                className={r.productUuid ? styles.matchOk : styles.matchNew}>
                {r.productUuid ? "✓" : "＋"}
              </span>
            }
            onTextChange={(text) => ctx.updateLocalRow(r, { name: text, productUuid: "", _matched: false })}
            onSelect={(u, dv, item) => ctx.handleLookupChange(r, "productUuid", u, {
              name: item?.name ?? dv,
              _matched: !!u,
              ...(item?.sku !== undefined ? { sku: item.sku ?? "" } : {}),
              ...(item ? { brand: item.brand?.name ?? "", brandUuid: item.brandUuid ?? "" } : {}),
              ...(item ? { unit: item.unitOfMeasure?.name ?? "", unitUuid: item.unitOfMeasureUuid ?? "" } : {}),
            })}
            onClear={() => ctx.handleLookupChange(r, "productUuid", null, { _matched: false })}
          />
        );
      return <span>{r.productUuid ? "" : "＋ "}{String(r.name ?? "")}</span>;
    }
    // Бренд / Ед. изм. — ссылки на справочники (по наименованию; бэкенд сопоставляет по имени).
    if (col.identifier === "brand" || col.identifier === "unit") {
      const endpoint = col.identifier === "brand" ? "brands" : "unit-of-measures";
      const uuidKey = col.identifier === "brand" ? "brandUuid" : "unitUuid";
      if (ctx.inlineEditing)
        return (
          <LookupField
            label="" name={`pie_${col.identifier}_${r.id}`} value={String(r[uuidKey] ?? "")} displayValue={String(r[col.identifier] ?? "")}
            endpoint={endpoint} displayField="name" variant="table" disabled={ctx.disabled}
            onSelect={(u, dv) => ctx.handleLookupChange(r, uuidKey, u, { [col.identifier]: dv })}
            onClear={() => ctx.handleLookupChange(r, uuidKey, null, { [col.identifier]: "" })}
          />
        );
      return <span>{String(r[col.identifier] ?? "")}</span>;
    }
    if (["sku", "barcodes"].includes(col.identifier)) {
      if (ctx.inlineEditing)
        return (
          <Field label="" name={`pie_${col.identifier}_${r.id}`} value={String(r[col.identifier] ?? "")} variant="table" width="100%"
            onChange={(e) => ctx.handleInlineChange(r, col.identifier, e.target.value)} disabled={ctx.disabled} />
        );
      return <span>{String(r[col.identifier] ?? "")}</span>;
    }
    if (col.identifier === "isService") {
      return (
        <input type="checkbox" checked={!!r.isService} disabled={ctx.disabled || !ctx.inlineEditing}
          onChange={(e) => ctx.updateLocalRow(r, { isService: e.target.checked })} />
      );
    }
    if (col.identifier === "prices") {
      const txt = pricesSummary(r);
      return <span className={styles.pricesCell} title={txt && priceDate ? `Цены будут записаны на ${priceDate}` : undefined}>
        {txt}{txt && priceDate ? `  -  ${priceDate}` : ""}
      </span>;
    }
    return undefined;
  };

export const ProductImportExport: FC<Partial<TPane>> = () => {
  const { canWrite } = useAccessPermission("Product");
  const { actions: { confirm } } = useAppContext();
  const [file, setFile] = useState<File | null>(null);
  const [priceDate, setPriceDate] = useState(today());
  const [allRows, setAllRows] = useState<any[]>([]);
  const [hideExisting, setHideExisting] = useState(false);
  const [pendingRows, setPendingRows] = useState<any[]>([]);
  const [currentRows, setCurrentRows] = useState<any[]>([]);
  const [fillVersion, setFillVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [parsed, setParsed] = useState(false);

  const cellRenderer = useMemo(() => makeCellRenderer(priceDate), [priceDate]);
  const productCount = currentRows.length;
  const matchedCount = useMemo(() => allRows.filter((r) => r.productUuid).length, [allRows]);
  const newCount = allRows.length - matchedCount;
  const newBarcodes = useMemo(
    () => currentRows.reduce((acc, r) => acc + splitBarcodes(r.barcodes).length, 0),
    [currentRows],
  );

  // Показ строк с учётом «Скрыть существующие» (#7): существующие = сопоставленные.
  const showRows = (rows: SheetRow[], hide: boolean) => {
    const shown = hide ? rows.filter((r) => !r.productUuid) : rows;
    setPendingRows(shown);
    setCurrentRows(shown);
    setFillVersion((v) => v + 1);
  };
  const applyHideExisting = (next: boolean) => { setHideExisting(next); showRows(allRows, next); };

  // ── Заполнить: парсинг файла в таблицу предпросмотра ──
  const handleFill = async () => {
    if (!file) { showToast("Сначала выберите файл (.xlsx, .xls)", "warning"); return; }
    setIsLoading(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
      if (!raw || raw.length === 0) { showToast("Файл пуст", "warning"); return; }
      const header = (raw[0] as any[]).map((h) => String(h ?? "").trim());
      const headerL = header.map((h) => h.toLowerCase());
      const findIdx = (names: string[]) => {
        for (const n of names) { const i = headerL.indexOf(n.toLowerCase()); if (i >= 0) return i; }
        return -1;
      };
      const idx: Record<string, number> = {};
      for (const k of Object.keys(FIXED)) idx[k] = findIdx(FIXED[k]);
      const used = new Set(Object.values(idx).filter((i) => i >= 0));
      const priceCols = header.map((h, i) => ({ name: h, i })).filter((c) => c.name && !used.has(c.i));

      const get = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
      const rows = (raw.slice(1) as any[])
        .map((r, n) => {
          const prices = priceCols
            .map((c) => ({ typeName: c.name, value: r[c.i] }))
            .filter((p) => p.value != null && p.value !== "")
            .map((p) => ({ typeName: p.typeName, value: parseFloat(String(p.value).replace(",", ".")) }))
            .filter((p) => !Number.isNaN(p.value));
          return {
            id: -(n + 1),
            sku: get(r, idx.sku),
            name: get(r, idx.name),
            brand: get(r, idx.brand),
            unit: get(r, idx.unit),
            isService: /^(да|yes|true|1|услуга)$/i.test(get(r, idx.isService)),
            barcodes: get(r, idx.barcodes),
            prices,
            productUuid: "",
            _matched: false,
            _pendingAction: "create",
          };
        })
        .filter((r) => r.sku || r.name || r.barcodes || r.prices.length);

      if (rows.length === 0) { showToast("В файле нет строк с данными", "warning"); return; }

      // Сопоставление с существующей номенклатурой (#6): ШК → артикул+бренд → наименование.
      try {
        const match = await resolveImportProducts(rows);
        for (const r of rows) {
          const p = match(r);
          if (p) { r.productUuid = p.uuid ?? ""; r._matched = true; }
        }
      } catch (e) { console.error("resolveImportProducts", e); }

      setAllRows(rows);
      showRows(rows, hideExisting);
      setParsed(true);
      const noName = rows.filter((r) => !r.name).length;
      const matched = rows.filter((r) => r.productUuid).length;
      showToast(
        `Строк: ${rows.length}, сопоставлено: ${matched}, новых: ${rows.length - matched}${noName ? `, без наименования: ${noName}` : ""}`,
        noName ? "warning" : "success",
      );
    } catch (err) {
      console.error(err);
      showToast("Ошибка чтения файла", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Загрузить: импорт в БД ──
  const handleUpload = async () => {
    if (!canWrite) return;
    const rows = currentRows
      .filter((r) => r.name || r.sku || splitBarcodes(r.barcodes).length)
      .map((r) => ({
        productUuid: r.productUuid || undefined, // явная ссылка из LookupField (#2/#6)
        sku: r.sku || "",
        name: r.name || "",
        brandName: r.brand || "",
        unitName: r.unit || "",
        isService: !!r.isService,
        barcodes: splitBarcodes(r.barcodes),
        prices: r.prices ?? [],
      }));
    if (rows.length === 0) { showToast("Нет строк для загрузки", "warning"); return; }
    const noName = rows.filter((r) => !r.name && !r.productUuid).length;
    const msg = noName > 0
      ? `Загрузить ${rows.length} строк? ${noName} без наименования будут пропущены (если товар не найден).`
      : `Загрузить ${rows.length} позиций номенклатуры? Цены — на ${priceDate}.`;
    if (!(await confirm(msg))) return;

    setIsLoading(true);
    try {
      const resp = await apiClient.post(`/${ENDPOINT}/import`, { rows, date: priceDate });
      const s = resp.data?.summary;
      showToast(s
        ? `Готово. Создано: ${s.created || 0}, обновлено: ${s.updated || 0}, штрих-кодов: +${s.barcodesAdded || 0}, цен: +${s.pricesAdded || 0}, пропущено: ${s.skipped || 0}`
        : "Импорт завершён", "success");
      setFile(null);
      setAllRows([]);
      setPendingRows([]);
      setCurrentRows([]);
      setParsed(false);
      setFillVersion((v) => v + 1);
    } catch (err) {
      console.error(err);
      showToast("Ошибка при импорте", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Выгрузить всю номенклатуру в xlsx ──
  const handleExport = async () => {
    setIsLoading(true);
    try {
      const resp = await apiClient.get(`/${ENDPOINT}/export-full`);
      const items = (resp.data?.items ?? []) as CatalogProduct[];
      if (items.length === 0) { showToast("Номенклатуры нет", "info"); return; }
      const typeNames: string[] = [];
      const seen = new Set<string>();
      for (const p of items) for (const pp of p.productPrices ?? []) {
        const n = pp.priceType?.name || "(без типа)";
        if (!seen.has(n)) { seen.add(n); typeNames.push(n); }
      }
      const header = ["sku", "name", "brand", "unit", "isService", "barcodes", ...typeNames];
      const aoa = [header, ...items.map((p) => {
        const bcs = Array.from(new Set([p.barcode, ...((p.barcodes ?? []).map((b) => b.barcode))].filter(Boolean)));
        const latest: Record<string, any> = {};
        for (const pp of p.productPrices ?? []) { // отсортированы date desc → первое = последнее значение
          const n = pp.priceType?.name || "(без типа)";
          if (!(n in latest)) latest[n] = pp.price;
        }
        return [p.sku ?? "", p.name ?? "", p.brand?.name ?? "", p.unitOfMeasure?.name ?? "", p.isService ? 1 : 0, bcs.join(";"),
        ...typeNames.map((n) => (latest[n] != null ? latest[n] : ""))];
      })];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "products");
      XLSX.writeFile(wb, `products_export_${today()}.xlsx`);
      showToast(`Выгружено позиций: ${items.length}`, "success");
    } catch (err) {
      console.error(err);
      showToast("Ошибка при выгрузке", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Скачать шаблон (с актуальными типами цен как колонками) ──
  const handleTemplate = async () => {
    try {
      let typeNames: string[] = [];
      try {
        const resp = await apiClient.get(`/price-types`, { params: { limit: 1000 } });
        typeNames = ((resp.data?.items ?? []) as any[]).map((t) => t.name).filter(Boolean);
      } catch { /* ignore */ }
      const header = ["sku", "name", "brand", "unit", "isService", "barcodes", ...typeNames];
      const sample = ["ART-001", "Пример товара", "Бренд", "шт", 0, "4870000000001;4870000000002", ...typeNames.map((_, i) => (i === 0 ? 1000 : ""))];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, sample]), "template");
      XLSX.writeFile(wb, "products_template.xlsx");
    } catch (err) {
      console.error(err);
      showToast("Не удалось сформировать шаблон", "error");
    }
  };

  return (
    <div className={styles.wrap}>
      <HelpBox title={translate("helpImpExpTitle")}>
        <ol>
          <li><HelpText text={translate("helpImpExp1")} /></li>
          <li><HelpText text={translate("helpImpExp2")} /></li>
          <li><HelpText text={translate("helpImpExp3")} /></li>
          <li><HelpText text={translate("helpImpExp4")} values={[translate("priceDate"), translate("hideExisting")]} /></li>
        </ol>
        <div className={styles.notice}>
          <HelpText text={translate("helpImpExpCols")} />
        </div>
      </HelpBox>

      <GroupRow>
        <FieldFile key={`file-${fillVersion}`} name="pie_file" accept=".xls,.xlsx" disabled={isLoading || !canWrite}
          buttonLabel="Выбрать файл" loading={isLoading} onSelect={(f) => { setFile(f); setParsed(false); }} />
        <FieldDate label={translate("priceDate")} name="pie_priceDate" value={priceDate} onChange={(e) => setPriceDate(e.target.value)} disabled={isLoading} />
        <Button variant="primary" onClick={handleFill} disabled={isLoading || !file}>{translate("fill")}</Button>
        <Button onClick={handleUpload} disabled={isLoading || !canWrite || !parsed}>{translate("upload")}</Button>
        <Button onClick={handleTemplate} type="button">{translate("downloadTemplate")}</Button>
        <Button onClick={handleExport} type="button" disabled={isLoading}>{translate("downloadBackup") || "Выгрузить номенклатуру"}</Button>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={hideExisting} onChange={(e) => applyHideExisting(e.target.checked)} disabled={isLoading} />
          {translate("hideExisting")}
        </label>
      </GroupRow>

      {parsed && (
        <div className={styles.summary}>
          <span className={`${styles.badge} ${styles.badgeOk}`}>Позиций: {productCount}</span>
          <span className={styles.badge}>{translate("matched")}: {matchedCount}</span>
          <span className={`${styles.badge} ${newCount ? styles.badgeWarn : ""}`}>Новых: {newCount}</span>
          <span className={styles.badge}>Штрих-кодов: {newBarcodes}</span>
        </div>
      )}

      <div className={styles.tableWrap}>
        <SubTable
          key={`pie-${fillVersion}`}
          model={ENDPOINT}
          componentName="ProductImport_part"
          columnsJson={IMPORT_COLUMNS}
          parentKey="uuid"
          parentUuid=""
          deferRemoteChanges
          clientSort
          initialPendingRows={pendingRows}
          defaultInlineEditing
          emptyMessage={"Выберите файл и нажмите «Заполнить», либо выгрузите всю номенклатуру"}
          onAllItemsChange={setCurrentRows}
          renderCell={cellRenderer}
          defaultNewRow={{ sku: "", name: "", productUuid: "", _matched: false, brand: "", brandUuid: "", unit: "", unitUuid: "", isService: false, barcodes: "", prices: [] }}
        />
      </div>
    </div>
  );
};
ProductImportExport.displayName = "ProductImportExport";

export default ProductImportExport;
