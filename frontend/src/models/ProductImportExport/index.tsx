import React, { FC, useMemo, useState } from "react";
import { translate } from "src/i18";
import { Field, FieldFile } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Button } from "src/components/Button";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { GroupRow } from "src/components/UI";
import mainStyles from "src/styles/main.module.scss";
import styles from "./ProductImportExport.module.scss";
import apiClient from "src/services/api/client";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { useAppContext } from "src/app";
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

const IMPORT_COLUMNS = [
  { identifier: "sku", type: "string", width: "120px", minWidth: "90px", alignment: "left", hint: "Артикул", visible: true, inlist: true },
  { identifier: "name", type: "string", width: "260px", minWidth: "160px", alignment: "left", hint: "Наименование", visible: true, inlist: true },
  { identifier: "brand", type: "string", width: "150px", minWidth: "100px", alignment: "left", hint: "Бренд", visible: true, inlist: true },
  { identifier: "unit", type: "string", width: "100px", minWidth: "70px", alignment: "left", hint: "Ед. изм.", visible: true, inlist: true },
  { identifier: "isService", type: "boolean", width: "80px", minWidth: "60px", alignment: "center", hint: "Услуга", visible: true, inlist: true },
  { identifier: "barcodes", type: "string", width: "210px", minWidth: "120px", alignment: "left", hint: "Штрих-коды", visible: true, inlist: true },
  { identifier: "prices", type: "string", width: "260px", minWidth: "140px", alignment: "left", hint: "Цены", visible: true, inlist: true },
];

const pricesSummary = (r: any): string =>
  (r.prices ?? []).map((p: any) => `${p.typeName}=${p.value}`).join("; ");

const cellRenderer = (row: TDataItem, col: TColumn, ctx: SubTableContext): React.ReactNode | undefined => {
  const r: any = row;
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
  if (["sku", "name", "barcodes"].includes(col.identifier)) {
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
    return <span style={{ color: "#555" }}>{pricesSummary(r)}</span>;
  }
  return undefined;
};

export const ProductImportExport: FC<Partial<TPane>> = () => {
  const { canWrite } = useUserAccessRight("Product");
  const { actions: { confirm } } = useAppContext();
  const [file, setFile] = useState<File | null>(null);
  const [pendingRows, setPendingRows] = useState<any[]>([]);
  const [currentRows, setCurrentRows] = useState<any[]>([]);
  const [fillVersion, setFillVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [parsed, setParsed] = useState(false);

  const productCount = currentRows.length;
  const newBarcodes = useMemo(
    () => currentRows.reduce((acc, r) => acc + splitBarcodes(r.barcodes).length, 0),
    [currentRows],
  );

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

      const get = (r: any[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
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
            _pendingAction: "create",
          };
        })
        .filter((r) => r.sku || r.name || r.barcodes || r.prices.length);

      if (rows.length === 0) { showToast("В файле нет строк с данными", "warning"); return; }
      setPendingRows(rows);
      setCurrentRows(rows);
      setParsed(true);
      setFillVersion((v) => v + 1);
      const noName = rows.filter((r) => !r.name).length;
      showToast(`Загружено строк: ${rows.length}${noName ? `, без наименования: ${noName}` : ""}`, noName ? "warning" : "success");
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
        sku: r.sku || "",
        name: r.name || "",
        brandName: r.brand || "",
        unitName: r.unit || "",
        isService: !!r.isService,
        barcodes: splitBarcodes(r.barcodes),
        prices: r.prices ?? [],
      }));
    if (rows.length === 0) { showToast("Нет строк для загрузки", "warning"); return; }
    const noName = rows.filter((r) => !r.name).length;
    const msg = noName > 0
      ? `Загрузить ${rows.length} строк? ${noName} без наименования будут пропущены (если товар не найден по артикулу).`
      : `Загрузить ${rows.length} позиций номенклатуры?`;
    if (!(await confirm(msg))) return;

    setIsLoading(true);
    try {
      const resp = await apiClient.post(`/${ENDPOINT}/import`, { rows, date: today() });
      const s = resp.data?.summary;
      showToast(s
        ? `Готово. Создано: ${s.created || 0}, обновлено: ${s.updated || 0}, штрих-кодов: +${s.barcodesAdded || 0}, цен: +${s.pricesAdded || 0}, пропущено: ${s.skipped || 0}`
        : "Импорт завершён", "success");
      setFile(null);
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
      const items = (resp.data?.items ?? []) as any[];
      if (items.length === 0) { showToast("Номенклатуры нет", "info"); return; }
      const typeNames: string[] = [];
      const seen = new Set<string>();
      for (const p of items) for (const pp of p.productPrices ?? []) {
        const n = pp.priceType?.name || "(без типа)";
        if (!seen.has(n)) { seen.add(n); typeNames.push(n); }
      }
      const header = ["sku", "name", "brand", "unit", "isService", "barcodes", ...typeNames];
      const aoa = [header, ...items.map((p) => {
        const bcs = Array.from(new Set([p.barcode, ...((p.barcodes ?? []).map((b: any) => b.barcode))].filter(Boolean)));
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
      <div className={styles.help}>
        <div className={styles.helpTitle}>ℹ️ Импорт / экспорт номенклатуры (.xlsx, .xls)</div>
        <ol className={styles.helpSteps}>
          <li><b>Выгрузка</b>: «Выгрузить номенклатуру» — все товары одним файлом. Штрих-коды одного товара — в одной ячейке через «;», цены — отдельной колонкой на каждый тип цены.</li>
          <li><b>Загрузка</b>: «Скачать шаблон» → заполнить → выбрать файл → «Заполнить» (предпросмотр, можно править) → «Загрузить».</li>
          <li>Товар ищется по <b>артикулу</b> (затем по первому штрих-коду): найден — обновляется, иначе создаётся. Бренд / ед. изм. / тип цены сопоставляются по наименованию.</li>
          <li>Штрих-коды добавляются без дублей; цены создаются на сегодняшнюю дату (повторы пропускаются).</li>
        </ol>
        <div className={styles.notice} style={{ marginTop: 6 }}>
          Колонки: «sku / артикул», «name / наименование», «brand / бренд», «unit / ед. изм.», «isService / услуга», «barcodes / штрих-коды», далее по колонке на каждый тип цены.
        </div>
      </div>

      <GroupRow className={mainStyles.GroupRowWrap}>
        <FieldFile key={`file-${fillVersion}`} name="pie_file" accept=".xls,.xlsx" disabled={isLoading || !canWrite}
          buttonLabel="Выбрать файл" onSelect={(f) => { setFile(f); setParsed(false); }} />
        <Button variant="primary" onClick={handleFill} disabled={isLoading || !file}>{translate("fill")}</Button>
        <Button onClick={handleUpload} disabled={isLoading || !canWrite || !parsed}>{translate("upload")}</Button>
        <Button onClick={handleTemplate} type="button">{translate("downloadTemplate")}</Button>
        <Button onClick={handleExport} type="button" disabled={isLoading}>{translate("downloadBackup") || "Выгрузить номенклатуру"}</Button>
      </GroupRow>

      {parsed && (
        <div className={styles.summary}>
          <span className={`${styles.badge} ${styles.badgeOk}`}>Позиций: {productCount}</span>
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
          initialPendingRows={pendingRows}
          defaultInlineEditing
          emptyMessage={"Выберите файл и нажмите «Заполнить», либо выгрузите всю номенклатуру"}
          onAllItemsChange={setCurrentRows}
          renderCell={cellRenderer}
          defaultNewRow={{ sku: "", name: "", brand: "", brandUuid: "", unit: "", unitUuid: "", isService: false, barcodes: "", prices: [] }}
        />
      </div>
    </div>
  );
};
ProductImportExport.displayName = "ProductImportExport";

export const ProductImportExportList: FC<{ variant?: any; onSelectItem?: any }> = () => <ProductImportExport />;
ProductImportExportList.displayName = "ProductImportExportList";

export default ProductImportExportList;
